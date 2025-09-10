import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as SDK from "azure-devops-extension-sdk";
import { showRootComponent } from "../Common";
import { getClient, ILocationService } from "azure-devops-extension-api";
import {
  PolicyRestClient,
  PolicyConfiguration,
} from "azure-devops-extension-api/Policy";

import {
  GitRestClient,
  GitRepository,
  GitPullRequest,
  PullRequestStatus,
} from "azure-devops-extension-api/Git";
import {
  BuildRestClient,
  BuildStatus,
  BuildResult,
} from "azure-devops-extension-api/Build";
import {
  CommonServiceIds,
  IGlobalMessagesService,
  IToast,
} from "azure-devops-extension-api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  expandedPipelineRepos: Set<string>;
  reviewPR: GitPullRequest | null;
  hasAcknowledgedReview: boolean;
  isReviewLoading: boolean;
  repoSearch?: string;
  isDarkMode?: boolean;
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
  pipelineUrls?: string[];
  pipelineDetails?: PipelineDetail[];
}

interface PipelineDetail {
  name: string;
  url: string;
  definitionId: number;
  status: BuildStatus;
  result?: BuildResult;
  lastBuildTime?: Date;
  buildNumber?: string;
  buildId?: number;
  isBuildPipeline?: boolean;
  folderPath?: string;
  yamlPath?: string;
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
  private policyClient: PolicyRestClient | null = null;
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
      this.policyClient = getClient(PolicyRestClient);
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

      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;

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
      expandedPipelineRepos: new Set<string>(),
      reviewPR: null,
      hasAcknowledgedReview: false,
      isReviewLoading: false,
      repoSearch: "",
      isDarkMode:
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches,
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

      // Listen to dark mode preference changes
      if (window.matchMedia) {
        const mql = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) =>
          this.setState({ isDarkMode: e.matches });
        // Safari<br/>
        // @ts-ignore
        if (mql.addEventListener) mql.addEventListener("change", handler);
        else if (mql.addListener) mql.addListener(handler);
      }
    } catch (error) {
      console.error("Extension initialization failed:", error);
      await this.showToast("Failed to initialize extension", "error");
    }
  }

  public componentWillUnmount() {
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
      console.error(
        "Cross-origin restriction, only iframe navigation will work"
      );
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

          if (repoDefinitions.length > 0) {
            definitionsByRepo.set(repo.id, repoDefinitions);
          }
        } catch (error) {
          console.warn(
            `Failed to load definitions for repo ${repo.name}:`,
            error
          );
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
        const pipelineNames = definitions
          .map((def) => def.name)
          .filter((name) => name);
        const pipelineUrls = definitions
          .map((def) => {
            if (def.id && def.name) {
              return `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectName}/_build?definitionId=${def.id}`;
            }
            return null;
          })
          .filter((url): url is string => url !== null);

        const buildValidationPipelineId = await this.getBuildValidationPipeline(
          projectName,
          repo.id,
          repo.defaultBranch
        );

        // Get detailed pipeline information including build status
        const pipelineDetails: PipelineDetail[] = [];

        for (const def of definitions) {
          if (!def.id || !def.name) continue;

          try {
            const builds = await this.buildClient!.getBuilds(
              projectName,
              [def.id],
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

            const latestBuild = builds.length > 0 ? builds[0] : null;

            pipelineDetails.push({
              name: def.name,
              url: `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectName}/_build?definitionId=${def.id}`,
              definitionId: def.id,
              status: latestBuild?.status || BuildStatus.None,
              result: latestBuild?.result,
              lastBuildTime: latestBuild?.finishTime || latestBuild?.startTime,
              buildNumber: latestBuild?.buildNumber,
              buildId: latestBuild?.id,
              isBuildPipeline: def.id === buildValidationPipelineId,
              folderPath: def.path,
              yamlPath: (def.process as any)?.yamlFilename,
            });
          } catch (error) {
            console.warn(
              `Failed to get build info for pipeline ${def.name}:`,
              error
            );
            // Add pipeline without build info
            pipelineDetails.push({
              name: def.name,
              url: `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${projectName}/_build?definitionId=${def.id}`,
              definitionId: def.id,
              status: BuildStatus.None,
              folderPath: def.path,
              yamlPath: (def.process as any)?.yamlFilename,
            });
          }
        }

        pipelineDetails.sort((a, b) => {
          const aIsBuild = a.isBuildPipeline ? 1 : 0;
          const bIsBuild = b.isBuildPipeline ? 1 : 0;
          if (bIsBuild - aIsBuild !== 0) return bIsBuild - aIsBuild;

          if (!a.lastBuildTime && !b.lastBuildTime) return 0;
          if (!a.lastBuildTime) return 1;
          if (!b.lastBuildTime) return -1;
          return (
            new Date(b.lastBuildTime).getTime() -
            new Date(a.lastBuildTime).getTime()
          );
        });

        // Use the first definition for build status (or any definition)
        const prValidationDef = definitions[0];

        if (!prValidationDef?.id) {
          this.setState((prevState) => ({
            buildStatuses: {
              ...prevState.buildStatuses,
              [repo.id!]: {
                status: BuildStatus.None,
                isLoading: false,
                pipelineNames: pipelineNames,
                pipelineUrls: pipelineUrls,
                pipelineDetails: pipelineDetails,
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
              pipelineDetails: pipelineDetails,
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
                  pipelineDetails: pipelineDetails,
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
                pipelineDetails: pipelineDetails,
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

  async getBuildValidationPipeline(
    projectName: string,
    repoId: string,
    refName: string
  ) {
    const policyClient = getClient(PolicyRestClient);

    const BUILD_POLICY_TYPE = "0609b952-1397-4640-95ec-e00a01b2c241";

    const policies: PolicyConfiguration[] =
      await policyClient.getPolicyConfigurations(
        projectName,
        undefined,
        BUILD_POLICY_TYPE
      );

    const activePolicies = policies.filter((p) => {
      const settings: any = p.settings as any;
      const scopes: any[] = Array.isArray(settings?.scope)
        ? (settings.scope as any[])
        : settings?.scope
        ? [settings.scope]
        : [];

      const hasMatch = scopes.some((s: any) => {
        const scopeRepoId = s?.repositoryId;
        const scopeRefName = s?.refName;
        const repoMatch = scopeRepoId === repoId;
        const refMatch = scopeRefName === refName;
        return repoMatch && refMatch;
      });

      return p.isEnabled && p.isBlocking && !p.isDeleted && hasMatch;
    });

    let buildPipelineId: number | undefined;

    if (activePolicies.length > 0) {
      buildPipelineId = (
        activePolicies.sort(
          (a, b) =>
            new Date(b.createdDate).getTime() -
            new Date(a.createdDate).getTime()
        )[0].settings as any
      ).buildDefinitionId;
    }

    return buildPipelineId;
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

  private getTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return "Just now";
    }

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
      return `${diffInDays}d ago`;
    }

    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) {
      return `${diffInWeeks}w ago`;
    }

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
      return `${diffInMonths}mo ago`;
    }

    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears}y ago`;
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

  private getQueryParam(param: string): string | null {
    try {
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
          console.log("Cross-origin restriction, reading from iframe URL");
        }
      }

      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
    } catch (error) {
      console.error("Error reading query parameters:", error);
      return null;
    }
  }

  private setQueryParam(param: string, value: string) {
    try {
      if (window.top && window.top !== window) {
        try {
          const parentUrl = new URL(window.top.location.href);
          parentUrl.searchParams.set(param, value);

          window.top.history.replaceState({}, "", parentUrl.toString());
          return;
        } catch (crossOriginError) {
          console.error(
            "Cross-origin restriction, updating iframe URL instead"
          );
        }
      }

      const url = new URL(window.location.href);
      url.searchParams.set(param, value);

      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Error setting query parameters:", error);
    }
  }

  private getInitialTabFromUrl(): string {
    const tabParam = this.getQueryParam("tab");
    if (tabParam === "repositories" || tabParam === "pullrequests") {
      return tabParam;
    }
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

      this.setState({ favoriteRepoIds: newFavoriteRepoIds });

      const storageKey = `repo-pulse-favorites-${projectInfo.name}`;
      localStorage.setItem(
        storageKey,
        JSON.stringify(Array.from(newFavoriteRepoIds))
      );

      const sortedRepos = this.sortRepositoriesByFavorites(
        this.state.repos,
        newFavoriteRepoIds
      );
      this.setState({ repos: sortedRepos });
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

    const isDark = !!this.state.isDarkMode;
    const colors = {
      bg: isDark ? "#0f172a" : "#f8f9fa",
      surface: isDark ? "#111827" : "#ffffff",
      border: isDark ? "#1f2937" : "#e1e1e1",
      subBorder: isDark ? "#243244" : "#d0d7de",
      text: isDark ? "#e5e7eb" : "#323130",
      subText: isDark ? "#9ca3af" : "#666",
      link: isDark ? "#60a5fa" : "#0078d4",
      cardHoverBorder: isDark ? "#2563eb" : "#0078d4",
      pipelineBg: isDark ? "#0b1220" : "#fafbfc",
      badgeBg: isDark ? "#0b1220" : "#f6f8fa",
      modalOverlay: "rgba(0,0,0,0.6)",
    } as const;

    return (
      <div
        style={{
          width: "100%",
          backgroundColor: colors.bg,
          minHeight: "100vh",
        }}
      >
        <div style={{ padding: "24px" }}>
          {/* Tab Navigation */}
          <div
            style={{
              borderBottom: `1px solid ${colors.border}`,
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
                color:
                  selectedTabId === "repositories"
                    ? colors.link
                    : colors.subText,
                cursor: "pointer",
                borderBottom:
                  selectedTabId === "repositories"
                    ? `2px solid ${colors.link}`
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
                color:
                  selectedTabId === "pullrequests"
                    ? colors.link
                    : colors.subText,
                cursor: "pointer",
                borderBottom:
                  selectedTabId === "pullrequests"
                    ? `2px solid ${colors.link}`
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
              {loading && (
                <div
                  className="body-medium"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: colors.subText,
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
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "12px",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Search repositories..."
                      value={this.state.repoSearch}
                      onChange={(e) =>
                        this.setState({ repoSearch: e.currentTarget.value })
                      }
                      style={{
                        width: "100%",
                        maxWidth: "420px",
                        padding: "8px 12px",
                        border: `1px solid ${colors.subBorder}`,
                        borderRadius: "6px",
                        outline: "none",
                        fontSize: "13px",
                        backgroundColor: colors.surface,
                        color: colors.text,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "12px",
                      alignItems: "start",
                    }}
                  >
                    {repos
                      .filter((repo) => repo && repo.id)
                      .filter((repo) =>
                        (this.state.repoSearch || "").trim().length === 0
                          ? true
                          : (repo.name || "")
                              .toLowerCase()
                              .includes(this.state.repoSearch!.toLowerCase())
                      )
                      .map((repo) => (
                        <div
                          key={repo.id}
                          style={{
                            backgroundColor: colors.surface,
                            border: `1px solid ${colors.border}`,
                            borderRadius: "6px",
                            padding: "16px 20px",
                            transition:
                              "box-shadow 0.2s ease, border-color 0.2s ease",
                          }}
                        >
                          <div
                            style={{
                              backgroundColor: colors.surface,
                              border: `1px solid ${colors.border}`,
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
                              e.currentTarget.style.borderColor =
                                colors.cardHoverBorder;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.boxShadow = "none";
                              e.currentTarget.style.borderColor = colors.border;
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
                              <div style={{ flex: 1 }}>
                                <div
                                  className="title-small"
                                  style={{
                                    color: colors.text,
                                    marginBottom: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <span
                                    style={{
                                      cursor: "pointer",
                                      color: colors.link,
                                      textDecoration: "none",
                                      transition: "color 0.2s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.textDecoration =
                                        "underline";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.textDecoration =
                                        "none";
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
                                      this.state.favoriteRepoIds.has(
                                        repo.id || ""
                                      )
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
                                          : colors.subText,
                                        fontSize: "14px",
                                        transition: "color 0.2s ease",
                                      }}
                                    />
                                  </span>
                                </div>
                                <div
                                  className="body-small"
                                  style={{
                                    color: colors.subText,
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
                                </div>
                              </div>
                            </div>

                            <div />
                          </div>

                          {/* Pipeline List - Indented under repository card */}
                          {repo.id &&
                            buildStatuses[repo.id]?.pipelineDetails &&
                            buildStatuses[repo.id].pipelineDetails!.length >
                              0 && (
                              <div
                                style={{
                                  // marginLeft: "40px",
                                  marginTop: "12px",
                                  marginBottom: "12px",
                                  backgroundColor: colors.pipelineBg,
                                  border: `1px solid ${colors.subBorder}`,
                                  borderRadius: "6px",
                                  padding: "16px",
                                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "12px",
                                    paddingBottom: "8px",
                                    borderBottom: "1px solid #e1e4e8",
                                  }}
                                >
                                  <Icon
                                    iconName="BuildDefinition"
                                    style={{
                                      fontSize: "16px",
                                      color: colors.link,
                                    }}
                                  />
                                  <span
                                    className="body-small"
                                    style={{
                                      fontWeight: "600",
                                      color: colors.text,
                                      fontSize: "13px",
                                    }}
                                  >
                                    Pipelines (
                                    {
                                      buildStatuses[repo.id].pipelineDetails!
                                        .length
                                    }
                                    )
                                  </span>
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "8px",
                                  }}
                                >
                                  {(this.state.expandedPipelineRepos.has(
                                    repo.id!
                                  )
                                    ? buildStatuses[repo.id].pipelineDetails!
                                    : buildStatuses[
                                        repo.id
                                      ].pipelineDetails!.slice(0, 3)
                                  ).map((pipeline, index) => {
                                    const timeAgo = pipeline.lastBuildTime
                                      ? this.getTimeAgo(
                                          new Date(pipeline.lastBuildTime)
                                        )
                                      : "Never";

                                    return (
                                      <div
                                        key={index}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "12px",
                                          padding: "12px 16px",
                                          backgroundColor: colors.surface,
                                          borderRadius: "6px",
                                          border: `1px solid ${colors.subBorder}`,
                                          transition: "all 0.2s ease",
                                          cursor: "pointer",
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor =
                                            "#f6f8fa";
                                          e.currentTarget.style.borderColor =
                                            "#0078d4";
                                          e.currentTarget.style.boxShadow =
                                            "0 2px 4px rgba(0, 120, 212, 0.1)";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor =
                                            colors.surface;
                                          e.currentTarget.style.borderColor =
                                            colors.subBorder;
                                          e.currentTarget.style.boxShadow =
                                            "none";
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          this.navigateToUrl(pipeline.url);
                                        }}
                                        title={`Click to open ${pipeline.name} pipeline`}
                                      >
                                        {/* Build Status Icon */}
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            width: "24px",
                                            height: "24px",
                                            borderRadius: "50%",
                                            backgroundColor:
                                              this.getBuildStatusColor(
                                                pipeline.status,
                                                pipeline.result
                                              ) + "20",
                                          }}
                                        >
                                          <Icon
                                            iconName={this.getBuildStatusIcon(
                                              pipeline.status,
                                              pipeline.result
                                            )}
                                            style={{
                                              fontSize: "14px",
                                              color: this.getBuildStatusColor(
                                                pipeline.status,
                                                pipeline.result
                                              ),
                                            }}
                                          />
                                        </div>

                                        {/* Pipeline Info */}
                                        <div
                                          style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            flex: 1,
                                            gap: "2px",
                                          }}
                                        >
                                          {/* Pipeline Name */}
                                          <span
                                            style={{
                                              color: colors.link,
                                              fontSize: "13px",
                                              fontWeight: "600",
                                              lineHeight: "1.4",
                                            }}
                                          >
                                            {pipeline.name}
                                            {pipeline.folderPath &&
                                              pipeline.folderPath !== "\\" && (
                                                <span
                                                  className="body-xsmall"
                                                  style={{
                                                    display: "inline-block",
                                                    marginLeft: "8px",
                                                    color: "#666",
                                                    fontWeight: "400",
                                                    fontSize: "11px",
                                                  }}
                                                >
                                                  (
                                                  {pipeline.folderPath.replace(
                                                    /\\/g,
                                                    " / "
                                                  )}
                                                  )
                                                </span>
                                              )}
                                            {pipeline.isBuildPipeline && (
                                              <span
                                                className="body-xsmall"
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "4px",
                                                  marginLeft: "8px",
                                                  padding: "2px 6px",
                                                  borderRadius: "10px",
                                                  backgroundColor: "#E6F2FB",
                                                  border: "1px solid #B3D8F5",
                                                  color: "#106EBE",
                                                  fontWeight: 600,
                                                }}
                                                title="Build validation pipeline"
                                              >
                                                <Icon
                                                  iconName="Shield"
                                                  style={{
                                                    fontSize: "12px",
                                                    color: "#106EBE",
                                                  }}
                                                />
                                                Build validation
                                              </span>
                                            )}
                                          </span>

                                          {/* Status and Time Row */}
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "8px",
                                            }}
                                          >
                                            {/* YAML file link */}
                                            {pipeline.yamlPath && (
                                              <span
                                                style={{
                                                  fontSize: "11px",
                                                  color: "#666",
                                                  backgroundColor: "#f6f8fa",
                                                  padding: "2px 6px",
                                                  borderRadius: "3px",
                                                  cursor: "pointer",
                                                }}
                                                title={`Open ${pipeline.yamlPath} in default branch`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const repoDefault = repo.defaultBranch?.replace(
                                                    "refs/heads/",
                                                    ""
                                                  ) || "master";
                                                  const project = this.getProjectInfo()?.name;
                                                  if (project && repo.name) {
                                                    const url = `${this.config.azureDevOpsBaseUrl}/DefaultCollection/${project}/_git/${repo.name}?path=${encodeURIComponent(
                                                      "/" + pipeline.yamlPath || ""
                                                    )}&version=GB${encodeURIComponent(
                                                      repoDefault
                                                    )}&_a=contents`;
                                                    this.navigateToUrl(url);
                                                  }
                                                }}
                                              >
                                                {pipeline.yamlPath}
                                              </span>
                                            )}
                                            {/* Build Status Text */}
                                            <span
                                              style={{
                                                fontSize: "11px",
                                                color: this.getBuildStatusColor(
                                                  pipeline.status,
                                                  pipeline.result
                                                ),
                                                fontWeight: "500",
                                                backgroundColor:
                                                  this.getBuildStatusColor(
                                                    pipeline.status,
                                                    pipeline.result
                                                  ) + "15",
                                                padding: "2px 6px",
                                                borderRadius: "3px",
                                              }}
                                            >
                                              {this.getBuildStatusText(
                                                pipeline.status,
                                                pipeline.result
                                              )}
                                            </span>

                                            {/* Last Build Time */}
                                            <span
                                              style={{
                                                fontSize: "11px",
                                                color: colors.subText,
                                              }}
                                            >
                                              {timeAgo}
                                            </span>

                                            {/* Build Number */}
                                            {pipeline.buildNumber && (
                                              <span
                                                style={{
                                                  fontSize: "10px",
                                                  color: colors.subText,
                                                  backgroundColor:
                                                    colors.badgeBg,
                                                  padding: "2px 6px",
                                                  borderRadius: "3px",
                                                  fontFamily: "monospace",
                                                }}
                                              >
                                                #{pipeline.buildNumber}
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Actions */}
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                          }}
                                        >
                                          <Button
                                            text="Trigger"
                                            iconProps={{ iconName: "Play" }}
                                            subtle={true}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (repo.id) {
                                                this.triggerPipeline(
                                                  repo.id,
                                                  pipeline.definitionId,
                                                  repo.name || "Unknown"
                                                );
                                              }
                                            }}
                                          />
                                          <Icon
                                            iconName="OpenInNewWindow"
                                            style={{
                                              fontSize: "12px",
                                              color: "#656d76",
                                              opacity: 0.7,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {(buildStatuses[repo.id].pipelineDetails?.length ?? 0) > 3 && (
                                    <div
                                      style={{
                                        marginTop: "12px",
                                        display: "flex",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <Button
                                        text={
                                          this.state.expandedPipelineRepos.has(
                                            repo.id!
                                          )
                                            ? "Show less"
                                            : "Show more"
                                        }
                                        iconProps={{
                                          iconName:
                                            this.state.expandedPipelineRepos.has(
                                              repo.id!
                                            )
                                              ? "ChevronUp"
                                              : "ChevronDown",
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          this.setState((prevState) => {
                                            const next = new Set(
                                              prevState.expandedPipelineRepos
                                            );
                                            if (repo.id && next.has(repo.id)) {
                                              next.delete(repo.id);
                                            } else if (repo.id) {
                                              next.add(repo.id);
                                            }
                                            return {
                                              expandedPipelineRepos: next,
                                            } as any;
                                          });
                                        }}
                                        primary={true}
                                        subtle={false}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      ))}
                  </div>
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
                    color: colors.subText,
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
                  {this.state.reviewPR && (
                    <div
                      style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0,0,0,0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 9999,
                      }}
                      onClick={() =>
                        this.setState({
                          reviewPR: null,
                          hasAcknowledgedReview: false,
                        })
                      }
                    >
                      <div
                        style={{
                          width: "720px",
                          maxHeight: "80vh",
                          overflow: "auto",
                          background: "white",
                          borderRadius: "8px",
                          border: "1px solid #e1e1e1",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          style={{
                            padding: "16px 20px",
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <h3 className="title-small" style={{ margin: 0 }}>
                              Review pull request
                            </h3>
                            <Button
                              text="Close"
                              iconProps={{ iconName: "Cancel" }}
                              subtle={true}
                              onClick={() =>
                                this.setState({
                                  reviewPR: null,
                                  hasAcknowledgedReview: false,
                                })
                              }
                            />
                          </div>
                          <div
                            className="body-small"
                            style={{ color: colors.subText, marginTop: "4px" }}
                          >
                            Please read the description before publishing.
                            Confirmation is required.
                          </div>
                        </div>
                        <div style={{ padding: "16px 20px" }}>
                          <div style={{ marginBottom: "12px" }}>
                            <div
                              className="body-small"
                              style={{
                                color: colors.subText,
                                marginBottom: "6px",
                              }}
                            >
                              Title
                            </div>
                            <div style={{ fontWeight: 600 }}>
                              {this.state.reviewPR.title}
                            </div>
                          </div>
                          <div style={{ marginBottom: "12px" }}>
                            <div
                              className="body-small"
                              style={{
                                color: colors.subText,
                                marginBottom: "6px",
                              }}
                            >
                              Description
                            </div>
                            <div
                              style={{
                                background: isDark ? "#0b1220" : "#fafafa",
                                border: `1px solid ${colors.border}`,
                                borderRadius: "6px",
                                padding: "12px",
                                maxHeight: "360px",
                                overflow: "auto",
                              }}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  a: ({
                                    href,
                                    children,
                                  }: {
                                    href?: string;
                                    children: React.ReactNode;
                                  }) => (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: colors.link }}
                                    >
                                      {children}
                                    </a>
                                  ),
                                  table: ({
                                    children,
                                  }: {
                                    children: React.ReactNode;
                                  }) => (
                                    <table
                                      style={{
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        margin: "8px 0",
                                        color: colors.text,
                                      }}
                                    >
                                      {children}
                                    </table>
                                  ),
                                  th: ({
                                    children,
                                  }: {
                                    children: React.ReactNode;
                                  }) => (
                                    <th
                                      style={{
                                        border: `1px solid ${colors.border}`,
                                        padding: "6px 8px",
                                        textAlign: "left",
                                        background: isDark
                                          ? "#0b2845"
                                          : "#f6f8fa",
                                      }}
                                    >
                                      {children}
                                    </th>
                                  ),
                                  td: ({
                                    children,
                                  }: {
                                    children: React.ReactNode;
                                  }) => (
                                    <td
                                      style={{
                                        border: `1px solid ${colors.border}`,
                                        padding: "6px 8px",
                                      }}
                                    >
                                      {children}
                                    </td>
                                  ),
                                  code: ({
                                    inline,
                                    children,
                                  }: {
                                    inline?: boolean;
                                    children: React.ReactNode;
                                  }) =>
                                    inline ? (
                                      <code
                                        style={{
                                          backgroundColor: isDark
                                            ? "#111827"
                                            : "#f6f8fa",
                                          padding: "2px 4px",
                                          borderRadius: "4px",
                                        }}
                                      >
                                        {children}
                                      </code>
                                    ) : (
                                      <pre
                                        style={{
                                          backgroundColor: isDark
                                            ? "#0b1220"
                                            : "#f6f8fa",
                                          padding: "12px",
                                          borderRadius: "6px",
                                          overflow: "auto",
                                        }}
                                      >
                                        <code>{children}</code>
                                      </pre>
                                    ),
                                }}
                              >
                                {this.state.reviewPR.description ||
                                  "No description provided."}
                              </ReactMarkdown>
                            </div>
                          </div>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={this.state.hasAcknowledgedReview}
                              onChange={(e) =>
                                this.setState({
                                  hasAcknowledgedReview:
                                    e.currentTarget.checked,
                                })
                              }
                            />
                            <span>
                              I have read the description and confirm it's ready
                              to publish
                            </span>
                          </label>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                              gap: "8px",
                              marginTop: "16px",
                            }}
                          >
                            <Button
                              text="Publish"
                              iconProps={{ iconName: "PublishContent" }}
                              primary={true}
                              disabled={!this.state.hasAcknowledgedReview}
                              onClick={async () => {
                                const pr = this.state.reviewPR;
                                if (!pr) return;
                                await this.publishDraftPR(pr);
                                this.setState({
                                  reviewPR: null,
                                  hasAcknowledgedReview: false,
                                });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
                          {/* Removed group publish button to enforce individual review */}
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
                                      text="Review & Publish"
                                      iconProps={{ iconName: "PreviewLink" }}
                                      onClick={async (event) => {
                                        event.stopPropagation();
                                        try {
                                          this.setState({
                                            isReviewLoading: true,
                                            reviewPR: pr,
                                            hasAcknowledgedReview: false,
                                          });
                                          const full =
                                            await this.gitClient!.getPullRequest(
                                              pr.repository!.id!,
                                              pr.pullRequestId!,
                                              pr.repository?.project?.name
                                            );
                                          this.setState({ reviewPR: full });
                                        } catch (e) {
                                          console.warn(
                                            "Failed to fetch full PR details; falling back to list item.",
                                            e
                                          );
                                        } finally {
                                          this.setState({
                                            isReviewLoading: false,
                                          });
                                        }
                                      }}
                                      primary={true}
                                      tooltipProps={{
                                        text: `Open details to review and publish "${pr.title}"`,
                                      }}
                                    />
                                  ) : (
                                    <Button
                                      text="Update from master"
                                      iconProps={{
                                        iconName: "BranchPullRequest",
                                      }}
                                      onClick={(event) => {
                                        event.stopPropagation();
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
      </div>
    );
  }
}

export default HomePage;

showRootComponent(<HomePage />);
