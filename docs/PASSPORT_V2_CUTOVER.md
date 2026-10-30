# Passport v2 cutover

Passport v2 (spec: `@fabric/core` `docs/PASSPORT.md`) is not compatible with
v1. Sign-in, the local signer, and the account keys all change at once, so
hub.fabric.pub, relay.goon.vc, goon.vc, the extension, and the Hub and
GoonCitizen desktop apps ship in one window. This is the order.

| Repo | Branch | Gate |
| --- | --- | --- |
| `@fabric/core` (fabric-clean) | `feature/passport-v2` | `npm run ci` |
| `@fabric/http` | `feature/passport-v2` | `npm test` |
| hub.fabric.pub | `feature/passport-v2` | `npm run ci` |
| fabric-browser-extension | `feature/passport-v2` | `npm test` + Playwright |
| star-citizen-live | `feature/passport-v2` | `npm test` |
| goon.vc | `feature/passport-v2` | `npm test` |
| sensemaker | `feature/passport-v2` | `npm test` |

Core lands first, then http. The other five pin those two commits
(`FabricLabs/fabric#<sha>`, `FabricLabs/fabric-http#<sha>`). Nothing merges to
`main` until the owner says so.

## What changes keys

Every federation whose validators were identity keys gets a new id and vault
address under v2, because validators are now cosigner keys
(`m/87'/B'/n'/0/0`):

- goon.vc Market escrow orders (buyer and seller were `fabric:` identity keys);
- GoonCitizen group wallets (signers were member identity keys);
- Passport federations made in the extension;
- named federations the Hub is a member of, and the Hub Beacon vault (the Hub
  validated with its root key; v2 validates with its cosigner key).

Off mainnet, wallet coins move too: the funds coin type goes from `0'` to `1'`,
so testnet, signet, and regtest coins on `m/44'/0'/n'` disappear from view.
Mainnet coins on `m/44'/0'/n'` stay visible because `44'` is still watched.

Unchanged: the Hub's bitcoind wallet, coinjoin maker keys and fidelity bonds
(the Hub root master at `m/86'/…`), goon.vc's arbiter, bridge, and alliance
keys (`m/7777'/…` of `GOON_FABRIC_XPRV`), and GoonCitizen mission escrows
(authority pubkeys from settings).

Identity pubkeys stay the same for account 0 on a non-mainnet network
(`m/44'/7778'/0'/0/0`). A client that used to take its network from somewhere
else (the GoonCitizen blob from env, the Hub signer hard-coded to 7778) gets a
new pubkey, and that goon.vc member signs in with Discord and links Passport
again from their profile.

## Step 0: sweep, on the old builds

Everything here runs **before** any v2 build is deployed or installed.

1. **Freeze the Market.** Announce in the Market forum and #announcements that
   no new orders open until the cutover. The old build has no switch that stops
   orders alone (`GOON_MARKET=0` takes the whole Market down), so leadership
   and the Market arbiters (`GOON_MARKET_ARBITERS`) work through what's open:
   - paid and delivered orders: the buyer releases on the order page, or the
     arbiter presses release;
   - paid, not delivered: the seller refunds, or the arbiter refunds;
   - unpaid: cancel.

   Parties sign with the old tooling: the order page's pasted frame, the old
   Passport, or `npm run market:sign -- sign <order> release|refund` from the
   **old** goon.vc checkout. The v2 `market-sign.js` signs with the cosigner
   key and can't sign a v1 order.
2. **GoonCitizen group wallets.** Each group's signers open
   `GET /services/star-citizen/groups/<id>/wallet` on their desktop (the
   Wallet tab). For every funded vault, including those under `previous`, one
   signer requests a withdrawal to a member's address:
   `POST /services/star-citizen/groups/<id>/withdrawals { destinationAddress, amountSats, feeSats }`.
   The others sign with `POST …/withdrawals/<id>/signatures` until the
   threshold, and any member's node broadcasts. Group wallets aren't posted to
   the Hub, so the vault list below can't see them. Each group confirms on its
   own that its balance is 0.
3. **Passport federations.** Members withdraw from each funded federation in
   the old Passport and sign until the threshold.
4. **Hub federations and the Beacon vault.** The operator spends the Beacon
   vault with `PrepareFederationVaultWithdrawalPsbt`. That takes the admin token,
   a `withdrawalRequest` bound to the current tip with `amountSats`, and
   `withdrawalWitnesses` when the threshold is 2 or more; see
   [FEDERATED_SETTLEMENT.md](FEDERATED_SETTLEMENT.md) and
   [FEDERATION_DEPLOYMENT.md](FEDERATION_DEPLOYMENT.md). Named federations the
   Hub belongs to withdraw through the federation mailbox like any member.
5. **Off-mainnet wallets.** Users on testnet, signet, or regtest send the coins
   on `m/44'/0'/n'` to an address outside Passport, the Hub browser wallet, and
   GoonCitizen (an exchange or another wallet), and receive them on a v2
   address after the cutover.
6. **Gate: the vault list.** On the Hub host, against the live Hub:

   ```bash
   npm run cutover:vaults -- --hub https://hub.fabric.pub
   # --store <dir> when the Hub keeps stores/hub elsewhere; --json for a report
   ```

   It reads every named federation the Hub knows (its own and those in
   invites or the mailbox, which includes each Market order), asks
   `GET /services/federations/<id>/vault` for each, adds the Beacon vault
   (`GET /services/distributed/vault/utxos`), and prints a table of each vault
   with its signers, network, address, balance, and coins. It exits 1 while
   any vault holds coins or can't be read. Paste the table into the cutover
   announcement. **Don't go on until it exits 0** and every GoonCitizen group
   has reported 0.

## Lockfiles

The pins in the five downstream repos resolve once the core and http commits
are on GitHub. After pushing those branches, refresh each downstream lockfile
and commit it on the same branch:

```bash
npm install --package-lock-only   # hub, extension, star-citizen-live, goon.vc, sensemaker
```

`@fabric/http` refreshes its own lockfile against the core pin the same way.
Re-run each repo's gate after the refresh.

## Step 1: builds, ready before the window

- Extension: `npm run build:prod`, then submit to the Chrome Web Store and AMO.
  Hold the release; don't publish yet.
- Hub: `npm run build:installers` (or `build:installers` per OS on its native
  builder for code signing).
- GoonCitizen: `npm run build:installers` (or `build:installers:packed` on the
  pinned sibling checkouts), plus `npm run android:sync` for the APK.

## Step 2: deploy the three services in one window

Each deploy follows its own production doc; these are the v2 settings:

| Service | Doc | Set |
| --- | --- | --- |
| hub.fabric.pub (and hub.goon.vc) | [PRODUCTION.md](PRODUCTION.md) | `FABRIC_HUB_PUBLIC_ORIGIN=https://hub.fabric.pub`, `FABRIC_HUB_PASSPORT_ORIGINS=https://hub.goon.vc` |
| relay.goon.vc | star-citizen-live `docs/PRODUCTION.md` | `FABRIC_PUBLIC_HOST=relay.goon.vc` (pins `https://relay.goon.vc`) |
| goon.vc | goon.vc `DEPLOY.md` | `GOON_MEMBERS_ORIGINS=https://goon.vc` |

Sign-in challenges are issued only for pinned origins, so an unset variable
means nobody signs in on that name. goon.vc no longer proxies `/sessions` to
the Hub; its Passport sign-in is its own. v1 sessions and delegation tokens
end at deploy, and everyone signs in again.

Check after deploy, on each origin:

- `POST /sessions/challenges` answers 200 with a `fabric:` challenge (goon.vc:
  `POST /services/members/passport/challenges`);
- an old `SITE_LOGIN_RESPONSE` posted to `POST /sessions` answers 426
  `passport_outdated`;
- `npm run cutover:vaults` still exits 0.

## Step 3: publish

Publish the held extension release in both stores, then the Hub and
GoonCitizen installers (`/downloads`, `npm run publish:builds -- --pin`, and
goon.vc `npm run build:downloads`). Announce in Discord with the vault table
from step 0, and say that Market orders are open again.

## Step 4: older clients

Nothing from v1 is accepted, and every refusal says what to do:

- **Server.** A sign-in that isn't a v2 `PASSPORT_ASSERTION` (a v1
  `SITE_LOGIN_RESPONSE`, or a frame with `v` below 2) gets HTTP 426
  `{ error: 'passport_outdated', message: 'This sign-in needs Passport v2. …' }`
  from the Hub, relay.goon.vc, sensemaker, and goon.vc
  (`@fabric/http` `passportHttp`). goon.vc's old
  `POST /services/members/passport/requests` answers the same. The challenge
  isn't spent, so the user can try again once updated.
- **Desktop signer.** The `/services/fabric/sign` local signer is gone.
  A Passport that still sends `PASSPORT_SIGN_REQUEST` (or a v1
  `FABRIC_SIGN_REQUEST`) to the delegate gets 426 `passport_outdated`.
  Desktop apps sign through delegation (step 5).
- **Pages.** A page asks whether Passport is there with `PASSPORT_HELLO` on a
  transferred port (`probePassport` in `@fabric/http` `passportPage`); only an
  answer with `v: 2` counts. A page that finds only an older Passport's
  `<html>` marker says "Update Fabric Passport to sign in here" instead of
  offering sign-in.
- **Extension.** A v2 Passport whose desktop app is still v1 tells the user to
  update the desktop app.

## Step 5: linked signers replace device links

Device links, identity clusters, `IdentityCrossSign`, and the desktop
`/services/fabric/{identity,sign,link}` routes are removed everywhere at once
(core, http, Hub, Passport, GoonCitizen, goon.vc). Nothing carries over:

- **Pair again.** In Passport, open **Linked signers → Pair with a Hub** (or a
  GoonCitizen desktop) on the machine where it runs. Both screens show a
  six-digit code; approve it in the app's window. Old device links are not
  read.
- **Signing rules start empty.** Until the operator adds rules
  (`/settings/signing`), every request waits under Notifications (and in the
  desktop dialog).
- **goon.vc proxying.** If goon.vc proxies `/delegations` to the Hub, add
  `https://goon.vc` to `FABRIC_HUB_PASSPORT_ORIGINS` so the rendezvous serves
  that origin.
