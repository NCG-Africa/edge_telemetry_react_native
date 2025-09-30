# GitHub Actions Mirror Setup Guide

This guide will help you set up the GitHub Action to automatically mirror commits from KiplangatSang/react_telemetry to NCG-Africa/edge_telemetry_react_native with author rewriting.

## 📋 Prerequisites

- Admin access to the source repository: `https://github.com/KiplangatSang/react_telemetry.git`
- Admin access to the destination repository: `https://github.com/NCG-Africa/edge_telemetry_react_native.git`
- A GitHub account with Personal Access Token creation permissions

## 🔧 Step 1: Create Personal Access Token

1. **Log in to your KiplangatSang GitHub account**

2. **Navigate to Settings**:
   - Click your profile picture (top right)
   - Select "Settings"

3. **Access Developer Settings**:
   - Scroll down to "Developer settings" (bottom left)
   - Click "Personal access tokens"
   - Select "Tokens (classic)"

4. **Generate New Token**:
   - Click "Generate new token" → "Generate new token (classic)"
   - Give it a descriptive name: `Mirror Commits Token`
   - Set expiration as needed (recommend 1 year)

5. **Select Required Scopes**:
   ```
   ✅ repo (Full control of private repositories)
   ✅ workflow (Update GitHub Action workflows)
   ```

6. **Generate and Copy Token**:
   - Click "Generate token"
   - **IMPORTANT**: Copy the token immediately - you won't see it again!
   - Save it securely (you'll need it in Step 2)

## 🔐 Step 2: Configure GitHub Secrets

### In the SOURCE repository (KiplangatSang/react_telemetry):

1. **Navigate to Repository Settings**:
   - Go to `https://github.com/KiplangatSang/react_telemetry`
   - Click "Settings" tab
   - Click "Secrets and variables" → "Actions"

2. **Add Repository Secret**:
   
   **Secret: TOKEN**
   - Click "New repository secret"
   - Name: `TOKEN`
   - Value: Paste the Personal Access Token from Step 1
   - Click "Add secret"

## ⚙️ Step 3: Configure Your Git Identity

Edit the workflow file `.github/workflows/mirror-commits.yml` and update these lines:

```yaml
env:
  GIT_USER_NAME: "KiplangatSang"
  GIT_USER_EMAIL: "your-actual-email@example.com"  # ← Update this!
```

**Replace `your-actual-email@example.com` with your actual GitHub email address.**

## 📁 Step 4: Deploy the Workflow

The workflow is already in this repository (`KiplangatSang/react_telemetry`). Just commit and push any changes.

## 🧪 Step 5: Test the Setup

### Test 1: Manual Trigger Test
1. Go to the source repository on GitHub
2. Navigate to "Actions" tab
3. Find "Mirror Commits to Destination Repository" workflow
4. Click "Run workflow" to test manually

### Test 2: Push Test
1. Make a small test commit to the main branch of the source repository:
   ```bash
   echo "# Test commit for mirroring" >> TEST_MIRROR.md
   git add TEST_MIRROR.md
   git commit -m "Test: Mirror functionality"
   git push origin main
   ```

2. **Check the workflow execution**:
   - Go to "Actions" tab in source repository
   - Watch the workflow run
   - Check for any errors

3. **Verify the mirror**:
   - Go to `https://github.com/KiplangatSang/react_telemetry`
   - Check if the test commit appears
   - Verify the author is shown as "KiplangatSang"

## 🔍 Monitoring and Troubleshooting

### Workflow Logs
- Check workflow logs in the "Actions" tab of the source repository
- Look for detailed step-by-step execution information

### Common Issues and Solutions

1. **Authentication Failed**:
   - Verify the Personal Access Token is correct
   - Ensure the token has `repo` and `workflow` scopes
   - Check that the secret name is exactly `DEST_REPO_TOKEN`

2. **Permission Denied**:
   - Ensure you have admin access to both repositories
   - Verify the destination repository exists and is accessible

3. **Merge Conflicts**:
   - The workflow handles basic conflicts by skipping problematic commits
   - Check logs for specific conflict details

4. **Branch Not Found**:
   - Ensure the branch exists in the source repository
   - Check the branch name configuration in the workflow

### Workflow Triggers

The workflow is configured to trigger on:
- `main` branch pushes
- `develop` branch pushes
- `feature/**` branch pushes
- `release/**` branch pushes

To modify triggers, edit the `on.push.branches` section in the workflow file.

## 🔄 Workflow Features

### What the Workflow Does:
1. ✅ Triggers automatically on specified branch pushes
2. ✅ Fetches full commit history from source repository
3. ✅ Rewrites commit authors to your GitHub identity
4. ✅ Preserves original commit messages
5. ✅ Handles incremental updates (only mirrors new commits)
6. ✅ Supports multiple branches
7. ✅ Provides detailed logging and error handling
8. ✅ Cleans up temporary branches automatically

### What Gets Mirrored:
- All commit changes (files, modifications, deletions)
- Original commit messages
- Commit timestamps
- Branch structure

### What Gets Changed:
- Commit author name → "KiplangatSang"
- Commit author email → Your configured email
- Committer information → Your GitHub identity

## 📞 Support

If you encounter issues:
1. Check the workflow logs in the Actions tab
2. Verify all secrets are properly configured
3. Ensure Personal Access Token permissions are correct
4. Test with a simple commit first

The workflow includes comprehensive logging to help diagnose any issues that may arise.
