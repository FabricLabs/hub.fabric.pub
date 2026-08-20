# Managed node binaries

Hub stores **Bitcoin Core** (`bitcoind`, `bitcoin-cli`) and **Core Lightning** (`lightningd`) under this directory so first-time setup and desktop installers can run managed Bitcoin and Lightning without a system-wide install.

Layout (gitignored except this file):

```text
binaries/<platform>-<arch>/
  bin/bitcoind
  bin/bitcoin-cli
  lightning/          # Linux x64 official tarball tree (when present)
```

Platform ids match Node: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`.

- **Download this machine:** `npm run binaries:fetch`
- **Download every installer platform:** `npm run binaries:fetch:all`
- First-time setup in the Hub UI calls `POST /services/binaries` and writes here (or under `FABRIC_HUB_USER_DATA/binaries` on the desktop app).

Pinned versions live in `functions/hubManagedBinariesManifest.js`. Verify against official `SHA256SUMS` before bumping.
