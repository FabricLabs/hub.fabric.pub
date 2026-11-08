# Payjoin on the Hub

The Hub runs both sides of BIP78 Payjoin:

- **Receiver.** Deposit sessions hand out a BIP21 URI with `pj=`. The Hub adds one of its own coins to the payer's original and raises its own output by that coin's value, less the fee for the extra input.
- **Sender** (internal Payjoin, off by default). The Hub wallet pays a `pj=` URI through BIP78.

| Path | What it is |
|---|---|
| `services/payjoin.js` | Sessions, sends, the fallback sweep |
| `functions/payjoinReceiverContribution.js` | Receiver checks and contribution |
| `functions/payjoinHubSender.js` | Hub wallet sender |
| `functions/payjoinBrowserWallet.js` | Browser sender and the shared proposal checks |
| `functions/payjoinEndpointPolicy.js` | Which `pj=` endpoints may be dialed |
| `functions/payjoinInternalOperations.js` | Which Hub operations use Payjoin |

## Settings

`settings/local.js` → `payjoin`:

| Key | Default | |
|---|---|---|
| `enable` (`FABRIC_PAYJOIN_ENABLE`) | `true` | Deposit sessions, the BIP78 endpoint, the mailbox |
| `receiverContribution` (`FABRIC_PAYJOIN_RECEIVER_CONTRIBUTION`) | regtest only | Hub contributes a coin to proposals |
| `requireOwnedReceiveAddress` | `true` | Contribute only to addresses the Hub wallet owns |
| `maxProposalsPerSession` | `3` | Originals stored per session (one gets a coin) |
| `internal.enable` (**`FABRIC_PAYJOIN_INTERNAL=1`**) | **`false`** | Internal Payjoin (see below) |
| `internal.operations.<id>` | — | `false` turns one operation back off |
| `internal.timeoutMs` (`FABRIC_PAYJOIN_SEND_TIMEOUT_MS`) | `30000` | Receiver answer timeout |
| `internal.maxAdditionalFeeContributionSats` (`FABRIC_PAYJOIN_MAX_FEE_CONTRIBUTION_SATS`) | `1000` | Most the Hub lets a receiver take from its change |
| `internal.allowInsecureEndpoints` | `null` | `null`: plain http and local `pj=` hosts only off mainnet; never on mainnet |

## API

Mapping to SatoshiPortal/payjoin's JSON-RPC:

| SatoshiPortal | Hub HTTP | Hub RPC | Auth |
|---|---|---|---|
| `receive` | `POST /services/payjoin/sessions` | `CreatePayjoinDeposit` | Anyone may create a session for an address they give, but **only the operator's sessions get a Hub coin**. Allocating a Hub address needs the admin token. |
| `getReceive` | `GET /services/payjoin/sessions/:id` | `GetPayjoinSession` | Payer view for anyone; full view (proposals, contributions) for the operator |
| `cancelReceive` | `POST /services/payjoin/sessions/:id/cancel` | `CancelPayjoinSession` | Admin. Refused while a Hub proposal is outstanding. |
| — | `POST /services/payjoin/sessions/:id/proposals` | `SubmitPayjoinProposal` | BIP78 endpoint (`text/plain`) or JSON |
| `send` | `POST /services/payjoin/sends` `{ bip21, feeRateSatVb?, maxAdditionalFeeContributionSats?, dryRun? }` | `CreatePayjoinSend` | Admin, and needs `walletSend` enabled |
| `getSend` | `GET /services/payjoin/sends/:id` | `GetPayjoinSend` | Admin |
| — | `GET /services/payjoin/sends` | `ListPayjoinSends` | Admin |
| `cancelSend` | `POST /services/payjoin/sends/:id/cancel` | `CancelPayjoinSend` | Admin. Only before broadcast. |
| — | `GET /services/payjoin/operations` | `ListPayjoinOperations` | Public |
| — | `GET|POST /services/payjoin/v2[/:resource]` | — | 501 stub (BIP77 OHTTP) |

Every route is also mounted under `/payments/payjoin/…` and `/services/bitcoin/payjoin/…`.

Send statuses: `pending` → `original-built` → `proposal-received` → `broadcast`, or `failed` / `cancelled`. A `dryRun` send ends in `checked`.

SatoshiPortal's `callbackUrl` is not supported, because a caller-supplied URL the Hub would dial is an SSRF risk. WebSocket clients get a `GenericMessage` `{ type: 'PayjoinUpdate', object: { kind: 'session'|'send', id, status, updatedAt } }` instead. It carries no amounts or addresses.

## Internal operations

`payjoin.internal.enable` turns on every **implemented** operation. A stub has its hook in place and always answers `{ payjoin: false, reason: 'stub' }`.

| Operation | Role | Status |
|---|---|---|
| `walletSend` | sender | implemented: `sendpayment`, `POST /services/bitcoin/payments` and `_hubWalletSend` callers pay a BIP21 `pj=` URI (in `bip21` or `to`) through BIP78 |
| `distributeInvoice` | receiver | implemented: `CreateDistributeInvoice` returns `bip21Uri` / `payjoinSessionId` |
| `crowdfundingDonation`, `identityPayment`, `faucet` | receiver | stub |
| `bip77Directory` | transport | stub (`/services/payjoin/v2`) |
| `batching`, `consolidation` | receiver | stub (output substitution, several coins) |
| `inventoryHtlc`, `federationWithdrawal`, `coinjoin`, `fidelityBond` | sender | not applicable (script payee, threshold PSBT, own protocol, self-payment) |

**A failed Payjoin send fails.** Whenever the receiver errors, times out, or returns a proposal that fails a check, the Hub broadcasts **nothing**, not even the original, and unlocks the original's coins. The caller can then retry or pay the plain address.

## Security review (2026-11)

Sources:

- SatoshiPortal/payjoin: README (owned-address check) and issues #6–#9.
- The bitcoindev thread "UTXO probing attack using payjoin" (2025-03).
- rust-payjoin release notes, 1.0.0-rc.5 to 1.2.0.
- BIP78 and BIP79.

The BTCPay Server hot-wallet drains reported on 2026-11-02 were a 2FA bypass, not a Payjoin flaw. They are a reminder that automated hot-wallet receivers like this one are the target.

| # | Finding (before) | Fix |
|---|---|---|
| F1 | **Critical.** Anyone could open a session for any address. With receiver contribution on, the Hub added one of its coins to the output paying *that* address and signed it, so an attacker could drain the wallet one coin per session. A payer could also force the contribution on through the JSON proposal path. | The Hub contributes only to addresses its wallet owns (`getaddressinfo`, or a Hub Taproot template). This is checked when the session is created and again before signing, and fails closed. Anonymous sessions never get a coin. A proposal flag can turn the contribution off, never on. The original must also pay the session its full amount itself, so a Hub coin cannot make an underpaid invoice verify. |
| F2 | **High.** Unlimited originals per session and no seen-input record, so varying the amount walked the wallet coin by coin. Contributed coins stayed locked forever, and the Hub never broadcast the fallback. | One Hub coin per session. The same original gets the same answer, and inputs already answered get `unavailable` (`payjoin/seen-inputs.json`). At most 3 originals per session. A sweep handles fallback (see F10). |
| F3 | **High.** `GET /services/payjoin` listed recent sessions to anyone, and session reads returned PSBTs and contributed outpoints, which made a free probe oracle. | Recent sessions are listed for the operator only. Everyone else gets the payer view. |
| F4 | **High.** The mailbox list was public, mailbox ids were derived from the creation time, and the number of mailboxes was unbounded. | Ids are 32 random bytes and act as the capability. Listing needs the admin token. Open mailboxes are capped and return 429 when full. |
| F5 | **Medium.** An original could spend a Hub wallet coin. | Refused (`getaddressinfo` on each sender input). |
| F6 | **Medium.** The Hub could contribute the output of its previous payjoin, chaining receiver coins together (snowballing). | Outputs of earlier Hub payjoins and sends are excluded before coin selection. If every candidate is excluded, the answer is `unavailable`. |
| F7 | **Medium.** Signatures that did not commit to every input and output were accepted (`NONE`, `ANYONECANPAY`). | Only `SIGHASH_ALL` is accepted, or the Taproot default, on partial and final signatures. |
| F8 | **Medium.** No limits on original size, input or output count, or values. | Originals are capped at 200 000 base64 characters and 100 inputs / 100 outputs. Values above `MAX_MONEY` are refused. |
| F9 | **Medium.** Sender checks did not catch reordered inputs or receiver inputs of another script type. `pj=` URLs could carry userinfo (`http://x.onion:1@evil.com`). The POST had no timeout or size cap. | Both senders now check input order, script type, and that receiver inputs are not our own coins. `checkPayjoinEndpoint` accepts https or `.onion` only, with no userinfo, and refuses private, local and metadata hosts when the Hub dials, including after DNS resolution. The POST has a timeout and a size cap, and refuses redirects. |
| F10 | **Low.** No record of which transaction appeared, and no release of reserved coins. | After `fallbackAfterSeconds` (120), the sweep records whether the payjoin or the original appeared. If neither did, it broadcasts the original. It unlocks the contributed coin unless the payjoin spent it. |

**Residual risk.** A determined attacker can still learn one Hub coin per confirmed UTXO they control and per session the operator opens. Each such probe now costs them a real payment, because the fallback is broadcast. BIP78 and BIP79 do not close this, and neither does any other receiver. Keep receiver contribution off on mainnet unless the Hub's coins are meant to be mixed.
