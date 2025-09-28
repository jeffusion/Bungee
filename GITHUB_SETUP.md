# GitHub Repository Setup for Automated Releases

## Required Repository Settings

To enable automated releases with semantic-release, ensure the following settings are configured in your GitHub repository:

### 1. Actions Permissions
1. Go to **Settings** → **Actions** → **General**
2. Under "Workflow permissions", select **"Read and write permissions"**
3. Check **"Allow GitHub Actions to create and approve pull requests"**

### 2. Branch Protection (Optional but Recommended)
1. Go to **Settings** → **Branches**
2. Add a branch protection rule for `main`:
   - Require pull request reviews before merging
   - Require status checks to pass before merging
   - Include administrators (optional)

### 3. Secrets (if publishing to npm)
If you want to publish to npm registry, add the following secret:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add repository secret:
   - `NPM_TOKEN`: Your npm publish token

## How It Works

The automated release workflow will:
1. Analyze commits since the last release
2. Determine the next version based on conventional commits
3. Generate a changelog
4. Create a GitHub release
5. Update package.json version
6. Commit changes back to the repository

## Triggering Releases

Releases are triggered automatically when you push to the `main` branch with commits that follow the conventional commit format:

- `feat:` - minor version bump
- `fix:` - patch version bump
- `feat!:` or `BREAKING CHANGE:` - major version bump
- `chore:`, `docs:`, etc. - no version bump

## Troubleshooting

If the release workflow fails with permission errors:
1. Verify "Read and write permissions" are enabled for GitHub Actions
2. Check that the `GITHUB_TOKEN` has sufficient permissions
3. Ensure the repository is not private with restricted Actions access