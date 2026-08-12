# Security (`@fabric/hub` / hub.fabric.pub)
Rendezvous hub, browser gateway, and Bitcoin-facing operator surface.

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

Hub admin capabilities (Beacon accept, generateblock, wallet spend, **regtest faucet**) require possession of the operator admin token / Schnorr proofs — never expose those to untrusted browsers. Regtest faucets are local/dev only and still require the admin token on `POST /services/bitcoin/faucet`. WebRTC `RelayFromWebRTC` must not Hub-re-sign client `BitcoinBlock` / unsigned `CONTRACT_MESSAGE` JSON.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js). Related: [`tests/fabricHubAllowlist.test.js`](tests/fabricHubAllowlist.test.js).

## Trust notes
- Admin token is client-held after first-time setup; treat XSS on the Hub UI as critical.
- Document market / inventory HTLC must rebuild buyer-bound addresses before funding (see `@fabric/core` SECURITY.md).
- Shared HTTP bind and public peering advertisement expand the attack surface — default carefully on production hosts.
- `bitcoinClient` attaches `hubAdminToken` only for Hub `/services/bitcoin` bases; explorer/payments URLs use `apiToken` only.

## Outstanding (PR #15 / RSI follow-ups)
- **Identity import** — xprv imports should persist through the encrypted identity path (not watch-only `id`/`xpub`) and restore locked/unlocked per password flow (heavy lift; extension sync no longer writes unlocked `xprv`/`masterXprv`).
- ~~**Encrypted backup export**~~ — primary “Download encrypted backup” requires an unlocked signing `xprv` (watch-only disabled + labeled).
- **Large WIP split** — PR #15 still spans far more than review-tool limits; land remaining RSI work as stacked PRs (identity, Bitcoin/HTLC, WebRTC, docs) once the staged hardening lands.
- **`GenericMessage` / WS** — see [MESSAGE_TRANSPORT.md](MESSAGE_TRANSPORT.md); prefer named AMP types on public hubs.
- **`@fabric/core` / `@fabric/http` pin hygiene** — `package.json` pins immutable commit SHAs matching the lockfile; bump deliberately with sibling RSI PRs rather than tracking moving branch tips.

## Process
1. `npm run test:unit` (or `npm test`) before release.
2. Never commit `FABRIC_XPRV`, admin tokens, or production stores.
3. Review `@fabric/core` SECURITY.md when bumping Fabric deps.

## Disclosure
Report issues via the repository issue tracker (default hub.fabric.pub issues URL / `FABRIC_ISSUES_URL`).
