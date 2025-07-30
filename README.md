# Repo Pulse - Azure DevOps Extension

A modern Azure DevOps extension built with React and TypeScript that provides enhanced repository and pull request management capabilities.

## 🚀 Features

### Repository Management
- **Repository Overview**: View all repositories in your Azure DevOps project
- **Quick Navigation**: Click any repository to open it in a new tab
- **Repository Details**: See default branch, repository size, and status indicators

### Pull Request Management
- **Grouped Pull Requests**: Pull requests are automatically grouped by title for better organization
- **Visual Status Indicators**: 
  - Draft/Active status badges
  - Build status indicators (Success/Failed/Running)
  - Color-coded status circles
- **"Update from Master"**: Create pull requests to update target branches from master with one click

### User Experience
- **Tabbed Interface**: Clean separation between Repositories and Pull Requests
- **Native Azure DevOps UI**: Uses Azure DevOps UI components for consistent look and feel
- **Toast Notifications**: Success and error messages using Azure DevOps native notifications
- **Responsive Design**: Works seamlessly across different screen sizes

## 📦 Installation

### Prerequisites
- Azure DevOps organization with appropriate permissions
- Node.js 16+ and npm/yarn for development

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mberrishdev/repo-pulse-azure-devops-extension.git
   cd repo-pulse-azure-devops-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Package the extension**
   ```bash
   tfx extension create --manifest-globs vss-extension.json
   ```

5. **Upload to Azure DevOps**
   - Go to your Azure DevOps organization
   - Navigate to Organization Settings → Extensions
   - Upload the generated `.vsix` file

## 🔧 Configuration

### Extension Manifest
The extension is configured through `vss-extension.json`:

- **Hub Location**: Appears in the "Repos" section of Azure DevOps
- **Permissions**: Requires Git repository read/write permissions
- **Target**: Works with Azure DevOps Services and Server

### Required Permissions
The extension requires the following permissions in your `vss-extension.json`:

```json
"permissions": [
  {
    "namespaceId": "52d39943-cb85-4d7f-8fa8-c6baac873819",
    "permissions": [
      "Read",
      "Write", 
      "ManagePermissions",
      "CreateRepository"
    ]
  }
]
```

## 🎯 Usage

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

## 🛠️ Development

### Tech Stack
- **Frontend**: React with TypeScript
- **UI Framework**: Azure DevOps UI Library
- **Build Tool**: Webpack
- **Package Manager**: npm
- **Extension Framework**: Azure DevOps Extension SDK

### Project Structure
```
azure-devops-extension-sample/
├── src/
│   ├── home/
│   │   ├── Home.tsx          # Main extension component
│   │   └── Home.html         # Extension entry point
│   └── Common.tsx            # Shared utilities
├── static/                   # Static assets
├── vss-extension.json        # Extension manifest
└── package.json             # Dependencies and scripts
```

### Key Components

#### Home.tsx
Main React component that provides:
- Repository listing and management
- Pull request grouping and display
- "Update from master" functionality
- Azure DevOps API integration

#### API Integration
- Uses `azure-devops-extension-api` for REST client access
- Implements `GitRestClient` for repository and pull request operations
- Handles authentication through Azure DevOps Extension SDK

### Development Commands

```bash
# Install dependencies
npm install

# Build for development
npm run build

# Build for production
npm run build:prod

# Package extension
tfx extension create --manifest-globs vss-extension.json
```

## 🔍 API Usage

### Repository Operations
```typescript
const gitClient = getClient(GitRestClient);
const repos = await gitClient.getRepositories(projectId);
```

### Pull Request Operations
```typescript
const pullRequests = await gitClient.getPullRequests(repositoryId, {
  status: PullRequestStatus.Active,
  includeLinks: false
});
```

### Creating Pull Requests
```typescript
const pullRequest = await gitClient.createPullRequest({
  sourceRefName: "refs/heads/master",
  targetRefName: "refs/heads/develop",
  title: "Update develop from master",
  description: "Automated PR to update develop with latest changes"
}, repositoryId);
```

## 🚨 Troubleshooting

### Common Issues

1. **Extension not loading**
   - Check browser console for errors
   - Verify extension permissions in Azure DevOps
   - Ensure proper build output in `dist/` folder

2. **API calls failing**
   - Verify Git repository permissions
   - Check Azure DevOps project access
   - Ensure proper authentication

3. **Build failures**
   - Clear `node_modules` and reinstall
   - Check Node.js version compatibility
   - Verify webpack configuration

### CORS Issues
The extension uses Azure DevOps Extension API to avoid CORS issues. Direct `fetch` calls to Azure DevOps APIs will be blocked.

## 📝 License

This project is provided as-is for educational and development purposes.

## 🤝 Contributing

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

**Note**: This extension was built and tested with Azure DevOps Services. Compatibility with Azure DevOps Server may vary depending on the version.
