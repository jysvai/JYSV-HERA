# Code signing (maintainers)

The release workflow (`.github/workflows/release.yml`) signs by itself once the secrets and variables below exist. Without them it builds exactly as before: unsigned on Windows, ad-hoc signed on macOS. `scripts/builder-config.cjs` is the electron-builder config the workflow uses: `package.json` `build` plus the signing switches.

Every release, signed or not, also gets a Sigstore build-provenance attestation per file (`actions/attest-build-provenance`), which users check with `gh attestation verify <file> --repo jysvai/JYSV-HERA`.

## Windows: SignPath Foundation

Free for open-source projects. The certificate belongs to SignPath Foundation, so Windows shows "SignPath Foundation" as the publisher. (Azure Artifact Signing does not take individuals outside the US and Canada; Certum's open-source certificate, about $58, is the paid alternative.)

1. Apply at <https://signpath.org/apply> with this repository. Requirements: OSI license (AGPL-3.0), no proprietary parts, released before, MFA on GitHub and SignPath.
2. In SignPath, create the project with the GitHub trusted build system, a signing policy (for example `release-signing`, manual approval), and two artifact configurations:

   `app` (the unpacked app, zipped by `actions/upload-artifact`):
   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file-set>
         <include path="jysvhera.exe" />
         <include path="resources/app.asar.unpacked/**/*.exe" min-matches="0" max-matches="unbounded" />
         <include path="resources/app.asar.unpacked/**/*.node" min-matches="0" max-matches="unbounded" />
         <for-each>
           <authenticode-sign />
         </for-each>
       </pe-file-set>
     </zip-file>
   </artifact-configuration>
   ```

   `installer` (the NSIS installer, zipped by `actions/upload-artifact`):
   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file-set>
         <include path="*.exe" />
         <for-each>
           <authenticode-sign />
         </for-each>
       </pe-file-set>
     </zip-file>
   </artifact-configuration>
   ```
3. GitHub → *Settings → Secrets and variables → Actions*:
   - secret `SIGNPATH_API_TOKEN`
   - variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`

With those set, the Windows job packages the app, has SignPath sign `jysvhera.exe` and the node-pty binaries, builds the installer and the zip from the signed app (`--prepackaged`), has SignPath sign the installer, and fails unless `Get-AuthenticodeSignature` reports `Valid` for both. Each release then waits for the two signing requests to be approved in SignPath.

SmartScreen still warns about a newly signed app until it builds reputation from downloads; the signature makes the publisher visible and keeps Smart App Control from blocking it.

## macOS: Developer ID and notarization

Needs the Apple Developer Program ($99 a year).

1. Create a **Developer ID Application** certificate, export it with its key as a `.p12`, and base64 it: `base64 -i cert.p12 | pbcopy`.
2. In App Store Connect → *Users and Access → Integrations*, create an API key with the Developer role and download the `.p8`.
3. GitHub secrets:
   - `MAC_CERTS`: the base64 `.p12`
   - `MAC_CERTS_PASSWORD`: its password
   - `APPLE_API_KEY_P8`: the text of the `.p8` file
   - `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: from the API key page

The macOS job then signs with hardened runtime (electron-builder's default entitlements cover V8 and node-pty), notarizes with `notarytool`, and the self-test runs the signed app. Without `APPLE_API_KEY_P8` it signs but does not notarize.

## Checking a signed release

```powershell
Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\jysvhera\jysvhera.exe"   # Windows
```
```bash
codesign --verify --deep --strict --verbose=2 "/Applications/JYSV HERA.app"   # macOS
spctl --assess --type execute --verbose "/Applications/JYSV HERA.app"
```
