import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as SDK from "azure-devops-extension-sdk";
import { showRootComponent } from "../Common";
import { getClient, ILocationService } from "azure-devops-extension-api";
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
}

interface RepositoryBuildStatus {
  status: BuildStatus;
  result?: BuildResult;
  finishTime?: Date;
  startTime?: Date;
  buildNumber?: string;
  isLoading: boolean;
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
      selectedTabId: "repositories",
      groupedPullRequests: {},
      buildStatuses: {},
    };
  }

  public async componentDidMount() {
    try {
      await SDK.init({ applyTheme: true });
      await SDK.ready();

      await this.initializeConfig();
      await this.initializeSDKClients();

      await new Promise((resolve) => setTimeout(resolve, 500));

      await this.checkPermissions();
      await this.loadRepositories();
      await this.loadPullRequests();
    } catch (error) {
      console.error("Extension initialization failed:", error);
      await this.showToast("Failed to initialize extension", "error");
    }
  }

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

      // Basic validation that we can access the project
      if (!this.gitClient) {
        throw new Error("Git client not initialized");
      }

      // Test basic access by getting repositories
      try {
        await this.gitClient.getRepositories(
          projectInfo.id || projectInfo.name
        );
      } catch (permError) {
        const permErrorMessage =
          permError instanceof Error ? permError.message : String(permError);
        console.error("Permission check via SDK failed:", permError);

        // Show appropriate error message
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

      this.setState({
        repos: repos,
        loading: false,
      });

      this.loadBuildStatusesForRepositories(repos, projectInfo);
    } catch (error: unknown) {
      let message = "Failed to load repositories";
      let isPermissionError = false;

      if (error instanceof Error) {
        message = error.message;

        // Check for permission-related errors
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
      console.log(
        `🚀 [BUILD DEBUG] Loading all build definitions for project ${projectName}...`
      );

      if (!this.buildClient) {
        console.log(`❌ [BUILD DEBUG] No build client available`);
        return;
      }

      const allDefinitions = await this.buildClient.getDefinitions(
        projectName,
        undefined, // name
        undefined, // repositoryId
        undefined, // repositoryType
        undefined, // queryOrder
        undefined, // top
        undefined, // continuationToken
        undefined, // minMetricsTime
        undefined, // definitionIds
        undefined, // path
        undefined, // builtAfter
        undefined, // notBuiltAfter
        true, // includeAllProperties - this might give us repository info
        true // includeLatestBuilds
      );

      console.log(
        `📋 [BUILD DEBUG] Found ${allDefinitions.length} total build definitions in project`
      );

      if (allDefinitions.length > 0) {
        console.log(`🔍 [BUILD DEBUG] Sample definition structure:`, {
          keys: Object.keys(allDefinitions[0]),
          definition: allDefinitions[0],
        });
      }

      const definitionsByRepo = new Map<string, any[]>();

      for (const repo of repos) {
        // For now, let's get all CI/PR-like definitions and check them individually
        const potentialDefinitions = allDefinitions.filter((def) => {
          const isCiLike =
            def.name?.toLowerCase().includes("ci") ||
            def.name?.toLowerCase().includes("pr") ||
            def.name?.toLowerCase().includes("validation") ||
            def.name?.toLowerCase().includes("build") ||
            def.name?.toLowerCase().includes(repo.name?.toLowerCase() || "");

          console.log(
            `🔍 [BUILD DEBUG] Checking if definition "${def.name}" is CI-like for repo ${repo.name}: ${isCiLike}`
          );
          return isCiLike;
        });

        const repoDefinitions = [];
        for (const def of potentialDefinitions) {
          try {
            console.log(
              `🔍 [BUILD DEBUG] Getting full definition for "${def.name}" (ID: ${def.id})...`
            );
            const fullDefinition = await this.buildClient!.getDefinition(
              projectName,
              def.id
            );

            console.log(`🔍 [BUILD DEBUG] Full definition for "${def.name}":`, {
              hasRepository: !!fullDefinition.repository,
              repositoryId: fullDefinition.repository?.id,
              repositoryName: fullDefinition.repository?.name,
              matchesRepo:
                fullDefinition.repository?.id === repo.id ||
                fullDefinition.repository?.name === repo.name,
            });

            if (
              fullDefinition.repository?.id === repo.id ||
              fullDefinition.repository?.name === repo.name
            ) {
              repoDefinitions.push(fullDefinition);
              console.log(
                `[BUILD DEBUG] Definition "${def.name}" matches repository ${repo.name}`
              );
            }
          } catch (error) {
            console.log(
              `[BUILD DEBUG] Failed to get full definition for "${def.name}":`,
              error
            );
          }
        }

        if (repoDefinitions.length > 0) {
          definitionsByRepo.set(repo.id!, repoDefinitions);
          console.log(
            `[BUILD DEBUG] Found ${repoDefinitions.length} definitions for ${repo.name}`
          );
        } else {
          console.log(
            `[BUILD DEBUG] No matching definitions found for ${repo.name}`
          );
        }
      }

      // Process each repository's definitions
      const processPromises = repos.map(async (repo) => {
        if (!repo.id) return;

        const definitions = definitionsByRepo.get(repo.id);
        if (!definitions || definitions.length === 0) {
          console.log(
            `[BUILD DEBUG] No definitions to process for ${repo.name}`
          );
          return;
        }

        // Look for CI/PR validation definitions
        const prValidationDef = definitions.find((def) => {
          const isCi =
            def.name?.toLowerCase().includes("ci") ||
            def.name?.toLowerCase().includes("pr") ||
            def.name?.toLowerCase().includes("validation") ||
            def.name?.toLowerCase().includes("build");

          console.log(
            `🔍 [BUILD DEBUG] Checking if "${def.name}" is CI/PR definition: ${isCi}`
          );
          return isCi;
        });

        if (!prValidationDef?.id) {
          console.log(
            `[BUILD DEBUG] No CI/PR validation definition found for ${repo.name}`
          );
          return;
        }

        console.log(
          `[BUILD DEBUG] Found CI definition "${prValidationDef.name}" for ${repo.name}`
        );

        try {
          // Get latest builds for this definition
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

          console.log(
            `📋 [BUILD DEBUG] Found ${builds.length} builds for ${repo.name}`
          );

          if (builds.length > 0) {
            const latestBuild = builds[0];
            const buildStatus: RepositoryBuildStatus = {
              status: latestBuild.status,
              result: latestBuild.result,
              finishTime: latestBuild.finishTime,
              startTime: latestBuild.startTime,
              buildNumber: latestBuild.buildNumber,
              isLoading: false,
            };

            console.log(
              `[BUILD DEBUG] Build status loaded for ${repo.name}:`,
              buildStatus
            );

            this.setState((prevState) => ({
              buildStatuses: {
                ...prevState.buildStatuses,
                [repo.id!]: buildStatus,
              },
            }));
          }
        } catch (buildError) {
          console.error(
            `❌ [BUILD DEBUG] Failed to load builds for ${repo.name}:`,
            buildError
          );
        }
      });

      await Promise.allSettled(processPromises);
      console.log(
        `🏁 [BUILD DEBUG] Finished processing build statuses for all repositories`
      );
    } catch (error) {
      console.error(
        `❌ [BUILD DEBUG] Failed to load build definitions:`,
        error
      );
    }
  }

  private async loadBuildStatusForRepository(
    repo: GitRepository,
    projectName: string
  ) {
    try {
      console.log(
        `🔍 [BUILD DEBUG] Loading build status for repository: ${repo.name} (ID: ${repo.id})`
      );

      if (!this.buildClient || !repo.id) {
        console.log(
          `❌ [BUILD DEBUG] Missing buildClient or repo.id for ${repo.name}`
        );
        return;
      }

      console.log(
        `🔍 [BUILD DEBUG] Fetching build definitions for repository ${repo.name}...`
      );

      const definitions = await this.buildClient.getDefinitions(
        projectName,
        undefined, // name
        repo.id, // repositoryId
        "TfsGit", // repositoryType - REQUIRED when using repositoryId
        undefined, // queryOrder
        undefined, // top
        undefined, // continuationToken
        undefined, // minMetricsTime
        undefined, // definitionIds
        undefined, // path
        undefined, // builtAfter
        undefined, // notBuiltAfter
        false, // includeAllProperties
        true // includeLatestBuilds
      );

      console.log(
        `📋 [BUILD DEBUG] Found ${definitions.length} build definitions for ${repo.name}:`,
        definitions.map((def) => ({
          name: def.name,
          id: def.id,
          path: def.path,
        }))
      );

      const prValidationDef = definitions.find(
        (def) =>
          def.path?.includes("pr-validation.yml") ||
          def.path?.includes("azure-pipelines.yml")
      );

      if (prValidationDef && prValidationDef.id) {
        const builds = await this.buildClient.getBuilds(
          projectName,
          [prValidationDef.id], // definitions
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
            isLoading: false,
          };

          this.setState((prevState) => ({
            buildStatuses: {
              ...prevState.buildStatuses,
              [repo.id!]: buildStatus,
            },
          }));
        }
      }
    } catch (error) {
      console.error(`Failed to load build status for ${repo.name}:`, error);

      if (repo.id) {
        this.setState((prevState) => ({
          buildStatuses: {
            ...prevState.buildStatuses,
            [repo.id!]: {
              status: BuildStatus.None,
              isLoading: false,
            },
          },
        }));
      }
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
        status: PullRequestStatus.Active,
      };

      const allPullRequests = await this.gitClient.getPullRequestsByProject(
        projectInfo.id || projectInfo.name,
        searchCriteria as any
      );

      // Group pull requests by title
      const groupedPullRequests = this.groupPullRequests(allPullRequests);

      // Update permission status for successful pull request access
      this.setState({
        pullRequests: allPullRequests,
        groupedPullRequests,
      });
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

  private groupPullRequests = (
    pullRequests: GitPullRequest[]
  ): Record<string, GitPullRequest[]> => {
    const groups: Record<string, GitPullRequest[]> = {};

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
      console.log(`${type.toUpperCase()}: ${message}`);
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
                        onClick={() => this.openRepository(repo)}
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
                              }}
                            >
                              {repo.name}
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
                              <span>•</span>
                              <span>
                                Size:{" "}
                                {repo.size
                                  ? `${Math.round(repo.size / 1024)} KB`
                                  : "Unknown"}
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
                                    }}
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
                          <div
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              backgroundColor: "#107c10",
                            }}
                          />
                          <Icon
                            iconName="ChevronRight"
                            style={{ color: "#666", fontSize: "12px" }}
                          />
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
                  {Object.entries(groupedPullRequests).map(([prTitle, prs]) => (
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
                            style={{ color: "#0078d4", fontSize: "16px" }}
                          />
                          <h3
                            className="title-small"
                            style={{
                              margin: 0,
                              color: "#323130",
                            }}
                          >
                            {prTitle} ({prs.length} pull requests)
                          </h3>
                        </div>
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
                                    {(
                                      pr as GitPullRequest & {
                                        buildStatus?: {
                                          id: number;
                                          status: string;
                                          result: string;
                                          url: string;
                                        };
                                      }
                                    ).buildStatus && (
                                      <>
                                        <span>•</span>
                                        <span
                                          style={{
                                            padding: "2px 6px",
                                            borderRadius: "4px",
                                            fontSize: "10px",
                                            fontWeight: "600",
                                            backgroundColor:
                                              (
                                                pr as GitPullRequest & {
                                                  buildStatus?: {
                                                    id: number;
                                                    status: string;
                                                    result: string;
                                                    url: string;
                                                  };
                                                }
                                              ).buildStatus?.result ===
                                              "succeeded"
                                                ? "#107c10"
                                                : (
                                                    pr as GitPullRequest & {
                                                      buildStatus?: {
                                                        id: number;
                                                        status: string;
                                                        result: string;
                                                        url: string;
                                                      };
                                                    }
                                                  ).buildStatus?.result ===
                                                  "failed"
                                                ? "#d13438"
                                                : "#ff8c00",
                                            color: "#fff",
                                          }}
                                        >
                                          BUILD{" "}
                                          {(
                                            pr as GitPullRequest & {
                                              buildStatus?: {
                                                id: number;
                                                status: string;
                                                result: string;
                                                url: string;
                                              };
                                            }
                                          ).buildStatus?.result?.toUpperCase() ||
                                            "UNKNOWN"}
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
                                <Button
                                  text="Update from master"
                                  iconProps={{ iconName: "BranchPullRequest" }}
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
                                <Icon
                                  iconName="ChevronRight"
                                  style={{ color: "#666", fontSize: "12px" }}
                                />
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
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
