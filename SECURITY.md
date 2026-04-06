# Security

## API Key Storage

Horus stores sensitive configuration **outside this repository** at:

```
~/.horus/config.json
```

This ensures:
- API keys are never committed to git
- Each user has their own local config
- No risk of accidental exposure in PRs

## What Gets Committed

Only non-sensitive files are in this repo:
- Source code (`src/`)
- Documentation (`README.md`, `horus-spec.md`)
- Configuration templates (`.env.example`)
- Build configs (`package.json`, `tsconfig.json`)

## What Stays Local

These are gitignored and never committed:
- `node_modules/` - Dependencies
- `dist/` - Build output
- `.env` - Environment variables
- `*.db` - Database files
- `~/.horus/` - User config (outside repo)

## Verifying Safety

Before committing, you can verify no secrets are present:

```bash
# Check what will be committed
git status

# Search for potential secrets
grep -r "api.moonshot.cn" src/ || echo "No hardcoded URLs"
grep -r "sk-" src/ || echo "No API keys in source"
```

## If You Accidentally Commit a Secret

1. **Don't panic** - rotate the key immediately
2. **Invalidate the old key** via Moonshot AI dashboard
3. **Generate a new key**
4. **Update your local config**: `~/.horus/config.json`
5. **Force push** to remove from git history (if pushed)

## Reporting Security Issues

If you find a security vulnerability, please open an issue privately.
