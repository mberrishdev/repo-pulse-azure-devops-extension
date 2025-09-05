import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as SDK from "azure-devops-extension-sdk";
import { showRootComponent } from "../Common";
import { getClient, ILocationService } from "azure-devops-extension-api";

const EXTENSION_VERSION = "0.0.64";
const EXTENSION_NAME = "Repo Pulse";
import {
  GitRestClient,
  GitRepository,
  GitPullRequest,
  PullRequestStatus,
  GitPullRequestSearchCriteria,
} from "azure-devops-extension-api/Git";
import {
  BuildRestClient,
  Build,
  BuildStatus,
  BuildResult,
  BuildDefinitionReference,
} from "azure-devops-extension-api/Build";
import {
  CommonServiceIds,
  IGlobalMessagesService,
  IToast,
} from "azure-devops-extension-api";

interface HomePageState {
  repos: GitRepository[];
  pullRequests: GitPullRequest[];
  loading: boolean;
  error?: string;
  selectedTabId: string;
  groupedPullRequests: Record<string, GitPullRequest[]>;
  buildStatuses: Record<string, RepositoryBuildStatus>;
  favoriteRepoIds: Set<string>;
  selectedRepoIds: Set<string>;
  isTriggeringPipelines: boolean;
  triggeringRepoIds: Set<string>;
  prBuildStatuses: Record<number, PullRequestBuildStatus>;
  loadingPRBuilds: boolean;
}

interface RepositoryBuildStatus {
  status: BuildStatus;
  result?: BuildResult;
  finishTime?: Date;
  startTime?: Date;
  buildNumber?: string;
  buildId?: number;
  isLoading: boolean;
  definitionId?: number;
  definitionName?: string;
  pipelineNames?: string[];
  pipelineUrls?: string[]; // Array of pipeline URLs associated with this repository
}

interface PullRequestBuildStatus {
  status: BuildStatus;
  result?: BuildResult;
  buildNumber?: string;
  buildId?: number;
  isLoading: boolean;
  approvalStatus:
    | "approved"
    | "waiting-for-author"
    | "rejected"
    | "pending"
    | "unknown";
  reviewerCount: number;
  requiredReviewerCount: number;
  hasAutoComplete: boolean;
}

interface HomePageConfig {
  azureDevOpsBaseUrl: string;
}

export class HomePage extends React.Component<object, HomePageState> {
  private config: HomePageConfig = {
    azureDevOpsBaseUrl: "https://dev.azure.com", // Will be set automatically from LocationService
  };

  private CORE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";

  private gitClient: GitRestClient | null = null;
  private buildClient: BuildRestClient | null = null;

  public async getOrganizationBaseUrl(): Promise<string> {
    const loc = await SDK.getService<ILocationService>(
      CommonServiceIds.LocationService
    );
    return await loc.getResourceAreaLocation(this.CORE_AREA_ID);
  }

  private async initializeSDKClients(): Promise<void> {
    try {
      this.gitClient = getClient(GitRestClient);
      this.buildClient = getClient(BuildRestClient);
    } catch (error) {
      console.error("Failed to initialize SDK clients:", error);
      throw error;
    }
  }

  private async loadFavoriteRepositories() {
    try {
      const projectInfo = this.getProjectInfo();

      if (!projectInfo?.name) {
        return;
      }

      const storageKey = `repo-pulse-favorites-${projectInfo.name}`;
      const storedFavorites = localStorage.getItem(storageKey);

      if (storedFavorites) {
        const favoriteIds = JSON.parse(storedFavorites) as string[];
        this.setState({ favoriteRepoIds: new Set(favoriteIds) });
      }
    } catch (error) {
      console.error("Failed to load favorite repositories:", error);
    }
  }

  private sortRepositoriesByFavorites(
    repos: GitRepository[],
    favoriteIds?: Set<string>
  ): GitRepository[] {
    const favoriteRepoIds = favoriteIds || this.state.favoriteRepoIds;

    return repos.sort((a, b) => {
      const aIsFavorite = favoriteRepoIds.has(a.id || "");
      const bIsFavorite = favoriteRepoIds.has(b.id || "");

      // If one is favorite and the other isn't, favorite comes first
      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;

      // If both are favorites or both are not favorites, sort alphabetically by name
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  private getProjectFromUrl(): { id?: string; name?: string } | null {
    try {
      const url = window.top?.location.href;

      // Try to extract project name from various URL patterns
      // Pattern 1: https://server/collection/project/_git/repo
      // Pattern 2: https://server/collection/project/_apps/hub/...
      const patterns = [
        /\/([^\/]+)\/([^\/]+)\/_git/,
        /\/([^\/]+)\/([^\/]+)\/_apps/,
        /\/([^\/]+)\/([^\/]+)\/_build/,
        /\/([^\/]+)\/([^\/]+)\/_work/,
        /\/([^\/]+)\/([^\/]+)\/$/,
      ];

      for (const pattern of patterns) {
        const match = url?.match(pattern);
        if (match && match[2]) {
          const projectName = decodeURIComponent(match[2]);

          return { name: projectName };
        }
      }

      return null;
    } catch (error) {
      console.error("Error extracting project from URL:", error);
      return null;
    }
  }

  private getProjectInfo(): { id?: string; name?: string } | null {
    const webContext = SDK.getWebContext();

    if (webContext.project?.id) {
      return webContext.project;
    }

    const urlProject = this.getProjectFromUrl();
    if (urlProject?.name) {
      return urlProject;
    }

    return null;
  }

  constructor(props: object) {
    super(props);
    this.state = {
      repos: [],
      pullRequests: [],
      loading: true,
      selectedTabId: this.getInitialTabFromUrl(),
      groupedPullRequests: {},
      buildStatuses: {},
      favoriteRepoIds: new Set<string>(),
      selectedRepoIds: new Set<string>(),
      isTriggeringPipelines: false,
      triggeringRepoIds: new Set<string>(),
      prBuildStatuses: {},
      loadingPRBuilds: false,
    };
  }

  public async componentDidMount() {
    try {
      await SDK.init({ applyTheme: true });
      await SDK.ready();

      this.setupBrowserHistorySupport();

      await this.initializeConfig();
      await this.initializeSDKClients();

      await new Promise((resolve) => setTimeout(resolve, 500));

      await this.checkPermissions();
      await this.loadFavoriteRepositories();
      await this.loadRepositories();
      await this.loadPullRequests();
    } catch (error) {
      console.error("Extension initialization failed:", error);
      await this.showToast("Failed to initialize extension", "error");
    }
  }

  public componentWillUnmount() {
    // Clean up browser history event listener from both iframe and parent
    window.removeEventListener("popstate", this.handlePopState);

    try {
      if (window.top && window.top !== window) {
        window.top.removeEventListener("popstate", this.handlePopState);
      }
    } catch (error) {
      // Cross-origin restriction, ignore
    }
  }

  private setupBrowserHistorySupport = () => {
    window.addEventListener("popstate", this.handlePopState);

    try {
      if (window.top && window.top !== window) {
        window.top.addEventListener("popstate", this.handlePopState);
      }
    } catch (error) {
      console.log("Cross-origin restriction, only iframe navigation will work");
    }

    const currentTab = this.getQueryParam("tab");
    if (!currentTab) {
      this.setQueryParam("tab", this.state.selectedTabId);
    }
  };

  private handlePopState = () => {
    const tabFromUrl = this.getInitialTabFromUrl();
    if (tabFromUrl !== this.state.selectedTabId) {
      this.setState({ selectedTabId: tabFromUrl });
    }
  };

  private async checkPermissions() {
    try {
      const projectInfo = this.getProjectInfo();

      if (!projectInfo?.name) {
        console.error(
          "No project ID found in webContext and could not extract from URL!"
        );

        this.setState({
          loading: false,
        });
        return;
      }

      if (!this.gitClient) {
        throw new Error("Git client not initialized");
      }

      try {
        await this.gitClient.getRepositories(
          projectInfo.id || projectInfo.name
        );
      } catch (permError) {
        const permErrorMessage =
          permError instanceof Error ? permError.message : String(permError);
        console.error("Permission check via SDK failed:", permError);

        if (
          permErrorMessage.includes("403") ||
          permErrorMessage.includes("Forbidden")
        ) {
          await this.showToast("Access denied to Git repositories", "error");
        } else if (
          permErrorMessage.includes("401") ||
          permErrorMessage.includes("Unauthorized")
        ) {
          await this.showToast(
            "Authentication error - please reload extension",
            "error"
          );
        } else {
          await this.showToast(
            `SDK access failed: ${permErrorMessage}`,
            "error"
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Permission check error:", error);
      await this.showToast(`Permission check failed: ${errorMessage}`, "error");
    }
  }

  private async initializeConfig() {
    try {
      const baseUrl = await this.getOrganizationBaseUrl();
      const url = new URL(baseUrl);
      this.config.azureDevOpsBaseUrl = `${url.protocol}//${url.host}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.showToast(
        `Error detecting base URL using LocationService: ${errorMessage}.`,
        "warning"
      );
    }
  }

  async loadRepositories() {
    try {
      const projectInfo = this.getProjectInfo();

      if (!this.gitClient) {
        throw new Error("Git client not initialized");
      }

      const repos = await this.gitClient.getRepositories(
        projectInfo?.id || projectInfo?.name
      );

      const sortedRepos = this.sortRepositoriesByFavorites(repos);

      this.setState({
        repos: sortedRepos,
        loading: false,
      });

      this.loadBuildStatusesForRepositories(repos, projectInfo);
    } catch (error: unknown) {
      let message = "Failed to load repositories";
      let isPermissionError = false;

      if (error instanceof Error) {
        message = error.message;

        if (
          message.includes("403") ||
          message.includes("Forbidden") ||
          message.includes("unauthorized") ||
          message.includes("permission") ||
          message.includes("access denied") ||
          message.includes("401")
        ) {
          isPermissionError = true;
          message = `Access Denied: You don't have permission to read repositories via SDK. Check your Azure DevOps permissions.`;
        }
      }

      this.setState({
        error: message,
        loading: false,
      });

      if (isPermissionError) {
        await this.showToast(
          "Permission Error: Cannot read repositories. Contact your Azure DevOps administrator to grant 'Repository Read' permissions.",
          "error"
        );
      } else {
        await this.showToast(
          `Failed to load repositories: ${message}`,
          "error"
        );
      }
    }
  }

  private async loadBuildStatusesForRepositories(
    repos: GitRepository[],
    projectInfo: { id?: string; name?: string } | null
  ) {
    if (!projectInfo?.name || !this.buildClient) {
      return;
    }

    const initialBuildStatuses: Record<string, RepositoryBuildStatus> = {};
    repos.forEach((repo) => {
      if (repo.id) {
        initialBuildStatuses[repo.id] = {
          status: BuildStatus.None,
          isLoading: true,
        };
      }
    });

    this.setState((prevState) => ({
      buildStatuses: { ...prevState.buildStatuses, ...initialBuildStatuses },
    }));

    await this.loadAllBuildDefinitionsAndMapToRepos(repos, projectInfo.name!);
  }

  private async loadAllBuildDefinitionsAndMapToRepos(
    repos: GitRepository[],
    projectName: string
  ) {
    try {
      if (!this.buildClient) {
        return;
      }

      const definitionsByRepo = new Map<string, any[]>();

      // Get definitions for each repository individually since repository ID is mandatory
      for (const repo of repos) {
        if (!repo.id) continue;

        try {
          const repoDefinitions = await this.buildClient.getDefinitions(
            projectName,
            undefined, // name
            repo.id, // repositoryId - use the loaded repository ID
            "TfsGit", // repositoryType - specify Git repository type
            undefined, // queryOrder
            undefined, // top
            undefined, // continuationToken
            undefined, // minMetricsTime
            undefined, // definitionIds
            undefined, // path
            undefined, // builtAfter
            undefined, // notBuiltAfter
            true, // includeAllProperties
            true // includeLatestBuilds
          );

          console.log(`TEST-definitions for ${repo.name}:`, repoDefinitions);

          if (repoDefinitions.length > 0) {
            definitionsByRepo.set(repo.id, repoDefinitions);
          }
        } catch (error) {
          console.warn(`Failed to load definitions for repo ${repo.name}:`, error);
        }
      }

      // Process each repository's definitions
      const processPromises = repos.map(async (repo) => {
        if (!repo.id) return;

        const definitions = definitionsByRepo.get(repo.id);
        if (!definitions || definitions.length === 0) {
          // Set loading to false for repositories with no definitions
          this.setState((prevState) => ({
            buildStatuses: {
              ...prevState.buildStatuses,
              [repo.id!]: {
                status: BuildStatus.None,
                isLoading: false,
                pipelineNames: [],
                pipelineUrls: [],
              },
            },
          }));
          return;
        }

        // Extract all pipeline names and URLs for this repository
        const pipelineNames = definitions.map(def => def.name).filter(name => name);
        const pipelineUrls = definitions.map(def => {
          if (def.id && def.name) {
            return `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectName}/_build?definitionId=${def.id}`;
          }
          return null;
        }).filter((url): url is string => url !== null);

        // Find the most relevant definition (prefer pr-validation or azure-pipeline)
        let prValidationDef = definitions.find(def => 
          def.name?.toLowerCase().includes("pr-validation") ||
          def.name?.toLowerCase().includes("azure-pipeline")
        );
        
        // If no specific definition found, use the first one
        if (!prValidationDef) {
          prValidationDef = definitions[0];
        }

        if (!prValidationDef?.id) {
          this.setState((prevState) => ({
            buildStatuses: {
              ...prevState.buildStatuses,
              [repo.id!]: {
                status: BuildStatus.None,
                isLoading: false,
                pipelineNames: pipelineNames,
                pipelineUrls: pipelineUrls,
              },
            },
          }));
          return;
        }

        try {
          const builds = await this.buildClient!.getBuilds(
            projectName,
            [prValidationDef.id],
            undefined, // queues
            undefined, // buildNumber
            undefined, // minTime
            undefined, // maxTime
            undefined, // requestedFor
            undefined, // reasonFilter
            undefined, // statusFilter
            undefined, // resultFilter
            undefined, // tagFilters
            undefined, // properties
            1 // top - get only the latest build
          );

          if (builds.length > 0) {
            const latestBuild = builds[0];
            const buildStatus: RepositoryBuildStatus = {
              status: latestBuild.status,
              result: latestBuild.result,
              finishTime: latestBuild.finishTime,
              startTime: latestBuild.startTime,
              buildNumber: latestBuild.buildNumber,
              buildId: latestBuild.id,
              isLoading: false,
              definitionId: prValidationDef.id,
              definitionName: prValidationDef.name,
              pipelineNames: pipelineNames,
              pipelineUrls: pipelineUrls,
            };

            this.setState((prevState) => ({
              buildStatuses: {
                ...prevState.buildStatuses,
                [repo.id!]: buildStatus,
              },
            }));
          } else {
            // No builds found for this definition
            this.setState((prevState) => ({
              buildStatuses: {
                ...prevState.buildStatuses,
                [repo.id!]: {
                  status: BuildStatus.None,
                  isLoading: false,
                  pipelineNames: pipelineNames,
                  pipelineUrls: pipelineUrls,
                },
              },
            }));
          }
        } catch (buildError) {
          // Set loading to false even on error
          this.setState((prevState) => ({
            buildStatuses: {
              ...prevState.buildStatuses,
              [repo.id!]: {
                status: BuildStatus.None,
                isLoading: false,
                pipelineNames: pipelineNames,
                pipelineUrls: pipelineUrls,
              },
            },
          }));
        }
      });

      await Promise.allSettled(processPromises);
    } catch (error) {
      console.error("Failed to load build definitions:", error);
    }
  }

  async loadPullRequests() {
    try {
      const projectInfo = this.getProjectInfo();

      if (!projectInfo?.name) {
        return;
      }

      if (!this.gitClient) {
        throw new Error("Git client not initialized");
      }

      const searchCriteria = {
        status: PullRequestStatus.Active, // This includes both active and draft PRs
      };

      const allPullRequests = await this.gitClient.getPullRequestsByProject(
        projectInfo.id || projectInfo.name,
        searchCriteria as any
      );

      const groupedPullRequests = this.groupPullRequests(allPullRequests);

      this.setState({
        pullRequests: allPullRequests,
        groupedPullRequests,
      });

      // Load build statuses for pull requests
      await this.loadPullRequestBuildStatuses(allPullRequests);
    } catch (error: unknown) {
      console.error("Failed to load pull requests:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      let isPermissionError = false;

      // Check for permission-related errors
      if (
        errorMessage.includes("403") ||
        errorMessage.includes("Forbidden") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("permission") ||
        errorMessage.includes("access denied") ||
        errorMessage.includes("401")
      ) {
        isPermissionError = true;
      }

      this.setState({
        pullRequests: [],
        groupedPullRequests: {},
      });

      if (isPermissionError) {
        await this.showToast(
          `Permission Error: Cannot read pull requests via SDK. Contact your Azure DevOps administrator to grant access.`,
          "error"
        );
      } else {
        await this.showToast(
          `Failed to load pull requests: ${errorMessage}`,
          "error"
        );
      }
    }
  }

  private async loadPullRequestBuildStatuses(pullRequests: GitPullRequest[]) {
    if (!pullRequests.length || !this.buildClient) {
      return;
    }

    this.setState({ loadingPRBuilds: true });

    const statusPromises = pullRequests.map(async (pr) => {
      if (!pr.pullRequestId) return;

      try {
        // Initialize loading state for this PR
        this.setState((prevState) => ({
          prBuildStatuses: {
            ...prevState.prBuildStatuses,
            [pr.pullRequestId!]: {
              status: BuildStatus.None,
              isLoading: true,
              approvalStatus: "unknown",
              reviewerCount: 0,
              requiredReviewerCount: 0,
              hasAutoComplete: false,
            },
          },
        }));

        // If reviewers are not populated, try to get detailed PR information
        let detailedPR = pr;
        if (!pr.reviewers || pr.reviewers.length === 0) {
          try {
            detailedPR = await this.gitClient!.getPullRequestById(
              pr.pullRequestId,
              pr.repository?.id || ""
            );
          } catch (detailError) {
            console.warn(
              `Failed to get detailed PR info for ${pr.pullRequestId}:`,
              detailError
            );
            detailedPR = pr; // Fall back to original PR data
          }
        }

        // Get build status for the PR
        const builds = await this.buildClient!.getBuilds(
          pr.repository?.project?.name || "",
          undefined, // definitions
          undefined, // queues
          undefined, // buildNumber
          undefined, // minTime
          undefined, // maxTime
          undefined, // requestedFor
          undefined, // reasonFilter
          undefined, // statusFilter
          undefined, // resultFilter
          undefined, // tagFilters
          undefined, // properties
          5, // top - get recent builds
          undefined, // continuationToken
          undefined, // maxBuildsPerDefinition
          undefined, // deletedFilter
          undefined, // queryOrder
          pr.sourceRefName // branch filter
        );

        // Find the most recent build for this PR's source branch
        const latestBuild = builds.find(
          (build) =>
            build.sourceBranch === pr.sourceRefName ||
            build.triggerInfo?.["pr.number"] === pr.pullRequestId?.toString()
        );

        // Get approval status information
        let approvalStatus:
          | "approved"
          | "waiting-for-author"
          | "rejected"
          | "pending"
          | "unknown" = "unknown";
        let reviewerCount = 0;
        let requiredReviewerCount = 0;

        if (detailedPR.reviewers && detailedPR.reviewers.length > 0) {
          const approvedReviewers = detailedPR.reviewers.filter(
            (r) => r.vote === 10
          ); // 10 = approved
          const rejectedReviewers = detailedPR.reviewers.filter(
            (r) => r.vote === -10
          ); // -10 = rejected
          const waitingReviewers = detailedPR.reviewers.filter(
            (r) => r.vote === -5
          ); // -5 = waiting for author
          const noVoteReviewers = detailedPR.reviewers.filter(
            (r) => r.vote === 0 || !r.vote
          ); // 0 or null = no vote

          reviewerCount = detailedPR.reviewers.length;
          requiredReviewerCount = detailedPR.reviewers.filter(
            (r) => r.isRequired
          ).length;

          if (rejectedReviewers.length > 0) {
            approvalStatus = "rejected";
          } else if (waitingReviewers.length > 0) {
            approvalStatus = "waiting-for-author";
          } else if (approvedReviewers.length > 0) {
            // Check if we have enough approvals
            if (requiredReviewerCount > 0) {
              // If there are required reviewers, check if all required reviewers approved
              const requiredReviewers = detailedPR.reviewers.filter(
                (r) => r.isRequired
              );
              const approvedRequiredReviewers = requiredReviewers.filter(
                (r) => r.vote === 10
              );

              if (approvedRequiredReviewers.length >= requiredReviewerCount) {
                approvalStatus = "approved";
              } else {
                approvalStatus = "pending";
              }
            } else {
              // No specific required reviewers, any approval is good
              approvalStatus = "approved";
            }
          } else if (noVoteReviewers.length > 0) {
            approvalStatus = "pending";
          } else {
            approvalStatus = "pending";
          }
        } else {
          if (pr.status === 1) {
            // Active
            approvalStatus = "pending";
          }
        }

        const prBuildStatus: PullRequestBuildStatus = {
          status: latestBuild?.status || BuildStatus.None,
          result: latestBuild?.result,
          buildNumber: latestBuild?.buildNumber,
          buildId: latestBuild?.id,
          isLoading: false,
          approvalStatus,
          reviewerCount,
          requiredReviewerCount,
          hasAutoComplete: !!detailedPR.autoCompleteSetBy,
        };

        this.setState((prevState) => ({
          prBuildStatuses: {
            ...prevState.prBuildStatuses,
            [pr.pullRequestId!]: prBuildStatus,
          },
        }));
      } catch (error) {
        console.error(
          `Failed to load build status for PR ${pr.pullRequestId}:`,
          error
        );

        // Set error state for this PR
        this.setState((prevState) => ({
          prBuildStatuses: {
            ...prevState.prBuildStatuses,
            [pr.pullRequestId!]: {
              status: BuildStatus.None,
              isLoading: false,
              approvalStatus: "unknown",
              reviewerCount: 0,
              requiredReviewerCount: 0,
              hasAutoComplete: false,
            },
          },
        }));
      }
    });

    await Promise.allSettled(statusPromises);
    this.setState({ loadingPRBuilds: false });
  }

  private groupPullRequests = (
    pullRequests: GitPullRequest[]
  ): Record<string, GitPullRequest[]> => {
    const groups: Record<string, GitPullRequest[]> = {};

    // Group all PRs (draft and active) by title
    pullRequests.forEach((pr) => {
      const title = pr.title || "Untitled";

      if (!groups[title]) {
        groups[title] = [];
      }
      groups[title].push(pr);
    });

    return groups;
  };

  private onTabChanged = (selectedTabId: string) => {
    // Update the URL query parameter
    this.setQueryParam("tab", selectedTabId);

    // Update the state
    this.setState({ selectedTabId });
  };

  private getStatusText = (status: number): string => {
    switch (status) {
      case 1:
        return "Active";
      case 2:
        return "Abandoned";
      case 3:
        return "Completed";
      default:
        return "Unknown";
    }
  };

  private getStatusColor = (status: number): string => {
    switch (status) {
      case 1:
        return "#107c10"; // Green for active
      case 2:
        return "#ff8c00"; // Orange for abandoned
      case 3:
        return "#d13438"; // Red for completed
      default:
        return "#666666"; // Gray for unknown
    }
  };

  private getBuildStatusColor = (
    status: BuildStatus,
    result?: BuildResult
  ): string => {
    if (status === BuildStatus.InProgress) {
      return "#0078d4"; // Blue for in progress
    }

    if (status === BuildStatus.Completed && result) {
      switch (result) {
        case BuildResult.Succeeded:
          return "#107c10"; // Green for success
        case BuildResult.Failed:
          return "#d13438"; // Red for failed
        case BuildResult.PartiallySucceeded:
          return "#ff8c00"; // Orange for partially succeeded
        case BuildResult.Canceled:
          return "#666666"; // Gray for canceled
        default:
          return "#666666";
      }
    }

    return "#cccccc"; // Light gray for unknown/none
  };

  private getBuildStatusText = (
    status: BuildStatus,
    result?: BuildResult
  ): string => {
    if (status === BuildStatus.InProgress) {
      return "In Progress";
    }

    if (status === BuildStatus.Completed && result) {
      switch (result) {
        case BuildResult.Succeeded:
          return "Succeeded";
        case BuildResult.Failed:
          return "Failed";
        case BuildResult.PartiallySucceeded:
          return "Partial";
        case BuildResult.Canceled:
          return "Canceled";
        default:
          return "Unknown";
      }
    }

    return "No builds";
  };

  private getBuildStatusIcon = (
    status: BuildStatus,
    result?: BuildResult
  ): string => {
    if (status === BuildStatus.InProgress) {
      return "PlaySolid";
    }

    if (status === BuildStatus.Completed && result) {
      switch (result) {
        case BuildResult.Succeeded:
          return "CheckMark";
        case BuildResult.Failed:
          return "Error";
        case BuildResult.PartiallySucceeded:
          return "Warning";
        case BuildResult.Canceled:
          return "Cancel";
        default:
          return "Unknown";
      }
    }

    return "BuildDefinition";
  };

  private getApprovalStatusColor = (approvalStatus: string): string => {
    switch (approvalStatus) {
      case "approved":
        return "#107c10"; // Green
      case "rejected":
        return "#d13438"; // Red
      case "waiting-for-author":
        return "#ff8c00"; // Orange
      case "pending":
        return "#0078d4"; // Blue
      default:
        return "#666666"; // Gray
    }
  };

  private getApprovalStatusText = (approvalStatus: string): string => {
    switch (approvalStatus) {
      case "approved":
        return "Approved";
      case "rejected":
        return "Rejected";
      case "waiting-for-author":
        return "Waiting for Author";
      case "pending":
        return "Pending Review";
      default:
        return "Unknown";
    }
  };

  private getApprovalStatusIcon = (approvalStatus: string): string => {
    switch (approvalStatus) {
      case "approved":
        return "CheckMark";
      case "rejected":
        return "Cancel";
      case "waiting-for-author":
        return "Warning";
      case "pending":
        return "Clock";
      default:
        return "Unknown";
    }
  };

  private isPullRequestReadyToMerge = (
    pr: GitPullRequest,
    prBuildStatus?: PullRequestBuildStatus
  ): boolean => {
    if (!prBuildStatus) return false;

    if (pr.status !== PullRequestStatus.Active) return false;

    if (pr.isDraft) return false;

    const buildsPassing =
      prBuildStatus.status === BuildStatus.Completed &&
      prBuildStatus.result === BuildResult.Succeeded;

    const isApproved = prBuildStatus.approvalStatus === "approved";

    return buildsPassing && isApproved;
  };

  /**
   * Navigate to a URL from within the Azure DevOps iframe context
   * This properly handles navigation to preserve browser history
   */
  private navigateToUrl = (url: string) => {
    try {
      // Try to navigate the parent window (outside iframe) to preserve history
      if (window.top && window.top !== window) {
        window.top.location.href = url;
      } else if (window.parent && window.parent !== window) {
        // If window.top is not available, try parent
        window.parent.location.href = url;
      } else {
        // Last resort: open in new tab with _parent target
        window.open(url, "_parent");
      }
    } catch (error) {
      // Cross-origin restrictions might prevent access to window.top
      // Fall back to opening in new tab
      console.warn(
        "Could not navigate parent window, opening in new tab:",
        error
      );
      window.open(url, "_blank");
    }
  };

  private openRepository = (repo: GitRepository) => {
    const projectInfo = this.getProjectInfo();

    if (!projectInfo?.name) {
      console.error("Cannot open repository: No project context available");
      return;
    }

    const repoUrl = `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectInfo.name}/_git/${repo.name}`;
    this.navigateToUrl(repoUrl);
  };

  private openBuild = (buildId: number) => {
    const projectInfo = this.getProjectInfo();

    if (!projectInfo?.name) {
      console.error("Cannot open build: No project context available");
      return;
    }

    const buildUrl = `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectInfo.name}/_build/results?buildId=${buildId}`;
    this.navigateToUrl(buildUrl);
  };

  private createUpdatePRFromMaster = async (
    repo: GitRepository,
    targetRefName?: string
  ) => {
    try {
      const projectInfo = this.getProjectInfo();

      if (!projectInfo?.name) {
        await this.showToast("No project context available", "error");
        return;
      }

      const masterBranch = "master";
      const projectName = projectInfo.name;

      if (!this.gitClient) {
        throw new Error("Git client not initialized");
      }

      // Create pull request using SDK
      const prData: Partial<GitPullRequest> = {
        sourceRefName: `refs/heads/${masterBranch}`,
        targetRefName: `${targetRefName}`,
        title: `Update ${targetRefName} from ${masterBranch}`,
        description: `Automated PR to update ${targetRefName} with latest changes from ${masterBranch}`,
        isDraft: false,
      };

      const pullRequest = await this.gitClient.createPullRequest(
        prData as GitPullRequest,
        repo.id
      );

      if (pullRequest) {
        const prUrl = `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectName}/_git/${repo.name}/pullrequest/${pullRequest.pullRequestId}`;
        this.navigateToUrl(prUrl);
      }
    } catch (error: unknown) {
      console.error(`Failed to create update PR for ${repo.name}:`, error);

      // Handle specific error cases
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("TF401179") ||
        errorMessage.includes("already exists")
      ) {
        await this.showToast(
          `A pull request from master to ${targetRefName} already exists for ${repo.name}. Please check existing pull requests.`,
          "warning"
        );
      } else if (
        errorMessage.includes("TF401028") ||
        errorMessage.includes("source") ||
        errorMessage.includes("master")
      ) {
        await this.showToast(
          `The source branch 'master' does not exist in ${repo.name}. Please ensure the master branch exists.`,
          "warning"
        );
      } else if (
        errorMessage.includes("TF401027") ||
        errorMessage.includes("target")
      ) {
        await this.showToast(
          `The target branch '${targetRefName}' does not exist in ${repo.name}. Please check the branch name.`,
          "warning"
        );
      } else if (errorMessage.includes("403") || errorMessage.includes("401")) {
        await this.showToast(
          `Permission denied: Cannot create pull request for ${repo.name}. Contact your Azure DevOps administrator.`,
          "error"
        );
      } else {
        await this.showToast(
          `Failed to create pull request for ${repo.name}: ${errorMessage}`,
          "error"
        );
      }
    }
  };

  private showToast = async (
    message: string,
    type: "success" | "warning" | "error" | "info"
  ) => {
    try {
      const messagesService = await SDK.getService<IGlobalMessagesService>(
        CommonServiceIds.GlobalMessagesService
      );
      const toast: IToast = {
        message: message,
        duration: 5000, // 5 seconds
      };
      messagesService.addToast(toast);
    } catch (error) {
      console.error("Failed to show toast:", error);
    }
  };

  private triggerPipeline = async (
    repoId: string,
    definitionId: number,
    repoName: string
  ) => {
    try {
      const projectInfo = this.getProjectInfo();
      if (!projectInfo?.name || !this.buildClient) {
        throw new Error("Project context or build client not available");
      }

      this.setState((prevState) => ({
        triggeringRepoIds: new Set(prevState.triggeringRepoIds).add(repoId),
        buildStatuses: {
          ...prevState.buildStatuses,
          [repoId]: {
            ...prevState.buildStatuses[repoId],
            status: BuildStatus.InProgress,
            result: undefined,
            buildNumber: undefined,
            buildId: undefined,
            isLoading: false,
          },
        },
      }));

      const buildToQueue = {
        definition: {
          id: definitionId,
        },
        sourceBranch: "refs/heads/master",
      };

      const build = await this.buildClient.queueBuild(
        buildToQueue as any,
        projectInfo.id || projectInfo.name
      );

      this.setState((prevState) => ({
        buildStatuses: {
          ...prevState.buildStatuses,
          [repoId]: {
            ...prevState.buildStatuses[repoId],
            status: BuildStatus.InProgress,
            buildNumber: build.buildNumber,
            buildId: build.id,
            isLoading: false,
          },
        },
      }));

      await this.showToast(
        `Pipeline triggered successfully for ${repoName} (Build #${build.buildNumber})`,
        "success"
      );

      setTimeout(() => {
        this.refreshBuildStatusForRepo(repoId, projectInfo.name!);
      }, 2000);
    } catch (error) {
      console.error(`Failed to trigger pipeline for ${repoName}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("403") || errorMessage.includes("401")) {
        await this.showToast(
          `Permission denied: Cannot trigger pipeline for ${repoName}. Contact your Azure DevOps administrator.`,
          "error"
        );
      } else {
        await this.showToast(
          `Failed to trigger pipeline for ${repoName}: ${errorMessage}`,
          "error"
        );
      }
    } finally {
      // Remove loading state for this repo
      this.setState((prevState) => {
        const newTriggeringRepoIds = new Set(prevState.triggeringRepoIds);
        newTriggeringRepoIds.delete(repoId);
        return { triggeringRepoIds: newTriggeringRepoIds };
      });
    }
  };

  private triggerSelectedPipelines = async () => {
    const { selectedRepoIds, repos, buildStatuses } = this.state;

    if (selectedRepoIds.size === 0) {
      await this.showToast("Please select at least one repository", "warning");
      return;
    }

    this.setState({ isTriggeringPipelines: true });

    const triggerPromises = Array.from(selectedRepoIds).map(async (repoId) => {
      const repo = repos.find((r) => r.id === repoId);
      const buildStatus = buildStatuses[repoId];

      if (repo && buildStatus?.definitionId) {
        await this.triggerPipeline(
          repoId,
          buildStatus.definitionId,
          repo.name || "Unknown"
        );
      }
    });

    try {
      await Promise.allSettled(triggerPromises);
      await this.showToast(
        `Triggered pipelines for ${selectedRepoIds.size} repositories`,
        "success"
      );
    } catch (error) {
      console.error("Error during batch pipeline trigger:", error);
    } finally {
      this.setState({
        isTriggeringPipelines: false,
        selectedRepoIds: new Set(), // Clear selection after triggering
      });
    }
  };

  private refreshBuildStatusForRepo = async (
    repoId: string,
    projectName: string
  ) => {
    const buildStatus = this.state.buildStatuses[repoId];
    if (!buildStatus?.definitionId || !this.buildClient) {
      return;
    }

    try {
      const builds = await this.buildClient.getBuilds(
        projectName,
        [buildStatus.definitionId],
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter
        undefined, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        1 // top - get only the latest build
      );

      if (builds.length > 0) {
        const latestBuild = builds[0];
        const updatedBuildStatus: RepositoryBuildStatus = {
          ...buildStatus,
          status: latestBuild.status,
          result: latestBuild.result,
          finishTime: latestBuild.finishTime,
          startTime: latestBuild.startTime,
          buildNumber: latestBuild.buildNumber,
          buildId: latestBuild.id,
        };

        this.setState((prevState) => ({
          buildStatuses: {
            ...prevState.buildStatuses,
            [repoId]: updatedBuildStatus,
          },
        }));
      }
    } catch (error) {
      console.error(
        `Failed to refresh build status for repo ${repoId}:`,
        error
      );
    }
  };

  private toggleRepoSelection = (repoId: string) => {
    this.setState((prevState) => {
      const newSelectedRepoIds = new Set(prevState.selectedRepoIds);
      if (newSelectedRepoIds.has(repoId)) {
        newSelectedRepoIds.delete(repoId);
      } else {
        newSelectedRepoIds.add(repoId);
      }
      return { selectedRepoIds: newSelectedRepoIds };
    });
  };

  private selectAllRepos = () => {
    const { repos, buildStatuses } = this.state;
    const reposWithPipelines = repos.filter(
      (repo) => repo.id && buildStatuses[repo.id]?.definitionId
    );

    this.setState({
      selectedRepoIds: new Set(reposWithPipelines.map((repo) => repo.id!)),
    });
  };

  private clearRepoSelection = () => {
    this.setState({ selectedRepoIds: new Set() });
  };

  private publishDraftPR = async (pr: GitPullRequest) => {
    try {
      if (!this.gitClient || !pr.pullRequestId || !pr.repository?.id) {
        throw new Error("Git client not initialized or PR data incomplete");
      }

      // Update the PR to set isDraft to false
      const updatedPR: Partial<GitPullRequest> = {
        isDraft: false,
      };

      await this.gitClient.updatePullRequest(
        updatedPR as GitPullRequest,
        pr.repository.id,
        pr.pullRequestId
      );

      await this.showToast(
        `Draft PR "${pr.title}" has been published and is now ready for review!`,
        "success"
      );

      // Refresh pull requests to reflect the change
      await this.loadPullRequests();
    } catch (error) {
      console.error(`Failed to publish draft PR ${pr.pullRequestId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("403") || errorMessage.includes("401")) {
        await this.showToast(
          `Permission denied: Cannot publish draft PR "${pr.title}". Contact your Azure DevOps administrator.`,
          "error"
        );
      } else {
        await this.showToast(
          `Failed to publish draft PR "${pr.title}": ${errorMessage}`,
          "error"
        );
      }
    }
  };

  private publishAllDraftsInGroup = async (
    groupTitle: string,
    prs: GitPullRequest[]
  ) => {
    const draftPRs = prs.filter((pr) => pr.isDraft);

    if (draftPRs.length === 0) {
      await this.showToast(
        `No draft pull requests to publish in "${groupTitle}"`,
        "info"
      );
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    const publishPromises = draftPRs.map(async (pr) => {
      try {
        if (!this.gitClient || !pr.pullRequestId || !pr.repository?.id) {
          throw new Error("Git client not initialized or PR data incomplete");
        }

        const updatedPR: Partial<GitPullRequest> = {
          isDraft: false,
        };

        await this.gitClient.updatePullRequest(
          updatedPR as GitPullRequest,
          pr.repository.id,
          pr.pullRequestId
        );

        successCount++;
      } catch (error) {
        console.error(`Failed to publish draft PR ${pr.pullRequestId}:`, error);
        errorCount++;
      }
    });

    await Promise.allSettled(publishPromises);

    if (successCount > 0) {
      await this.showToast(
        `Successfully published ${successCount} draft pull request${
          successCount !== 1 ? "s" : ""
        } from "${groupTitle}"!`,
        "success"
      );
    }

    if (errorCount > 0) {
      await this.showToast(
        `Failed to publish ${errorCount} draft pull request${
          errorCount !== 1 ? "s" : ""
        } from "${groupTitle}"`,
        "error"
      );
    }

    // Refresh pull requests to reflect the changes
    await this.loadPullRequests();
  };

  private getQueryParam(param: string): string | null {
    try {
      // Try to get query param from parent window first (main Azure DevOps page)
      if (window.top && window.top !== window) {
        try {
          const parentUrlParams = new URLSearchParams(
            window.top.location.search
          );
          const parentParam = parentUrlParams.get(param);
          if (parentParam) {
            return parentParam;
          }
        } catch (crossOriginError) {
          // Cross-origin restriction, fall back to iframe URL
          console.log("Cross-origin restriction, reading from iframe URL");
        }
      }

      // Fallback to iframe URL
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
    } catch (error) {
      console.error("Error reading query parameters:", error);
      return null;
    }
  }

  private setQueryParam(param: string, value: string) {
    try {
      // Try to update parent window URL (main Azure DevOps page)
      if (window.top && window.top !== window) {
        try {
          const parentUrl = new URL(window.top.location.href);
          parentUrl.searchParams.set(param, value);

          // Update parent window URL without reloading
          window.top.history.replaceState({}, "", parentUrl.toString());
          return; // Success, no need to update iframe URL
        } catch (crossOriginError) {
          // Cross-origin restriction, fall back to iframe URL
          console.log("Cross-origin restriction, updating iframe URL instead");
        }
      }

      // Fallback to updating iframe URL
      const url = new URL(window.location.href);
      url.searchParams.set(param, value);

      // Update the iframe URL without reloading the page
      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Error setting query parameters:", error);
    }
  }

  private getInitialTabFromUrl(): string {
    const tabParam = this.getQueryParam("tab");

    // Validate the tab parameter
    if (tabParam === "repositories" || tabParam === "pullrequests") {
      return tabParam;
    }

    // Default to repositories if no valid tab parameter
    return "repositories";
  }

  private toggleFavorite = async (repoId: string) => {
    try {
      const projectInfo = this.getProjectInfo();

      if (!projectInfo?.name) {
        await this.showToast("No project context available", "error");
        return;
      }

      const { favoriteRepoIds } = this.state;
      const newFavoriteRepoIds = new Set(favoriteRepoIds);
      const isCurrentlyFavorite = favoriteRepoIds.has(repoId);

      if (isCurrentlyFavorite) {
        newFavoriteRepoIds.delete(repoId);
      } else {
        newFavoriteRepoIds.add(repoId);
      }

      // Update state immediately for responsive UI
      this.setState({ favoriteRepoIds: newFavoriteRepoIds });

      // Save to localStorage with project-specific key
      const storageKey = `repo-pulse-favorites-${projectInfo.name}`;
      localStorage.setItem(
        storageKey,
        JSON.stringify(Array.from(newFavoriteRepoIds))
      );

      // Re-sort repositories to move favorites to top
      const sortedRepos = this.sortRepositoriesByFavorites(
        this.state.repos,
        newFavoriteRepoIds
      );
      this.setState({ repos: sortedRepos });

      // Show feedback
      const repoName =
        this.state.repos.find((r) => r.id === repoId)?.name || "Repository";
      await this.showToast(
        `${repoName} ${
          isCurrentlyFavorite ? "removed from" : "added to"
        } favorites`,
        "success"
      );
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
      await this.showToast("Failed to update favorite status", "error");
    }
  };

  public render(): JSX.Element {
    const {
      repos,
      pullRequests,
      loading,
      error,
      selectedTabId,
      groupedPullRequests,
      buildStatuses,
      selectedRepoIds,
      isTriggeringPipelines,
      triggeringRepoIds,
      prBuildStatuses,
      loadingPRBuilds,
    } = this.state;

    return (
      <div
        style={{
          width: "100%",
          backgroundColor: "#f8f9fa",
          minHeight: "100vh",
        }}
      >
        <div style={{ padding: "24px" }}>
          {/* Tab Navigation */}
          <div
            style={{
              borderBottom: "1px solid #e1e1e1",
              marginBottom: "24px",
              display: "flex",
              gap: "0",
            }}
          >
            <button
              className="body-medium"
              style={{
                padding: "12px 24px",
                border: "none",
                background:
                  selectedTabId === "repositories" ? "white" : "transparent",
                color: selectedTabId === "repositories" ? "#0078d4" : "#666",
                cursor: "pointer",
                borderBottom:
                  selectedTabId === "repositories"
                    ? "2px solid #0078d4"
                    : "2px solid transparent",
                fontWeight: selectedTabId === "repositories" ? "600" : "400",
              }}
              onClick={() => this.onTabChanged("repositories")}
            >
              Repositories ({repos.length})
            </button>
            <button
              className="body-medium"
              style={{
                padding: "12px 24px",
                border: "none",
                background:
                  selectedTabId === "pullrequests" ? "white" : "transparent",
                color: selectedTabId === "pullrequests" ? "#0078d4" : "#666",
                cursor: "pointer",
                borderBottom:
                  selectedTabId === "pullrequests"
                    ? "2px solid #0078d4"
                    : "2px solid transparent",
                fontWeight: selectedTabId === "pullrequests" ? "600" : "400",
              }}
              onClick={() => this.onTabChanged("pullrequests")}
            >
              Pull Requests ({pullRequests.length})
            </button>
          </div>

          {selectedTabId === "repositories" && (
            <div>
              {/* Batch Controls */}
              {!loading && !error && repos.length > 0 && (
                <div
                  style={{
                    backgroundColor: "white",
                    border: "1px solid #e1e1e1",
                    borderRadius: "6px",
                    padding: "16px 20px",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <span
                      className="body-medium"
                      style={{ color: "#323130", fontWeight: "600" }}
                    >
                      Pipeline Controls:
                    </span>
                    <span className="body-small" style={{ color: "#666" }}>
                      {selectedRepoIds.size} of{" "}
                      {
                        repos.filter(
                          (repo) =>
                            repo.id && buildStatuses[repo.id]?.definitionId
                        ).length
                      }{" "}
                      selected
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Button
                      text="Select All"
                      iconProps={{ iconName: "CheckboxComposite" }}
                      onClick={this.selectAllRepos}
                      disabled={isTriggeringPipelines}
                      subtle={true}
                    />
                    <Button
                      text="Clear"
                      iconProps={{ iconName: "Clear" }}
                      onClick={this.clearRepoSelection}
                      disabled={
                        isTriggeringPipelines || selectedRepoIds.size === 0
                      }
                      subtle={true}
                    />
                    <Button
                      text={
                        isTriggeringPipelines
                          ? "Triggering..."
                          : `Trigger Selected (${selectedRepoIds.size})`
                      }
                      iconProps={{
                        iconName: isTriggeringPipelines ? "Sync" : "Play",
                      }}
                      onClick={this.triggerSelectedPipelines}
                      disabled={
                        isTriggeringPipelines || selectedRepoIds.size === 0
                      }
                      primary={true}
                    />
                  </div>
                </div>
              )}

              {loading && (
                <div
                  className="body-medium"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#666",
                  }}
                >
                  Loading repositories...
                </div>
              )}

              {error && (
                <div
                  className="body-medium"
                  style={{
                    backgroundColor: "#fde7e9",
                    border: "1px solid #f1707b",
                    borderRadius: "4px",
                    padding: "12px 16px",
                    color: "#d13438",
                  }}
                >
                  {error}
                </div>
              )}

              {!loading && !error && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {repos
                    .filter((repo) => repo && repo.id)
                    .map((repo) => (
                      <div
                        key={repo.id}
                        style={{
                          backgroundColor: "white",
                          border: "1px solid #e1e1e1",
                          borderRadius: "6px",
                          padding: "16px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition:
                            "box-shadow 0.2s ease, border-color 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow =
                            "0 2px 8px rgba(0,0,0,0.1)";
                          e.currentTarget.style.borderColor = "#0078d4";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.borderColor = "#e1e1e1";
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "16px",
                            flex: 1,
                          }}
                        >
                          {/* Checkbox for selection (only show if repo has a pipeline) */}
                          {repo.id && buildStatuses[repo.id]?.definitionId && (
                            <input
                              type="checkbox"
                              checked={selectedRepoIds.has(repo.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                this.toggleRepoSelection(repo.id!);
                              }}
                              style={{
                                width: "16px",
                                height: "16px",
                                cursor: "pointer",
                                accentColor: "#0078d4",
                              }}
                              disabled={isTriggeringPipelines}
                            />
                          )}

                          <div
                            className="body-medium"
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              backgroundColor: "#0078d4",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "white",
                              fontWeight: "600",
                            }}
                          >
                            {repo.name.charAt(0).toUpperCase()}
                          </div>

                          <div style={{ flex: 1 }}>
                            <div
                              className="title-small"
                              style={{
                                color: "#323130",
                                marginBottom: "4px",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <span
                                style={{
                                  cursor: "pointer",
                                  color: "#0078d4",
                                  textDecoration: "none",
                                  transition: "color 0.2s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.textDecoration =
                                    "underline";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.textDecoration = "none";
                                }}
                                onClick={() => this.openRepository(repo)}
                                title={`Click to open ${repo.name} repository`}
                              >
                                {repo.name}
                              </span>
                              <span
                                style={{
                                  cursor: "pointer",
                                  padding: "4px",
                                  borderRadius: "4px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "background-color 0.2s ease",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  this.toggleFavorite(repo.id || "");
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor =
                                    "rgba(0, 120, 212, 0.1)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor =
                                    "transparent";
                                }}
                                title={
                                  this.state.favoriteRepoIds.has(repo.id || "")
                                    ? `Remove ${repo.name} from favorites`
                                    : `Add ${repo.name} to favorites`
                                }
                              >
                                <Icon
                                  iconName={
                                    this.state.favoriteRepoIds.has(
                                      repo.id || ""
                                    )
                                      ? "FavoriteStarFill"
                                      : "FavoriteStar"
                                  }
                                  style={{
                                    color: this.state.favoriteRepoIds.has(
                                      repo.id || ""
                                    )
                                      ? "#ffb900"
                                      : "#666",
                                    fontSize: "14px",
                                    transition: "color 0.2s ease",
                                  }}
                                />
                              </span>
                            </div>
                            <div
                              className="body-small"
                              style={{
                                color: "#666",
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                flexWrap: "wrap",
                              }}
                            >
                              <span>
                                Default Branch:{" "}
                                {repo.defaultBranch?.replace(
                                  "refs/heads/",
                                  ""
                                ) || "None"}
                              </span>
                              {repo.id && buildStatuses[repo.id] && (
                                <>
                                  <span>•</span>
                                  <span
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      color: this.getBuildStatusColor(
                                        buildStatuses[repo.id].status,
                                        buildStatuses[repo.id].result
                                      ),
                                      cursor: buildStatuses[repo.id].buildId
                                        ? "pointer"
                                        : "default",
                                      padding: "2px 4px",
                                      borderRadius: "4px",
                                      transition: "background-color 0.2s ease",
                                    }}
                                    onClick={(e) => {
                                      if (buildStatuses[repo.id].buildId) {
                                        e.stopPropagation();
                                        this.openBuild(
                                          buildStatuses[repo.id].buildId!
                                        );
                                      }
                                    }}
                                    onMouseEnter={(e) => {
                                      if (buildStatuses[repo.id].buildId) {
                                        e.currentTarget.style.backgroundColor =
                                          "rgba(0, 120, 212, 0.1)";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor =
                                        "transparent";
                                    }}
                                    title={
                                      buildStatuses[repo.id].buildId
                                        ? `Click to view build #${
                                            buildStatuses[repo.id]
                                              .buildNumber ||
                                            buildStatuses[repo.id].buildId
                                          }`
                                        : undefined
                                    }
                                  >
                                    <Icon
                                      iconName={this.getBuildStatusIcon(
                                        buildStatuses[repo.id].status,
                                        buildStatuses[repo.id].result
                                      )}
                                      style={{ fontSize: "10px" }}
                                    />
                                    {buildStatuses[repo.id].isLoading
                                      ? "Loading..."
                                      : this.getBuildStatusText(
                                          buildStatuses[repo.id].status,
                                          buildStatuses[repo.id].result
                                        )}
                                    {buildStatuses[repo.id].buildNumber && (
                                      <span
                                        style={{
                                          fontSize: "9px",
                                          opacity: 0.7,
                                        }}
                                      >
                                        #{buildStatuses[repo.id].buildNumber}
                                      </span>
                                    )}
                                  </span>
                                </>
                              )}

                              {/* Pipeline Names */}
                              {repo.id && buildStatuses[repo.id]?.pipelineNames && buildStatuses[repo.id].pipelineNames!.length > 0 && (
                                <>
                                  <span>•</span>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      fontSize: "11px",
                                    }}
                                  >
                                    <Icon
                                      iconName="BuildDefinition"
                                      style={{ fontSize: "10px", color: "#0078d4" }}
                                    />
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                      {buildStatuses[repo.id].pipelineNames!.map((name, index) => {
                                        const url = buildStatuses[repo.id].pipelineUrls?.[index];
                                        return (
                                          <span
                                            key={index}
                                            style={{
                                              color: url ? "#0078d4" : "#666",
                                              fontWeight: "500",
                                              cursor: url ? "pointer" : "default",
                                              textDecoration: url ? "underline" : "none",
                                              transition: "color 0.2s ease",
                                            }}
                                            onClick={(e) => {
                                              if (url) {
                                                e.stopPropagation();
                                                this.navigateToUrl(url);
                                              }
                                            }}
                                            onMouseEnter={(e) => {
                                              if (url) {
                                                e.currentTarget.style.color = "#106ebe";
                                              }
                                            }}
                                            onMouseLeave={(e) => {
                                              if (url) {
                                                e.currentTarget.style.color = "#0078d4";
                                              }
                                            }}
                                            title={url ? `Click to open ${name} pipeline` : name}
                                          >
                                            {name}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          {/* Individual Pipeline Trigger Button */}
                          {repo.id && buildStatuses[repo.id]?.definitionId && (
                            <Button
                              text={
                                triggeringRepoIds.has(repo.id)
                                  ? "Triggering..."
                                  : "Trigger"
                              }
                              iconProps={{
                                iconName: triggeringRepoIds.has(repo.id)
                                  ? "Sync"
                                  : "Play",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                this.triggerPipeline(
                                  repo.id!,
                                  buildStatuses[repo.id].definitionId!,
                                  repo.name || "Unknown"
                                );
                              }}
                              disabled={
                                triggeringRepoIds.has(repo.id) ||
                                isTriggeringPipelines
                              }
                              primary={false}
                              subtle={true}
                              tooltipProps={{
                                text: `Trigger pipeline for ${repo.name} (${
                                  buildStatuses[repo.id]?.definitionName ||
                                  "Unknown pipeline"
                                })`,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {selectedTabId === "pullrequests" && (
            <div>
              {loading && (
                <div
                  className="body-medium"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#666",
                  }}
                >
                  Loading pull requests...
                </div>
              )}

              {!loading && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px",
                  }}
                >
                  {Object.entries(groupedPullRequests).map(([prTitle, prs]) => {
                    const hasDraftPRs = prs.some((pr) => pr.isDraft);
                    const draftCount = prs.filter((pr) => pr.isDraft).length;

                    return (
                      <div key={prTitle}>
                        <div
                          style={{
                            marginBottom: "16px",
                            padding: "12px 16px",
                            backgroundColor: "white",
                            border: "1px solid #e1e1e1",
                            borderRadius: "6px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <Icon
                              iconName="BranchPullRequest"
                              style={{
                                color: "#0078d4",
                                fontSize: "16px",
                              }}
                            />
                            <h3
                              className="title-small"
                              style={{
                                margin: 0,
                                color: "#323130",
                                fontWeight: "600",
                              }}
                            >
                              {prTitle} ({prs.length} pull request
                              {prs.length !== 1 ? "s" : ""})
                              {hasDraftPRs && (
                                <span
                                  style={{
                                    color: "#f57c00",
                                    fontSize: "12px",
                                    marginLeft: "8px",
                                  }}
                                >
                                  ({draftCount} draft
                                  {draftCount !== 1 ? "s" : ""})
                                </span>
                              )}
                            </h3>
                          </div>
                          {hasDraftPRs && (
                            <Button
                              text={`Publish ${draftCount} Draft${
                                draftCount !== 1 ? "s" : ""
                              }`}
                              iconProps={{ iconName: "PublishContent" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                this.publishAllDraftsInGroup(prTitle, prs);
                              }}
                              primary={true}
                              subtle={false}
                              tooltipProps={{
                                text: `Publish all ${draftCount} draft pull request${
                                  draftCount !== 1 ? "s" : ""
                                } in "${prTitle}" group`,
                              }}
                            />
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          {prs
                            .filter((pr) => pr && pr.pullRequestId)
                            .map((pr) => (
                              <div
                                key={pr.pullRequestId}
                                style={{
                                  backgroundColor: "white",
                                  border: "1px solid #e1e1e1",
                                  borderRadius: "6px",
                                  padding: "16px 20px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  transition:
                                    "box-shadow 0.2s ease, border-color 0.2s ease",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.boxShadow =
                                    "0 2px 8px rgba(0,0,0,0.1)";
                                  e.currentTarget.style.borderColor = "#0078d4";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.boxShadow = "none";
                                  e.currentTarget.style.borderColor = "#e1e1e1";
                                }}
                                onClick={() => {
                                  const projectInfo = this.getProjectInfo();

                                  if (projectInfo?.name) {
                                    const prUrl = `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectInfo.name}/_git/${pr.repository?.name}/pullrequest/${pr.pullRequestId}`;
                                    this.navigateToUrl(prUrl);
                                  }
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "16px",
                                    flex: 1,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      borderRadius: "50%",
                                      backgroundColor: this.getStatusColor(
                                        pr.status || 0
                                      ),
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "white",
                                      fontWeight: "600",
                                      fontSize: "14px",
                                    }}
                                  >
                                    PR
                                  </div>

                                  <div style={{ flex: 1 }}>
                                    <div
                                      style={{
                                        fontSize: "16px",
                                        fontWeight: "600",
                                        color: "#323130",
                                        marginBottom: "4px",
                                      }}
                                    >
                                      {pr.repository?.name} -{" "}
                                      {pr.sourceRefName?.replace(
                                        "refs/heads/",
                                        ""
                                      )}{" "}
                                      →{" "}
                                      {pr.targetRefName?.replace(
                                        "refs/heads/",
                                        ""
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        color: "#666",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "12px",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span>
                                        Status:{" "}
                                        {this.getStatusText(pr.status || 0)}
                                      </span>
                                      <span>•</span>
                                      <span>ID: #{pr.pullRequestId}</span>
                                      <span>•</span>
                                      <span
                                        style={{
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          fontSize: "10px",
                                          fontWeight: "600",
                                          backgroundColor: pr.isDraft
                                            ? "#ffd700"
                                            : "#107c10",
                                          color: pr.isDraft ? "#000" : "#fff",
                                        }}
                                      >
                                        {pr.isDraft ? "DRAFT" : "ACTIVE"}
                                      </span>

                                      {/* Build Status */}
                                      {pr.pullRequestId &&
                                        prBuildStatuses[pr.pullRequestId] && (
                                          <>
                                            <span>•</span>
                                            <span
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "10px",
                                                fontWeight: "600",
                                                backgroundColor:
                                                  this.getBuildStatusColor(
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].status,
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].result
                                                  ),
                                                color: "#fff",
                                              }}
                                            >
                                              <Icon
                                                iconName={this.getBuildStatusIcon(
                                                  prBuildStatuses[
                                                    pr.pullRequestId
                                                  ].status,
                                                  prBuildStatuses[
                                                    pr.pullRequestId
                                                  ].result
                                                )}
                                                style={{ fontSize: "8px" }}
                                              />
                                              {prBuildStatuses[pr.pullRequestId]
                                                .isLoading
                                                ? "Loading..."
                                                : this.getBuildStatusText(
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].status,
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].result
                                                  )}
                                              {prBuildStatuses[pr.pullRequestId]
                                                .buildNumber && (
                                                <span style={{ opacity: 0.8 }}>
                                                  #
                                                  {
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].buildNumber
                                                  }
                                                </span>
                                              )}
                                            </span>
                                          </>
                                        )}

                                      {/* Approval Status */}
                                      {pr.pullRequestId &&
                                        prBuildStatuses[pr.pullRequestId] && (
                                          <>
                                            <span>•</span>
                                            <span
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "10px",
                                                fontWeight: "600",
                                                backgroundColor:
                                                  this.getApprovalStatusColor(
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].approvalStatus
                                                  ),
                                                color: "#fff",
                                              }}
                                            >
                                              <Icon
                                                iconName={this.getApprovalStatusIcon(
                                                  prBuildStatuses[
                                                    pr.pullRequestId
                                                  ].approvalStatus
                                                )}
                                                style={{ fontSize: "8px" }}
                                              />
                                              {this.getApprovalStatusText(
                                                prBuildStatuses[
                                                  pr.pullRequestId
                                                ].approvalStatus
                                              )}
                                              {prBuildStatuses[pr.pullRequestId]
                                                .reviewerCount > 0 && (
                                                <span style={{ opacity: 0.8 }}>
                                                  (
                                                  {
                                                    prBuildStatuses[
                                                      pr.pullRequestId
                                                    ].reviewerCount
                                                  }
                                                  )
                                                </span>
                                              )}
                                            </span>
                                          </>
                                        )}

                                      {/* Ready to Merge Indicator */}
                                      {pr.pullRequestId &&
                                        prBuildStatuses[pr.pullRequestId] &&
                                        this.isPullRequestReadyToMerge(
                                          pr,
                                          prBuildStatuses[pr.pullRequestId]
                                        ) && (
                                          <>
                                            <span>•</span>
                                            <span
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "10px",
                                                fontWeight: "600",
                                                backgroundColor: "#107c10",
                                                color: "#fff",
                                              }}
                                            >
                                              <Icon
                                                iconName="Completed"
                                                style={{ fontSize: "8px" }}
                                              />
                                              READY TO MERGE
                                            </span>
                                          </>
                                        )}

                                      {/* Auto-complete indicator */}
                                      {pr.pullRequestId &&
                                        prBuildStatuses[pr.pullRequestId]
                                          ?.hasAutoComplete && (
                                          <>
                                            <span>•</span>
                                            <span
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "10px",
                                                fontWeight: "600",
                                                backgroundColor: "#0078d4",
                                                color: "#fff",
                                              }}
                                            >
                                              <Icon
                                                iconName="AutoFillTemplate"
                                                style={{ fontSize: "8px" }}
                                              />
                                              AUTO-COMPLETE
                                            </span>
                                          </>
                                        )}
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  {/* Show Publish Draft button for draft PRs */}
                                  {pr.isDraft ? (
                                    <Button
                                      text="Publish Draft"
                                      iconProps={{ iconName: "PublishContent" }}
                                      onClick={(event) => {
                                        event.stopPropagation(); // Prevent navigation to PR
                                        this.publishDraftPR(pr);
                                      }}
                                      primary={true}
                                      tooltipProps={{
                                        text: `Publish "${pr.title}" to make it ready for review`,
                                      }}
                                    />
                                  ) : (
                                    <Button
                                      text="Update from master"
                                      iconProps={{
                                        iconName: "BranchPullRequest",
                                      }}
                                      onClick={(event) => {
                                        event.stopPropagation(); // Prevent navigation to PR
                                        const repoName = pr.repository?.name;
                                        if (repoName) {
                                          const repo = repos.find(
                                            (r) => r.name === repoName
                                          );
                                          if (repo) {
                                            this.createUpdatePRFromMaster(
                                              repo,
                                              pr.sourceRefName
                                            );
                                          }
                                        }
                                      }}
                                      primary={false}
                                    />
                                  )}
                                  <Icon
                                    iconName="ChevronRight"
                                    style={{ color: "#666", fontSize: "12px" }}
                                  />
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {pullRequests.length === 0 && !loading && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    color: "#666",
                    backgroundColor: "white",
                    border: "1px solid #e1e1e1",
                    borderRadius: "6px",
                  }}
                >
                  <Icon
                    iconName="BranchPullRequest"
                    style={{
                      fontSize: "48px",
                      marginBottom: "16px",
                      color: "#ccc",
                    }}
                  />
                  <div
                    className="title-small"
                    style={{
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    No active pull requests found
                  </div>
                  <div className="body-medium" style={{ color: "#999" }}>
                    Pull requests will appear here when they are created
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Version Badge */}
        <div
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            backgroundColor: "rgba(0, 120, 212, 0.9)",
            color: "white",
            padding: "6px 12px",
            borderRadius: "16px",
            fontSize: "12px",
            fontWeight: "600",
            zIndex: 1000,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
          title={`${EXTENSION_NAME} v${EXTENSION_VERSION}`}
        >
          <Icon iconName="Info" style={{ fontSize: "10px" }} />v
          {EXTENSION_VERSION}
        </div>
      </div>
    );
  }
}

export default HomePage;

showRootComponent(<HomePage />);
