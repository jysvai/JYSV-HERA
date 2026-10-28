# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- **GitHub:** the repository's *Security* tab → **Report a vulnerability** (private vulnerability reporting).

Include the HERA version (`hera --version`), your OS, and the steps to reproduce. You will get an answer within 7 days. A fix ships as a new release, and the patch notes credit you unless you ask otherwise.

## Supported versions

Only the latest release gets security fixes. HERA updates itself from *Settings → Version · Update*.

## What protects you today

- Every release file has a signed build-provenance attestation (Sigstore) and a SHA-256 checksum, so you can check that a download was built by this repository's GitHub Actions from the tagged source.
- The app runs its UI sandboxed and blocks Node options, the inspector and tampering with its code (Electron fuses and asar integrity).
- CodeQL scans the source and the workflows on every push, and CI fails on a known high-severity vulnerability in shipped dependencies.

Details, and how to verify a download yourself: [docs/en/security.md](docs/en/security.md) ([한국어](docs/ko/security.md)).
