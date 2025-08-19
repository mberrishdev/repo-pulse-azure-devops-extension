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
  PullRequestTimeRangeType,
  PullRequestMergeFailureType,
  PullRequestAsyncStatus,
} from "azure-devops-extension-api/Git";
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
  permissionStatus: {
    hasRepoAccess: boolean | null;
    hasPRAccess: boolean | null;
    permissionMessages: string[];
  };
}

interface HomePageConfig {
  azureDevOpsBaseUrl: string;
}

export class HomePage extends React.Component<object, HomePageState> {
  private config: HomePageConfig = {
    azureDevOpsBaseUrl: "https://dev.azure.com", // Will be set automatically from LocationService
  };

  private CORE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";
  private GIT_REPOSITORIES_SECURITY_NAMESPACE =
    "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";

  public async getOrganizationBaseUrl(): Promise<string> {
    const loc = await SDK.getService<ILocationService>(
      CommonServiceIds.LocationService
    );
    return await loc.getResourceAreaLocation(this.CORE_AREA_ID);
  }

  constructor(props: object) {
    super(props);
    this.state = {
      repos: [],
      pullRequests: [],
      loading: true,
      selectedTabId: "repositories",
      groupedPullRequests: {},
      permissionStatus: {
        hasRepoAccess: null,
        hasPRAccess: null,
        permissionMessages: [],
      },
    };
  }

  public async componentDidMount() {
    await SDK.init({ applyTheme: true });

    await SDK.ready();

    await this.initializeConfig();
    await this.checkPermissions();
    this.loadRepositories();
    this.loadPullRequests();
  }

  private async checkPermissions() {
    const messages: string[] = [];

    try {
      // Check if user can access Azure DevOps project
      const webContext = SDK.getWebContext();

      // 🔍 DEBUG: Log complete webContext structure
      console.log("🔍 DEBUG - Complete webContext:", webContext);
      console.log("🔍 DEBUG - webContext type:", typeof webContext);
      console.log("🔍 DEBUG - webContext keys:", Object.keys(webContext || {}));

      // Check if SDK is properly initialized
      if (!webContext) {
        console.error(
          "❌ DEBUG: webContext is null/undefined - SDK may not be properly initialized"
        );
        messages.push(
          "❌ Azure DevOps SDK not properly initialized. Please reload the page."
        );
        await this.showToast("SDK initialization failed", "error");
        return;
      }

      // 🔍 DEBUG: Log project information
      console.log("🔍 DEBUG - webContext.project:", webContext.project);
      console.log("🔍 DEBUG - project type:", typeof webContext.project);
      if (webContext.project) {
        console.log(
          "🔍 DEBUG - project keys:",
          Object.keys(webContext.project)
        );
        console.log("🔍 DEBUG - project.id:", webContext.project.id);
        console.log("🔍 DEBUG - project.name:", webContext.project.name);
      }

      if (!webContext.project?.id) {
        console.error("❌ DEBUG: No project ID found!");
        messages.push(
          "❌ No project context available. Please ensure this extension is running within an Azure DevOps project."
        );
        await this.showToast(
          "Permission Check: No project context available",
          "error"
        );
        return;
      }

      // Check basic project access
      messages.push(
        `✅ Project Access: Connected to project "${webContext.project.name}"`
      );

      // Show info about required permissions
      messages.push(
        `ℹ️  Required Permissions: This extension needs access to Git Repositories security namespace (${this.GIT_REPOSITORIES_SECURITY_NAMESPACE})`
      );
      messages.push("ℹ️  Checking repository and pull request access...");

      this.setState({
        permissionStatus: {
          ...this.state.permissionStatus,
          permissionMessages: messages,
        },
      });

      await this.showToast("🔍 Checking Azure DevOps permissions...", "info");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ DEBUG: Permission check error:", error);

      // Check for specific security namespace permission error
      if (
        errorMessage.includes("security namespace") &&
        errorMessage.includes("No permissions found")
      ) {
        messages.push(
          "❌ Security Permission Error: Extension lacks proper Azure DevOps permissions"
        );
        messages.push(
          "🔧 Solution: Reinstall the extension or contact your Azure DevOps administrator"
        );
        messages.push(
          "ℹ️  This error usually indicates missing scopes in the extension manifest"
        );
      } else {
        messages.push(`❌ Permission Check Failed: ${errorMessage}`);
      }

      this.setState({
        permissionStatus: {
          ...this.state.permissionStatus,
          permissionMessages: messages,
        },
      });

      await this.showToast(
        "❌ Permission check failed during initialization",
        "error"
      );
    }
  }

  private async initializeConfig() {
    try {
      const baseUrl = await this.getOrganizationBaseUrl();
      const url = new URL(baseUrl);
      this.config.azureDevOpsBaseUrl = `${url.protocol}//${url.host}`;
      console.log(
        "Successfully detected Azure DevOps base URL:",
        this.config.azureDevOpsBaseUrl
      );
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
      const webContext = SDK.getWebContext();

      // 🔍 DEBUG: Log webContext in loadRepositories
      console.log("🔍 DEBUG loadRepositories - webContext:", webContext);
      console.log(
        "🔍 DEBUG loadRepositories - webContext.project:",
        webContext.project
      );

      // Check if project context is available
      if (!webContext.project?.id) {
        console.error(
          "❌ DEBUG loadRepositories: No project context available for repository loading"
        );
        console.error(
          "❌ DEBUG loadRepositories: webContext.project is:",
          webContext.project
        );
        await this.showToast(
          "❌ No project context available. Please ensure this extension is running within an Azure DevOps project.",
          "error"
        );
        this.setState({
          repos: [],
          loading: false,
          error: "No project context available",
          permissionStatus: {
            ...this.state.permissionStatus,
            hasRepoAccess: false,
            permissionMessages: [
              ...this.state.permissionStatus.permissionMessages,
              "❌ Repository Access Failed: No project context available",
            ],
          },
        });
        return;
      }

      const projectId = webContext.project.id;
      const gitClient = getClient(GitRestClient);

      // Use the REST client to get repositories (no fetch, no CORS issue)
      const repos = await gitClient.getRepositories(projectId);

      // Update permission status for successful repository access
      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `✅ Repository Access: Successfully loaded ${
          repos?.length || 0
        } repositories`,
      ];

      this.setState({
        repos: repos || [],
        loading: false,
        permissionStatus: {
          ...this.state.permissionStatus,
          hasRepoAccess: true,
          permissionMessages: updatedMessages,
        },
      });

      await this.showToast(
        `✅ Repository permissions verified! Found ${
          repos?.length || 0
        } repositories.`,
        "success"
      );
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
          message.includes("TF401028")
        ) {
          isPermissionError = true;
          message = `Access Denied: You don't have permission to read repositories. Required permission: 'GenericRead' in Git Repositories namespace (${this.GIT_REPOSITORIES_SECURITY_NAMESPACE})`;
        }
      }

      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `❌ Repository Access Failed: ${message}`,
      ];

      this.setState({
        error: message,
        loading: false,
        permissionStatus: {
          ...this.state.permissionStatus,
          hasRepoAccess: false,
          permissionMessages: updatedMessages,
        },
      });

      if (isPermissionError) {
        await this.showToast(
          "❌ Permission Error: Cannot read repositories. Contact your Azure DevOps administrator to grant 'Repository Read' permissions.",
          "error"
        );
      } else {
        await this.showToast(
          `❌ Failed to load repositories: ${message}`,
          "error"
        );
      }
    }
  }

  async loadPullRequests() {
    try {
      const webContext = SDK.getWebContext();

      // 🔍 DEBUG: Log webContext in loadPullRequests
      console.log("🔍 DEBUG loadPullRequests - webContext:", webContext);
      console.log(
        "🔍 DEBUG loadPullRequests - webContext.project:",
        webContext.project
      );

      // Check if project context is available
      if (!webContext.project?.id) {
        console.error(
          "❌ DEBUG loadPullRequests: No project context available for pull request loading"
        );
        console.error(
          "❌ DEBUG loadPullRequests: webContext.project is:",
          webContext.project
        );
        await this.showToast(
          "❌ No project context available. Please ensure this extension is running within an Azure DevOps project.",
          "error"
        );
        this.setState({
          pullRequests: [],
          groupedPullRequests: {},
          permissionStatus: {
            ...this.state.permissionStatus,
            hasPRAccess: false,
            permissionMessages: [
              ...this.state.permissionStatus.permissionMessages,
              "❌ Pull Request Access Failed: No project context available",
            ],
          },
        });
        return;
      }

      const projectId = webContext.project.id;
      console.log("🔍 DEBUG loadPullRequests - projectId:", projectId);

      const gitClient = getClient(GitRestClient);
      console.log(
        "🔍 DEBUG loadPullRequests - gitClient created:",
        !!gitClient
      );

      // Get all repositories first
      console.log(
        "🔍 DEBUG loadPullRequests - About to call getRepositories..."
      );
      const repos = await gitClient.getRepositories(projectId);
      console.log("🔍 DEBUG loadPullRequests - Retrieved repos:", repos);
      console.log(
        "🔍 DEBUG loadPullRequests - Repos count:",
        repos?.length || 0
      );

      // Get pull requests for all repositories
      const allPullRequests: GitPullRequest[] = [];
      for (const repo of repos || []) {
        console.log("🔍 DEBUG loadPullRequests - Processing repo:", repo);
        console.log("🔍 DEBUG loadPullRequests - Repo type:", typeof repo);
        console.log("🔍 DEBUG loadPullRequests - Repo.id:", repo?.id);
        console.log("🔍 DEBUG loadPullRequests - Repo.name:", repo?.name);

        if (!repo || !repo.id) {
          console.warn("⚠️  Skipping repository without valid ID:", repo);
          continue;
        }

        try {
          // Use safe search criteria to avoid SQL exceptions
          const pullRequests = await gitClient.getPullRequests(repo.id, {
            status: PullRequestStatus.Active,
            includeLinks: false,
            creatorId: null,
            maxTime: new Date(Date.now() + 1000 * 365 * 24 * 60 * 60 * 1),
            minTime: new Date(Date.now() - 1000 * 365 * 24 * 60 * 60),
            queryTimeRangeType: PullRequestTimeRangeType.Created,
            repositoryId: repo.id,
            reviewerId: null,
            sourceRefName: null,
            sourceRepositoryId: null,
            targetRefName: null,
          });

          if (pullRequests && pullRequests.length > 0) {
            allPullRequests.push(...pullRequests);
          }
        } catch (error) {
          console.warn(
            `Failed to load pull requests for repo ${repo.name || "Unknown"}:`,
            error
          );
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          await this.showToast(
            `Failed to load pull requests for ${
              repo.name || "repository"
            }: ${errorMessage}`,
            "warning"
          );
          // Continue with other repositories even if one fails
        }
      }

      // Group pull requests by repository
      const groupedPullRequests = this.groupPullRequests(allPullRequests);

      // Update permission status for successful pull request access
      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `✅ Pull Request Access: Successfully loaded ${
          allPullRequests.length
        } pull requests from ${(repos || []).length} repositories`,
      ];

      this.setState({
        pullRequests: allPullRequests,
        groupedPullRequests,
        permissionStatus: {
          ...this.state.permissionStatus,
          hasPRAccess: true,
          permissionMessages: updatedMessages,
        },
      });

      if (allPullRequests.length > 0) {
        await this.showToast(
          `✅ Pull Request permissions verified! Found ${allPullRequests.length} active pull requests.`,
          "success"
        );
      } else {
        await this.showToast(
          "✅ Pull Request access verified, but no active pull requests found.",
          "info"
        );
      }
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
        errorMessage.includes("TF401028")
      ) {
        isPermissionError = true;
      }

      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `❌ Pull Request Access Failed: ${errorMessage}`,
      ];

      this.setState({
        pullRequests: [],
        groupedPullRequests: {},
        permissionStatus: {
          ...this.state.permissionStatus,
          hasPRAccess: false,
          permissionMessages: updatedMessages,
        },
      });

      if (isPermissionError) {
        await this.showToast(
          `❌ Permission Error: Cannot read pull requests. Required permission: 'PullRequestContribute' in Git Repositories namespace (${this.GIT_REPOSITORIES_SECURITY_NAMESPACE}). Contact your Azure DevOps administrator.`,
          "error"
        );
      } else {
        await this.showToast(
          `❌ Failed to load pull requests: ${errorMessage}`,
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

  private openRepository = (repo: GitRepository) => {
    const webContext = SDK.getWebContext();
    const repoUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${repo.name}`;
    window.open(repoUrl, "_blank");
  };

  private createUpdatePRFromMaster = async (
    repo: GitRepository,
    targetRefName?: string
  ) => {
    try {
      const webContext = SDK.getWebContext();
      const gitClient = getClient(GitRestClient);

      const masterBranch = "master";

      const pullRequest = await gitClient.createPullRequest(
        {
          sourceRefName: `refs/heads/${masterBranch}`,
          targetRefName: `${targetRefName}`,
          title: `Update ${targetRefName} from ${masterBranch}`,
          description: `Automated PR to update ${targetRefName} with latest changes from ${masterBranch}`,
          isDraft: false,
          supportsIterations: true,
          _links: undefined,
          artifactId: "",
          autoCompleteSetBy: null,
          closedBy: null,
          closedDate: null,
          codeReviewId: 0,
          commits: [],
          completionOptions: null,
          completionQueueTime: null,
          createdBy: null,
          creationDate: null,
          forkSource: null,
          hasMultipleMergeBases: false,
          labels: [],
          lastMergeCommit: null,
          lastMergeSourceCommit: null,
          lastMergeTargetCommit: null,
          mergeFailureMessage: "",
          mergeFailureType: PullRequestMergeFailureType.None,
          mergeId: "",
          mergeOptions: null,
          mergeStatus: PullRequestAsyncStatus.NotSet,
          pullRequestId: 0,
          remoteUrl: "",
          repository: null,
          reviewers: [],
          status: PullRequestStatus.NotSet,
          url: "",
          workItemRefs: [],
        },
        repo.id
      );

      if (pullRequest) {
        const prUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${repo.name}/pullrequest/${pullRequest.pullRequestId}`;
        window.open(prUrl, "_blank");
        await this.showToast("Pull request created successfully!", "success");
      }
    } catch (error: unknown) {
      console.error(`Failed to create update PR for ${repo.name}:`, error);

      // Handle specific error cases
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("TF401179")) {
        await this.showToast(
          `A pull request from master to ${targetRefName} already exists for ${repo.name}. Please check existing pull requests.`,
          "warning"
        );
      } else if (errorMessage.includes("TF401028")) {
        await this.showToast(
          `The source branch 'master' does not exist in ${repo.name}. Please ensure the master branch exists.`,
          "warning"
        );
      } else if (errorMessage.includes("TF401027")) {
        await this.showToast(
          `The target branch '${targetRefName}' does not exist in ${repo.name}. Please check the branch name.`,
          "warning"
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
      // Fallback to console log if toast service fails
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
      permissionStatus,
    } = this.state;

    return (
      <div
        style={{
          width: "100%",
          backgroundColor: "#f8f9fa",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            borderBottom: "1px solid #e1e1e1",
            padding: "16px 24px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "24px",
              fontWeight: "600",
              color: "#323130",
            }}
          >
            Repo Pulse
          </h1>
        </div>

        {/* Permission Status Panel */}
        {permissionStatus.permissionMessages.length > 0 && (
          <div
            style={{
              margin: "16px 24px",
              padding: "16px",
              backgroundColor: "white",
              border: "1px solid #e1e1e1",
              borderRadius: "6px",
              fontSize: "12px",
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "12px",
                fontSize: "14px",
                fontWeight: "600",
                color: "#323130",
              }}
            >
              <Icon
                iconName="SecurityGroup"
                style={{ marginRight: "8px", color: "#0078d4" }}
              />
              Permission Status - Git Repositories Namespace (
              {this.GIT_REPOSITORIES_SECURITY_NAMESPACE})
            </div>

            <div
              style={{
                display: "grid",
                gap: "6px",
                maxHeight: "120px",
                overflowY: "auto",
                padding: "8px",
                backgroundColor: "#f8f9fa",
                borderRadius: "4px",
              }}
            >
              {permissionStatus.permissionMessages.map((message, index) => (
                <div
                  key={index}
                  style={{
                    color: message.startsWith("✅")
                      ? "#107c10"
                      : message.startsWith("❌")
                      ? "#d13438"
                      : message.startsWith("ℹ️")
                      ? "#0078d4"
                      : "#666",
                    lineHeight: "1.4",
                  }}
                >
                  {message}
                </div>
              ))}
            </div>

            {/* Quick Permission Summary */}
            <div
              style={{
                marginTop: "12px",
                padding: "8px",
                backgroundColor: "#f3f2f1",
                borderRadius: "4px",
                display: "flex",
                gap: "16px",
                alignItems: "center",
                fontSize: "12px",
              }}
            >
              <span
                style={{
                  color:
                    permissionStatus.hasRepoAccess === true
                      ? "#107c10"
                      : permissionStatus.hasRepoAccess === false
                      ? "#d13438"
                      : "#666",
                }}
              >
                {permissionStatus.hasRepoAccess === true
                  ? "✅"
                  : permissionStatus.hasRepoAccess === false
                  ? "❌"
                  : "⏳"}{" "}
                Repository Access
              </span>
              <span
                style={{
                  color:
                    permissionStatus.hasPRAccess === true
                      ? "#107c10"
                      : permissionStatus.hasPRAccess === false
                      ? "#d13438"
                      : "#666",
                }}
              >
                {permissionStatus.hasPRAccess === true
                  ? "✅"
                  : permissionStatus.hasPRAccess === false
                  ? "❌"
                  : "⏳"}{" "}
                Pull Request Access
              </span>
            </div>
          </div>
        )}

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
                fontSize: "14px",
              }}
              onClick={() => this.onTabChanged("repositories")}
            >
              Repositories ({repos.length})
            </button>
            <button
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
                fontSize: "14px",
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
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#666",
                    fontSize: "14px",
                  }}
                >
                  Loading repositories...
                </div>
              )}

              {error && (
                <div
                  style={{
                    backgroundColor: "#fde7e9",
                    border: "1px solid #f1707b",
                    borderRadius: "4px",
                    padding: "12px 16px",
                    color: "#d13438",
                    fontSize: "14px",
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
                              fontSize: "14px",
                            }}
                          >
                            {repo.name.charAt(0).toUpperCase()}
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
                              {repo.name}
                            </div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "#666",
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
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
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#666",
                    fontSize: "14px",
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
                            style={{
                              margin: 0,
                              fontSize: "16px",
                              fontWeight: "600",
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
                                const webContext = SDK.getWebContext();
                                const prUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${pr.repository?.name}/pullrequest/${pr.pullRequestId}`;
                                window.open(prUrl, "_blank");
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
                    style={{
                      fontSize: "16px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    No active pull requests found
                  </div>
                  <div style={{ fontSize: "14px", color: "#999" }}>
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
