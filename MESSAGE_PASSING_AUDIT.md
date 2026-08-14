# Message Passing Flow Audit

## Executive Summary

This audit traces the message passing flow from client load through WebSocket bridge, WebRTC peer connections, and message relay. **Finding: Messages received via WebRTC data channel are NOT relayed to the WebSocket bridge.** The hub has no RPC method for clients to relay WebRTC-originated messages, and the Bridge does not call any such method when it receives messages over WebRTC.

---

## 1. Client Load and Connection Flow

### 1.1 Client Load
- **Entry**: `scripts/browser.js` → Webpack bundle
- **UI**: `components/HubInterface.js` composes `Bridge.js` and other views
- **Bridge**: `components/Bridge.js` manages WebSocket + WebRTC

### 1.2 WebSocket Bridge Connection
- **Connect**: `Bridge.connect()` → `new WebSocket(wsUrl)` → `this.ws.onmessage = this.onSocketMessage.bind(this)`
- **Registration**: On open, Bridge flushes `_jsonRpcQueue` and sends `RegisterWebRTCPeer` (if peerId set)
- **Initial state**: Hub pushes `GetNetworkStatus` response, `JSONPatch` for global state, `ListWebRTCPeers` results

### 1.3 WebRTC Peer Discovery and Connection
- **Discovery**: `discoverAndConnectToPeers()` calls `ListWebRTCPeers` RPC, filters by `webrtcCandidateMaxAgeMs`
- **Signaling**: `SendWebRTCSignal` RPC relays offer/answer/ICE between browser clients; hub broadcasts to all, Bridge filters by `toPeerId`
- **Data channel**: `_attachDataChannelHandlers(peerId, dc)` sets `dc.onmessage = (ev) => this.handleWebRTCPeerMessage(peerId, ev.data)`

---

## 2. Message Sending Paths

### 2.1 Client → Bridge (WebSocket)
- **SubmitChatMessage**: Bridge calls `sendSubmitChatMessageRequest()` → JSON-RPC `SubmitChatMessage` → hub
- **Hub**: `hub.js:2505` creates `ChatMessage` and `P2P_CHAT_MESSAGE`, broadcasts to WebSocket clients, relays to Fabric P2P via `relayFrom('_client', p2pMsg)`

### 2.2 Client → WebRTC Peers
- **P2P_CHAT_MESSAGE**: `_broadcastChatToWebRTCPeersOnly()` or `broadcastToWebRTCPeersWithRecipients({ type: 'P2P_CHAT_MESSAGE', actor, object })`
- **sendToWebRTCPeer(peerId, data)**: Sends over WebRTC data channel

### 2.3 Client → Bridge (WebSocket) + WebRTC
- **preferWebRTCChat**: `sendSubmitChatMessageRequest()` fans out to WebRTC peers AND calls hub `SubmitChatMessage` RPC

---

## 3. Message Reception Paths

### 3.1 WebSocket → Client
- **onSocketMessage**: Parses `Message.fromBuffer()`, switches on `message.type`
- **ChatMessage**: `Bridge.js:2287` parses body, updates `globalState.messages`, fires `globalStateUpdate`
- **JSONPatch**: `updateGlobalState(patchData)`

### 3.2 WebRTC Data Channel → Client
- **dc.onmessage** → `handleWebRTCPeerMessage(peerId, ev.data)`
- **P2P_CHAT_MESSAGE**: Updates `globalState.messages`, fires `globalStateUpdate`, `_persistMessages`, wraps in P2P_RELAY envelope and relays via RelayFromWebRTC
- **ping/pong**: Handled locally; pong updates `peerInfo.lastSeen`
- **default**: Falls through to `handleWebRTCMessage(payload)` which handles `fabric-message` (base64 Fabric message) or passes through to `onSocketMessage`

---

## 4. Relay Gap: WebRTC → Bridge

### 4.1 Current Behavior
When a client receives a `P2P_CHAT_MESSAGE` over the WebRTC data channel:

1. `handleWebRTCPeerMessage` processes it
2. Updates local `globalState.messages`
3. **Does NOT** call any hub RPC to relay the message
4. **Does NOT** forward to other WebSocket clients
5. **Does NOT** forward to Fabric P2P peers

### 4.2 Required Behavior (per user)
> Messages received via WebRTC should be relayed on to the WebSocket bridge if they meet the relay requirements.

### 4.3 Hub RPC Methods (relevant)
| Method | Purpose |
|--------|---------|
| `SubmitChatMessage` | Client-originated broadcast |
| `SendWebRTCSignal` | WebRTC signaling only (offer/answer/ICE) |
| `SendPeerMessage` | Send to specific Fabric P2P peer |

**There is no `RelayFromWebRTC` or equivalent.** The hub cannot receive WebRTC-originated messages from clients for relay.

### 4.4 Relay Requirements (from Fabric Protocol)
- **FABRIC_MESSAGE_RELAY_BEHAVIOR.md**: `CHAT_MESSAGE` / `P2P_CHAT_MESSAGE` should be relayed
- **fabric/types/peer.js:832**: On `P2P_CHAT_MESSAGE`, agent emits `chat` and `relayFrom(origin, ...)` to other P2P peers
- **hub.js:3430**: `agent.on('chat')` broadcasts `ChatMessage` to WebSocket clients

So for WebRTC-originated chat:
- **Relay requirement**: `P2P_CHAT_MESSAGE` wrapped in `P2P_RELAY` envelope (preserves original + signature for onion routing) relayed to WebSocket clients and Fabric P2P
- **Validation**: Same structure as `P2P_CHAT_MESSAGE` (actor, object.content, created, etc.)

---

## 5. Protocol Flow Summary

### 5.1 Working Paths
```
Client → SubmitChatMessage RPC → Hub → broadcast(ChatMessage) → all WebSocket clients
Client → SubmitChatMessage RPC → Hub → agent.relayFrom(P2P_CHAT_MESSAGE) → Fabric P2P peers
Fabric P2P → P2P_CHAT_MESSAGE → Hub agent → emit('chat') → broadcast(ChatMessage) → WebSocket clients
Client → P2P_CHAT_MESSAGE → WebRTC data channel → other WebRTC peers (mesh only)
```

### 5.2 Missing Path
```
Client A → P2P_CHAT_MESSAGE → WebRTC → Client B
  → Client B wraps in P2P_RELAY envelope (preserves original) → RelayFromWebRTC → Hub
  → Hub broadcasts P2P_RELAY to all WebSocket clients and Fabric P2P peers
```

---

## 6. Files Reviewed

| File | Role |
|------|------|
| `components/Bridge.js` | WebSocket + WebRTC client; `handleWebRTCPeerMessage`, `handleWebRTCMessage`, `sendSubmitChatMessageRequest` |
| `services/hub.js` | RPC methods, `SubmitChatMessage`, `SendWebRTCSignal`, `agent.on('chat')` broadcast |
| `fabric-http/MESSAGE_PROTOCOL_REPORT.md` | Message creation/parsing, broadcast mechanisms |
| `fabric/FABRIC_MESSAGE_RELAY_BEHAVIOR.md` | Relay types, `shouldRelay` logic |
| `fabric/types/peer.js` | `_handleGenericMessage` handling `P2P_CHAT_MESSAGE`, `relayFrom` |

---

## 7. Recommendations

### 7.1 Add Hub RPC: `RelayFromWebRTC`
- **Params**: `{ fromPeerId, envelope }` where `envelope` is `{ original, originalType, hops }` (preserves original message + signature)
- **Validation**: Check message type is in relay whitelist; validate structure (actor, object.content, created)
- **Hub behavior**: Broadcast `ChatMessage` to WebSocket clients; optionally relay `P2P_CHAT_MESSAGE` to Fabric P2P via `relayFrom('_webrtc', ...)`

### 7.2 Bridge: Relay WebRTC Messages on Receive
- In `handleWebRTCPeerMessage`, after handling `P2P_CHAT_MESSAGE` locally:
  - If WebSocket connected: wrap in P2P_RELAY envelope and call `RelayFromWebRTC` with `{ fromPeerId, envelope }`
- Ensure no duplicate relay (e.g. if client already received this via hub broadcast)

### 7.3 Relay Requirements (Whitelist)
- `P2P_CHAT_MESSAGE` → wrap in P2P_RELAY envelope, broadcast relay message (preserves original)
- `fabric-message` (base64 Fabric Message) → decode, validate type, relay if in relay whitelist
- Consider `P2P_FILE_SEND` if file transfer over WebRTC is ever added

### 7.4 Deduplication
- Use `clientId` or similar to avoid re-broadcasting messages the hub already sent (e.g. from SubmitChatMessage)
- Hub could track recently relayed message hashes to avoid echo loops

---

## 8. Implementation (Completed)

1. **P2P_RELAY type** — Mesh flood envelope; preserves original message + signature for WebRTC/Hub fan-out (not directed IP-hiding onion).
2. **RelayFromWebRTC RPC** — Accepts `{ fromPeerId, envelope }` where `envelope` is `{ original, originalType, hops }`. Broadcasts `P2P_RELAY` to WebSocket clients and Fabric P2P peers.
3. **Bridge** — Uses `P2P_CHAT_MESSAGE` (not webrtc-chat); wraps in P2P_RELAY envelope when relaying; handles incoming P2P_RELAY by unwrapping and displaying inner message. **`P2P_FORWARD` is ignored on WS** (TCP Peer / `SendOnion` only).
4. **P2P_FORWARD / SendOnion** — Directed onion hops in `@fabric/core` (`fabricOnion` + `Peer#sendOnion`); Hub registers opcode 69 and exposes `SendOnion` JSON-RPC.

## 9. Remaining Next Steps

1. Add tests for WebRTC → bridge relay (e.g. extend `verify-webrtc-chat-e2e.js`)
2. Consider deduplication by message hash if echo loops are observed
