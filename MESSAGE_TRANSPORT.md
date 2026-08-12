# Fabric-native client messaging (Hub ↔ browser)

Hub and browser exchange **signed Fabric `Message`** frames over the **binary WebSocket** (`Message.fromBuffer` / `toBuffer`), matching `@fabric/http` `HTTPServer` (see `JSONCall`, `Ping` / `Pong`, etc.).

**Core V1 rule:** AMP **bodies are typed field layouts** in `@fabric/core`
(`docs/MESSAGE_BODY.md`). **JSON is an HTTP/browser bridge** (`@fabric/http`),
not the wire body design. Former JSON keys map to named fields in per-opcode schemas.

**Application Groups:** out-of-band shares and federation invites may arrive as
opaque `fabric:<hex>` signed `CONTRACT_MESSAGE` frames (`GroupShare` /
`GroupOffer`, or `FederationContractInvite`) — not only Hub chat JSON.

This document defines how we **move away from `GenericMessage` as a catch-all** toward a **cohesive set of standard outer types**, each with a stable numeric opcode (today: 32-bit field in the Message header).

## Type tiers

| Tier | Meaning |
|------|---------|
| **Stable outer type** | Registered in `@fabric/core` `Message.types` + `Message` type getter; fixed opcode. |
| **Transitional outer type** | `GenericMessage`, `JSONBlob` — valid on the wire, but **not** the end state; body is usually JSON with domain `type` inside. |
| **Inner domain type** | JSON `type: 'INVENTORY_RESPONSE'` (etc.) inside a transitional carrier; **planned promotion** to its own outer `Message.type` + opcode. |

**Policy:** New hub/browser features SHOULD add a **named outer type** in `@fabric/core` (opcode + `Message.types` + getter cases) once the payload shape stabilizes. Until then, use **`FabricBridgeEnvelope`** inside `GenericMessage` (see below) so payloads stay versioned and reversible.

**Canonical list:** [`functions/fabricMessageRegistry.js`](functions/fabricMessageRegistry.js) — outer opcodes Hub cares about, inner types pending promotion, suggested opcode block `16200–16299` for future hub-specific allocation **after** core review.

## `GenericMessage` is outstanding work

`GenericMessage` (opcode `GENERIC_MESSAGE_TYPE` / 15103) is a **placeholder**: unknown or convenience payloads default here. It does **not** replace a proper AMP type:

1. Prefer **`JSONCall`** for request/response RPC.
2. Prefer **named outer types** (`ChatMessage`, `P2P_RELAY`, `JSONPatch`, …) when the semantic is fixed.
3. For fanout blobs not yet promoted, use **`GenericMessage`** with either explicit JSON `type` **or** a **`FabricBridgeEnvelope`** body.

Long term, **every** standard message SHOULD have a dedicated outer type and a **versioned binary body** (or a tight binary prefix + optional extensions), not an unstructured JSON string.

**Still open (Hub / `@fabric/http`):** broader WebSocket `GenericMessage` fan-out auth — optional `settings.websocket.requireClientToken` is not enough for production shared hosts; promote sensitive carriers off `GenericMessage`, keep WS token required where the hub is public, and do not treat unsigned JSON carriers as equivalent to author-signed AMP (`CONTRACT_MESSAGE`, `BitcoinBlock`, …). WebRTC already requires author-signed AMP for contract / tip frames (`functions/fabricWebRtcP2pRelay.js`).

## Envelope: `FabricBridgeEnvelope` (reversible JSON inside `GenericMessage`)

Until an inner domain type becomes an outer type, carry it as:

```json
{
  "@fabric/BridgeEnvelope": true,
  "v": 1,
  "fabricType": "HubClientChat",
  "payload": { },
  "meta": { }
}
```

- **`fabricType`** — Should align with names in `INNER_DOMAIN_PENDING_PROMOTION` / future outer type names when promoted (`functions/fabricMessageRegistry.js`).
- Helpers: [`functions/fabricBridgeEnvelope.js`](functions/fabricBridgeEnvelope.js).

**WebRTC:** Prefer the same **binary** `Message.toBuffer()` as the WebSocket over `RTCDataChannel`.

## Outer types (short reference)

Full table with opcodes and stability: **`fabricMessageRegistry.OUTER_WIRE_TYPES`**.

| `Message.type` | Role (summary) |
|----------------|----------------|
| `JSONCall` | Hub RPC; body `{ method, params }`; response uses `JSONCallResult` convention. |
| `GenericMessage` | **Transitional** fanout / carrier; migrate to specific types. |
| `JSONBlob` | **Transitional** JSON payload (`GENERIC_MESSAGE_TYPE + 1`). |
| `P2P_RELAY` | Mesh **flood** envelope. **Peer mesh:** body = raw inner `Message` bytes. **Hub↔browser WS:** JSON `{ original, originalType, hops }` (Bridge). Not IP-hiding. |
| `P2P_FORWARD` | Directed onion hop (`0x45`): field body `{ nextPeer, ttl, inner }`. Terminated by `@fabric/core` Peer (peel / single-peer forward). Hub RPC **`SendOnion`** (text sealed to path tip by default via `onionChatSeal`; `encrypt: false` for cleartext). **Do not** `http.broadcast` outer frames to browsers — Bridge ignores. See core [`docs/P2P_FORWARD.md`](https://github.com/FabricLabs/fabric/blob/master/docs/P2P_FORWARD.md). |
| `Ping` / `Pong` | Keepalive. |
| `P2P_MESSAGE_RECEIPT` | Server ack. |
| `ChatMessage` | Chat broadcast (legacy re-signed relay path). |
| `P2P_CHAT_MESSAGE` | First-class peer chat frame (opcode `104` / `0x68`). Relayed with per-hop re-sign for key-pinning continuity; author carried in body. |
| `CONTRACT_PUBLISH` | Publishes a contract definition; registers under a deterministic Actor id (contract namespace). Hub records `ContractPublish`. |
| `CONTRACT_MESSAGE` | Namespaced contract event; body carries `contract: <id>`. Dispatch routes by namespace; Hub records `ContractMessage`. |
| `ContractProposal` | Batched signed messages + Merkle + JSON Patch (+ optional PSBT); optional `contractId` namespace. |
| `JSONPatch` | Client state patch. |

## WebSocket authentication (optional)

When enabled, the server rejects the WebSocket handshake unless a shared secret matches.

**Hub settings** (`settings/websocket` from [`settings/local.js`](settings/local.js)):

- `requireClientToken` — If true, unauthenticated handshakes are rejected.
- `clientToken` — Shared secret (use a long random value).

**Client may send the token** as:

- Query param on the WS URL: `?token=...` or `?clientToken=...`
- Header: `Authorization: Bearer <token>`
- Subprotocol: entry `fabric.token.<urlencoded-token>` in `Sec-WebSocket-Protocol`

**Browser:** set `window.FABRIC_WS_CLIENT_TOKEN` before the Bridge connects.

Environment wiring:

- `FABRIC_WS_REQUIRE_TOKEN=1`
- `FABRIC_WS_CLIENT_TOKEN=<secret>`

## Hub → client fanout

`broadcast(message)` in `@fabric/http` sends **`message.toBuffer()`** to every WebSocket connection. There is no per-client routing in the base server; all attached browser tabs receive the same Fabric frames. Filter in the Bridge if you introduce operator-only types.

For **targeted** delivery, use **JSON-RPC** responses to the calling client, or future outer types with routing metadata once defined.

## Payjoin (BIP 78 sync + BIP 77 experimental mailbox)
[Async Payjoin (BIP 77)](https://payjoin.org/docs/how-it-works/payjoin-v2-bip-77) keeps the same PSBT exchange shape as v1 but moves delivery through a **Payjoin Directory** (mailbox + HPKE) and uses **Oblivious HTTP (OHTTP)** so the directory does not learn client IP metadata alongside payloads.

**Today on Hub:**
- **BIP78 (active):** deposit sessions emit absolute BIP21 `pj=` URLs; clients `POST` PSBT as `text/plain` to `…/sessions/:id/proposals` and receive a `text/plain` payjoined PSBT (optional Hub ACP co-input). JSON `{ psbt }` remains for Hub UI/RPC.
- **BIP77 (experimental, Hub-local):** opaque mailboxes under `…/mailboxes` (`enqueue` / `poll` / `markDelivered`), mirroring CONTRACT_MESSAGE queue semantics. **`markDelivered` is a delivery sidecar only** — not Payjoin settlement and not ARC `MessageReceipt`. Not a public directory + HPKE + OHTTP stack yet (see capabilities `fabricProtocol.receiver.roadmapModes`).

Prefer push drain (Peer / WebRTC) as a later upgrade; HTTP poll is the current fallback (same order as application DeliverySync).

**WebRTC relay:** `RelayFromWebRTC` may forward selected inner types inside `P2P_RELAY` so mesh participants can reach the hub’s Fabric P2P fan-out path. Allow-list includes `P2P_CHAT_MESSAGE`, peer gossip/offer/alias, `fabric-message`, **`CONTRACT_MESSAGE`** (author-signed AMP — GroupChat / MessageReceived / MessageReceipt), and `BitcoinBlock`. Prefer **binary** `Message.toBuffer()` on `RTCDataChannel`; Hub preserves author signatures when `original` is base64 AMP (`functions/fabricWebRtcP2pRelay.js`).

**MessageReceipt / 2PC receipts:** Hub may **queue and relay** author-signed `CONTRACT_MESSAGE` bytes (including `MessageReceipt` bodies) without opening seals. BIP340 `receiptSig` verification and `markReceipt` live in `@fabric/core` `contractMessageCommit` and are applied by **participants** (downstream apps) when folding tips — not by Hub enqueue/drain. Hub `markDelivered` on the opaque queue is a per-peer delivery sidecar only; it is not a MessageReceipt.

## Application namespaces (Hub ↔ applications)

Canonical model in **`@fabric/core`** — [docs/APPLICATION_NAMESPACES.md](https://github.com/FabricLabs/fabric/blob/master/docs/APPLICATION_NAMESPACES.md) and `functions/applicationNamespaces.js`.

| Layer | Outer type | Hub behavior |
|-------|------------|--------------|
| Global shoutbox | `P2P_CHAT_MESSAGE` | `SubmitChatMessage` / peer `chat` → mesh; WS UI may still fan out as `ChatMessage` (legacy 0x67) |
| Namespace declare | `CONTRACT_PUBLISH` (`P2P_CONTRACT_PUBLISH`) | Peer relays; Hub records `ContractPublish` once per contract id |
| Namespace events | `CONTRACT_MESSAGE` (`P2P_CONTRACT_MESSAGE`) | Peer relays; Hub counts in memory (does **not** append each to the Fabric log) |
| Shared body types | see `APPLICATION_CONTRACT_BODY_TYPES` in [`fabricMessageRegistry.js`](functions/fabricMessageRegistry.js) | Federation invites, GroupChat / GroupShare, etc. |

**Policy:** New mesh features use these outer types — not new per-app opcodes. App semantics live in `CONTRACT_MESSAGE` body `type` under a published contract id. Apps ignore unknown namespaces.

## Related

- [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md) — value-transfer messaging policy.
- [AGENTS.md](AGENTS.md) — RPC and Bridge events.
- `@fabric/core` [APPLICATION_NAMESPACES.md](https://github.com/FabricLabs/fabric/blob/master/docs/APPLICATION_NAMESPACES.md) — common type set.
