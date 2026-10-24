## Classes

<dl>
<dt><a href="#Hub">Hub</a></dt>
<dd><p>Defines the Hub service, known as <code>@fabric/hub</code> within the network.</p>
<p>NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket JSONCall
and HTTP <code>POST /services/rpc</code>) without authentication. It is intended to run in
trusted or development environments. Do not expose a Hub instance
directly to untrusted networks without an appropriate proxy, firewall,
or additional auth layer in front of it.</p>
</dd>
</dl>

## Members

<dl>
<dt><a href="#documents">documents</a></dt>
<dd><p>Optional Document Market: persist peer inventories and republish held files at a markup.
Off by default. See <code>functions/documentInventoryMarket.js</code>.</p>
</dd>
<dt><a href="#fabricPeerId">fabricPeerId</a></dt>
<dd><p>Stable Fabric P2P identity (secp256k1 pubkey hex) for sharing — does not change with contract state.</p>
</dd>
<dt><a href="#bitcoin">bitcoin</a></dt>
<dd><p>Wallet-safe Bitcoin head (height, tip hash, network, mempool counts) for operator UIs (e.g. Peers).</p>
</dd>
<dt><a href="#email">email</a></dt>
<dd><p>Outbound email (invitations / alerts); no secrets in this snapshot.</p>
</dd>
<dt><a href="#bandwidth">bandwidth</a></dt>
<dd><p>Fabric P2P byte counters vs Bitcoin L1 (1 MiB / 10 min) split across 32 peers.</p>
</dd>
<dt><a href="#featureFlags">featureFlags</a></dt>
<dd><p>Server process FEATURE_FLAGS (see constants.js / FABRIC_FEATURE_*).</p>
</dd>
<dt><a href="#documentMarket">documentMarket</a></dt>
<dd><p>Optional Document Market (peer inventory book + markup republish). Off by default.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#_rpcHttpLocalStore">_rpcHttpLocalStore</a></dt>
<dd><p>Per-request loopback flag for HTTP JSON-RPC (avoids racing a Hub instance field).</p>
</dd>
<dt><a href="#HUB_PARENT_CHAIN_SKIP">HUB_PARENT_CHAIN_SKIP</a></dt>
<dd><p>Ping/pong keep genesis parent. Durable Hub log frames (including GENESIS_MESSAGE) chain AMP <code>parent</code>.</p>
</dd>
<dt><a href="#BITCOIN_TX_DOC_INDEX_MAX_TXS">BITCOIN_TX_DOC_INDEX_MAX_TXS</a></dt>
<dd><p>Skip per-tx Fabric documents when a block has more than this many txs (mainnet safety).</p>
</dd>
<dt><a href="#HUB_SELF_DESTRUCT_CONFIRM_PHRASE">HUB_SELF_DESTRUCT_CONFIRM_PHRASE</a></dt>
<dd><p>Body field <code>confirmPhrase</code> for <a href="Hub#_handleSettingsSelfDestructRequest">Hub#_handleSettingsSelfDestructRequest</a> must match exactly (admin-only).
Wipes writable <code>stores/</code> and <code>logs/</code> under <a href="#hubStoreRoot">hubStoreRoot</a> after <a href="#Hub+stop">stop</a>.</p>
</dd>
<dt><a href="#INVENTORY_FILE_RELAY_TTL">INVENTORY_FILE_RELAY_TTL</a></dt>
<dd><p>Max Fabric hops for relayed P2P_FILE_SEND chunks (per chunk, decremented each forward).</p>
</dd>
<dt><a href="#WEBRTC_RELAY_MAX_HOPS">WEBRTC_RELAY_MAX_HOPS</a></dt>
<dd><p>Max WebRTC→Fabric relay hops (envelope.hops length) before refusing to fan out.</p>
</dd>
<dt><a href="#WEBRTC_RELAY_MAX_PER_SEC">WEBRTC_RELAY_MAX_PER_SEC</a></dt>
<dd><p>Per WebRTC peer id: max RelayFromWebRTC fan-outs per second (DoS guard).</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#hubAssetsDir">hubAssetsDir()</a></dt>
<dd><p>Read-only static root (see <code>resolveAppAssetsDir</code> on <code>@fabric/http</code>).</p>
</dd>
<dt><a href="#hubStoreRoot">hubStoreRoot()</a></dt>
<dd><p>Writable store root (Electron: FABRIC_HUB_USER_DATA).</p>
</dd>
<dt><a href="#resolveStorePath">resolveStorePath(p)</a> ⇒ <code>string</code></dt>
<dd><p>Resolve an absolute path under the writable store root.</p>
</dd>
<dt><a href="#payjoinContributionFlag">payjoinContributionFlag()</a></dt>
<dd><p><code>receiverContribution</code> (or legacy <code>autoAcpBoost</code>) from a request body; undefined = service default.</p>
</dd>
</dl>

<a name="Hub"></a>

## Hub
Defines the Hub service, known as `@fabric/hub` within the network.

NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket JSONCall
and HTTP `POST /services/rpc`) without authentication. It is intended to run in
trusted or development environments. Do not expose a Hub instance
directly to untrusted networks without an appropriate proxy, firewall,
or additional auth layer in front of it.

**Kind**: global class  

* [Hub](#Hub)
    * [new Hub([settings])](#new_Hub_new)
    * [._webrtcRelayRate](#Hub+_webrtcRelayRate)
    * [._bitcoinScanInflight](#Hub+_bitcoinScanInflight)
    * [._lastBitcoinBlockActivityTip](#Hub+_lastBitcoinBlockActivityTip)
    * [._bitcoinBlockTips](#Hub+_bitcoinBlockTips)
    * [._mainchainInventoryRequestCooldown](#Hub+_mainchainInventoryRequestCooldown)
    * [._pendingMainchainBlockSyncRequests](#Hub+_pendingMainchainBlockSyncRequests)
    * [._heapTelemetryTimer](#Hub+_heapTelemetryTimer) : <code>NodeJS.Timeout</code>
    * [._lastStateWriteBytes](#Hub+_lastStateWriteBytes)
    * [._inventoryHtlcById](#Hub+_inventoryHtlcById) : <code>Map.&lt;string, Object&gt;</code>
    * [._crowdfundingCampaigns](#Hub+_crowdfundingCampaigns) : <code>Map.&lt;string, Object&gt;</code>
    * [._desktopAuthSessions](#Hub+_desktopAuthSessions) : <code>Map.&lt;string, Object&gt;</code>
    * [._deviceLinkSessions](#Hub+_deviceLinkSessions) : <code>Map.&lt;string, Object&gt;</code>
    * [._delegationRegistry](#Hub+_delegationRegistry) : <code>Map.&lt;string, Object&gt;</code>
    * [._delegationSignatureMessages](#Hub+_delegationSignatureMessages) : <code>Map.&lt;string, Object&gt;</code>
    * [._outboundMessageTip](#Hub+_outboundMessageTip)
    * [._sidechainState](#Hub+_sidechainState)
    * [._sidechainSerialize](#Hub+_sidechainSerialize)
    * [._beaconReorgChain](#Hub+_beaconReorgChain)
    * [._loopbackAllowedHosts](#Hub+_loopbackAllowedHosts)
    * [._applyTestLoopbackBinds()](#Hub+_applyTestLoopbackBinds) ⇒ <code>void</code>
    * [._validateDocumentSize(buf)](#Hub+_validateDocumentSize) ⇒ <code>Object</code> \| <code>null</code>
    * [._normalizePeerInput()](#Hub+_normalizePeerInput)
    * [._resolvePeerAddress()](#Hub+_resolvePeerAddress)
    * [._originConnectionIsFabricPeer()](#Hub+_originConnectionIsFabricPeer)
    * [._connectPeer()](#Hub+_connectPeer)
    * [._disconnectPeer()](#Hub+_disconnectPeer)
    * [._sendVectorToPeer()](#Hub+_sendVectorToPeer)
    * [._sendGenericFabricEnvelopeToPeer(addressInput, envelope)](#Hub+_sendGenericFabricEnvelopeToPeer)
    * [._maybeRequestFabricSeedResync()](#Hub+_maybeRequestFabricSeedResync)
    * [._installFabricChainSyncRequestBridge()](#Hub+_installFabricChainSyncRequestBridge)
    * [._capHeapCollections()](#Hub+_capHeapCollections) ⇒ <code>void</code>
    * [._rememberBitcoinBlockTip(tip)](#Hub+_rememberBitcoinBlockTip) ⇒ <code>void</code>
    * [._hydrateBitcoinBlockTipsFromLog()](#Hub+_hydrateBitcoinBlockTipsFromLog) ⇒ <code>void</code>
    * [._loadRecentFabricMessagesFromDisk()](#Hub+_loadRecentFabricMessagesFromDisk) ⇒ <code>number</code>
    * [._collectLocalDocumentInventoryItems()](#Hub+_collectLocalDocumentInventoryItems) ⇒ <code>Array.&lt;object&gt;</code>
    * [._mergeFabricResyncInventoryItems(items)](#Hub+_mergeFabricResyncInventoryItems)
    * [._documentMarketPolicy()](#Hub+_documentMarketPolicy) ⇒ <code>Object</code>
    * [._accumulatePeerDocumentInventory(message, [origin])](#Hub+_accumulatePeerDocumentInventory) ⇒ <code>Array.&lt;object&gt;</code>
    * [._maybeRepublishHeldDocumentsFromMarket([documentIds])](#Hub+_maybeRepublishHeldDocumentsFromMarket) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
    * [._publishHeldDocumentAtPrice(documentId, purchasePriceSats, [extra])](#Hub+_publishHeldDocumentAtPrice) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [._requestDocumentInventoryFromPeer(addressInput, [reason])](#Hub+_requestDocumentInventoryFromPeer) ⇒ <code>boolean</code>
    * [._getDocumentPayload(idRef)](#Hub+_getDocumentPayload) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._fabricPeerResyncRespondToRequest(originConn, [object])](#Hub+_fabricPeerResyncRespondToRequest)
    * [.commit()](#Hub+commit)
    * [._reportHeapTelemetry()](#Hub+_reportHeapTelemetry) ⇒ <code>object</code> \| <code>null</code>
    * [._startHeapTelemetry()](#Hub+_startHeapTelemetry) ⇒ <code>void</code>
    * [._stopHeapTelemetry()](#Hub+_stopHeapTelemetry) ⇒ <code>void</code>
    * [.recordActivity(activity)](#Hub+recordActivity) ⇒ <code>Object</code> \| <code>null</code>
    * [._cacheChatMessage(chat)](#Hub+_cacheChatMessage) ⇒ <code>Object</code> \| <code>null</code>
    * [._unpublishDocument(documentId)](#Hub+_unpublishDocument) ⇒ <code>Object</code>
    * [.recordTombstone(options)](#Hub+recordTombstone) ⇒ <code>Promise.&lt;{status: string, messageId: (string\|null\|undefined), documentId: (string\|null\|undefined), message: (string\|undefined)}&gt;</code>
    * [._bitcoinP2pAddNodesList()](#Hub+_bitcoinP2pAddNodesList) ⇒ <code>Array.&lt;string&gt;</code>
    * [._wireHttpOptionsContract()](#Hub+_wireHttpOptionsContract)
    * [._buildOptionsFaucetService()](#Hub+_buildOptionsFaucetService) ⇒ <code>object</code> \| <code>null</code>
    * [._distributedFederationPersisted()](#Hub+_distributedFederationPersisted) ⇒ <code>Object</code> \| <code>undefined</code>
    * [._federationRegistryScanEnabled()](#Hub+_federationRegistryScanEnabled)
    * [._hydrateDistributedFederationFromFsSnapshot()](#Hub+_hydrateDistributedFederationFromFsSnapshot)
    * [._bootstrapFederationFilesystem()](#Hub+_bootstrapFederationFilesystem)
    * [._distributedFederationValidatorsFromEnv()](#Hub+_distributedFederationValidatorsFromEnv) ⇒ <code>Array.&lt;string&gt;</code>
    * [._distributedFederationThresholdEffective()](#Hub+_distributedFederationThresholdEffective) ⇒ <code>number</code>
    * [._distributedFederationSignatureSchemeEffective()](#Hub+_distributedFederationSignatureSchemeEffective) ⇒ <code>&#x27;schnorr&#x27;</code> \| <code>&#x27;bls&#x27;</code>
    * [._allowTrustedSidechainPatch()](#Hub+_allowTrustedSidechainPatch) ⇒ <code>boolean</code>
    * [._federationWitnessFailClosedEffective()](#Hub+_federationWitnessFailClosedEffective) ⇒ <code>boolean</code>
    * [._getEffectiveFederationPolicyForDistributedHttp()](#Hub+_getEffectiveFederationPolicyForDistributedHttp) ⇒ <code>Object</code>
    * [._getSidechainPathPolicy()](#Hub+_getSidechainPathPolicy) ⇒ <code>object</code> \| <code>null</code>
    * [._getSidechainSnapshotForBeacon()](#Hub+_getSidechainSnapshotForBeacon) ⇒ <code>Object</code>
    * [._getContractsSnapshotForBeacon()](#Hub+_getContractsSnapshotForBeacon) ⇒ <code>Object</code>
    * [._bitcoinTipForArc()](#Hub+_bitcoinTipForArc) ⇒ <code>Promise.&lt;{blockHash: (string\|null), height: (number\|null)}&gt;</code>
    * [._recordTrackedContractPublish(ev)](#Hub+_recordTrackedContractPublish)
    * [._ensureContractMessageQueueStore()](#Hub+_ensureContractMessageQueueStore) ⇒ <code>Object</code> \| <code>null</code>
    * [._enqueueOpaqueContractMessage(ev)](#Hub+_enqueueOpaqueContractMessage) ⇒ <code>object</code> \| <code>null</code>
    * [._drainContractMessageQueueToPeer(addressInput, [opts])](#Hub+_drainContractMessageQueueToPeer) ⇒ <code>Object</code>
    * [._reEnrichAcceptedTrackedContracts()](#Hub+_reEnrichAcceptedTrackedContracts) ⇒ <code>Promise.&lt;({changed: number, contractIds: Array.&lt;string&gt;}\|null)&gt;</code>
    * [._ensureBeaconNativeContract()](#Hub+_ensureBeaconNativeContract) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [._verifyOperatorAdminToken(token)](#Hub+_verifyOperatorAdminToken) ⇒ <code>boolean</code>
    * [._syncTrackedContractDigestsFromSidechainUnlocked()](#Hub+_syncTrackedContractDigestsFromSidechainUnlocked)
    * [._getContractSidechainStateJson(params)](#Hub+_getContractSidechainStateJson)
    * [._submitContractSidechainStatePatch()](#Hub+_submitContractSidechainStatePatch)
    * [._submitSidechainStatePatch(params)](#Hub+_submitSidechainStatePatch) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._applySidechainPatchesTrusted(patches)](#Hub+_applySidechainPatchesTrusted) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._ingestSidechainPatchFromPeer([ev])](#Hub+_ingestSidechainPatchFromPeer) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [._handleBeaconReorgForSidechain(info)](#Hub+_handleBeaconReorgForSidechain)
    * [._reconcileSidechainToBeaconTip()](#Hub+_reconcileSidechainToBeaconTip)
    * [._federationAuthorityPublisher([validators])](#Hub+_federationAuthorityPublisher) ⇒ <code>string</code> \| <code>null</code>
    * [._federationAuthoritySoftPolicy()](#Hub+_federationAuthoritySoftPolicy) ⇒ <code>Object</code>
    * [._federationInternalKeyMode()](#Hub+_federationInternalKeyMode) ⇒ <code>string</code>
    * [._federationVaultBuildOpts(validators)](#Hub+_federationVaultBuildOpts) ⇒ <code>object</code>
    * [._assertBeaconVaultSpendUnity()](#Hub+_assertBeaconVaultSpendUnity) ⇒ <code>Object</code>
    * [._buildFederationVaultSummary()](#Hub+_buildFederationVaultSummary) ⇒ <code>object</code>
    * [._voutPayeeAddresses(bitcoin, txid, address, amountSats)](#Hub+_voutPayeeAddresses) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [._loadL1TxForVerification(bitcoin, txid)](#Hub+_loadL1TxForVerification) ⇒ <code>Promise.&lt;(Object\|null)&gt;</code>
    * [._l1PaymentVerificationDetail()](#Hub+_l1PaymentVerificationDetail) ⇒ <code>Object</code>
    * [._l1TxChainStatusBatch()](#Hub+_l1TxChainStatusBatch) ⇒ <code>Object.&lt;string, {confirmations: (number\|null), inMempool: boolean}&gt;</code>
    * [._mergePersistedTxLabel(txid, type, [meta])](#Hub+_mergePersistedTxLabel)
    * [._collectFabricTxLabelMap()](#Hub+_collectFabricTxLabelMap) ⇒ <code>Object.&lt;string, {types: Array.&lt;string&gt;, meta: object}&gt;</code>
    * [._applyPayjoinDepositAddressLabels(transactions)](#Hub+_applyPayjoinDepositAddressLabels) ⇒ <code>Array.&lt;object&gt;</code>
    * [._sealDocumentForPricedPublish(documentId, parsed)](#Hub+_sealDocumentForPricedPublish) ⇒ <code>Promise.&lt;{parsed: object, key: Buffer}&gt;</code>
    * [._sendHtlcKeyRevealToPeer(address, payload, [relayMeta])](#Hub+_sendHtlcKeyRevealToPeer)
    * [._getInventoryHtlcSellerReveal(body)](#Hub+_getInventoryHtlcSellerReveal)
    * [._claimInventoryHtlcOnChain()](#Hub+_claimInventoryHtlcOnChain)
    * [._rpcBroadcastSignedTransaction()](#Hub+_rpcBroadcastSignedTransaction)
    * [._handleHttpJsonRpcRequest()](#Hub+_handleHttpJsonRpcRequest)
    * [._normBitcoinChainHeight()](#Hub+_normBitcoinChainHeight)
    * [._redactBitcoinStatusForNonAdmin(full)](#Hub+_redactBitcoinStatusForNonAdmin) ⇒ <code>object</code>
    * [._resolveBitcoinDocumentInventoryPriceSats(kind)](#Hub+_resolveBitcoinDocumentInventoryPriceSats) ⇒ <code>number</code> \| <code>undefined</code>
    * [._dropLocalPublishedBitcoinIndexBelowPruneHeight()](#Hub+_dropLocalPublishedBitcoinIndexBelowPruneHeight)
    * [._broadcastBitcoinStatusToClients()](#Hub+_broadcastBitcoinStatusToClients)
    * [._broadcastBitcoinBlockToFabricPeers(payload)](#Hub+_broadcastBitcoinBlockToFabricPeers)
    * [._ingestP2pBitcoinBlockForFabricLog(payload, [originName])](#Hub+_ingestP2pBitcoinBlockForFabricLog)
    * [._ensureBitcoinBlockPublishedDocument(block, networkName)](#Hub+_ensureBitcoinBlockPublishedDocument)
    * [._ensureBitcoinTransactionPublishedDocuments(block, networkName)](#Hub+_ensureBitcoinTransactionPublishedDocuments)
    * [._maybeScanSidechainBlock()](#Hub+_maybeScanSidechainBlock)
    * [._maybePublishFabricHallmark(tipBlockHash, height)](#Hub+_maybePublishFabricHallmark)
    * [._publishFabricHallmarkRpc(req)](#Hub+_publishFabricHallmarkRpc) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._handleBitcoinTransactionUpdate()](#Hub+_handleBitcoinTransactionUpdate)
    * [._collectSelfDestructRemovalTargets()](#Hub+_collectSelfDestructRemovalTargets) ⇒ <code>Array.&lt;string&gt;</code>
    * [._scheduleHubSelfDestructWipe(res)](#Hub+_scheduleHubSelfDestructWipe)
    * [._applyFirstTimeSetupStores(initialConfig)](#Hub+_applyFirstTimeSetupStores) ⇒ <code>Object</code>
    * [._startManagedChainsAfterSetup([initialConfig])](#Hub+_startManagedChainsAfterSetup) ⇒ <code>Promise.&lt;void&gt;</code>
    * [._rebindHttpForSharedModeIfChanged()](#Hub+_rebindHttpForSharedModeIfChanged)
    * [._summarizeBitcoinBlockByHash(bitcoin, hash)](#Hub+_summarizeBitcoinBlockByHash) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [._listBitcoinBlockSummaries(bitcoin, range)](#Hub+_listBitcoinBlockSummaries) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
    * [._handleBitcoinCrowdfundingAcpDonationPsbtRequest()](#Hub+_handleBitcoinCrowdfundingAcpDonationPsbtRequest)
    * [._handleBitcoinCrowdfundingPayoutSignArbiterRequest()](#Hub+_handleBitcoinCrowdfundingPayoutSignArbiterRequest)
    * [._handleBitcoinCrowdfundingPayoutBroadcastRequest()](#Hub+_handleBitcoinCrowdfundingPayoutBroadcastRequest)
    * [._normalizeXpubForNetwork()](#Hub+_normalizeXpubForNetwork)
    * [._extractOptionalAdminTokenFromRequest(req)](#Hub+_extractOptionalAdminTokenFromRequest) ⇒ <code>string</code> \| <code>null</code>
    * [._isSetupAdminRequest(req)](#Hub+_isSetupAdminRequest) ⇒ <code>boolean</code>
    * [._requireAdminTokenForHubWalletHttp(req, res, [message])](#Hub+_requireAdminTokenForHubWalletHttp) ⇒ <code>boolean</code>
    * [._authorizeBitcoinXpubQueryHttp(req, res)](#Hub+_authorizeBitcoinXpubQueryHttp) ⇒ <code>boolean</code>
    * [._bitcoinXpubWatchSummaryPayload(bitcoin, xpub, addressesParam)](#Hub+_bitcoinXpubWatchSummaryPayload) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._bitcoinXpubWatchUtxosPayload(bitcoin, xpub)](#Hub+_bitcoinXpubWatchUtxosPayload) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._bitcoinXpubWatchTransactionsPayload(bitcoin, xpub, addressesParam, limit)](#Hub+_bitcoinXpubWatchTransactionsPayload) ⇒ <code>Promise.&lt;object&gt;</code>
    * [._bitcoinXpubFromRequest(req)](#Hub+_bitcoinXpubFromRequest) ⇒ <code>string</code>
    * [._filterMempoolPaymentSummariesForAddresses(bitcoin, watchAddrs, limit)](#Hub+_filterMempoolPaymentSummariesForAddresses)
    * [._handleBitcoinAddressInfoRequest()](#Hub+_handleBitcoinAddressInfoRequest)
    * [._handleBitcoinAddressBalanceRequest()](#Hub+_handleBitcoinAddressBalanceRequest)
    * [._handleBitcoinWalletTransactionsRequest()](#Hub+_handleBitcoinWalletTransactionsRequest)
    * [._publishCoinjoinMessage(body, [opts])](#Hub+_publishCoinjoinMessage) ⇒ <code>boolean</code>
    * [._marketAgentAdminOk()](#Hub+_marketAgentAdminOk)
    * [._handlePayjoinContributeRequest()](#Hub+_handlePayjoinContributeRequest)
    * [._hubBitcoindJsonRpc()](#Hub+_hubBitcoindJsonRpc)
    * [._handleLightningChannelDeleteRequest()](#Hub+_handleLightningChannelDeleteRequest)
    * [._repairManagedRegtestSettingsJsonIfCorrupt()](#Hub+_repairManagedRegtestSettingsJsonIfCorrupt) ⇒ <code>void</code>
    * [._startPhase_diagnostics()](#Hub+_startPhase_diagnostics) ⇒ [<code>Hub</code>](#Hub)
    * [.stop()](#Hub+stop) ⇒ [<code>Hub</code>](#Hub)

<a name="new_Hub_new"></a>

### new Hub([settings])
Create an instance of the [Hub](#Hub) service.

**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Hub instance. |

<a name="Hub+_webrtcRelayRate"></a>

### hub.\_webrtcRelayRate
fromPeerId → { count, windowStart } for RelayFromWebRTC rate limiting

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_bitcoinScanInflight"></a>

### hub.\_bitcoinScanInflight
Dedupe concurrent scantxoutset scans by descriptor set.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_lastBitcoinBlockActivityTip"></a>

### hub.\_lastBitcoinBlockActivityTip
Dedupe Activity stream + P2P BitcoinBlock gossip when the same tip is signaled more than once.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_bitcoinBlockTips"></a>

### hub.\_bitcoinBlockTips
Bounded recent BitcoinBlock tips so P2P ingest does not scan the full message log.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_mainchainInventoryRequestCooldown"></a>

### hub.\_mainchainInventoryRequestCooldown
Per-peer cooldown for requesting mainchain inventory over Fabric.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_pendingMainchainBlockSyncRequests"></a>

### hub.\_pendingMainchainBlockSyncRequests
Dedupe in-flight block-sync requests by `peer|hash`.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_heapTelemetryTimer"></a>

### hub.\_heapTelemetryTimer : <code>NodeJS.Timeout</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_lastStateWriteBytes"></a>

### hub.\_lastStateWriteBytes
UTF-8 byte length of last `commit()` STATE body (telemetry; avoids re-stringify).

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_inventoryHtlcById"></a>

### hub.\_inventoryHtlcById : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_crowdfundingCampaigns"></a>

### hub.\_crowdfundingCampaigns : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_desktopAuthSessions"></a>

### hub.\_desktopAuthSessions : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_deviceLinkSessions"></a>

### hub.\_deviceLinkSessions : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_delegationRegistry"></a>

### hub.\_delegationRegistry : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_delegationSignatureMessages"></a>

### hub.\_delegationSignatureMessages : <code>Map.&lt;string, Object&gt;</code>
**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_outboundMessageTip"></a>

### hub.\_outboundMessageTip
Previous signed AMP `Message.id` for `_appendFabricMessage` (D-020).

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_sidechainState"></a>

### hub.\_sidechainState
Sidechain document + logical clock; see @fabric/core/functions/sidechainState

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_sidechainSerialize"></a>

### hub.\_sidechainSerialize
Serialize patch submits + reorg rewind (linearize statechain mutations).

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_beaconReorgChain"></a>

### hub.\_beaconReorgChain
Serialize beacon reorg handling so sidechain rewind completes before downstream refresh.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_loopbackAllowedHosts"></a>

### hub.\_loopbackAllowedHosts
Names (besides IP literals and localhost) this Hub answers to directly on loopback; see hubHttpLocalTrust.

**Kind**: instance property of [<code>Hub</code>](#Hub)  
<a name="Hub+_applyTestLoopbackBinds"></a>

### hub.\_applyTestLoopbackBinds() ⇒ <code>void</code>
Mocha / NODE_ENV=test: Peer constructor re-applies FABRIC_INTERFACE from the
process environment (core `resolveFabricPeerInterface`). Force loopback so
deploy-host env cannot steal test sockets.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
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
<a name="Hub+_sendGenericFabricEnvelopeToPeer"></a>

### hub.\_sendGenericFabricEnvelopeToPeer(addressInput, envelope)
Send a JSON envelope to a peer. Document inventory request/response types use
first-class `P2P_INVENTORY_REQUEST` / `P2P_INVENTORY_RESPONSE` AMP opcodes —
Core Peer drops those types when they arrive on GenericMessage.
Other envelopes still use GenericMessage so `_handleGenericMessage` runs.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| addressInput | <code>string</code> |  |
| envelope | <code>object</code> \| <code>string</code> | Parsed object or JSON string (must include `type` when object). |

<a name="Hub+_maybeRequestFabricSeedResync"></a>

### hub.\_maybeRequestFabricSeedResync()
When a Fabric TCP session opens to an address listed in [settings.peers](settings.peers) (or
`FABRIC_FABRIC_RESYNC_PEERS`), send [ChainSyncRequest](ChainSyncRequest) so the peer can push catalog
inventory and replay `BitcoinBlock` Fabric log rows. Bitcoin Core chain length still follows
bitcoind P2P (`addnode`), not this path.
Disable: `FABRIC_DISABLE_FABRIC_SEED_RESYNC=1`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_installFabricChainSyncRequestBridge"></a>

### hub.\_installFabricChainSyncRequestBridge()
`@fabric/core` Peer treats wire `ChainSyncRequest` as unhandled (default switch branch), so
`chainSyncRequest` never fires. Peek the type opcode and emit so [_fabricPeerResyncRespondToRequest](_fabricPeerResyncRespondToRequest) runs.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_capHeapCollections"></a>

### hub.\_capHeapCollections() ⇒ <code>void</code>
Cap in-memory Activity + Fabric message maps. Durable rows stay on disk
under `messages/*.json`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_rememberBitcoinBlockTip"></a>

### hub.\_rememberBitcoinBlockTip(tip) ⇒ <code>void</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| tip | <code>string</code> | 64-hex block hash |

<a name="Hub+_hydrateBitcoinBlockTipsFromLog"></a>

### hub.\_hydrateBitcoinBlockTipsFromLog() ⇒ <code>void</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_loadRecentFabricMessagesFromDisk"></a>

### hub.\_loadRecentFabricMessagesFromDisk() ⇒ <code>number</code>
Load the newest `messages/*.json` files when STATE restore skipped the log.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>number</code> - rows loaded  
<a name="Hub+_collectLocalDocumentInventoryItems"></a>

### hub.\_collectLocalDocumentInventoryItems() ⇒ <code>Array.&lt;object&gt;</code>
Local document rows for [INVENTORY_RESPONSE](INVENTORY_RESPONSE) / Fabric resync (no HTLC enrichment).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_mergeFabricResyncInventoryItems"></a>

### hub.\_mergeFabricResyncInventoryItems(items)
Apply published rows from a peer [INVENTORY_RESPONSE](INVENTORY_RESPONSE) after [ChainSyncRequest](ChainSyncRequest)
(`object.fabricResync`) so [ListDocuments](ListDocuments) / catalog match the anchor hub without local `CreateDocument`.
Does not write `documents/<id>.json`; [GetDocument](GetDocument) still needs replication or fetch.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| items | <code>Array.&lt;object&gt;</code> | 

<a name="Hub+_documentMarketPolicy"></a>

### hub.\_documentMarketPolicy() ⇒ <code>Object</code>
Optional Document Market policy (`documents.market` / `FABRIC_DOCUMENT_MARKET_*`).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_accumulatePeerDocumentInventory"></a>

### hub.\_accumulatePeerDocumentInventory(message, [origin]) ⇒ <code>Array.&lt;object&gt;</code>
Persist a peer documents inventory snapshot when Document Market accumulate is on.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | GenericMessage / inventory response |
| [origin] | <code>Object</code> |  |

<a name="Hub+_maybeRepublishHeldDocumentsFromMarket"></a>

### hub.\_maybeRepublishHeldDocumentsFromMarket([documentIds]) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
Publish or raise a local listing when we hold the blob and a cheaper remote offer exists.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| [documentIds] | <code>Array.&lt;string&gt;</code> | limit to these ids; omit to scan offers against local files |

<a name="Hub+_publishHeldDocumentAtPrice"></a>

### hub.\_publishHeldDocumentAtPrice(documentId, purchasePriceSats, [extra]) ⇒ <code>Promise.&lt;Object&gt;</code>
Seal (if needed) and list a held document at `purchasePriceSats`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| purchasePriceSats | <code>number</code> | 
| [extra] | <code>Object</code> | 

<a name="Hub+_requestDocumentInventoryFromPeer"></a>

### hub.\_requestDocumentInventoryFromPeer(addressInput, [reason]) ⇒ <code>boolean</code>
Query a connected peer for documents inventory when Document Market accumulate is on.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Default |
| --- | --- | --- |
| addressInput | <code>string</code> |  | 
| [reason] | <code>string</code> | <code>&quot;peer-open&quot;</code> | 

<a name="Hub+_getDocumentPayload"></a>

### hub.\_getDocumentPayload(idRef) ⇒ <code>Promise.&lt;object&gt;</code>
GetDocument body: local blob when held, else peer-only metadata from the offer book.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| idRef | <code>string</code> | 

<a name="Hub+_fabricPeerResyncRespondToRequest"></a>

### hub.\_fabricPeerResyncRespondToRequest(originConn, [object])
Respond to a Fabric [P2P_CHAIN_SYNC_REQUEST](P2P_CHAIN_SYNC_REQUEST): push document inventory, request peer inventory,
and replay recent `BitcoinBlock` Fabric log payloads over P2P (throttled).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| originConn | <code>string</code> | host:port |
| [object] | <code>object</code> | parsed ChainSyncRequest JSON body |

<a name="Hub+commit"></a>

### hub.commit()
Finalizes the current state.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_reportHeapTelemetry"></a>

### hub.\_reportHeapTelemetry() ⇒ <code>object</code> \| <code>null</code>
Log-only heap / retainer snapshot for agents (PM2 stdout). Does not mutate
durable stores — full replay of `messages/` + documents + STATE remains.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_startHeapTelemetry"></a>

### hub.\_startHeapTelemetry() ⇒ <code>void</code>
Start periodic `[HUB:HEAP]` lines (Beacon cadence by default). Idempotent.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_stopHeapTelemetry"></a>

### hub.\_stopHeapTelemetry() ⇒ <code>void</code>
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

<a name="Hub+_cacheChatMessage"></a>

### hub.\_cacheChatMessage(chat) ⇒ <code>Object</code> \| <code>null</code>
Cache chat messages in Hub state so browser reloads can rehydrate from GetNetworkStatus.
Accepts Hub classic (`object.content`) and application peers (`object.body` / channel / handle).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| chat | <code>object</code> | Chat payload |

<a name="Hub+_unpublishDocument"></a>

### hub.\_unpublishDocument(documentId) ⇒ <code>Object</code>
Remove a document from the hub published collection (in-memory + persisted via [#commit](#commit)).
Does not delete the underlying `documents/<id>.json` file.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> | Normalized document id (sha256). |

<a name="Hub+recordTombstone"></a>

### hub.recordTombstone(options) ⇒ <code>Promise.&lt;{status: string, messageId: (string\|null\|undefined), documentId: (string\|null\|undefined), message: (string\|undefined)}&gt;</code>
Remove an activity row and/or unpublish a document; persist a Fabric chain message and state.

- Appends `_appendFabricMessage('Tombstone', …)` (sequential `messages/*.json`, chain, `fs.addToChain`).
- Broadcasts JSON Patch `remove` for activity rows and a `GenericMessage` `{ type: 'Tombstone', object }`
  so Bridge dispatches `fabric:tombstone` with `messageId` / `documentId`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> |  |
| [options.messageId] | <code>string</code> | Key in `this._state.messages` (omit to unpublish-only). |
| [options.documentId] | <code>string</code> | Published document id to remove from `collections.documents`. |

<a name="Hub+_bitcoinP2pAddNodesList"></a>

### hub.\_bitcoinP2pAddNodesList() ⇒ <code>Array.&lt;string&gt;</code>
Bitcoin Core P2P `addnode` targets for playnet/LAN regtest (not Fabric TCP peers).
Merges `settings.bitcoin.p2pAddNodes` with `FABRIC_BITCOIN_P2P_ADDNODES` (comma-separated).
For **regtest**, also appends `hub.fabric.pub:18444` unless `FABRIC_BITCOIN_SKIP_PLAYNET_PEER`
is set or `settings.bitcoin.skipPlaynetPeer` is true (this host is the playnet seed).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_wireHttpOptionsContract"></a>

### hub.\_wireHttpOptionsContract()
Enrich HTTP `OPTIONS /` with Application Resource Contract identity,
peering service pointers, optional regtest Beacon faucet discovery, and
(when available) a live OracleAttestation so application peers can
discover hubs without a hard-coded path.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_buildOptionsFaucetService"></a>

### hub.\_buildOptionsFaucetService() ⇒ <code>object</code> \| <code>null</code>
OPTIONS `services.faucet` from live Bitcoin / Beacon state (regtest only).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_distributedFederationPersisted"></a>

### hub.\_distributedFederationPersisted() ⇒ <code>Object</code> \| <code>undefined</code>
Persisted federation policy from `stores/hub/STATE` `.settings.DISTRIBUTED_FEDERATION`, when present.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_federationRegistryScanEnabled"></a>

### hub.\_federationRegistryScanEnabled()
Chain scan for `fabfed` OP_RETURN federation announcements (regtest default on).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_hydrateDistributedFederationFromFsSnapshot"></a>

### hub.\_hydrateDistributedFederationFromFsSnapshot()
When setup has no `DISTRIBUTED_FEDERATION` JSON, restore from Fabric `federations/POLICY_SNAPSHOT`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_bootstrapFederationFilesystem"></a>

### hub.\_bootstrapFederationFilesystem()
Seed `federations/REGISTRY`, hydrate policy from snapshot, mirror current setup policy to disk.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_distributedFederationValidatorsFromEnv"></a>

### hub.\_distributedFederationValidatorsFromEnv() ⇒ <code>Array.&lt;string&gt;</code>
Federation validator pubkeys (hex) for Beacon epoch witnesses — env, then persisted setting, then in-memory defaults.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_distributedFederationThresholdEffective"></a>

### hub.\_distributedFederationThresholdEffective() ⇒ <code>number</code>
M-of-N threshold aligned with [#_distributedFederationValidatorsFromEnv](#_distributedFederationValidatorsFromEnv) source order.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_distributedFederationSignatureSchemeEffective"></a>

### hub.\_distributedFederationSignatureSchemeEffective() ⇒ <code>&#x27;schnorr&#x27;</code> \| <code>&#x27;bls&#x27;</code>
Witness scheme aligned with [#_distributedFederationValidatorsFromEnv](#_distributedFederationValidatorsFromEnv) source order.
Env validators honor `FABRIC_DISTRIBUTED_FEDERATION_SIGNATURE_SCHEME` (`schnorr` or `bls`).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_allowTrustedSidechainPatch"></a>

### hub.\_allowTrustedSidechainPatch() ⇒ <code>boolean</code>
Whether trusted sidechain apply (no federation witness) is allowed.
Disabled by default; regtest/playnet only via env or explicit setting.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_federationWitnessFailClosedEffective"></a>

### hub.\_federationWitnessFailClosedEffective() ⇒ <code>boolean</code>
Fail-closed beacon epoch witness verification when federation validators are configured.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_getEffectiveFederationPolicyForDistributedHttp"></a>

### hub.\_getEffectiveFederationPolicyForDistributedHttp() ⇒ <code>Object</code>
Same validator list + threshold as [#_submitSidechainStatePatch](#_submitSidechainStatePatch) (env + persisted + settings).
Used for `/services/distributed/manifest` and epoch JSON so operators see what the hub enforces even when
the Beacon has not called [Beacon#attach](Beacon#attach) yet (e.g. Bitcoin RPC not ready).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_getSidechainPathPolicy"></a>

### hub.\_getSidechainPathPolicy() ⇒ <code>object</code> \| <code>null</code>
Contract path policy for statechain patches (settings.distributed.sidechainPolicy or env).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_getSidechainSnapshotForBeacon"></a>

### hub.\_getSidechainSnapshotForBeacon() ⇒ <code>Object</code>
Snapshot of sidechain logical head for Beacon epoch payloads (`payload.sidechain`).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_getContractsSnapshotForBeacon"></a>

### hub.\_getContractsSnapshotForBeacon() ⇒ <code>Object</code>
Snapshot of accepted tracked application contracts for Beacon epochs (`payload.contracts`).
This is the federation-facing Merkle root of published contracts the operator accepted.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_bitcoinTipForArc"></a>

### hub.\_bitcoinTipForArc() ⇒ <code>Promise.&lt;{blockHash: (string\|null), height: (number\|null)}&gt;</code>
Best-effort Bitcoin tip for ARC bitcoinAnchor on tracked contracts.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_recordTrackedContractPublish"></a>

### hub.\_recordTrackedContractPublish(ev)
Ingest CONTRACT_PUBLISH into the pending tracked-application-contract queue.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| ev | <code>Object</code> | 

<a name="Hub+_ensureContractMessageQueueStore"></a>

### hub.\_ensureContractMessageQueueStore() ⇒ <code>Object</code> \| <code>null</code>
Opaque CONTRACT_MESSAGE queue store (Filesystem-backed).
Does not open sealed content — hex only.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_enqueueOpaqueContractMessage"></a>

### hub.\_enqueueOpaqueContractMessage(ev) ⇒ <code>object</code> \| <code>null</code>
Persist opaque AMP bytes from a Peer `contract:message` event.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| ev | <code>object</code> | 

<a name="Hub+_drainContractMessageQueueToPeer"></a>

### hub.\_drainContractMessageQueueToPeer(addressInput, [opts]) ⇒ <code>Object</code>
Later-relay: write pending opaque frames to a newly opened peer connection.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| addressInput | <code>string</code> | 
| [opts] | <code>Object</code> | 

<a name="Hub+_reEnrichAcceptedTrackedContracts"></a>

### hub.\_reEnrichAcceptedTrackedContracts() ⇒ <code>Promise.&lt;({changed: number, contractIds: Array.&lt;string&gt;}\|null)&gt;</code>
Recompute spendAddress / tip anchors for accepted ARCs after network bind.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_ensureBeaconNativeContract"></a>

### hub.\_ensureBeaconNativeContract() ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Publish + accept the native Beacon ARC (fabric-beacon) so Federation authority
shares the same CONTRACT_PUBLISH / spend surface as application contracts.
Idempotent for a stable validator set; network overlays apply at Accept/re-enrich.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_verifyOperatorAdminToken"></a>

### hub.\_verifyOperatorAdminToken(token) ⇒ <code>boolean</code>
Local developer env is the production publisher: Hub `_rootKey` (HD master)
and Peer `agent.key` (BIP44 child) share `FABRIC_XPRV`. Accept tokens minted
from either.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| token | <code>string</code> | 

<a name="Hub+_syncTrackedContractDigestsFromSidechainUnlocked"></a>

### hub.\_syncTrackedContractDigestsFromSidechainUnlocked()
When sidechain app payloads change (e.g. `/services/rsi` or `/namespaces/<id>`),
refresh matching accepted contract state digests so the next Beacon epoch seals
the new contracts root (ADR-001).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_getContractSidechainStateJson"></a>

### hub.\_getContractSidechainStateJson(params)
Contract Statechain head for an accepted CONTRACT_PUBLISH namespace (ADR-001).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| params | <code>Object</code> | 

<a name="Hub+_submitContractSidechainStatePatch"></a>

### hub.\_submitContractSidechainStatePatch()
Patch a contract-namespace Statechain, then seal its head into Hub `/namespaces/<id>`.
Auth: same as root sidechain (federation witness or admin token).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_submitSidechainStatePatch"></a>

### hub.\_submitSidechainStatePatch(params) ⇒ <code>Promise.&lt;object&gt;</code>
Apply JSON Patch to sidechain `content` after federation witness or admin token.
Serialized with other statechain mutations; appends journal entry for unsealed recovery.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| params | <code>object</code> | 

<a name="Hub+_applySidechainPatchesTrusted"></a>

### hub.\_applySidechainPatchesTrusted(patches) ⇒ <code>Promise.&lt;object&gt;</code>
Apply sidechain patches from a trusted Hub-internal caller (no admin /
federation check). Used by application aggregators (e.g. RSI service on
goon.vc) before Beacon epochs seal `payload.sidechain` + SNAPSHOTS.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| patches | <code>Array.&lt;object&gt;</code> | RFC6902 ops on `content` |

<a name="Hub+_ingestSidechainPatchFromPeer"></a>

### hub.\_ingestSidechainPatchFromPeer([ev]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Ingest a SIDECHAIN_STATE_PATCH from the Fabric Peer mesh.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| [ev] | <code>Object</code> | 
| [ev.proposal] | <code>Object</code> | 
| [ev.federationWitness] | <code>Object</code> | 

<a name="Hub+_handleBeaconReorgForSidechain"></a>

### hub.\_handleBeaconReorgForSidechain(info)
After Bitcoin reorg: prune sidechain snapshots for dropped beacon epochs and reload `STATE` from the surviving tip snapshot.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| info | <code>Object</code> | 

<a name="Hub+_reconcileSidechainToBeaconTip"></a>

### hub.\_reconcileSidechainToBeaconTip()
Align in-memory `sidechain/STATE` with the persisted beacon epoch chain tip (snapshots written each epoch).
Same restore policy as reorg: snapshot → digest-match → genesis, then replay unsealed journal.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_federationAuthorityPublisher"></a>

### hub.\_federationAuthorityPublisher([validators]) ⇒ <code>string</code> \| <code>null</code>
Soft-tier publisher for federation vault + Beacon ARC (hub root key, else first validator).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| [validators] | <code>Array.&lt;string&gt;</code> | 

<a name="Hub+_federationAuthoritySoftPolicy"></a>

### hub.\_federationAuthoritySoftPolicy() ⇒ <code>Object</code>
Shared CSV / soft-mode knobs for vault + Beacon ARC.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_federationInternalKeyMode"></a>

### hub.\_federationInternalKeyMode() ⇒ <code>string</code>
Taproot internal key for federation vault + native Beacon overlay.
Defaults to `nums` so historical NUMS UTXOs stay on the displayed address.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>string</code> - `nums` | `musig2`  
<a name="Hub+_federationVaultBuildOpts"></a>

### hub.\_federationVaultBuildOpts(validators) ⇒ <code>object</code>
Shared vault-builder knobs (CSV / publisher / internal key).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| validators | <code>Array.&lt;string&gt;</code> | 

<a name="Hub+_assertBeaconVaultSpendUnity"></a>

### hub.\_assertBeaconVaultSpendUnity() ⇒ <code>Object</code>
Assert Hub federation vault address matches accepted fabric-beacon ARC spendAddress.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_buildFederationVaultSummary"></a>

### hub.\_buildFederationVaultSummary() ⇒ <code>object</code>
L1 Taproot vault derived from federation validator list + threshold (deterministic).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
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

<a name="Hub+_loadL1TxForVerification"></a>

### hub.\_loadL1TxForVerification(bitcoin, txid) ⇒ <code>Promise.&lt;(Object\|null)&gt;</code>
Load a decoded tx for L1 payment checks.
Confirmed wallet sends leave the mempool; without a ready txindex,
`getrawtransaction` fails and Core tells you to use `gettransaction`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>Promise.&lt;(Object\|null)&gt;</code> - decoded tx with `vout` and `confirmations`  

| Param | Type | Description |
| --- | --- | --- |
| bitcoin | <code>Object</code> | Bitcoin service |
| txid | <code>string</code> |  |

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
<a name="Hub+_applyPayjoinDepositAddressLabels"></a>

### hub.\_applyPayjoinDepositAddressLabels(transactions) ⇒ <code>Array.&lt;object&gt;</code>
Label txs that pay to a Payjoin session deposit address (BIP21 deposit flow).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| transactions | <code>Array.&lt;object&gt;</code> | 

<a name="Hub+_sealDocumentForPricedPublish"></a>

### hub.\_sealDocumentForPricedPublish(documentId, parsed) ⇒ <code>Promise.&lt;{parsed: object, key: Buffer}&gt;</code>
Seal a document for priced publish: ciphertext-at-rest + hub-only content key K.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| parsed | <code>object</code> | documents/{id}.json body |

<a name="Hub+_sendHtlcKeyRevealToPeer"></a>

### hub.\_sendHtlcKeyRevealToPeer(address, payload, [relayMeta])
Buyer-targeted HTLC key reveal (never embed preimage in relayed file chunks).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| address | <code>string</code> |  | next-hop connection key |
| payload | <code>object</code> |  |  |
| [relayMeta] | <code>Object</code> \| <code>null</code> | <code></code> |  |

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
<a name="Hub+_rpcBroadcastSignedTransaction"></a>

### hub.\_rpcBroadcastSignedTransaction()
JSON-RPC: relay a signed raw tx to bitcoind. On regtest (or if settings.bitcoin.publicDocumentOfferBroadcast),
no admin token; otherwise requires adminToken.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleHttpJsonRpcRequest"></a>

### hub.\_handleHttpJsonRpcRequest()
HTTP JSON-RPC for the same method set as WebSocket `JSONCall` (`this.http._registerMethod`).
Registered as an explicit route so `POST /services/rpc` is not handled by the SPA `POST /*`
resource path (which would return 500 for unknown POST /services/...).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_normBitcoinChainHeight"></a>

### hub.\_normBitcoinChainHeight()
Returns minimal public Bitcoin status for global state / GetNetworkStatus.
Excludes balance, beacon, blockchain, networkInfo, mempoolInfo, recentBlocks, recentTransactions.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_redactBitcoinStatusForNonAdmin"></a>

### hub.\_redactBitcoinStatusForNonAdmin(full) ⇒ <code>object</code>
Removes Hub-wallet-specific fields from [_collectBitcoinStatus](_collectBitcoinStatus) for unauthenticated HTTP clients.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| full | <code>object</code> | 

<a name="Hub+_resolveBitcoinDocumentInventoryPriceSats"></a>

### hub.\_resolveBitcoinDocumentInventoryPriceSats(kind) ⇒ <code>number</code> \| <code>undefined</code>
Positive sats listed on Bitcoin block/tx Fabric documents for inventory HTLC (`purchasePriceSats`).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| kind | <code>&#x27;block&#x27;</code> \| <code>&#x27;transaction&#x27;</code> | 

<a name="Hub+_dropLocalPublishedBitcoinIndexBelowPruneHeight"></a>

### hub.\_dropLocalPublishedBitcoinIndexBelowPruneHeight()
Unpublish and delete on-disk Bitcoin index documents whose `bitcoinHeight` is below Core `pruneheight`.
Local-only: does not append Fabric `Tombstone` (catalogs may diverge; Beacon + P2P `BitcoinBlock` stay aligned).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_broadcastBitcoinStatusToClients"></a>

### hub.\_broadcastBitcoinStatusToClients()
Push sanitized Bitcoin status to browsers (wallet-safe fields only).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_broadcastBitcoinBlockToFabricPeers"></a>

### hub.\_broadcastBitcoinBlockToFabricPeers(payload)
Gossip the local chain tip to Fabric P2P peers (signed with the agent identity key).
Incoming tips are relayed by Fabric `Peer` (Bitcoin block opcode). Use the `BitcoinBlock` vector label so encoders map to the correct opcode (not all cores accept `BITCOIN_BLOCK` as the constructor label).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>object</code> | Same shape as `BitcoinBlock` Fabric message log (tip, height, network, at, …) |

<a name="Hub+_ingestP2pBitcoinBlockForFabricLog"></a>

### hub.\_ingestP2pBitcoinBlockForFabricLog(payload, [originName])
When a BitcoinBlock arrives over Fabric P2P (e.g. peer resync replay), append to the hub Fabric
message log if this tip is not already recorded — keeps two hubs' Fabric views closer without
replacing L1 IBD (still use bitcoind addnode / RPC for chain data).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>object</code> |  |
| [originName] | <code>string</code> | TCP peer host:port |

<a name="Hub+_ensureBitcoinBlockPublishedDocument"></a>

### hub.\_ensureBitcoinBlockPublishedDocument(block, networkName)
Persist a compact Bitcoin block summary as a Fabric Document and publish it to the hub catalog
(`collections.documents` + `PublishDocument` message). Idempotent per block (stable JSON → sha256 id).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| block | <code>object</code> | — Bitcoin Core `getblock` verbosity 2 JSON |
| networkName | <code>string</code> \| <code>null</code> |  |

<a name="Hub+_ensureBitcoinTransactionPublishedDocuments"></a>

### hub.\_ensureBitcoinTransactionPublishedDocuments(block, networkName)
Publish verbose transactions from a `getblock` … 2 result as Fabric documents (optional; see `documentTransactions`).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| block | <code>object</code> | 
| networkName | <code>string</code> \| <code>null</code> | 

<a name="Hub+_maybeScanSidechainBlock"></a>

### hub.\_maybeScanSidechainBlock()
Optional playnet / sidechain indexing: scan new block for OP_RETURN markers and watched addresses.
Enable with `settings.bitcoin.sidechainScan.enable` (off by default for production).
When `settings.bitcoin.hallmarks.scan` is on, also decode Fabric hallmark OP_RETURNs.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_maybePublishFabricHallmark"></a>

### hub.\_maybePublishFabricHallmark(tipBlockHash, height)
Opt-in OP_RETURN hallmark publish (regtest). On-chain only — no P2P relay.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| tipBlockHash | <code>string</code> | 
| height | <code>number</code> \| <code>null</code> | 

<a name="Hub+_publishFabricHallmarkRpc"></a>

### hub.\_publishFabricHallmarkRpc(req) ⇒ <code>Promise.&lt;object&gt;</code>
Derive + publish a hallmark for the current tip (admin RPC helper).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 

<a name="Hub+_handleBitcoinTransactionUpdate"></a>

### hub.\_handleBitcoinTransactionUpdate()
Wallet / mempool refresh on transaction-related ZMQ (no new chain tip).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_collectSelfDestructRemovalTargets"></a>

### hub.\_collectSelfDestructRemovalTargets() ⇒ <code>Array.&lt;string&gt;</code>
Absolute paths removed by self-destruct (each must stay under the Hub writable root).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_scheduleHubSelfDestructWipe"></a>

### hub.\_scheduleHubSelfDestructWipe(res)
**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| res | <code>http.ServerResponse</code> | 

<a name="Hub+_applyFirstTimeSetupStores"></a>

### hub.\_applyFirstTimeSetupStores(initialConfig) ⇒ <code>Object</code>
Persist first-time setup onto runtime Bitcoin settings and Hub STATE so the
next process boot (and this process's commit()) keep IS_CONFIGURED.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| initialConfig | <code>Object</code> | 

<a name="Hub+_startManagedChainsAfterSetup"></a>

### hub.\_startManagedChainsAfterSetup([initialConfig]) ⇒ <code>Promise.&lt;void&gt;</code>
After first-time setup or a binaries install, start deferred managed bitcoind / lightningd.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| [initialConfig] | <code>object</code> | 

<a name="Hub+_rebindHttpForSharedModeIfChanged"></a>

### hub.\_rebindHttpForSharedModeIfChanged()
Apply HTTP bind interface from persisted HTTP_SHARED_MODE (127.0.0.1 vs 0.0.0.0).
No-op when FABRIC_HUB_INTERFACE / INTERFACE env overrides (handled at process start).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_summarizeBitcoinBlockByHash"></a>

### hub.\_summarizeBitcoinBlockByHash(bitcoin, hash) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Lightweight getblock(+stats) summary for explorer / chain scroller tiles.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| bitcoin | <code>object</code> | 
| hash | <code>string</code> | 

<a name="Hub+_listBitcoinBlockSummaries"></a>

### hub.\_listBitcoinBlockSummaries(bitcoin, range) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
Inclusive height window of block summaries (ascending by height).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| bitcoin | <code>object</code> | 
| range | <code>Object</code> | 

<a name="Hub+_handleBitcoinCrowdfundingAcpDonationPsbtRequest"></a>

### hub.\_handleBitcoinCrowdfundingAcpDonationPsbtRequest()
GET .../campaigns/:id/acp-donation-psbt?amountSats=
Outputs-only PSBT: one output to the campaign vault; donors add inputs with SIGHASH_ALL|ANYONECANPAY.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinCrowdfundingPayoutSignArbiterRequest"></a>

### hub.\_handleBitcoinCrowdfundingPayoutSignArbiterRequest()
POST body: `{ psbtBase64 }` — PSBT after beneficiary signed all inputs (tapscript path).
Hub adds arbiter Schnorr sigs via `crowdfundingTaproot.signAllInputsWithKey` (same order as finalize).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleBitcoinCrowdfundingPayoutBroadcastRequest"></a>

### hub.\_handleBitcoinCrowdfundingPayoutBroadcastRequest()
POST body: `{ psbtBase64 }` — fully signed payout PSBT (beneficiary + arbiter).
Validates inputs pay the campaign vault, `crowdfundingTaproot.finalizeCrowdfundPayoutPsbt`, then `sendrawtransaction`.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_normalizeXpubForNetwork"></a>

### hub.\_normalizeXpubForNetwork()
Normalize xpub version bytes for the given network (regtest/testnet use testnet bytes).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_extractOptionalAdminTokenFromRequest"></a>

### hub.\_extractOptionalAdminTokenFromRequest(req) ⇒ <code>string</code> \| <code>null</code>
Setup admin token from `Authorization: Bearer` or `?adminToken=` (GET ergonomics).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 

<a name="Hub+_isSetupAdminRequest"></a>

### hub.\_isSetupAdminRequest(req) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 

<a name="Hub+_requireAdminTokenForHubWalletHttp"></a>

### hub.\_requireAdminTokenForHubWalletHttp(req, res, [message]) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>boolean</code> - false when 403 already sent  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 
| res | <code>object</code> | 
| [message] | <code>string</code> | 

<a name="Hub+_authorizeBitcoinXpubQueryHttp"></a>

### hub.\_authorizeBitcoinXpubQueryHttp(req, res) ⇒ <code>boolean</code>
When `settings.bitcoin.xpubQueryToken` is set (e.g. `FABRIC_BITCOIN_XPUB_QUERY_TOKEN`), HTTP watch-only
xpub routes that run `scantxoutset` — **`GET /services/bitcoin/xpub`**, **`GET /services/bitcoin/xpub/utxos`**,
**`GET /services/bitcoin/xpub/transactions`**, and legacy **`GET /services/bitcoin/wallets/:walletId`** with
**`?xpub=`** when `:walletId` ≠ the Hub wallet name — require this shared secret.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>boolean</code> - false when 403 already sent  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 
| res | <code>object</code> | 

<a name="Hub+_bitcoinXpubWatchSummaryPayload"></a>

### hub.\_bitcoinXpubWatchSummaryPayload(bitcoin, xpub, addressesParam) ⇒ <code>Promise.&lt;object&gt;</code>
Watch-only xpub balance (scantxoutset on BIP84 descriptors) + optional mempool amounts for ?addresses=

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>Promise.&lt;object&gt;</code> - JSON fields (no walletId)  

| Param | Type | Description |
| --- | --- | --- |
| bitcoin | <code>object</code> |  |
| xpub | <code>string</code> |  |
| addressesParam | <code>string</code> | comma-separated watch addresses |

<a name="Hub+_bitcoinXpubWatchUtxosPayload"></a>

### hub.\_bitcoinXpubWatchUtxosPayload(bitcoin, xpub) ⇒ <code>Promise.&lt;object&gt;</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>Promise.&lt;object&gt;</code> - { network, utxos, keysHeldByServer }  

| Param | Type |
| --- | --- |
| bitcoin | <code>object</code> | 
| xpub | <code>string</code> | 

<a name="Hub+_bitcoinXpubWatchTransactionsPayload"></a>

### hub.\_bitcoinXpubWatchTransactionsPayload(bitcoin, xpub, addressesParam, limit) ⇒ <code>Promise.&lt;object&gt;</code>
**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: <code>Promise.&lt;object&gt;</code> - { network, transactions, keysHeldByServer }  

| Param | Type | Default |
| --- | --- | --- |
| bitcoin | <code>object</code> |  | 
| xpub | <code>string</code> |  | 
| addressesParam | <code>string</code> |  | 
| limit | <code>number</code> | <code>50</code> | 

<a name="Hub+_bitcoinXpubFromRequest"></a>

### hub.\_bitcoinXpubFromRequest(req) ⇒ <code>string</code>
Resolve watch-only xpub from a request without preferring query strings
(which land in access logs). Order: `X-Fabric-Xpub` header → JSON body
`xpub` → `?xpub=` (legacy).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| req | <code>object</code> | 

<a name="Hub+_filterMempoolPaymentSummariesForAddresses"></a>

### hub.\_filterMempoolPaymentSummariesForAddresses(bitcoin, watchAddrs, limit)
Mempool payment summaries (same JSON shape as legacy GET /payments) filtered to txs paying watched addresses.

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type |
| --- | --- |
| bitcoin | <code>object</code> | 
| watchAddrs | <code>Set.&lt;string&gt;</code> | 
| limit | <code>number</code> | 

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
<a name="Hub+_publishCoinjoinMessage"></a>

### hub.\_publishCoinjoinMessage(body, [opts]) ⇒ <code>boolean</code>
Put a coinjoin `CONTRACT_MESSAGE` on the Fabric mesh. Sealed round
messages go out under a throwaway key so the wire signature does not
name this Hub (the round key inside authenticates them).

**Kind**: instance method of [<code>Hub</code>](#Hub)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>Object</code> | `functions/coinjoin` `toContractMessage` output |
| [opts] | <code>Object</code> | `{ anonymous }` |

<a name="Hub+_marketAgentAdminOk"></a>

### hub.\_marketAgentAdminOk()
Admin token (Bearer or body) gate shared by the agent write routes.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handlePayjoinContributeRequest"></a>

### hub.\_handlePayjoinContributeRequest()
POST /services/payjoin/sessions/:sessionId/contribute (legacy alias: …/acp-hub-boost; mirrors: /payments/payjoin/…, /services/bitcoin/payjoin/…)
Admin: run the BIP78 receiver contribution for the session's latest proposal (or `psbt` in the body).
Body may carry BIP78 parameters as `bip78Params` ({ additionalfeeoutputindex, maxadditionalfeecontribution, minfeerate }).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_hubBitcoindJsonRpc"></a>

### hub.\_hubBitcoindJsonRpc()
POST /services/bitcoin with body { jsonrpc: '2.0', method, params: [], id }.
- verifymessage: implemented locally (no bitcoind) using tiny-secp256k1 + bitcoinjs-lib.
- other methods: forwarded to Fabric Bitcoin service RPC when available (passthrough to bitcoind).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_handleLightningChannelDeleteRequest"></a>

### hub.\_handleLightningChannelDeleteRequest()
Close a Lightning channel (REST: DELETE …/channels/:channelId).

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_repairManagedRegtestSettingsJsonIfCorrupt"></a>

### hub.\_repairManagedRegtestSettingsJsonIfCorrupt() ⇒ <code>void</code>
Managed regtest bitcoind can refuse to boot if `regtest/settings.json` is malformed
after an unclean shutdown. Detect and quarantine the file before startup so the node
can recreate defaults.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Hub+_startPhase_diagnostics"></a>

### hub.\_startPhase\_diagnostics() ⇒ [<code>Hub</code>](#Hub)
Start the instance.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  
<a name="Hub+stop"></a>

### hub.stop() ⇒ [<code>Hub</code>](#Hub)
Stop the instance.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
**Returns**: [<code>Hub</code>](#Hub) - Instance of the [Hub](#Hub).  
<a name="documents"></a>

## documents
Optional Document Market: persist peer inventories and republish held files at a markup.
Off by default. See `functions/documentInventoryMarket.js`.

**Kind**: global variable  
<a name="fabricPeerId"></a>

## fabricPeerId
Stable Fabric P2P identity (secp256k1 pubkey hex) for sharing — does not change with contract state.

**Kind**: global variable  
<a name="bitcoin"></a>

## bitcoin
Wallet-safe Bitcoin head (height, tip hash, network, mempool counts) for operator UIs (e.g. Peers).

**Kind**: global variable  
<a name="bitcoin.listen"></a>

### bitcoin.listen
Managed bitcoind: accept inbound P2P on the network’s default port unless set to `false` (tests use custom ports + `listen: false`).

**Kind**: static property of [<code>bitcoin</code>](#bitcoin)  
<a name="email"></a>

## email
Outbound email (invitations / alerts); no secrets in this snapshot.

**Kind**: global variable  
<a name="bandwidth"></a>

## bandwidth
Fabric P2P byte counters vs Bitcoin L1 (1 MiB / 10 min) split across 32 peers.

**Kind**: global variable  
<a name="featureFlags"></a>

## featureFlags
Server process FEATURE_FLAGS (see constants.js / FABRIC_FEATURE_*).

**Kind**: global variable  
<a name="documentMarket"></a>

## documentMarket
Optional Document Market (peer inventory book + markup republish). Off by default.

**Kind**: global variable  
<a name="_rpcHttpLocalStore"></a>

## \_rpcHttpLocalStore
Per-request loopback flag for HTTP JSON-RPC (avoids racing a Hub instance field).

**Kind**: global constant  
<a name="HUB_PARENT_CHAIN_SKIP"></a>

## HUB\_PARENT\_CHAIN\_SKIP
Ping/pong keep genesis parent. Durable Hub log frames (including GENESIS_MESSAGE) chain AMP `parent`.

**Kind**: global constant  
<a name="BITCOIN_TX_DOC_INDEX_MAX_TXS"></a>

## BITCOIN\_TX\_DOC\_INDEX\_MAX\_TXS
Skip per-tx Fabric documents when a block has more than this many txs (mainnet safety).

**Kind**: global constant  
<a name="HUB_SELF_DESTRUCT_CONFIRM_PHRASE"></a>

## HUB\_SELF\_DESTRUCT\_CONFIRM\_PHRASE
Body field `confirmPhrase` for [Hub#_handleSettingsSelfDestructRequest](Hub#_handleSettingsSelfDestructRequest) must match exactly (admin-only).
Wipes writable `stores/` and `logs/` under [hubStoreRoot](#hubStoreRoot) after [stop](#Hub+stop).

**Kind**: global constant  
<a name="INVENTORY_FILE_RELAY_TTL"></a>

## INVENTORY\_FILE\_RELAY\_TTL
Max Fabric hops for relayed P2P_FILE_SEND chunks (per chunk, decremented each forward).

**Kind**: global constant  
<a name="WEBRTC_RELAY_MAX_HOPS"></a>

## WEBRTC\_RELAY\_MAX\_HOPS
Max WebRTC→Fabric relay hops (envelope.hops length) before refusing to fan out.

**Kind**: global constant  
<a name="WEBRTC_RELAY_MAX_PER_SEC"></a>

## WEBRTC\_RELAY\_MAX\_PER\_SEC
Per WebRTC peer id: max RelayFromWebRTC fan-outs per second (DoS guard).

**Kind**: global constant  
<a name="hubAssetsDir"></a>

## hubAssetsDir()
Read-only static root (see `resolveAppAssetsDir` on `@fabric/http`).

**Kind**: global function  
<a name="hubStoreRoot"></a>

## hubStoreRoot()
Writable store root (Electron: FABRIC_HUB_USER_DATA).

**Kind**: global function  
<a name="resolveStorePath"></a>

## resolveStorePath(p) ⇒ <code>string</code>
Resolve an absolute path under the writable store root.

**Kind**: global function  

| Param | Type |
| --- | --- |
| p | <code>string</code> | 

<a name="payjoinContributionFlag"></a>

## payjoinContributionFlag()
`receiverContribution` (or legacy `autoAcpBoost`) from a request body; undefined = service default.

**Kind**: global function  
