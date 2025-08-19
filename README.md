# Repo Pulse - Azure DevOps Extension

A modern Azure DevOps extension built with React and TypeScript that provides enhanced repository and pull request management capabilities. Designed to work seamlessly with both Azure DevOps Services (cloud) and Azure DevOps Server (on-premises).

## Features

### Repository Management
- **Repository Overview**: View all repositories in your Azure DevOps project with detailed information
- **Quick Navigation**: Click any repository to open it directly in a new browser tab
- **Repository Details**: See default branch, repository size, and visual status indicators
- **Smart Project Detection**: Automatically detects project context from various Azure DevOps environments

### Pull Request Management
- **Grouped Display**: Pull requests are automatically grouped by title for better organization
- **Visual Status Indicators**: 
  - Draft/Active status badges with color coding
  - Build status indicators (Success/Failed/Running) when available
  - Status circles for quick visual reference
- **"Update from Master"**: Create pull requests to update target branches from master with one click
- **Direct Navigation**: Click any pull request to open it in Azure DevOps

### User Experience
- **Modern Typography**: Uses Microsoft Fluent Design System fonts (Segoe UI) for consistency
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
  "vso.code_full",     // Git repository read/write access
  "vso.project",       // Project information access
  "vso.identity",      // User identity access
  "vso.graph"          // Organization graph access
]
```

### API Version Compatibility
- **Azure DevOps Services**: Supports latest APIs
- **Azure DevOps Server 2019**: Uses API version 3.0 for compatibility
- **Azure DevOps Server 2020+**: Uses API version 7.1
- The extension automatically detects and adapts to your environment

## Usage

### Viewing Repositories
1. Navigate to your Azure DevOps project
2. Go to **Repos** → **Repo Pulse**
3. View all repositories with their details
4. Click any repository to open it in a new tab

### Managing Pull Requests
1. Switch to the **Pull Requests** tab
2. View pull requests grouped by title
3. See status indicators for drafts and build results
4. Click "Update from Master" to create update pull requests
5. Click any pull request to open it in a new tab

### Creating Update Pull Requests
- Click "Update from master" on any pull request group
- Automatically creates a PR from `master` to the target branch
- Opens the new pull request in a new tab
- Shows success/error notifications

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
- Repository listing and management with visual indicators
- Pull request grouping and display by title
- "Update from master" functionality for automated PR creation
- Smart project detection with URL parsing fallback
- Azure DevOps SDK integration with error handling
- Modern typography using Fluent Design System

#### API Integration
- Uses `azure-devops-extension-api` v1.158.0 for compatibility
- Implements `GitRestClient` for repository and pull request operations
- Handles authentication through Azure DevOps Extension SDK
- Supports both project ID and project name for API calls
- Automatic base URL detection for cloud and on-premises instances

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

## API Usage

### Repository Operations
```typescript
// Initialize Git client
const gitClient = getClient(GitRestClient);

// Get repositories by project (supports both ID and name)
const repos = await gitClient.getRepositories(projectInfo.id || projectInfo.name);
```

### Pull Request Operations
```typescript
// Get active pull requests by project
const searchCriteria = { status: PullRequestStatus.Active };
const pullRequests = await gitClient.getPullRequestsByProject(
  projectInfo.id || projectInfo.name,
  searchCriteria
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
