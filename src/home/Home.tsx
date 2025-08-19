import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as SDK from "azure-devops-extension-sdk";
import { showRootComponent } from "../Common";
import { ILocationService } from "azure-devops-extension-api";
import {
  CommonServiceIds,
  IGlobalMessagesService,
  IToast,
} from "azure-devops-extension-api";

// Define interfaces for REST API responses
interface GitRepository {
  id: string;
  name: string;
  defaultBranch?: string;
  size?: number;
  webUrl?: string;
  project?: {
    id: string;
    name: string;
  };
}

interface GitPullRequest {
  pullRequestId: number;
  title?: string;
  description?: string;
  sourceRefName?: string;
  targetRefName?: string;
  status?: number;
  isDraft?: boolean;
  repository?: GitRepository;
  createdBy?: {
    displayName: string;
    id: string;
  };
  creationDate?: string;
}

interface SecurityPermission {
  namespaceId: string;
  token: string;
  acesDictionary: Record<string, any>;
}

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
  showProjectInput: boolean;
  manualProjectName: string;
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
  private accessToken: string = "";

  public async getOrganizationBaseUrl(): Promise<string> {
    const loc = await SDK.getService<ILocationService>(
      CommonServiceIds.LocationService
    );
    return await loc.getResourceAreaLocation(this.CORE_AREA_ID);
  }

  /**
   * Helper method to make authenticated REST API calls
   */
  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Helper method to make authenticated REST API POST calls
   */
  private async postJson<T>(url: string, data: any): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Helper method to extract project information from URL when webContext is empty
   */
  private getProjectFromUrl(): { id?: string; name?: string } | null {
    try {
      const url = window.location.href;
      console.log("🔍 DEBUG - Current URL:", url);
      
      // Try to extract project name from various URL patterns
      // Pattern 1: https://server/collection/project/_git/repo
      // Pattern 2: https://server/collection/project/_apps/hub/...
      const patterns = [
        /\/([^\/]+)\/([^\/]+)\/_git/,
        /\/([^\/]+)\/([^\/]+)\/_apps/,
        /\/([^\/]+)\/([^\/]+)\/_build/,
        /\/([^\/]+)\/([^\/]+)\/_work/,
        /\/([^\/]+)\/([^\/]+)\/$/
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[2]) {
          const projectName = decodeURIComponent(match[2]);
          console.log("🔍 DEBUG - Extracted project name from URL:", projectName);
          return { name: projectName };
        }
      }

      console.log("❌ DEBUG - Could not extract project from URL");
      return null;
    } catch (error) {
      console.error("❌ DEBUG - Error extracting project from URL:", error);
      return null;
    }
  }

  /**
   * Get project information with fallback hierarchy:
   * 1. webContext.project
   * 2. URL extraction
   * 3. Manual user input
   */
  private getProjectInfo(): { id?: string; name?: string } | null {
    const webContext = SDK.getWebContext();

    // Try webContext first
    if (webContext.project?.id) {
      console.log("🔍 DEBUG - Using webContext project:", webContext.project.name);
      return webContext.project;
    }

    // Try URL extraction
    const urlProject = this.getProjectFromUrl();
    if (urlProject?.name) {
      console.log("🔍 DEBUG - Using URL extracted project:", urlProject.name);
      return urlProject;
    }

    // Finally, check if user has provided manual input
    if (this.state.manualProjectName.trim()) {
      console.log("🔍 DEBUG - Using manually entered project:", this.state.manualProjectName.trim());
      return { name: this.state.manualProjectName.trim() };
    }

    return null;
  }

  /**
   * Handle manual project name submission
   */
  private handleProjectSubmit = async () => {
    if (!this.state.manualProjectName.trim()) {
      await this.showToast("Please enter a project name", "error");
      return;
    }

    this.setState({ showProjectInput: false, loading: true });
    await this.showToast("Connecting to project...", "info");
    
    // Retry the operations with the manual project name
    await this.checkPermissionsViaRest();
    this.loadRepositoriesViaRest();
    this.loadPullRequestsViaRest();
  };

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
      showProjectInput: false,
      manualProjectName: "",
    };
  }

  public async componentDidMount() {
    try {
      await SDK.init({ applyTheme: true });
      await SDK.ready();

      // Get access token for REST API calls
      this.accessToken = await SDK.getAccessToken();
      console.log("🔍 DEBUG - Access token obtained:", !!this.accessToken);

      await this.initializeConfig();
      
      // Wait a bit for the SDK to fully initialize context
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.checkPermissionsViaRest();
      this.loadRepositoriesViaRest();
      this.loadPullRequestsViaRest();
    } catch (error) {
      console.error("❌ Extension initialization failed:", error);
      await this.showToast("Failed to initialize extension", "error");
    }
  }

  private async checkPermissionsViaRest() {
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

      const projectInfo = this.getProjectInfo();
      
      if (!projectInfo?.name) {
        console.error("❌ DEBUG: No project ID found in webContext and could not extract from URL!");
        console.log("🔧 DEBUG: Enabling manual project input");
        
        messages.push(
          "❌ No project context available. Extension may not be properly installed in project context."
        );
        messages.push(
          "🔧 Manual project entry enabled below. Please enter your project name."
        );
        
        this.setState({
          permissionStatus: {
            ...this.state.permissionStatus,
            permissionMessages: messages,
          },
          showProjectInput: true,
          loading: false
        });

        await this.showToast(
          "Please enter project name manually",
          "info"
        );
        return;
      }

      // Check basic project access
      messages.push(
        `✅ Project Access: Connected to project "${projectInfo.name}"`
      );

      // Check permissions via REST API instead of relying on shared data
      try {
        // Try to get repositories - this will test our basic Git access
        const reposUrl = `${this.config.azureDevOpsBaseUrl}/${projectInfo.name}/_apis/git/repositories?api-version=7.1`;
        console.log("🔍 DEBUG - Testing repository access with URL:", reposUrl);
        
        const reposResponse = await this.getJson<{ value: GitRepository[] }>(reposUrl);
        const repoCount = reposResponse?.value?.length || 0;
        
        messages.push(`✅ Repository Access: Found ${repoCount} repositories via REST API`);
        
        // If we have repositories, test pull request access
        if (repoCount > 0) {
          const prUrl = `${this.config.azureDevOpsBaseUrl}/${projectInfo.name}/_apis/git/pullrequests?searchCriteria.status=active&api-version=7.1`;
          console.log("🔍 DEBUG - Testing pull request access with URL:", prUrl);
          
          const prResponse = await this.getJson<{ value: GitPullRequest[] }>(prUrl);
          const prCount = prResponse?.value?.length || 0;
          
          messages.push(`✅ Pull Request Access: Found ${prCount} active pull requests via REST API`);
          messages.push(`ℹ️  REST API permissions verified for Git Repositories namespace`);
        }

      } catch (permError) {
        const permErrorMessage = permError instanceof Error ? permError.message : String(permError);
        console.error("❌ DEBUG: Permission check via REST failed:", permError);
        
        if (permErrorMessage.includes("403") || permErrorMessage.includes("Forbidden")) {
          messages.push("❌ Permission Error: Access denied to Git repositories");
          messages.push("🔧 Solution: Contact your Azure DevOps administrator to grant repository access");
        } else if (permErrorMessage.includes("401") || permErrorMessage.includes("Unauthorized")) {
          messages.push("❌ Authentication Error: Invalid or expired access token");
          messages.push("🔧 Solution: Reload the extension or re-authenticate");
        } else {
          messages.push(`❌ API Access Failed: ${permErrorMessage}`);
        }
      }

      this.setState({
        permissionStatus: {
          ...this.state.permissionStatus,
          permissionMessages: messages,
        },
      });

      await this.showToast("🔍 Checking Azure DevOps permissions via REST API...", "info");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ DEBUG: Permission check error:", error);

      messages.push(`❌ Permission Check Failed: ${errorMessage}`);
      messages.push("🔧 Solution: This extension requires access to Git repositories");

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

  async loadRepositoriesViaRest() {
    try {
      const webContext = SDK.getWebContext();

      // 🔍 DEBUG: Log webContext in loadRepositories
      console.log("🔍 DEBUG loadRepositoriesViaRest - webContext:", webContext);
      console.log(
        "🔍 DEBUG loadRepositoriesViaRest - webContext.project:",
        webContext.project
      );

      const projectInfo = this.getProjectInfo();
        
      if (!projectInfo?.name) {
        console.error(
          "❌ DEBUG loadRepositoriesViaRest: No project context available for repository loading"
        );
        console.error(
          "❌ DEBUG loadRepositoriesViaRest: webContext.project is:",
          webContext.project
        );
        await this.showToast(
          "❌ No project context available. Please enter project name manually.",
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
          showProjectInput: true
        });
        return;
      }

      const projectName = projectInfo.name;
      const reposUrl = `${this.config.azureDevOpsBaseUrl}/${projectName}/_apis/git/repositories?api-version=7.1`;
      
      console.log("🔍 DEBUG loadRepositoriesViaRest - URL:", reposUrl);

      // Use direct REST API call instead of SDK client
      const response = await this.getJson<{ value: GitRepository[] }>(reposUrl);
      const repos = response?.value || [];

      // Update permission status for successful repository access
      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `✅ Repository Access: Successfully loaded ${repos.length} repositories via REST API`,
      ];

      this.setState({
        repos: repos,
        loading: false,
        permissionStatus: {
          ...this.state.permissionStatus,
          hasRepoAccess: true,
          permissionMessages: updatedMessages,
        },
      });

      await this.showToast(
        `✅ Repository permissions verified! Found ${repos.length} repositories.`,
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
          message.includes("401")
        ) {
          isPermissionError = true;
          message = `Access Denied: You don't have permission to read repositories via REST API. Check your Azure DevOps permissions.`;
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

  async loadPullRequestsViaRest() {
    try {
      const webContext = SDK.getWebContext();

      // 🔍 DEBUG: Log webContext in loadPullRequests
      console.log("🔍 DEBUG loadPullRequestsViaRest - webContext:", webContext);
      console.log(
        "🔍 DEBUG loadPullRequestsViaRest - webContext.project:",
        webContext.project
      );

      const projectInfo = this.getProjectInfo();
        
      if (!projectInfo?.name) {
        console.error(
          "❌ DEBUG loadPullRequestsViaRest: No project context available for pull request loading"
        );
        console.error(
          "❌ DEBUG loadPullRequestsViaRest: webContext.project is:",
          webContext.project
        );
        await this.showToast(
          "❌ No project context available. Please enter project name manually.",
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
          showProjectInput: true
        });
        return;
      }

      const projectName = projectInfo.name;
      console.log("🔍 DEBUG loadPullRequestsViaRest - projectName:", projectName);

      // Use direct REST API call to get all active pull requests across all repositories
      const prUrl = `${this.config.azureDevOpsBaseUrl}/${projectName}/_apis/git/pullrequests?searchCriteria.status=active&api-version=7.1`;
      console.log("🔍 DEBUG loadPullRequestsViaRest - URL:", prUrl);

      const response = await this.getJson<{ value: GitPullRequest[] }>(prUrl);
      const allPullRequests = response?.value || [];

      console.log("🔍 DEBUG loadPullRequestsViaRest - Retrieved PRs:", allPullRequests);
      console.log(
        "🔍 DEBUG loadPullRequestsViaRest - PRs count:",
        allPullRequests.length
      );

      // Group pull requests by title
      const groupedPullRequests = this.groupPullRequests(allPullRequests);

      // Update permission status for successful pull request access
      const updatedMessages = [
        ...this.state.permissionStatus.permissionMessages,
        `✅ Pull Request Access: Successfully loaded ${allPullRequests.length} pull requests via REST API`,
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
        errorMessage.includes("401")
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
          `❌ Permission Error: Cannot read pull requests via REST API. Contact your Azure DevOps administrator to grant access.`,
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
    const projectInfo = this.getProjectInfo();

    if (!projectInfo?.name) {
      console.error("Cannot open repository: No project context available");
      return;
    }

    const repoUrl = `${this.config.azureDevOpsBaseUrl}/${projectInfo.name}/_git/${repo.name}`;
    window.open(repoUrl, "_blank");
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
      
      // Create pull request using REST API
      const createPrUrl = `${this.config.azureDevOpsBaseUrl}/${projectName}/_apis/git/repositories/${repo.id}/pullrequests?api-version=7.1`;
      
      const prData = {
        sourceRefName: `refs/heads/${masterBranch}`,
        targetRefName: `${targetRefName}`,
        title: `Update ${targetRefName} from ${masterBranch}`,
        description: `Automated PR to update ${targetRefName} with latest changes from ${masterBranch}`,
        isDraft: false
      };

      const pullRequest = await this.postJson<GitPullRequest>(createPrUrl, prData);

      if (pullRequest) {
        const prUrl = `${this.config.azureDevOpsBaseUrl}/${projectName}/_git/${repo.name}/pullrequest/${pullRequest.pullRequestId}`;
        window.open(prUrl, "_blank");
        await this.showToast("Pull request created successfully!", "success");
      }
    } catch (error: unknown) {
      console.error(`Failed to create update PR for ${repo.name}:`, error);

      // Handle specific error cases
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("TF401179") || errorMessage.includes("already exists")) {
        await this.showToast(
          `A pull request from master to ${targetRefName} already exists for ${repo.name}. Please check existing pull requests.`,
          "warning"
        );
      } else if (errorMessage.includes("TF401028") || errorMessage.includes("source") || errorMessage.includes("master")) {
        await this.showToast(
          `The source branch 'master' does not exist in ${repo.name}. Please ensure the master branch exists.`,
          "warning"
        );
      } else if (errorMessage.includes("TF401027") || errorMessage.includes("target")) {
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

        {/* Manual Project Input Panel */}
        {this.state.showProjectInput && (
          <div
            style={{
              margin: "16px 24px",
              padding: "20px",
              backgroundColor: "#fff8dc",
              border: "2px solid #ffd700",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "12px",
                fontSize: "16px",
                fontWeight: "600",
                color: "#b8860b",
              }}
            >
              <Icon
                iconName="Info"
                style={{ marginRight: "8px", color: "#ffd700" }}
              />
              Manual Project Entry Required
            </div>
            
            <p style={{ margin: "0 0 16px 0", color: "#666" }}>
              The extension couldn't automatically detect your project context. This usually happens when:
            </p>
            <ul style={{ margin: "0 0 16px 0", paddingLeft: "20px", color: "#666" }}>
              <li>Extension is not properly installed in project scope</li>
              <li>Loading from gallery URL instead of project context</li>
              <li>Running on Azure DevOps Server with limited context sharing</li>
            </ul>
            <p style={{ margin: "0 0 16px 0", color: "#666" }}>
              <strong>Please enter your Azure DevOps project name manually:</strong>
            </p>
            
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Enter project name (e.g., MyProject)"
                value={this.state.manualProjectName}
                onChange={(e) => this.setState({ manualProjectName: e.target.value })}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    this.handleProjectSubmit();
                  }
                }}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "14px"
                }}
              />
              <Button
                text="Connect"
                primary={true}
                onClick={this.handleProjectSubmit}
                disabled={!this.state.manualProjectName.trim()}
              />
            </div>
          </div>
        )}

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
                                const projectInfo = this.getProjectInfo();

                                if (projectInfo?.name) {
                                  const prUrl = `${this.config.azureDevOpsBaseUrl}/${projectInfo.name}/_git/${pr.repository?.name}/pullrequest/${pr.pullRequestId}`;
                                  window.open(prUrl, "_blank");
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
