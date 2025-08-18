# RepoPulse Extension - Personal Development Notes

## 👤 Publisher Information

- **Publisher ID**: `mberrishdev`
- **Email**: *[Add your email here]*
- **Marketplace Publisher Dashboard**: https://marketplace.visualstudio.com/manage/publishers/mberrishdev

## 🔗 Important Links

### Marketplace Management
- **Publisher Dashboard**: https://marketplace.visualstudio.com/manage/publishers/mberrishdev
- **Extension Overview**: https://marketplace.visualstudio.com/manage/publishers/mberrishdev/extensions/repo-pulse/hub
- **Public Extension Page**: https://marketplace.visualstudio.com/items?itemName=mberrishdev.repo-pulse

### Azure DevOps Extension Resources
- **Extension Documentation**: https://docs.microsoft.com/en-us/azure/devops/extend/
- **Security Namespace Reference**: https://learn.microsoft.com/en-us/azure/devops/organizations/security/namespace-reference?view=azure-devops

## 📦 Publishing Instructions

### Prerequisites
1. **Install Azure DevOps Extension CLI**:
   ```bash
   npm install -g tfx-cli
   ```

2. **Create Personal Access Token (PAT)**:
   - Go to https://dev.azure.com/{organization}/_usersSettings/tokens
   - Create token with **Marketplace (Manage)** scope
   - Save the token securely

### Publishing

### Quick Publishing Commands
```bash
npm run publish
```
## 🚨 Troubleshooting

### Common Publishing Errors

#### "Uploaded extension package is missing an 'overview.md' file"
- **Solution**: Ensure `overview.md` exists and is listed in `vss-extension.json` files array
- **Check**: `"content": { "details": { "path": "overview.md" } }`

#### "Extension already exists with this version"
- **Solution**: Increment version number in `vss-extension.json`
- **Location**: Line 6 in `vss-extension.json`

#### "Invalid manifest"
- **Solution**: Validate JSON syntax in `vss-extension.json`
- **Tool**: Use `jq . vss-extension.json` or online JSON validator

#### "Permission denied"
- **Solution**: Check your PAT has **Marketplace (Manage)** scope
- **Regenerate**: https://dev.azure.com/{organization}/_usersSettings/tokens

### Security Namespace Issues
- **Git Repositories Namespace**: `2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87`
- **Required Permissions**: `GenericRead`, `PullRequestContribute`
- **Documentation**: https://learn.microsoft.com/en-us/azure/devops/organizations/security/namespace-reference?view=azure-devops

## 📝 Extension Information

### Current Extension Details
- **ID**: `repo-pulse`
- **Name**: `Repo Pulse`
- **Publisher**: `mberrishdev`
- **Category**: `Azure Repos`
- **Scopes**: `vso.code_full`
