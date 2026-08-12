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

## Process
1. `npm run test:unit` (or `npm test`) before release.
2. Never commit `FABRIC_XPRV`, admin tokens, or production stores.
3. Review `@fabric/core` SECURITY.md when bumping Fabric deps.

## Disclosure
Report issues via the repository issue tracker (default hub.fabric.pub issues URL / `FABRIC_ISSUES_URL`).
