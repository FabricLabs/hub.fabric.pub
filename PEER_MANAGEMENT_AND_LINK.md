# Peer Management Across Fabric Projects & Local Linking

Overview of the three repos and how peer management flows between them, plus how to test **@fabric/core** changes in **@fabric/hub** without publishing.

---

## The Three Projects

| Project       | Package       | Role |
|--------------|---------------|------|
| **fabric**   | `@fabric/core` | Core P2P runtime: Peer type, NOISE handshake, connections, `publicPeers`, messaging. |
| **fabric-http** | `@fabric/http` | HTTP/WS server and browser tooling; can use Fabric types and has its own peer UI components. |
| **hub.fabric.pub** | `@fabric/hub` | Hub app: server (Hub service + Peer agent) + browser UI (Bridge, Dashboard). Depends on `@fabric/http` (which depends on `@fabric/core`). |

---

## Peer Management Flow

### 1. @fabric/core (fabric repo)

- **Connections vs Peers**
  - **Connections** are tracked by **IP:port** (address). One socket per connection endpoint; keys are `host:port` (e.g. `127.0.0.1:54321`). Stored in `this.connections`.
  - **Peers** are tracked by **public key** (id). One logical identity per peer; registry keyed by id in `_state.peers`. When the same peer reconnects from a different port, the connection entry (address) is updated; the peer (id) stays the same.
  - **`_addressToId`** maps current connection address → peer id for routing (e.g. send message to peer id → resolve to current address → use that socket).
- **`types/peer.js`** – Defines the **Peer** class (extends Service):
  - **TCP + NOISE**: `net.createServer` + `noise-protocol-stream`, listen on `port` (default 7777).
  - **State**: `this.connections` (by address), `_state.peers` (by id), `this.peers`, `this.actors`; handshake and message handling in `_handleFabricMessage` / `_handleGenericMessage`.
  - **Public API**: `connectTo(address)`, `broadcast()`, `listen()`, **`publicPeers`** / **`knownPeers`** getters (id + address + status).
  - **Start**: `settings.peers` array is iterated and `_connect(candidate)` is called for each.
- **Key peer surface**: `publicPeers` / `knownPeers` (array of `{ id, address, status, lastMessage? }`), `_connect()`, `_registerNOISEClient`, P2P_SESSION_OFFER/OPEN, P2P_PING/PONG, P2P_PEER_ANNOUNCE.

### 2. @fabric/http (fabric-http repo)

- Depends on **@fabric/core** (e.g. git ref).
- **Components**: `FabricPeerList.js`, `peer-list.js`, `peer-view.js` – UI over peer/connection state.
- **Server**: Can run a Fabric-backed server; peer state ultimately comes from a Peer (or similar) from core.

### 3. @fabric/hub (hub.fabric.pub repo)

- **Server (Node)**
  - **`services/hub.js`**:
    - Creates **`this.agent = new Peer(this.settings)`** from `@fabric/core/types/peer`.
    - Registers RPC methods on the HTTP/WS stack: **`AddPeer`** (calls `this.agent._connect(peer.address)`), **`GetNetworkStatus`**, **`ListPeers`** (both use **`this.agent.publicPeers`**).
    - On start: `await this.agent.start()` → Peer listens and connects to `settings.peers`.
  - **REST**:
    - `GET /services/peering` + `GET /services/peering/attestation` are the live peering HTTP surface.
    - `/peers` and `/peers/:id` are now handled by `@fabric/http` Resource routing (schema-driven CRUD semantics), not legacy route stubs.

- **Browser (Bridge)**
  - **`components/Bridge.js`**:
    - WebSocket to hub server + **PeerJS** (WebRTC) for signaling.
    - Uses **`@fabric/core/types/message`** and **`@fabric/core/types/key`** for signing/protocol.
    - Gets network state (including peers) via the server RPC (e.g. GetNetworkStatus / ListPeers), not by running a Node Peer in the browser.

So: **peer list and connection management live in @fabric/core (Peer)**; **hub server** is the single Node process that runs that Peer and exposes it over REST and WebSocket RPC; the **hub UI** talks to the server, not to a browser-side Peer.

---

## Testing @fabric/core in the Hub Without Publishing

To try changes in **fabric** (e.g. `types/peer.js`) in the **hub** app without committing or publishing:

1. **Link @fabric/core from the hub**
   - From **fabric** (where `package.json` has `"name": "@fabric/core"`):
     ```bash
     cd /path/to/fabric
     npm link
     ```
   - From **hub**:
     ```bash
     cd /path/to/hub.fabric.pub
     npm link @fabric/core
     ```
   - This makes `hub.fabric.pub/node_modules/@fabric/core` point at your local **fabric** clone. The hub server and webpack (browser bundle) both resolve **@fabric/core** from there.

2. **Optional: add @fabric/core to hub’s package.json**
   - So the dependency is explicit and `npm install` doesn’t drop the link:
   - In **hub.fabric.pub/package.json** you can add under `dependencies`:
     ```json
     "@fabric/core": "link:../fabric"
     ```
   - Or keep using **npm link** only (no commit of that line). If you use `link:../fabric`, ensure the path is correct relative to hub’s root.

3. **Run hub and verify**
   - Start the hub (e.g. `npm start` or your usual command). The server loads **Peer** from `node_modules/@fabric/core` (your linked copy).
   - Rebuild or run the dev server for the UI; the bundle will also use the linked **@fabric/core** (e.g. Message, Key in Bridge).
   - Change **fabric** (e.g. peer logic or types), restart hub server / refresh UI as needed; no publish step.

4. **Unlink when done**
   - In hub: `npm unlink @fabric/core`
   - In fabric: `npm unlink` (if you want to remove the global link).

**Quick reference (from repo roots):**
```bash
# In fabric
cd /path/to/fabric && npm link

# In hub
cd /path/to/hub.fabric.pub && npm link @fabric/core

# Run hub (server + UI)
npm run dev   # or npm start
```

You do **not** need to add `@fabric/core` to hub’s `package.json` for `npm link` to work; the link overrides the transitive dependency from `@fabric/http`. To lock a local path without using the global link, you can add `"@fabric/core": "link:../fabric"` to hub’s dependencies (adjust path if your repos are not siblings).

**If the bundle fails** with `__webpack_modules__[moduleId].call is not a function` (e.g. in `readable-stream`, `hash-base`, `md5.js`), the hub’s webpack is already configured to prefer the hub’s `node_modules` for resolution (`resolve.modules`), so the linked core and its dependencies use the same copies as the rest of the app. If the error persists, run `npm install` in the hub so all transitive deps are present in the hub’s `node_modules`, then rebuild.

---

## Summary

- **Peer implementation**: **@fabric/core** `types/peer.js`.
- **Hub server**: One **Peer** instance (`this.agent`), exposed via **GetNetworkStatus** / **ListPeers** and peering HTTP endpoints under **`/services/peering`**.
- **Hub UI**: Uses **@fabric/core** (Message, Key) in the browser; peer list comes from the server.
- **Local testing**: `npm link` from fabric, then `npm link @fabric/core` in hub (and optionally `"@fabric/core": "link:../fabric"` in hub’s package.json).
