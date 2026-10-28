<!-- lang --><sub>[한국어](../ko/security.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Security

HERA runs your shells and AI CLIs, so it has to be trustworthy itself. This page lists what you can check yourself and what the app does to protect you. To report a problem, see [SECURITY.md](../../SECURITY.md).

## Check a download

Every release is built by GitHub Actions from the tagged source, in public: [release workflow runs](https://github.com/jysvai/JYSV-HERA/actions/workflows/release.yml). Nothing is built on a personal machine.

**1. Build provenance (signed).** Each release file has a [build-provenance attestation](https://github.com/jysvai/JYSV-HERA/attestations): a statement signed with Sigstore that says which workflow, commit and tag produced the file. With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify JYSV-HERA-0.2.4-win-x64.exe --repo jysvai/JYSV-HERA
```

`Verification succeeded!` means the file is byte for byte what this repository's workflow built. A file changed by anyone afterwards fails.

**2. Checksum.** `SHA256SUMS.txt` in the release lists the SHA-256 of every file, and GitHub shows the same digest next to each asset.

```powershell
Get-FileHash .\JYSV-HERA-0.2.4-win-x64.exe -Algorithm SHA256   # Windows
```
```bash
shasum -a 256 JYSV-HERA-0.2.4-mac-arm64.dmg                     # macOS / Linux
```

The [in-app updater](updates-and-privacy.md) does this check by itself and installs nothing that does not match.

## Code signing

| OS | Today | Planned |
|---|---|---|
| Windows | Not signed yet: SmartScreen asks *More info → Run anyway* the first time. | Authenticode through SignPath Foundation (free for open source). The release workflow is ready and signs once the account exists. |
| macOS | Ad-hoc signed, not notarized: the first time, *System Settings → Privacy & Security → Open Anyway* (macOS 12–14: right-click → *Open*). | Developer ID signing and Apple notarization. The release workflow is ready and does both once the certificate is added. |
| Linux | Checksums and provenance (Linux packages are not usually signed). | — |

Until then, the provenance check above is the way to know a file is genuine.

## How the app is hardened

- **Sandboxed UI.** The window runs with `sandbox`, `contextIsolation` and no Node integration, under a Content Security Policy. It cannot open other sites: links open in your browser, and navigation away from the app is blocked.
- **Narrow bridge.** The UI reaches the app only through a fixed list of named calls (the preload allowlist). It cannot run arbitrary commands: the *Extensions & updates* page, for example, sends only the id of what to update, and the app builds the command itself and runs it in a visible terminal tab.
- **Locked runtime (Electron fuses).** The packaged app ignores `NODE_OPTIONS` and `--inspect`, loads its code only from its own `app.asar`, and checks that archive's integrity at start, so editing the installed files makes the app refuse to run. `RunAsNode` stays on, because the `hera` CLI uses it when Node.js is not installed.
- **Local-only bus.** The `hera` CLI talks to the app over a named pipe (Windows) or a Unix socket with owner-only permissions (macOS, Linux), never over the network. Each request must carry a random token from your data folder. `hera host` opens tabs only for folders you registered.
- **No secrets.** Account and extension pages show names, plans and package names. Tokens, API keys, MCP server headers and environment variables are not read or shown.

## Network and data

HERA has no server, no account and no telemetry. Without your action it makes one kind of request: the update check against GitHub's public releases API, which you can switch off. Details: [Updates and privacy](updates-and-privacy.md).

## Automated checks

| Check | When |
|---|---|
| [CodeQL](https://github.com/jysvai/JYSV-HERA/actions/workflows/codeql.yml) security queries over the TypeScript source and the workflows | Every push, every pull request, weekly |
| `npm audit` of the dependencies that ship in the app (fails on high or critical) | Every push |
| Packaged-app self-test on Windows, macOS and Linux: real terminal, `hera` CLI, window | Every release, before anything is published |
