// electron-builder config for the release workflow: package.json "build", plus
// code signing when the signing secrets are set (see docs/code-signing.md).
// Without them the result is the same as `npm run dist`: ad-hoc signed on macOS,
// unsigned on Windows.
const { build } = require('../package.json')

const config = structuredClone(build)

// macOS: Developer ID certificate (CSC_LINK + CSC_KEY_PASSWORD) with hardened runtime.
// electron-builder notarizes on its own when APPLE_API_KEY, APPLE_API_KEY_ID and
// APPLE_API_ISSUER are set too. Its default entitlements cover Electron and node-pty.
if (process.platform === 'darwin' && process.env.CSC_LINK) {
  delete config.mac.identity
  config.mac.hardenedRuntime = true
  config.mac.gatekeeperAssess = false
}

module.exports = config
