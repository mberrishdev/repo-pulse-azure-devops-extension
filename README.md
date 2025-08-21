# Repo Pulse - Azure DevOps Extension

A comprehensive Azure DevOps extension built with React and TypeScript that provides enhanced repository management, pull request workflow automation, and CI/CD pipeline control. Designed to work seamlessly with both Azure DevOps Services (cloud) and Azure DevOps Server (on-premises).

## ✨ Features

### 🏗️ Repository Management
- **Repository Overview**: View all repositories with real-time build status and detailed information
- **Favorite Repositories**: ⭐ Star repositories to keep them at the top of the list
- **Pipeline Triggering**: 🚀 Trigger CI/CD pipelines individually or in bulk
- **Build Status Monitoring**: Live build status with clickable links to build details
- **Smart Selection**: Checkbox-based selection for batch operations
- **Quick Navigation**: Click repository names to open them directly in Azure DevOps

### 📋 Pull Request Management
- **Enhanced PR Display**: Pull requests grouped by title with comprehensive status information
- **Build Status Integration**: Real-time build status for each PR's source branch
- **Approval Status Tracking**: Visual indicators for review status and approval progress
- **Draft PR Support**: Manage and publish draft pull requests with one-click publishing
- **Ready-to-Merge Detection**: Automatic detection of PRs ready for merge
- **Batch Draft Publishing**: Publish all draft PRs in a group simultaneously
- **Auto-Complete Indicators**: Visual badges for PRs with auto-complete enabled

### 🚀 Pipeline & Build Features
- **Individual Pipeline Triggers**: Start builds for specific repositories
- **Batch Pipeline Execution**: Select multiple repositories and trigger all their pipelines
- **Real-time Status Updates**: Build status updates immediately when triggered
- **Build History Access**: Click build status to view detailed build information
- **Pipeline Detection**: Automatically finds and maps CI/CD pipelines to repositories

### 🎯 User Experience
- **Tabbed Interface**: Clean separation between Repositories and Pull Requests views
- **Native Azure DevOps UI**: Built with Azure DevOps UI components for seamless integration
- **Toast Notifications**: Success and error messages using Azure DevOps native notification system
- **Cross-Platform Compatibility**: Works on Azure DevOps Services and Server 2019+
- **Responsive Design**: Optimized for different screen sizes and devices

## Installation

### Prerequisites
- Azure DevOps organization with appropriate permissions
- Node.js 16+ and npm/yarn for development

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repository-url>
   cd repo-pulse-azure-devops-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run compile
   ```

4. **Package the extension**
   ```bash
   npm run package
   ```
   This will create a `.vsix` file in the `out/` directory.

5. **Upload to Azure DevOps**
   - Go to your Azure DevOps organization
   - Navigate to Organization Settings → Extensions
   - Upload the generated `.vsix` file from the `out/` directory

## Configuration

### Extension Manifest
The extension is configured through `vss-extension.json`:

- **Hub Location**: Appears in the "Repos" section of Azure DevOps
- **API Compatibility**: Uses API version 3.0 for maximum compatibility with Azure DevOps Server
- **Target Platforms**: Works with Azure DevOps Services and Server 2019+

### Required Scopes
The extension requires the following scopes in your `vss-extension.json`:

```json
"scopes": [
  "vso.code",          // Git repository read access
  "vso.code_write",    // Git repository write access (for publishing draft PRs)
  "vso.build",         // Build definitions and history read access
  "vso.build_execute", // Build pipeline triggering permissions
  "vso.project"        // Project information access
]
```

### API Version Compatibility
- **Azure DevOps Services**: Supports latest APIs
- **Azure DevOps Server 2019**: Uses API version 3.0 for compatibility
- **Azure DevOps Server 2020+**: Uses API version 7.1
- The extension automatically detects and adapts to your environment

## 📖 Usage

### 🏗️ Repository Management
1. **Navigate to Extension**: Go to **Repos** → **Repo Pulse** in your Azure DevOps project
2. **View Repositories**: See all repositories with build status and pipeline information
3. **Manage Favorites**: Click the ⭐ star icon to add/remove repositories from favorites
4. **Trigger Pipelines**: 
   - **Individual**: Click "Trigger" button on any repository
   - **Batch**: Select multiple repositories and click "Trigger Selected"
5. **Monitor Builds**: Click build status badges to view detailed build information

### 📋 Pull Request Workflow
1. **Switch to PR Tab**: Click "Pull Requests" tab (bookmarkable with `?tab=pullrequests`)
2. **View Grouped PRs**: See pull requests organized by title with status indicators
3. **Monitor Status**: View build status, approval status, and merge readiness
4. **Manage Drafts**: 
   - **Individual**: Click "Publish Draft" on draft PRs
   - **Group**: Click "Publish X Drafts" to publish all drafts in a group
5. **Create Update PRs**: Click "Update from Master" to sync branches

### 🚀 Pipeline Operations
- **Quick Trigger**: Start CI/CD pipelines with one click
- **Batch Operations**: Select multiple repositories and trigger all pipelines
- **Real-time Updates**: Build status updates immediately when triggered
- **Build Monitoring**: Click build badges to view detailed build logs

### ⭐ Favorites Management
- **Add Favorites**: Click the star icon next to any repository name
- **Automatic Sorting**: Favorite repositories appear at the top of the list
- **Persistent Storage**: Favorites are saved per project and persist between sessions
- **Visual Indicators**: Gold stars show which repositories are favorited

### 📝 Draft PR Publishing
- **Individual Publishing**: Convert draft PRs to active status with "Publish Draft" button
- **Group Publishing**: Publish all drafts in a specific group with one click
- **No Confirmation**: Instant publishing without confirmation dialogs
- **Status Tracking**: See approval status, build status, and merge readiness

## Development

### Tech Stack
- **Frontend**: React 16.14 with TypeScript 5.4
- **UI Framework**: Azure DevOps UI Library 2.238
- **Extension SDK**: Azure DevOps Extension SDK 4.0.2
- **Extension API**: Azure DevOps Extension API 1.158.0 (for Server compatibility)
- **Build Tool**: Webpack 5 with TypeScript loader
- **Package Manager**: npm
- **Fonts**: Microsoft Fluent Design System (Segoe UI)

### Project Structure
```
repo-pulse-azure-devops-extension/
├── src/
│   ├── home/
│   │   ├── Home.tsx          # Main React component
│   │   └── Home.html         # Extension entry point
│   ├── Common.tsx            # Shared utilities
│   └── Common.scss           # Global styles and typography
├── static/
│   └── images/               # Screenshots and assets
├── out/                      # Build output (.vsix files)
├── dist/                     # Compiled TypeScript/React
├── vss-extension.json        # Extension manifest
├── webpack.config.js         # Build configuration
└── package.json             # Dependencies and scripts
```

### Key Components

#### Home.tsx
Main React component that provides:
- **Repository Management**: Listing, favorites, build status monitoring
- **Pipeline Control**: Individual and batch CI/CD pipeline triggering
- **Pull Request Workflow**: Grouping, status tracking, draft publishing
- **Build Integration**: Real-time build status and history access
- **Approval Tracking**: Reviewer analysis and merge readiness detection
- **URL State Management**: Bookmarkable tabs and browser navigation support
- **Smart Project Detection**: URL parsing fallback with multiple pattern support
- **Azure DevOps SDK Integration**: Comprehensive error handling and permissions

#### API Integration
- **Git Operations**: `GitRestClient` for repositories, pull requests, and branch management
- **Build Operations**: `BuildRestClient` for pipeline triggering and build monitoring
- **Multi-Client Architecture**: Separate clients for different Azure DevOps services
- **Authentication**: Azure DevOps Extension SDK with automatic token management
- **Project Context**: Supports both project ID and project name for API calls
- **Base URL Detection**: Automatic detection for cloud and on-premises instances
- **Permissions**: Comprehensive scope management for read/write operations

### Development Commands

```bash
# Install dependencies
npm install

# Clean build artifacts
npm run clean

# Build for development
npm run compile

# Package extension (builds and creates .vsix)
npm run package

# Publish to marketplace (requires token)
npm run publish
```

## 🔧 API Usage

### Repository Operations
```typescript
// Initialize Git and Build clients
const gitClient = getClient(GitRestClient);
const buildClient = getClient(BuildRestClient);

// Get repositories by project (supports both ID and name)
const repos = await gitClient.getRepositories(projectInfo.id || projectInfo.name);

// Load build statuses for repositories
const builds = await buildClient.getBuilds(projectName, [definitionId], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1);
```

### Pull Request Operations
```typescript
// Get active and draft pull requests by project
const searchCriteria = { status: PullRequestStatus.Active };
const pullRequests = await gitClient.getPullRequestsByProject(
  projectInfo.id || projectInfo.name,
  searchCriteria
);

// Get detailed PR information with reviewers
const detailedPR = await gitClient.getPullRequestById(
  pullRequestId,
  repositoryId
);
```

### Pipeline Triggering
```typescript
// Trigger a build pipeline
const buildToQueue = {
  definition: { id: definitionId },
  sourceBranch: "refs/heads/master"
};

const build = await buildClient.queueBuild(
  buildToQueue as any,
  projectInfo.id || projectInfo.name
);
```

### Publishing Draft PRs
```typescript
// Convert draft PR to active status
const updatedPR: Partial<GitPullRequest> = {
  isDraft: false
};

await gitClient.updatePullRequest(
  updatedPR as GitPullRequest,
  repositoryId,
  pullRequestId
);
```

### Creating Pull Requests
```typescript
// Create a pull request to update branch from master
const prData: Partial<GitPullRequest> = {
  sourceRefName: "refs/heads/master",
  targetRefName: "refs/heads/develop",
  title: "Update develop from master",
  description: "Automated PR to update develop with latest changes",
  isDraft: false
};

const pullRequest = await gitClient.createPullRequest(
  prData as GitPullRequest,
  repositoryId
);
```

### Favorites Management
```typescript
// Save favorites to localStorage (project-specific)
const storageKey = `repo-pulse-favorites-${projectName}`;
localStorage.setItem(storageKey, JSON.stringify(Array.from(favoriteRepoIds)));

// Load favorites on startup
const storedFavorites = localStorage.getItem(storageKey);
if (storedFavorites) {
  const favoriteIds = JSON.parse(storedFavorites) as string[];
  this.setState({ favoriteRepoIds: new Set(favoriteIds) });
}
```

### Project Context Detection
```typescript
// Multi-layered project detection
private getProjectInfo(): { id?: string; name?: string } | null {
  const webContext = SDK.getWebContext();
  
  // Try webContext first
  if (webContext.project?.id) {
    return webContext.project;
  }
  
  // Fallback to URL parsing
  const urlProject = this.getProjectFromUrl();
  if (urlProject?.name) {
    return urlProject;
  }
  
  return null;
}
```

## Troubleshooting

### Common Issues

1. **Extension not loading**
   - Check browser console for errors
   - Verify extension permissions in Azure DevOps
   - Ensure proper build output in `dist/` folder
   - Confirm extension is installed in the correct scope (organization vs project)

2. **API version compatibility errors**
   - "API version 7.2 out of range" → Extension uses compatible API version 1.158.0
   - Update Azure DevOps Server to support newer APIs if needed
   - Extension automatically adapts to available API versions

3. **Project context detection issues**
   - Extension automatically detects project from URL patterns
   - Works with various Azure DevOps URL formats
   - Supports both cloud (dev.azure.com) and on-premises installations

4. **Build failures**
   - Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
   - Check Node.js version (requires 16+)
   - Verify TypeScript compilation: `npm run compile`

5. **Permission errors**
   - Verify user has appropriate Git repository permissions
   - Check that required scopes are granted in extension manifest
   - Ensure user is member of the Azure DevOps project
   - For pipeline triggering: Verify `vso.build_execute` scope is granted
   - For draft publishing: Verify `vso.code_write` scope is granted

6. **Pipeline triggering issues**
   - Check if build definitions exist for the repository
   - Verify user has "Queue builds" permission in Azure DevOps
   - Ensure the source branch (default: master) exists in the repository
   - Check browser console for detailed error messages

7. **Draft publishing failures**
   - Verify user has "Contribute to pull requests" permission
   - Check if the PR is actually in draft status
   - Ensure the PR is not already completed or abandoned

8. **Approval status showing as "Unknown"**
   - Check browser console for detailed reviewer analysis logs
   - Verify that reviewers are properly assigned to the pull request
   - Some PRs may not have reviewers assigned (shows as "Pending")

9. **Favorites not persisting**
   - Check if localStorage is enabled in the browser
   - Favorites are stored per project - switching projects will show different favorites
   - Clear browser cache if favorites appear corrupted

### Azure DevOps Server Compatibility
- **Server 2019**: Supported with API version 3.0
- **Server 2020+**: Uses API version 7.1 for better performance
- **Collection Names**: Extension handles custom collection names automatically
- **Authentication**: Uses Azure DevOps Extension SDK for seamless auth

### CORS and Security
- Extension uses Azure DevOps Extension API to avoid CORS issues
- Direct `fetch` calls to Azure DevOps APIs will be blocked by browser security
- All API calls are authenticated through the Extension SDK

## License

This project is provided as-is for educational and development purposes.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly in Azure DevOps
5. Submit a pull request

## 📚 Resources

- [Azure DevOps Extension Documentation](https://docs.microsoft.com/en-us/azure/devops/extend/)
- [Azure DevOps UI Library](https://developer.microsoft.com/en-us/azure-devops/)
- [Extension API Reference](https://docs.microsoft.com/en-us/javascript/api/azure-devops-extension-api/)

---

## Compatibility Matrix

| Platform | Status | API Version | Notes |
|----------|--------|-------------|-------|
| Azure DevOps Services | ✅ Full Support | Latest | All features available |
| Azure DevOps Server 2022 | ✅ Full Support | 7.1 | Recommended version |
| Azure DevOps Server 2020 | ✅ Full Support | 7.1 | All features work |
| Azure DevOps Server 2019 | ✅ Basic Support | 3.0 | Core functionality only |

**Note**: This extension is optimized for Azure DevOps Server environments and has been tested extensively with both cloud and on-premises installations. The extension automatically adapts its API usage based on the detected platform version.
