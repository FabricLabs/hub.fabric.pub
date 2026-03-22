## Classes

<dl>
<dt><a href="#Hub">Hub</a></dt>
<dd><p>Defines the Hub service, known as <code>@fabric/hub</code> within the network.</p>
<p>NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket <code>JSONCall</code>
and HTTP <code>POST /services/rpc</code>) without authentication. It is intended to run in
trusted or development environments. Do not expose a Hub instance
directly to untrusted networks without an appropriate proxy, firewall,
or additional auth layer in front of it.</p>
</dd>
</dl>

## Members

<dl>
<dt><a href="#fabricPeerId">fabricPeerId</a></dt>
<dd><p>Stable Fabric P2P identity (secp256k1 pubkey hex) for sharing — does not change with contract state.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#INVENTORY_FILE_RELAY_TTL">INVENTORY_FILE_RELAY_TTL</a></dt>
<dd><p>Max Fabric hops for relayed P2P_FILE_SEND chunks (per chunk, decremented each forward).</p>
</dd>
</dl>

<a name="Hub"></a>

## Hub
Defines the Hub service, known as `@fabric/hub` within the network.

NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket `JSONCall`
and HTTP `POST /services/rpc`) without authentication. It is intended to run in
trusted or development environments. Do not expose a Hub instance
directly to untrusted networks without an appropriate proxy, firewall,
or additional auth layer in front of it.

**Kind**: global class  

* [Hub](#Hub)
    * [new Hub([settings])](#new_Hub_new)
    * [._inventoryHtlcById](#Hub+_inventoryHtlcById) : <code>Map.&lt;string, Object&gt;</code>
    * [._validateDocumentSize(buf)](#Hub+_validateDocumentSize) ⇒ <code>Object</code> \| <code>null</code>
    * [._normalizePeerInput()](#Hub+_normalizePeerInput)
    * [._resolvePeerAddress()](#Hub+_resolvePeerAddress)
    * [._originConnectionIsFabricPeer()](#Hub+_originConnectionIsFabricPeer)
    * [._connectPeer()](#Hub+_connectPeer)
    * [._disconnectPeer()](#Hub+_disconnectPeer)
    * [._sendVectorToPeer()](#Hub+_sendVectorToPeer)
    * [.commit()](#Hub+commit)
    * [.recordActivity(activity)](#Hub+recordActivity) ⇒ <code>Object</code> \| <code>null</code>
    * [._voutPayeeAddresses(bitcoin, txid, address, amountSats)](#Hub+_voutPayeeAddresses) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [._l1PaymentVerificationDetail()](#Hub+_l1PaymentVerificationDetail) ⇒ <code>Object</code>
    * [._l1TxChainStatusBatch()](#Hub+_l1TxChainStatusBatch) ⇒ <code>Object.&lt;string, {confirmations: (number\|null), inMempool: boolean}&gt;</code>
    * [._mergePersistedTxLabel(txid, type, [meta])](#Hub+_mergePersistedTxLabel)
    * [._collectFabricTxLabelMap()](#Hub+_collectFabricTxLabelMap) ⇒ <code>Object.&lt;string, {types: Array.&lt;string&gt;, meta: object}&gt;</code>
    * [._sendDocumentToPeerAddress(address, docOrId, [fileRelayMeta])](#Hub+_sendDocumentToPeerAddress) ⇒ <code>Promise.&lt;{status: string, document: (Object\|undefined), message: (string\|undefined)}&gt;</code>
    * [._getInventoryHtlcSellerReveal(body)](#Hub+_getInventoryHtlcSellerReveal)
    * [._claimInventoryHtlcOnChain()](#Hub+_claimInventoryHtlcOnChain)
    * [._jsonOnly()](#Hub+_jsonOnly)
    * [._sanitizeBitcoinStatusForPublic()](#Hub+_sanitizeBitcoinStatusForPublic)
    * [._handleBitcoinBlockUpdate()](#Hub+_handleBitcoinBlockUpdate)
    * [._normalizeXpubForNetwork()](#Hub+_normalizeXpubForNetwork)
    * [._handleBitcoinAddressInfoRequest()](#Hub+_handleBitcoinAddressInfoRequest)
    * [._handleBitcoinAddressBalanceRequest()](#Hub+_handleBitcoinAddressBalanceRequest)
    * [._handleBitcoinWalletTransactionsRequest()](#Hub+_handleBitcoinWalletTransactionsRequest)
    * [.start()](#Hub+start) ⇒ [<code>Hub</code>](#Hub)
    * [.stop()](#Hub+stop) ⇒ [<code>Hub</code>](#Hub)

<a name="new_Hub_new"></a>

### new Hub([settings])
Create an instance of the [Hub](#Hub) service.

**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Hub instance. |

<a name="Hub+_inventoryHtlcById"></a>

### hub.\_inventoryHtlcById : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_validateDocumentSize"></a>

### hub.\_validateDocumentSize(buf) ⇒ <code>Object</code> \| <code>null</code>
Validate document/file buffer size. Returns error object or null if valid.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| buf | <code>Buffer</code> \| <code>Uint8Array</code> | 

<a name="Hub+_normalizePeerInput"></a>

### hub.\_normalizePeerInput()
Normalize and validate an incoming peer address or id-style input.
Returns `{ idOrAddress, address }` where `address` may be `null` if
resolution is deferred to the Peer implementation.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_resolvePeerAddress"></a>

### hub.\_resolvePeerAddress()
Best-effort conversion to a concrete `host:port` address, falling back
to the original value when the agent does not expose a resolver.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_originConnectionIsFabricPeer"></a>

### hub.\_originConnectionIsFabricPeer()
True when the Fabric session at `connectionAddress` belongs to `fabricPeerId`
(so P2P_FILE_SEND can use that connection for inventory HTLC phase 2).
Relay hops do not satisfy this — use `requesterFabricId` + direct peering instead.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_connectPeer"></a>

### hub.\_connectPeer()
Connect to a peer via the underlying Peer implementation, enforcing
basic input validation and normalization.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_disconnectPeer"></a>

### hub.\_disconnectPeer()
Disconnect from a peer by id or address.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_sendVectorToPeer"></a>

### hub.\_sendVectorToPeer()
Low-level send of a Message vector to a specific peer connection.
Vector is `[type, JSON.stringify(payload)]`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+commit"></a>

### hub.commit()
Finalizes the current state.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+recordActivity"></a>

### hub.recordActivity(activity) ⇒ <code>Object</code> \| <code>null</code>
Record an ActivityStreams-style activity and broadcast it to UI clients.

Activities are stored in-memory under `this._state.messages` and sent to
browsers via a `JSONPatch` message that updates `globalState.messages`
on the Bridge. This powers the Activity log / ActivityStream UI.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| activity | <code>Object</code> | Base activity object; minimally `{ type, object }`. |

<a name="Hub+_voutPayeeAddresses"></a>

### hub.\_voutPayeeAddresses(bitcoin, txid, address, amountSats) ⇒ <code>Promise.&lt;boolean&gt;</code>
Verify that a transaction pays at least amountSats to the given address.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| bitcoin | <code>Object</code> | Bitcoin service instance |
| txid | <code>string</code> | Transaction ID |
| address | <code>string</code> | Expected recipient address |
| amountSats | <code>number</code> | Minimum amount in satoshis |

<a name="Hub+_l1PaymentVerificationDetail"></a>

### hub.\_l1PaymentVerificationDetail() ⇒ <code>Object</code>
Inspect whether a tx pays `address` at least `amountSats`, and return confirmation depth.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_l1TxChainStatusBatch"></a>

### hub.\_l1TxChainStatusBatch() ⇒ <code>Object.&lt;string, {confirmations: (number\|null), inMempool: boolean}&gt;</code>
Confirmation depth + mempool membership for txids (one getrawmempool, parallel getrawtransaction).
Used for document list / status without per-row mempool RPC.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_mergePersistedTxLabel"></a>

### hub.\_mergePersistedTxLabel(txid, type, [meta])
Persist a txid → Fabric contract-flow label (survives restarts). Merged into wallet transaction lists.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| txid | <code>string</code> |  |
| type | <code>string</code> | machine id (see `functions/txContractLabels.js`) |
| [meta] | <code>object</code> |  |

<a name="Hub+_collectFabricTxLabelMap"></a>

### hub.\_collectFabricTxLabelMap() ⇒ <code>Object.&lt;string, {types: Array.&lt;string&gt;, meta: object}&gt;</code>
Build lower-case txid → { types, meta } from disk + in-memory Hub state (contracts, HTLC, Payjoin).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_sendDocumentToPeerAddress"></a>

### hub.\_sendDocumentToPeerAddress(address, docOrId, [fileRelayMeta]) ⇒ <code>Promise.&lt;{status: string, document: (Object\|undefined), message: (string\|undefined)}&gt;</code>
Send document bytes to a connected peer (P2P_FILE_SEND chunks).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| address | <code>string</code> |  | Peer connection key (host:port) — immediate next hop. |
| docOrId | <code>string</code> \| <code>Object</code> |  | Document id or in-memory `{ id, contentBase64, ... }`. |
| [fileRelayMeta] | <code>Object</code> \| <code>null</code> | <code></code> | When set, each chunk includes `deliveryFabricId` / `fileRelayTtl` so intermediaries can forward (HTLC phase 2 over a relay). |

<a name="Hub+_getInventoryHtlcSellerReveal"></a>

### hub.\_getInventoryHtlcSellerReveal(body)
Admin-only: preimage + scripts for seller on-chain claim tooling (see INVENTORY_HTLC_ONCHAIN.md).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>Object</code> | { settlementId, adminToken|token } |

<a name="Hub+_claimInventoryHtlcOnChain"></a>

### hub.\_claimInventoryHtlcOnChain()
Admin-only: build, sign (hub Fabric identity key), and broadcast seller claim for a funded inventory HTLC.
Params: { settlementId, adminToken|token, toAddress?, destinationAddress?, feeSats? }

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_jsonOnly"></a>

### hub.\_jsonOnly()
Always return JSON (no Accept negotiation). Use for API-only routes like /settings.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_sanitizeBitcoinStatusForPublic"></a>

### hub.\_sanitizeBitcoinStatusForPublic()
Returns minimal public Bitcoin status for global state / GetNetworkStatus.
Excludes balance, beacon, blockchain, networkInfo, mempoolInfo, recentBlocks, recentTransactions.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinBlockUpdate"></a>

### hub.\_handleBitcoinBlockUpdate()
Called when the Bitcoin service receives a new block via ZMQ.
Updates global state, appends a commit message to the Fabric chain, and broadcasts a JSON Patch to all WebSocket clients.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_normalizeXpubForNetwork"></a>

### hub.\_normalizeXpubForNetwork()
Normalize xpub version bytes for the given network (regtest/testnet use testnet bytes).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinAddressInfoRequest"></a>

### hub.\_handleBitcoinAddressInfoRequest()
Full address info for explorer: balance, unspents, recent txids.
Compatible with Fabric CLI and Blockstream-style chain_stats/mempool_stats.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinAddressBalanceRequest"></a>

### hub.\_handleBitcoinAddressBalanceRequest()
Look up balance for a single address. Server does not hold keys; uses scantxoutset.
Requires txindex. Works for any on-chain address.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinWalletTransactionsRequest"></a>

### hub.\_handleBitcoinWalletTransactionsRequest()
List transactions for a wallet. For client wallet (xpub), uses scantxoutset to find
UTXOs, extracts txids, fetches full tx data. Returns receive transactions (txs that
created our UTXOs). Requires txindex for getrawtransaction.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+start"></a>

### hub.start() ⇒ [<code>Hub</code>](#Hub)
Start the instance.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  
<a name="Hub+stop"></a>

### hub.stop() ⇒ [<code>Hub</code>](#Hub)
Stop the instance.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  
<a name="fabricPeerId"></a>

## fabricPeerId
Stable Fabric P2P identity (secp256k1 pubkey hex) for sharing — does not change with contract state.

**Kind**: global variable  
<a name="INVENTORY_FILE_RELAY_TTL"></a>

## INVENTORY\_FILE\_RELAY\_TTL
Max Fabric hops for relayed P2P_FILE_SEND chunks (per chunk, decremented each forward).

**Kind**: global constant  
