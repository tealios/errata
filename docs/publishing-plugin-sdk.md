# Publishing `@tealios/errata-plugin-sdk`

This project includes a local SDK package at `packages/errata-plugin-sdk`.

## Manual Publish (npm)

Run publish from the SDK package directory (not repo root):

```bash
cd packages/errata-plugin-sdk
NODE_AUTH_TOKEN="<your-npm-token>" npm publish
```

Notes:

- Package is configured with `publishConfig.access = public`.
- Publish target is npm registry (`https://registry.npmjs.org`).

## CI Publish (GitHub Actions)

Workflow file:

- `.github/workflows/publish-plugin-sdk.yml`

Triggers:

- manual (`workflow_dispatch`)
- tag push matching `sdk-v*` (example: `sdk-v0.1.1`)

Behavior:

- Validates tag version matches `packages/errata-plugin-sdk/package.json` version.
- Publishes from `packages/errata-plugin-sdk`.

Required GitHub secret:

- `NPM_TOKEN`

## Common Errors + Fixes

### `E403 ... Two-factor authentication ... bypass 2fa enabled is required`

Cause:

- token does not satisfy org/npm 2FA publish policy
- or token is expired/revoked

Fix:

- create a new npm automation/granular token that can publish `@tealios/errata-plugin-sdk`
- ensure it is valid for your org's 2FA policy
- retry publish and update GitHub `NPM_TOKEN`

### `Cannot read properties of null (reading 'prerelease')`

Cause:

- usually running `npm publish` from the wrong directory (repo root) instead of the SDK package folder

Fix:

- run publish from `packages/errata-plugin-sdk`

### `gitignore-fallback No .npmignore file found`

Cause:

- npm uses `.gitignore` when `.npmignore` is missing

Fix:

- optional; add `.npmignore` inside `packages/errata-plugin-sdk` if you need explicit publish file control

## Versioning Flow

1. Bump `packages/errata-plugin-sdk/package.json` version.
2. Publish manually, or push matching release tag:

```bash
git tag sdk-v0.1.1
git push origin sdk-v0.1.1
```

## Security Reminder

- Never commit npm tokens.
- If a token is ever shared in logs/chat, rotate/revoke it immediately.
