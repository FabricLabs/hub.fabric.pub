# Contributors

## Maintainers
- Fabric Labs core maintainers

## Contribution Scope
Contributions are welcome across:
- runtime reliability (startup/shutdown/service lifecycle)
- Fabric peer/websocket/webrtc protocol surfaces
- Bitcoin and Payjoin flows
- UI operability and diagnostics
- tests and release automation

## Recent Contributor Areas
Recent work has centered on:
- Payjoin service integration (`services/payjoin.js`, Hub routes/RPC wiring)
- Bitcoin operator UX hardening (`components/BitcoinHome.js`)
- browser-based e2e test automation (`scripts/verify-payjoin-e2e.js`)
- managed-runtime stability and lock-file recovery for regtest

## How to Contribute
1. Create a focused branch.
2. Implement the change with tests or reproducible validation steps.
3. Run:
   - `npm run build`
   - `npm test`
   - relevant e2e checks (`npm run test:e2e-payjoin`, `npm run test:e2e-webrtc`)
4. Update contributor-facing docs (`AGENTS.md`, `DEVELOPERS.md`) when behavior changes.
5. Open a PR with:
   - summary of user-visible behavior changes
   - operational impact notes
   - test plan and command output

## Attribution Notes
- If adding major subsystems, add your name/org and contact handle in this file.
- Keep entries concise and role-based (avoid adding secrets or personal addresses).
