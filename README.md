# Publish ATProto Lexicons

A GitHub Action that automatically publishes ATProto lexicon schemas to the ATProto network. This action loads lexicon JSON files from your repository, compares them with already-published versions, and publishes only new or updated lexicons.

![Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)
![Coverage](./badges/coverage.svg)

## Usage

### Basic Example

```yaml
name: Publish Lexicons
on:
  push:
    branches: [main]
    paths:
      - 'lexicons/**'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Publish Lexicons
        uses: birbhouse-games/publish-lexicons@v1
        with:
          handle: ${{ secrets.ATPROTO_HANDLE }}
          app-password: ${{ secrets.ATPROTO_APP_PASSWORD }}
          lexicon-files: ./lexicons
```

### Using Multiple Paths

```yaml
- name: Publish Lexicons
  uses: birbhouse-games/publish-lexicons@v1
  with:
    handle: ${{ secrets.ATPROTO_HANDLE }}
    app-password: ${{ secrets.ATPROTO_APP_PASSWORD }}
    lexicon-files: |
      ./lexicons/app
      ./lexicons/com
      ./schemas/custom-lexicon.json
```

### Using Outputs

```yaml
- name: Publish Lexicons
  id: publish
  uses: birbhouse-games/publish-lexicons@v1
  with:
    handle: ${{ secrets.ATPROTO_HANDLE }}
    app-password: ${{ secrets.ATPROTO_APP_PASSWORD }}
    lexicon-files: ./lexicons

- name: Report Results
  run: |
    echo "📊 Publishing Summary:"
    echo "  New: ${{ steps.publish.outputs.new-count }}"
    echo "  Updated: ${{ steps.publish.outputs.updated-count }}"
    echo "  Skipped: ${{ steps.publish.outputs.skipped-count }}"
    echo ""
    echo "📝 Published lexicons: ${{ steps.publish.outputs.published-lexicons }}"
```

### Conditional Workflow Steps

```yaml
- name: Publish Lexicons
  id: publish
  uses: your-org/publish-lexicons@v1
  with:
    handle: ${{ secrets.ATPROTO_HANDLE }}
    app-password: ${{ secrets.ATPROTO_APP_PASSWORD }}
    lexicon-files: ./lexicons

- name: Rebuild Documentation
  if: steps.publish.outputs.new-count > 0
  run: npm run docs:build

- name: Create PR Comment
  if: steps.publish.outputs.published-count > 0
  uses: actions/github-script@v7
  with:
    script: |
      const newCount = ${{ steps.publish.outputs.new-count }};
      const updatedCount = ${{ steps.publish.outputs.updated-count }};
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `✅ Published ${newCount} new and ${updatedCount} updated lexicons`
      });
```

### Custom ATProto Service

```yaml
- name: Publish to Custom PDS
  uses: your-org/publish-lexicons@v1
  with:
    handle: user.custom-pds.example
    app-password: ${{ secrets.CUSTOM_PDS_PASSWORD }}
    service: https://pds.example.com
    lexicon-files: ./lexicons
```

## Inputs

| Input           | Description                                                                                                   | Required | Default                       |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- |
| `handle`        | ATProto handle for the account whose repository the lexicons will be published to (e.g., `user.bsky.social`). | **Yes**  | N/A                           |
| `app-password`  | App password for authentication. **Do not use your main account password.** Store this in GitHub Secrets.     | **Yes**  | N/A                           |
| `lexicon-files` | Paths to lexicon files or directories. Directories are recursively searched for `.json` files.                | **Yes**  | N/A                           |
| `service`       | ATProto service URL. Use this to publish to a custom PDS.                                                     | No       | `https://public.api.bsky.app` |

## Outputs

### Summary Statistics

| Output            | Description                                        | Type   | Example |
| ----------------- | -------------------------------------------------- | ------ | ------- |
| `published-count` | Total number of lexicons published (new + updated) | Number | `5`     |
| `new-count`       | Number of new lexicons published                   | Number | `3`     |
| `updated-count`   | Number of existing lexicons updated                | Number | `2`     |
| `skipped-count`   | Number of lexicons skipped (no changes detected)   | Number | `7`     |

### Lexicon Lists

| Output               | Description                               | Type       | Example                                  |
| -------------------- | ----------------------------------------- | ---------- | ---------------------------------------- |
| `published-lexicons` | JSON array of all published lexicon IDs   | JSON Array | `["com.example.one", "com.example.two"]` |
| `new-lexicons`       | JSON array of newly published lexicon IDs | JSON Array | `["com.example.one"]`                    |
| `updated-lexicons`   | JSON array of updated lexicon IDs         | JSON Array | `["com.example.two"]`                    |
| `skipped-lexicons`   | JSON array of skipped lexicon IDs         | JSON Array | `["com.example.unchanged"]`              |

### Using Outputs in Workflows

All count outputs are numbers and can be used in conditionals:

```yaml
if: steps.publish.outputs.new-count > 0
```

List outputs are JSON arrays (strings) and can be parsed:

```yaml
- name: Process Published Lexicons
  run: |
    echo '${{ steps.publish.outputs.published-lexicons }}' | jq -r '.[]'
```

## Security Best Practices

### Creating an App Password

**Never use your main account password!** Always create an app password:

1. Log into your ATProto account (e.g., Bluesky)
2. Navigate to **Settings → Privacy and Security → App Passwords**
3. Create a new app password with a descriptive name (e.g., "My Repo - GitHub Actions")
4. Copy the generated password

### Storing Credentials in GitHub Secrets

1. Go to your repository → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Add these secrets:
   - `ATPROTO_HANDLE`: Your ATProto handle (e.g., `user.bsky.social`)
   - `ATPROTO_APP_PASSWORD`: The app password you created

**Important**: The app password is automatically marked as secret in action logs to prevent accidental exposure.

## How It Works

1. **Load Lexicons**: Recursively scans specified paths for `.json` files
2. **Validate**: Ensures each file has a valid `id` field and is valid JSON
3. **Authenticate**: Logs into the ATProto service with provided credentials
4. **Fetch Published**: Retrieves all currently published lexicons from your repository (with pagination support for repos with >100 lexicons)
5. **Compare**: Uses diff detection to identify new, updated, and unchanged lexicons
6. **Publish**: Batch-publishes only new and updated lexicons using `com.atproto.repo.applyWrites`
7. **Report**: Sets outputs with detailed statistics for downstream workflow steps

## Troubleshooting

### "Authentication failed" error

**Cause**: Invalid credentials or wrong password type.

**Solution**:

- Verify you're using an **app password**, not your main account password
- Check that secrets are set correctly in repository settings
- Ensure the handle matches the account for the app password

### "No lexicon files found" warning

**Cause**: No `.json` files found in specified paths.

**Solution**:

- Verify paths in `lexicon-files` are correct relative to repository root
- Ensure lexicon files have `.json` extension
- Check that files are committed to the repository (not in `.gitignore`)

### "Missing required 'id' field" error

**Cause**: Lexicon file doesn't have an `id` field.

**Solution**: All lexicon files must have an `id` field following ATProto naming conventions (e.g., `"id": "com.example.myLexicon"`).

### "Failed to parse JSON" error

**Cause**: Invalid JSON syntax in lexicon file.

**Solution**: Use a JSON validator or linter to check syntax.

## Development

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint code
npm run lint

# Build distribution
npm run package
```

### Releasing

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and releases.

**Commit Message Format:**

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```bash
# Patch release (1.0.0 -> 1.0.1)
fix: correct input validation for handle parameter

# Minor release (1.0.0 -> 1.1.0)
feat: add support for custom ATProto services

# Major release (1.0.0 -> 2.0.0)
feat!: change output format to JSON arrays

BREAKING CHANGE: output format has changed
```

### Local Testing

You can test the action locally using the `@github/local-action` utility:

1. Create a `.env` file:

   ```bash
   INPUT_HANDLE=user.bsky.social
   INPUT_APP-PASSWORD=xxxx-xxxx-xxxx-xxxx
   INPUT_LEXICON-FILES=./lexicons
   INPUT_SERVICE=https://public.api.bsky.app
   ```

2. Run the action:
   ```bash
   npm run local-action
   ```

## License

See [LICENSE](LICENSE) for details.
