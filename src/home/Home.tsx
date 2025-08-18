import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as SDK from "azure-devops-extension-sdk";
import { showRootComponent } from "../Common";
import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitRepository,
  GitPullRequest,
  PullRequestStatus,
  PullRequestTimeRangeType,
  PullRequestMergeFailureType,
  PullRequestAsyncStatus,
} from "azure-devops-extension-api/Git";
import { CommonServiceIds, IGlobalMessagesService, IToast, IExtensionDataManager } from "azure-devops-extension-api";

interface HomePageState {
  repos: GitRepository[];
  pullRequests: GitPullRequest[];
  loading: boolean;
  error?: string;
  selectedTabId: string;
  groupedPullRequests: Record<string, GitPullRequest[]>;
}

interface HomePageConfig {
  azureDevOpsBaseUrl: string;
}

export class HomePage extends React.Component<object, HomePageState> {
  private config: HomePageConfig = {
    //azureDevOpsBaseUrl: "https://dev.azure.com"
    azureDevOpsBaseUrl: "https://dev.azure.com"
  };

  constructor(props: object) {
    super(props);
    this.state = {
      repos: [],
      pullRequests: [],
      loading: true,
      selectedTabId: "repositories",
      groupedPullRequests: {},
    };
  }

  public componentDidMount() {
    SDK.init();
    SDK.ready().then(() => {
      this.loadRepositories();
      this.loadPullRequests();
    });
  }

  async loadRepositories() {
    try {
      const webContext = SDK.getWebContext();
      const projectId = webContext.project.id;
      const gitClient = getClient(GitRestClient);

      // Use the REST client to get repositories (no fetch, no CORS issue)
      const repos = await gitClient.getRepositories(projectId);

      this.setState({
        repos: repos || [],
        loading: false,
      });
    } catch (error: unknown) {
      let message = "Failed to load repositories";
      if (error instanceof Error) {
        message = error.message;
      }
      this.setState({
        error: message,
        loading: false,
      });
    }
  }

  async loadPullRequests() {
    try {
      const webContext = SDK.getWebContext();
      const projectId = webContext.project.id;
      const gitClient = getClient(GitRestClient);

      // Get all repositories first
      const repos = await gitClient.getRepositories(projectId);
      
      // Get pull requests for all repositories
      const allPullRequests: GitPullRequest[] = [];
      for (const repo of repos || []) {
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
            `Failed to load pull requests for repo ${repo.name}:`,
            error
          );
          // Continue with other repositories even if one fails
        }
      }

      // Group pull requests by repository
      const groupedPullRequests = this.groupPullRequests(allPullRequests);

      this.setState({
        pullRequests: allPullRequests,
        groupedPullRequests,
      });
    } catch (error: unknown) {
      console.error("Failed to load pull requests:", error);
      this.setState({
        pullRequests: [],
        groupedPullRequests: {},
      });
    }
  }

  private groupPullRequests = (pullRequests: GitPullRequest[]): Record<string, GitPullRequest[]> => {
    const groups: Record<string, GitPullRequest[]> = {};
    
    pullRequests.forEach(pr => {
      const title = pr.title || 'Untitled';
      
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
      case 1: return "Active";
      case 2: return "Abandoned";
      case 3: return "Completed";
      default: return "Unknown";
    }
  };

  private getStatusColor = (status: number): string => {
    switch (status) {
      case 1: return "#107c10"; // Green for active
      case 2: return "#ff8c00"; // Orange for abandoned
      case 3: return "#d13438"; // Red for completed
      default: return "#666666"; // Gray for unknown
    }
  };

  private openRepository = (repo: GitRepository) => {
    const webContext = SDK.getWebContext();
    const repoUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${repo.name}`;
    window.open(repoUrl, '_blank');
  };

  private createUpdatePRFromMaster = async (repo: GitRepository, targetRefName?: string) => {
    try {
      const webContext = SDK.getWebContext();
      const gitClient = getClient(GitRestClient);
      
      const masterBranch = "master";

      const pullRequest = await gitClient.createPullRequest({
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
        workItemRefs: []
      }, repo.id);

      if (pullRequest) {
        const prUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${repo.name}/pullrequest/${pullRequest.pullRequestId}`;
        window.open(prUrl, '_blank');
        await this.showToast("Pull request created successfully!", "success");
      }
    } catch (error: unknown) {
      console.error(`Failed to create update PR for ${repo.name}:`, error);
      
      // Handle specific error cases
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('TF401179')) {
        await this.showToast(`A pull request from master to ${targetRefName} already exists for ${repo.name}. Please check existing pull requests.`, "warning");
      } else if (errorMessage.includes('TF401028')) {
        await this.showToast(`The source branch 'master' does not exist in ${repo.name}. Please ensure the master branch exists.`, "warning");
      } else if (errorMessage.includes('TF401027')) {
        await this.showToast(`The target branch '${targetRefName}' does not exist in ${repo.name}. Please check the branch name.`, "warning");
      } else {
        await this.showToast(`Failed to create pull request for ${repo.name}: ${errorMessage}`, "error");
      }
    }
  };

  private showToast = async (message: string, type: "success" | "warning" | "error") => {
    try {
      const messagesService = await SDK.getService<IGlobalMessagesService>(CommonServiceIds.GlobalMessagesService);
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
    const { repos, pullRequests, loading, error, selectedTabId, groupedPullRequests } = this.state;

    return (
      <div style={{ width: "100%", backgroundColor: "#f8f9fa", minHeight: "100vh" }}>
        <div style={{ 
          backgroundColor: "white", 
          borderBottom: "1px solid #e1e1e1",
          padding: "16px 24px"
        }}>
          <h1 style={{ 
            margin: 0, 
            fontSize: "24px", 
            fontWeight: "600",
            color: "#323130"
          }}>
            Repo Pulse
          </h1>
        </div>

        <div style={{ padding: "24px" }}>
          {/* Tab Navigation */}
          <div style={{ 
            borderBottom: "1px solid #e1e1e1", 
            marginBottom: "24px",
            display: "flex",
            gap: "0"
          }}>
            <button
              style={{
                padding: "12px 24px",
                border: "none",
                background: selectedTabId === "repositories" ? "white" : "transparent",
                color: selectedTabId === "repositories" ? "#0078d4" : "#666",
                cursor: "pointer",
                borderBottom: selectedTabId === "repositories" ? "2px solid #0078d4" : "2px solid transparent",
                fontWeight: selectedTabId === "repositories" ? "600" : "400",
                fontSize: "14px"
              }}
              onClick={() => this.onTabChanged("repositories")}
            >
              Repositories ({repos.length})
            </button>
            <button
              style={{
                padding: "12px 24px",
                border: "none",
                background: selectedTabId === "pullrequests" ? "white" : "transparent",
                color: selectedTabId === "pullrequests" ? "#0078d4" : "#666",
                cursor: "pointer",
                borderBottom: selectedTabId === "pullrequests" ? "2px solid #0078d4" : "2px solid transparent",
                fontWeight: selectedTabId === "pullrequests" ? "600" : "400",
                fontSize: "14px"
              }}
              onClick={() => this.onTabChanged("pullrequests")}
            >
              Pull Requests ({pullRequests.length})
            </button>
          </div>
          
          {selectedTabId === "repositories" && (
            <div>
              {loading && (
                <div style={{ 
                  textAlign: "center", 
                  padding: "40px", 
                  color: "#666",
                  fontSize: "14px"
                }}>
                  Loading repositories...
                </div>
              )}
              
              {error && (
                <div style={{ 
                  backgroundColor: "#fde7e9", 
                  border: "1px solid #f1707b", 
                  borderRadius: "4px",
                  padding: "12px 16px",
                  color: "#d13438",
                  fontSize: "14px"
                }}>
                  {error}
                </div>
              )}
              
              {!loading && !error && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {repos.map((repo) => (
                    <div key={repo.id} style={{ 
                      backgroundColor: "white",
                      border: "1px solid #e1e1e1",
                      borderRadius: "6px",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      transition: "box-shadow 0.2s ease, border-color 0.2s ease",
                      cursor: "pointer"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                      e.currentTarget.style.borderColor = "#0078d4";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.borderColor = "#e1e1e1";
                    }}
                    onClick={() => this.openRepository(repo)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
                        <div style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          backgroundColor: "#0078d4",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontWeight: "600",
                          fontSize: "14px"
                        }}>
                          {repo.name.charAt(0).toUpperCase()}
                        </div>
                        
                        <div style={{ flex: 1 }}>
                          <div style={{ 
                            fontSize: "16px", 
                            fontWeight: "600",
                            color: "#323130",
                            marginBottom: "4px"
                          }}>
                            {repo.name}
                          </div>
                          <div style={{ 
                            fontSize: "12px", 
                            color: "#666",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px"
                          }}>
                            <span>Default Branch: {repo.defaultBranch?.replace("refs/heads/", "") || "None"}</span>
                            <span>•</span>
                            <span>Size: {repo.size ? `${Math.round(repo.size / 1024)} KB` : "Unknown"}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: "#107c10"
                        }} />
                        <Icon iconName="ChevronRight" style={{ color: "#666", fontSize: "12px" }} />
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
                <div style={{ 
                  textAlign: "center", 
                  padding: "40px", 
                  color: "#666",
                  fontSize: "14px"
                }}>
                  Loading pull requests...
                </div>
              )}
              
              {!loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {Object.entries(groupedPullRequests).map(([prTitle, prs]) => (
                    <div key={prTitle}>
                      <div style={{ 
                        marginBottom: "16px",
                        padding: "12px 16px",
                        backgroundColor: "white",
                        border: "1px solid #e1e1e1",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <Icon iconName="BranchPullRequest" style={{ color: "#0078d4", fontSize: "16px" }} />
                          <h3 style={{ 
                            margin: 0, 
                            fontSize: "16px", 
                            fontWeight: "600",
                            color: "#323130"
                          }}>
                            {prTitle} ({prs.length} pull requests)
                          </h3>
                        </div>
                      </div>
                      
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {prs.map((pr) => (
                          <div key={pr.pullRequestId} style={{ 
                            backgroundColor: "white",
                            border: "1px solid #e1e1e1",
                            borderRadius: "6px",
                            padding: "16px 20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            transition: "box-shadow 0.2s ease, border-color 0.2s ease",
                            cursor: "pointer"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                            e.currentTarget.style.borderColor = "#0078d4";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = "none";
                            e.currentTarget.style.borderColor = "#e1e1e1";
                          }}
                          onClick={() => {
                            const webContext = SDK.getWebContext();
                            const prUrl = `${this.config.azureDevOpsBaseUrl}/${webContext.project.name}/_git/${pr.repository?.name}/pullrequest/${pr.pullRequestId}`;
                            window.open(prUrl, '_blank');
                          }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
                              <div style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "50%",
                                backgroundColor: this.getStatusColor(pr.status || 0),
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white",
                                fontWeight: "600",
                                fontSize: "14px"
                              }}>
                                PR
                              </div>
                              
                              <div style={{ flex: 1 }}>
                                <div style={{ 
                                  fontSize: "16px", 
                                  fontWeight: "600",
                                  color: "#323130",
                                  marginBottom: "4px"
                                }}>
                                  {pr.repository?.name} - {pr.sourceRefName?.replace("refs/heads/", "")} → {pr.targetRefName?.replace("refs/heads/", "")}
                                </div>
                                <div style={{ 
                                  fontSize: "12px", 
                                  color: "#666",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "12px",
                                  flexWrap: "wrap"
                                }}>
                                  <span>Status: {this.getStatusText(pr.status || 0)}</span>
                                  <span>•</span>
                                  <span>ID: #{pr.pullRequestId}</span>
                                  <span>•</span>
                                  <span style={{
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: "600",
                                    backgroundColor: pr.isDraft ? "#ffd700" : "#107c10",
                                    color: pr.isDraft ? "#000" : "#fff"
                                  }}>
                                    {pr.isDraft ? "DRAFT" : "ACTIVE"}
                                  </span>
                                  {((pr as GitPullRequest & { buildStatus?: { id: number; status: string; result: string; url: string } }).buildStatus) && (
                                    <>
                                      <span>•</span>
                                      <span style={{
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        backgroundColor: ((pr as GitPullRequest & { buildStatus?: { id: number; status: string; result: string; url: string } }).buildStatus?.result === "succeeded") ? "#107c10" :
                                                       ((pr as GitPullRequest & { buildStatus?: { id: number; status: string; result: string; url: string } }).buildStatus?.result === "failed") ? "#d13438" : "#ff8c00",
                                        color: "#fff"
                                      }}>
                                        BUILD {((pr as GitPullRequest & { buildStatus?: { id: number; status: string; result: string; url: string } }).buildStatus?.result?.toUpperCase() || "UNKNOWN")}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Button
                                text="Update from master"
                                iconProps={{ iconName: "BranchPullRequest" }}
                                onClick={(event) => {
                                  event.stopPropagation(); // Prevent navigation to PR
                                  const repoName = pr.repository?.name;
                                  if (repoName) {
                                    const repo = repos.find(r => r.name === repoName);
                                    if (repo) {
                                      this.createUpdatePRFromMaster(repo, pr.sourceRefName);
                                    }
                                  }
                                }}
                                primary={false}
                              />
                              <Icon iconName="ChevronRight" style={{ color: "#666", fontSize: "12px" }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {pullRequests.length === 0 && !loading && (
                <div style={{ 
                  textAlign: "center", 
                  padding: "60px 20px", 
                  color: "#666",
                  backgroundColor: "white",
                  border: "1px solid #e1e1e1",
                  borderRadius: "6px"
                }}>
                  <Icon iconName="BranchPullRequest" style={{ 
                    fontSize: "48px", 
                    marginBottom: "16px",
                    color: "#ccc"
                  }} />
                  <div style={{ fontSize: "16px", fontWeight: "500", marginBottom: "8px" }}>
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
