'use strict';

const React = require('react');
const {
  Button,
  Form,
  Header,
  Icon,
  Message,
  Segment,
  TextArea,
  Divider,
  Label
} = require('semantic-ui-react');
const { toast } = require('../functions/toast');
const { sha256 } = require('@noble/hashes/sha256');
const {
  getSidechainState,
  submitSidechainStatePatch,
  fetchDistributedEpoch
} = require('../functions/sidechainHubClient');
const {
  createOfferRecord,
  patchesForNewOffer,
  patchReplaceOffer,
  buildDocumentOfferEnvelope
} = require('../functions/documentOffer');
const {
  buildDocumentOfferEscrow,
  verifyDocumentOfferFunding,
  prepareDocumentOfferDelivererClaimPsbt,
  prepareDocumentOfferInitiatorRefundPsbt,
  broadcastSignedTransaction,
  getBitcoinTipHeight
} = require('../functions/documentOfferHubClient');
const {
  signDelivererClaimFromPsbtBase64,
  signInitiatorRefundFromPsbtBase64
} = require('../functions/documentOfferTxBrowser');
const { DOCUMENT_OFFER } = require('../functions/messageTypes');
const { loadHubUiFeatureFlags, subscribeHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { Link } = require('react-router-dom');
const DistributedFederationPanel = require('./DistributedFederationPanel');

function paymentHashHexFromPreimageHex (preimageHex) {
  const clean = String(preimageHex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(clean)) return '';
  return Buffer.from(sha256(Uint8Array.from(Buffer.from(clean, 'hex')))).toString('hex');
}

function safeJson (obj, space = 2) {
  try {
    return JSON.stringify(obj, null, space);
  } catch (e) {
    return String(obj);
  }
}

function newOfferId () {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

class SidechainHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      sidechain: null,
      epoch: null,
      epochError: null,
      patchJson: '[\n  { "op": "add", "path": "/example", "value": true }\n]',
      federationWitnessJson: '',
      basisClockNote: '',
      offerDocumentId: '',
      offerRewardSats: '10000',
      offerMemo: '',
      offerAnnounceChat: true,
      lastPatchResult: null,
      inboundOffer: null,
      escrowPreimageHex: '',
      escrowPaymentHashHex: '',
      escrowDelivererPubkey: '',
      escrowInitiatorRefundPubkey: '',
      escrowRefundLockHeight: '',
      escrowRefundDelta: '144',
      escrowBuildResult: null,
      l1OfferId: '',
      l1FundingTxid: '',
      l1ClaimDestAddress: '',
      l1RefundDestAddress: '',
      l1FeeClaimSats: '2000',
      l1FeeRefundSats: '2000',
      l1DelivererPrivHex: '',
      l1InitiatorPrivHex: '',
      l1LastPsbtClaim: '',
      l1LastPsbtRefund: '',
      l1LastSignedTxHex: '',
      hubUiFlagsRev: 0
    };
    this._onDocumentOffer = this._onDocumentOffer.bind(this);
  }

  componentDidMount () {
    this.refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('fabric:documentOffer', this._onDocumentOffer);
      this._hubUiFlagsUnsub = subscribeHubUiFeatureFlags(() => {
        this.setState((s) => ({ hubUiFlagsRev: (s.hubUiFlagsRev || 0) + 1 }));
      });
    }
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('fabric:documentOffer', this._onDocumentOffer);
    }
    if (typeof this._hubUiFlagsUnsub === 'function') {
      this._hubUiFlagsUnsub();
      this._hubUiFlagsUnsub = null;
    }
  }

  _onDocumentOffer (ev) {
    const d = ev && ev.detail;
    if (!d || !d.object) return;
    this.setState({ inboundOffer: d });
    toast.info('Incoming DOCUMENT_OFFER (see Demo section)');
  }

  _getInitiatorId () {
    const id = this.props.identity && (this.props.identity.fabricPeerId || this.props.identity.id);
    if (id) return String(id);
    const br = this.props.bridgeRef && this.props.bridgeRef.current;
    if (br && typeof br._getIdentityId === 'function') {
      const x = br._getIdentityId();
      if (x) return String(x);
    }
    return '';
  }

  async refresh () {
    this.setState({ loading: true, epochError: null });
    try {
      const [st, ep] = await Promise.all([getSidechainState(), fetchDistributedEpoch()]);
      const next = { sidechain: st.ok ? st.state : null };
      if (!st.ok) next.epochError = st.error || 'GetSidechainState failed';
      if (ep.ok) next.epoch = ep.data;
      else if (!next.epochError) next.epochError = ep.error || 'epoch fetch failed';
      if (st.ok && st.state && typeof st.state.clock === 'number') {
        next.patchJson = this.state.patchJson;
        next.basisClockNote = `Current logical clock: ${st.state.clock} — use this as basisClock when submitting patches.`;
      }
      this.setState(next);
    } catch (e) {
      this.setState({ epochError: e && e.message ? e.message : String(e) });
    } finally {
      this.setState({ loading: false });
    }
  }

  _sealedDigestHint () {
    const { sidechain, epoch } = this.state;
    const last = epoch && epoch.beacon && epoch.beacon.last;
    const payload = last && last.payload;
    const sc = payload && payload.sidechain;
    if (!sc || sc.stateDigest == null) {
      return { text: 'No sidechain digest in last sealed epoch (beacon idle or no epochs yet).', color: 'grey' };
    }
    const cur = sidechain && sidechain.stateDigest;
    if (!cur) return { text: `Last sealed digest: ${sc.stateDigest}`, color: 'blue' };
    if (String(sc.stateDigest) === String(cur)) {
      return { text: 'Live head matches last sealed epoch sidechain digest.', color: 'green' };
    }
    return {
      text: 'Live stateDigest differs from last sealed epoch — unsealed patch, sync lag, or post-reorg reconciliation (see BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md, section 6).',
      color: 'orange'
    };
  }

  _parseFederationWitnessFromState () {
    const raw = String(this.state.federationWitnessJson || '').trim();
    if (!raw) return { ok: true, witness: null };
    try {
      return { ok: true, witness: JSON.parse(raw) };
    } catch (_) {
      return { ok: false, error: 'federation witness JSON' };
    }
  }

  /**
   * Admin token + optional witness for every `submitSidechainStatePatch` call on this page.
   * @returns {{ ok: true, adminToken?: string, federationWitness?: object } | { ok: false, error: string }}
   */
  _sidechainPatchAuth () {
    const adminToken = this._adminToken();
    const fw = this._parseFederationWitnessFromState();
    if (!fw.ok) return { ok: false, error: `Invalid ${fw.error}` };
    return {
      ok: true,
      adminToken: adminToken || undefined,
      federationWitness: fw.witness || undefined
    };
  }

  async _submitRawPatch () {
    let patches;
    try {
      patches = JSON.parse(this.state.patchJson);
    } catch (e) {
      toast.error('Invalid JSON in patches');
      return;
    }
    if (!Array.isArray(patches) || !patches.length) {
      toast.error('patches must be a non-empty array');
      return;
    }
    const basisClock = this.state.sidechain && Number.isFinite(Number(this.state.sidechain.clock))
      ? Number(this.state.sidechain.clock)
      : NaN;
    if (!Number.isFinite(basisClock)) {
      toast.error('Load sidechain state first');
      return;
    }
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const out = await submitSidechainStatePatch({
      patches,
      basisClock,
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Patch failed');
      return;
    }
    this.setState({ lastPatchResult: out.result });
    toast.success('Sidechain patch applied');
    await this.refresh();
  }

  async _submitDocumentOfferDemo () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const documentId = String(this.state.offerDocumentId || '').trim();
    const rewardSats = Math.max(0, Math.floor(Number(this.state.offerRewardSats) || 0));
    const initiatorFabricId = this._getInitiatorId();
    if (!documentId) {
      toast.error('Document id required');
      return;
    }
    if (!initiatorFabricId) {
      toast.error('Unlock identity (or set Fabric id) so initiator is known — Settings → Fabric identity or top-bar Locked.');
      return;
    }
    if (!this.state.sidechain) {
      toast.error('Load sidechain state first');
      return;
    }
    const offerId = newOfferId();
    const record = createOfferRecord({
      offerId,
      documentId,
      rewardSats,
      initiatorFabricId,
      memo: this.state.offerMemo
    });
    const patches = patchesForNewOffer(
      (this.state.sidechain && this.state.sidechain.content) || {},
      offerId,
      record
    );
    const basisClock = Number(this.state.sidechain.clock);
    const out = await submitSidechainStatePatch({
      patches,
      basisClock,
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Offer patch failed');
      return;
    }
    toast.success(`Document offer ${offerId} recorded on sidechain`);

    const br = this.props.bridgeRef && this.props.bridgeRef.current;
    if (this.state.offerAnnounceChat && br && typeof br.submitChatMessage === 'function') {
      const env = buildDocumentOfferEnvelope(
        { id: initiatorFabricId },
        { offerId, documentId, rewardSats, phase: record.phase, kind: DOCUMENT_OFFER }
      );
      const line = `[${DOCUMENT_OFFER}] ${JSON.stringify(env)}`;
      br.submitChatMessage(line);
      toast.info('Posted offer marker to activity chat (multi-hop / WebRTC demo signal)');
    }

    this.setState({ lastPatchResult: out.result });
    await this.refresh();
  }

  async _advanceOfferPhase (phase) {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const id = String(this.state.l1OfferId || '').trim();
    if (!id) {
      toast.error('Set Offer id first');
      return;
    }
    if (!id || !this.state.sidechain || !this.state.sidechain.content) return;
    const offers = this.state.sidechain.content.documentOffers;
    if (!offers || !offers[id]) {
      toast.error('Unknown offer id');
      return;
    }
    const next = { ...offers[id], phase };
    const patches = patchReplaceOffer(id, next);
    const basisClock = Number(this.state.sidechain.clock);
    const out = await submitSidechainStatePatch({
      patches,
      basisClock,
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Update failed');
      return;
    }
    toast.success(`Offer ${id} → ${phase}`);
    await this.refresh();
  }

  _adminToken () {
    return this.props.adminToken ||
      (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken')) ||
      '';
  }

  _genEscrowPreimage () {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.getRandomValues) {
      toast.error('WebCrypto unavailable');
      return;
    }
    const u8 = new Uint8Array(32);
    window.crypto.getRandomValues(u8);
    const hex = Buffer.from(u8).toString('hex');
    const ph = paymentHashHexFromPreimageHex(hex);
    this.setState({ escrowPreimageHex: hex, escrowPaymentHashHex: ph });
    toast.success('New 32-byte preimage (keep secret until delivery)');
  }

  async _syncRefundLockFromTip () {
    const tip = await getBitcoinTipHeight();
    if (!tip.ok) {
      toast.error(tip.error || 'Could not read chain tip');
      return;
    }
    const delta = Math.max(1, Math.floor(Number(this.state.escrowRefundDelta) || 144));
    this.setState({ escrowRefundLockHeight: String(tip.height + delta) });
    toast.info(`refundLockHeight = tip (${tip.height}) + ${delta}`);
  }

  async _buildEscrowAddress () {
    const paymentHashHex = String(this.state.escrowPaymentHashHex || '').trim().toLowerCase();
    const delivererPubkeyHex = String(this.state.escrowDelivererPubkey || '').trim().replace(/\s+/g, '');
    const initiatorRefundPubkeyHex = String(this.state.escrowInitiatorRefundPubkey || '').trim().replace(/\s+/g, '');
    const refundLockHeight = Math.floor(Number(this.state.escrowRefundLockHeight) || 0);
    if (!paymentHashHex || paymentHashHex.length !== 64) {
      toast.error('Generate preimage first (payment hash must be 64 hex chars)');
      return;
    }
    if (!delivererPubkeyHex || delivererPubkeyHex.length !== 66) {
      toast.error('Deliverer pubkey: 33-byte compressed secp256k1 hex (66 chars)');
      return;
    }
    if (!initiatorRefundPubkeyHex || initiatorRefundPubkeyHex.length !== 66) {
      toast.error('Initiator refund pubkey: 66 hex chars (compressed)');
      return;
    }
    if (!Number.isFinite(refundLockHeight) || refundLockHeight < 1) {
      toast.error('Set refundLockHeight (absolute block height for CLTV refund)');
      return;
    }
    const rewardSats = Math.max(0, Math.floor(Number(this.state.offerRewardSats) || 0));
    const out = await buildDocumentOfferEscrow({
      paymentHashHex,
      delivererPubkeyHex,
      initiatorRefundPubkeyHex,
      refundLockHeight,
      rewardSats,
      label: `offer-${(this.state.l1OfferId || newOfferId()).slice(0, 12)}`
    });
    if (!out.ok || !out.result || out.result.status !== 'success') {
      toast.error(out.error || (out.result && out.result.message) || 'Build escrow failed');
      return;
    }
    this.setState({ escrowBuildResult: out.result });
    toast.success('Escrow address derived (fund this output ≥ reward sats)');
  }

  async _recordL1OfferOnSidechain () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const br = this.state.escrowBuildResult;
    if (!br || !br.paymentAddress) {
      toast.error('Build escrow address first');
      return;
    }
    const documentId = String(this.state.offerDocumentId || '').trim();
    const rewardSats = Math.max(0, Math.floor(Number(this.state.offerRewardSats) || 0));
    const initiatorFabricId = this._getInitiatorId();
    if (!documentId || !initiatorFabricId) {
      toast.error('Document id and unlocked identity required');
      return;
    }
    if (!this.state.sidechain) {
      toast.error('Load sidechain state first');
      return;
    }
    const offerId = String(this.state.l1OfferId || '').trim() || newOfferId();
    const record = createOfferRecord({
      offerId,
      documentId,
      rewardSats,
      initiatorFabricId,
      memo: this.state.offerMemo,
      phase: 'funding_pending',
      paymentAddress: br.paymentAddress,
      paymentHashHex: br.paymentHashHex,
      claimScriptHex: br.claimScriptHex,
      refundScriptHex: br.refundScriptHex,
      delivererEscrowPubkeyHex: String(this.state.escrowDelivererPubkey || '').trim().replace(/\s+/g, ''),
      initiatorRefundPubkeyHex: String(this.state.escrowInitiatorRefundPubkey || '').trim().replace(/\s+/g, ''),
      refundLockHeight: Math.floor(Number(this.state.escrowRefundLockHeight) || 0)
    });
    const patches = patchesForNewOffer(
      (this.state.sidechain && this.state.sidechain.content) || {},
      offerId,
      record
    );
    const basisClock = Number(this.state.sidechain.clock);
    const out = await submitSidechainStatePatch({
      patches,
      basisClock,
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Patch failed');
      return;
    }
    this.setState({ l1OfferId: offerId, lastPatchResult: out.result });
    toast.success(`Offer ${offerId} on sidechain — fund ${br.paymentAddress}`);

    if (this.state.offerAnnounceChat && this.props.bridgeRef && this.props.bridgeRef.current) {
      const brInst = this.props.bridgeRef.current;
      if (typeof brInst.submitChatMessage === 'function') {
        const env = buildDocumentOfferEnvelope(
          { id: initiatorFabricId },
          {
            offerId,
            documentId,
            rewardSats,
            phase: 'funding_pending',
            paymentAddress: br.paymentAddress,
            kind: DOCUMENT_OFFER
          }
        );
        brInst.submitChatMessage(`[${DOCUMENT_OFFER}] ${JSON.stringify(env)}`);
      }
    }
    await this.refresh();
  }

  async _verifyL1FundingAndPatch () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const offerId = String(this.state.l1OfferId || '').trim();
    const txid = String(this.state.l1FundingTxid || '').trim().toLowerCase();
    if (!offerId || !txid) {
      toast.error('Set l1OfferId and funding txid');
      return;
    }
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error('Load sidechain; offer must exist');
      return;
    }
    const offers = this.state.sidechain.content.documentOffers;
    const rec = offers[offerId];
    if (!rec || !rec.paymentAddress) {
      toast.error('Unknown offer or missing paymentAddress on record');
      return;
    }
    const rewardSats = Math.max(0, Math.floor(Number(rec.rewardSats) || 0));
    const v = await verifyDocumentOfferFunding({
      fundingTxid: txid,
      paymentAddress: rec.paymentAddress,
      rewardSats
    });
    if (!v.ok || !v.result || v.result.status !== 'success' || !v.result.verified) {
      toast.error(v.error || (v.result && v.result.message) || 'Funding not verified');
      return;
    }
    const next = {
      ...rec,
      phase: 'funded',
      fundingTxid: txid,
      fundingVout: v.result.fundingVout != null ? v.result.fundingVout : rec.fundingVout
    };
    const patches = patchReplaceOffer(offerId, next);
    const out = await submitSidechainStatePatch({
      patches,
      basisClock: Number(this.state.sidechain.clock),
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Patch failed');
      return;
    }
    toast.success('Offer marked funded on sidechain');
    await this.refresh();
  }

  async _revealPreimageDelivered () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const offerId = String(this.state.l1OfferId || '').trim();
    const preimage = String(this.state.escrowPreimageHex || '').trim().toLowerCase();
    if (!offerId || !/^[0-9a-f]{64}$/.test(preimage)) {
      toast.error('Offer id and local escrow preimage (64 hex) required');
      return;
    }
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error('Load sidechain');
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec) {
      toast.error('Unknown offer');
      return;
    }
    const want = String(rec.paymentHashHex || '').toLowerCase();
    const got = paymentHashHexFromPreimageHex(preimage);
    if (want && got !== want) {
      toast.error('Preimage does not match offer paymentHashHex');
      return;
    }
    const next = { ...rec, phase: 'delivered', revealedPreimageHex: preimage };
    const patches = patchReplaceOffer(offerId, next);
    const out = await submitSidechainStatePatch({
      patches,
      basisClock: Number(this.state.sidechain.clock),
      adminToken: auth.adminToken,
      federationWitness: auth.federationWitness
    });
    if (!out.ok) {
      toast.error(out.error || 'Patch failed');
      return;
    }
    toast.success('Preimage on sidechain — deliverer can build claim tx');
    await this.refresh();
  }

  async _prepareDelivererClaim () {
    const offerId = String(this.state.l1OfferId || '').trim();
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error('Load sidechain');
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec || !rec.fundingTxid || !rec.revealedPreimageHex) {
      toast.error('Offer needs funded + delivered (revealed preimage)');
      return;
    }
    const dest = String(this.state.l1ClaimDestAddress || '').trim();
    if (!dest) {
      toast.error('Claim payout address required');
      return;
    }
    const feeSats = Math.max(1, Math.floor(Number(this.state.l1FeeClaimSats) || 2000));
    const prep = await prepareDocumentOfferDelivererClaimPsbt({
      fundingTxid: rec.fundingTxid,
      paymentAddress: rec.paymentAddress,
      claimScriptHex: rec.claimScriptHex,
      refundScriptHex: rec.refundScriptHex,
      preimageHex: rec.revealedPreimageHex,
      destinationAddress: dest,
      feeSats
    });
    if (!prep.ok || !prep.result || prep.result.status !== 'success') {
      toast.error(prep.error || (prep.result && prep.result.message) || 'Prepare PSBT failed');
      return;
    }
    this.setState({ l1LastPsbtClaim: prep.result.psbtBase64 });
    toast.success('Claim PSBT ready — sign with deliverer key then broadcast');
  }

  _signAndBroadcastClaim () {
    const psbtB64 = String(this.state.l1LastPsbtClaim || '').trim();
    const priv = String(this.state.l1DelivererPrivHex || '').trim().replace(/^0x/i, '');
    if (!psbtB64 || !/^[0-9a-f]{64}$/i.test(priv)) {
      toast.error('Prepare claim PSBT and paste deliverer secp256k1 private key (64 hex)');
      return;
    }
    const offerId = String(this.state.l1OfferId || '').trim();
    const rec = this.state.sidechain && this.state.sidechain.content && this.state.sidechain.content.documentOffers
      ? this.state.sidechain.content.documentOffers[offerId]
      : null;
    const preimage = String((rec && rec.revealedPreimageHex) || this.state.escrowPreimageHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(preimage)) {
      toast.error('Offer must include revealedPreimageHex (refresh sidechain) or keep local preimage');
      return;
    }
    let txHex;
    try {
      ({ txHex } = signDelivererClaimFromPsbtBase64(psbtB64, preimage, priv));
    } catch (e) {
      this.setState({ l1DelivererPrivHex: '' });
      toast.error(e && e.message ? e.message : 'Sign failed');
      return;
    }
    this.setState({ l1DelivererPrivHex: '' });
    this._broadcastExitTx(txHex, 'claim');
  }

  async _prepareInitiatorRefund () {
    const offerId = String(this.state.l1OfferId || '').trim();
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error('Load sidechain');
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec || !rec.fundingTxid || !rec.refundLockHeight) {
      toast.error('Offer missing funding or refundLockHeight');
      return;
    }
    const dest = String(this.state.l1RefundDestAddress || '').trim();
    if (!dest) {
      toast.error('Refund payout address required');
      return;
    }
    const feeSats = Math.max(1, Math.floor(Number(this.state.l1FeeRefundSats) || 2000));
    const prep = await prepareDocumentOfferInitiatorRefundPsbt({
      fundingTxid: rec.fundingTxid,
      paymentAddress: rec.paymentAddress,
      claimScriptHex: rec.claimScriptHex,
      refundScriptHex: rec.refundScriptHex,
      refundLockHeight: rec.refundLockHeight,
      destinationAddress: dest,
      feeSats
    });
    if (!prep.ok || !prep.result || prep.result.status !== 'success') {
      toast.error(prep.error || (prep.result && prep.result.message) || 'Prepare refund PSBT failed');
      return;
    }
    if (prep.result.refundValidOnChain === false) {
      toast.warning('Chain tip below refundLockHeight — tx may not relay yet');
    }
    this.setState({ l1LastPsbtRefund: prep.result.psbtBase64 });
    toast.success('Refund PSBT ready — sign with initiator refund key');
  }

  _signAndBroadcastRefund () {
    const psbtB64 = String(this.state.l1LastPsbtRefund || '').trim();
    const priv = String(this.state.l1InitiatorPrivHex || '').trim().replace(/^0x/i, '');
    if (!psbtB64 || !/^[0-9a-f]{64}$/i.test(priv)) {
      toast.error('Prepare refund PSBT and paste initiator refund private key (64 hex)');
      return;
    }
    let txHex;
    try {
      ({ txHex } = signInitiatorRefundFromPsbtBase64(psbtB64, priv));
    } catch (e) {
      this.setState({ l1InitiatorPrivHex: '' });
      toast.error(e && e.message ? e.message : 'Sign failed');
      return;
    }
    this.setState({ l1InitiatorPrivHex: '' });
    this._broadcastExitTx(txHex, 'refund');
  }

  async _broadcastExitTx (txHex, exitKind) {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const b = await broadcastSignedTransaction({ signedTxHex: txHex, adminToken: auth.adminToken });
    if (!b.ok || !b.result || b.result.status !== 'success') {
      toast.error(b.error || (b.result && b.result.message) || 'Broadcast failed');
      return;
    }
    const txid = b.result.txid;
    this.setState({ l1LastSignedTxHex: txHex });
    toast.success(`Broadcast ${exitKind}: ${txid}`);

    const offerId = String(this.state.l1OfferId || '').trim();
    if (offerId && this.state.sidechain && this.state.sidechain.content && this.state.sidechain.content.documentOffers) {
      const rec = this.state.sidechain.content.documentOffers[offerId];
      if (rec) {
        const next = { ...rec, phase: 'settled', exitTxid: txid, exitKind };
        const patches = patchReplaceOffer(offerId, next);
        const out = await submitSidechainStatePatch({
          patches,
          basisClock: Number(this.state.sidechain.clock),
          adminToken: auth.adminToken,
          federationWitness: auth.federationWitness
        });
        if (out.ok) await this.refresh();
      }
    }
  }

  render () {
    const { loading, sidechain, epoch, epochError, patchJson, basisClockNote, lastPatchResult, inboundOffer } = this.state;
    void this.state.hubUiFlagsRev;
    const hubUi = loadHubUiFeatureFlags();
    const hint = this._sealedDigestHint();
    const beacon = epoch && epoch.beacon;
    const lastPayload = beacon && beacon.last && beacon.last.payload;

    return (
      <Segment.Group>
        <Segment>
          <Header as="h2">
            <Icon name="chain" />
            Sidechain & beacon (operator)
          </Header>
          <p style={{ color: '#666', maxWidth: '52em' }}>
            Logical <code>sidechain/STATE</code> with JSON Patch updates; beacon epochs seal{' '}
            <code>payload.sidechain</code>. Use the same Hub origin when testing LAN nodes (e.g.{' '}
            <code>http://192.168.50.5:8080</code>). Multi-hop chat: use Home → WebRTC discovery, then send chat;
            offers can mirror to chat for visibility.
            {' '}
            <Link to="/contracts">Execution contracts</Link> cover L1 registry, deterministic runs, and how federation relates (or does not) to <code>RunExecutionContract</code>.
            {' '}
            The <strong>Federation guarantees</strong> panel below links to Beacon settings, live manifest/epoch JSON, and reproducing <code>federationWitness</code> with <code>@fabric/core</code>.
          </p>
          <div
            role="toolbar"
            aria-label="Hub shortcuts"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center', marginBottom: '0.65em' }}
          >
            <Button as={Link} to="/" basic size="small" icon labelPosition="left" aria-label="Back to home">
              <Icon name="arrow left" aria-hidden="true" />
              Home
            </Button>
            <Button as={Link} to="/contracts" basic size="small" title="Execution contracts and L1 registry">
              Contracts
            </Button>
            <Button as={Link} to="/services/bitcoin" basic size="small" title="Bitcoin status, regtest, Lightning">
              Bitcoin
            </Button>
            {hubUi.bitcoinPayments ? (
              <Button as={Link} to="/services/bitcoin/payments" basic size="small" title="Payjoin and payments">
                Payments
              </Button>
            ) : null}
            {hubUi.bitcoinResources ? (
              <Button as={Link} to="/services/bitcoin/resources" basic size="small" title="HTTP resources and L1 verify">
                Resources
              </Button>
            ) : null}
            {hubUi.bitcoinCrowdfund ? (
              <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" title="Taproot crowdfund vault">
                <Icon name="heart" />
                Crowdfunds
              </Button>
            ) : null}
          </div>
          <Button primary icon loading={loading} onClick={() => this.refresh()}>
            <Icon name="refresh" />
            Refresh
          </Button>
          {epochError && (
            <Message warning style={{ marginTop: '1em' }}>
              <Message.Header>Fetch warning</Message.Header>
              <p>{epochError}</p>
            </Message>
          )}
          <DistributedFederationPanel hideSidechainNavLink style={{ marginTop: '1em' }} />
        </Segment>

        <Segment>
          <Header as="h3">Beacon / distributed epoch</Header>
          <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em', maxWidth: '48em' }}>
            Hub summary (not the full sealed message). Compare any L1 height/hash in the live epoch payload to your node; re-verify Schnorr witness bytes against the manifest pubkeys (see the Federation guarantees panel above).
          </p>
          {beacon ? (
            <pre style={{ fontSize: '12px', overflow: 'auto' }}>{safeJson({
              status: beacon.status,
              clock: beacon.clock,
              merkleRoot: beacon.merkleRoot,
              epochCount: beacon.epochCount,
              lastCommitmentDigest: beacon.lastCommitmentDigest,
              lastL1Binding: lastPayload
                ? {
                  beaconClock: lastPayload.clock,
                  height: lastPayload.height,
                  blockHash: lastPayload.blockHash
                }
                : null,
              lastSidechain: lastPayload && lastPayload.sidechain
            })}</pre>
          ) : (
            <Message info>No epoch data yet.</Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">Live sidechain state</Header>
          <Label color={hint.color} style={{ marginBottom: '0.75em' }}>{hint.text}</Label>
          {sidechain ? (
            <pre style={{ fontSize: '12px', overflow: 'auto', maxHeight: '22em' }}>{safeJson(sidechain)}</pre>
          ) : (
            <Message warning>Could not load GetSidechainState (check Hub RPC and session).</Message>
          )}
          {basisClockNote && <p style={{ color: '#555' }}>{basisClockNote}</p>}
        </Segment>

        <Segment>
          <Header as="h3">Submit JSON Patch (admin or federation)</Header>
          <p style={{ color: '#666' }}>
            RFC6902 ops apply to <code>content</code> only. Requires <code>basisClock</code> equal to current clock.
            Hub policy for admin token vs <code>federationWitness</code> (k-of-n) is summarized in <strong>Federation guarantees</strong> above.
            Without validators configured, use your admin token from Settings; it is read from the same store as other admin flows.
          </p>
          <Form>
            <p style={{ margin: '0 0 0.5em', color: '#666', fontSize: '0.9em' }} id="fabric-sidechain-witness-intro">
              <strong>Federation witness</strong> — optional when the hub is admin-only; <strong>required</strong> when validators are configured.
              Used for <strong>Apply patch</strong> and <strong>every</strong> document-offer / L1 escrow sidechain action below (same <code>SubmitSidechainStatePatch</code> verification). Example:{' '}
              <code style={{ fontSize: '11px' }}>{'{"version":1,"signatures":{"03…":"<schnorr sig hex>"}}'}</code>
            </p>
            <label htmlFor="fabric-sidechain-federation-witness" style={{ display: 'block', marginBottom: '0.35em', fontWeight: 600 }}>
              Federation witness JSON
            </label>
            <TextArea
              id="fabric-sidechain-federation-witness"
              rows={5}
              value={this.state.federationWitnessJson}
              onChange={(e, { value }) => this.setState({ federationWitnessJson: value })}
              placeholder='{"version":1,"signatures":{}}'
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
              aria-label="Federation witness JSON for SubmitSidechainStatePatch"
              aria-describedby="fabric-sidechain-witness-intro"
            />
            <Header as="h4" style={{ marginTop: '1.25em', marginBottom: '0.5em' }} id="fabric-sidechain-raw-patch-heading">
              Raw patch (RFC6902)
            </Header>
            <TextArea
              id="fabric-sidechain-patch-json"
              rows={12}
              value={patchJson}
              onChange={(e, { value }) => this.setState({ patchJson: value })}
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
              aria-label="RFC6902 JSON Patch operations for sidechain content"
              aria-labelledby="fabric-sidechain-raw-patch-heading"
            />
            <Button style={{ marginTop: '0.75em' }} primary onClick={() => this._submitRawPatch()}>
              Apply patch
            </Button>
          </Form>
          {lastPatchResult && (
            <Message success style={{ marginTop: '1em' }}>
              <pre style={{ fontSize: '11px' }}>{safeJson(lastPatchResult)}</pre>
            </Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">DOCUMENT_OFFER — L1 escrow (Taproot HTLC)</Header>
          <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em' }}>
            Sidechain updates from this section use the same <strong>Federation witness</strong> field and admin token as <strong>Submit JSON Patch</strong> above.
          </p>
          <p style={{ color: '#666', maxWidth: '52em' }}>
            Escrow matches inventory HTLC: <strong>deliverer</strong> claims with preimage + Schnorr after the initiator
            publishes <code>revealedPreimageHex</code> on the sidechain; <strong>initiator</strong> refunds after{' '}
            <code>refundLockHeight</code> (CLTV). Single SHA-256 preimage → <code>paymentHashHex</code> in the script.
            On regtest, <code>BroadcastSignedTransaction</code> does not require an admin token; other networks require
            admin or <code>settings.bitcoin.publicDocumentOfferBroadcast</code>.
          </p>
          {inboundOffer && (
            <Message info onDismiss={() => this.setState({ inboundOffer: null })}>
              <Message.Header>Last inbound offer envelope</Message.Header>
              <pre style={{ fontSize: '11px' }}>{safeJson(inboundOffer)}</pre>
            </Message>
          )}
          <Header as="h4">1. Offer + escrow params</Header>
          <Form>
            <Form.Input
              label="Document id"
              value={this.state.offerDocumentId}
              onChange={(e, { value }) => this.setState({ offerDocumentId: value })}
            />
            <Form.Input
              label="Reward (sats) — min paid to escrow output"
              value={this.state.offerRewardSats}
              onChange={(e, { value }) => this.setState({ offerRewardSats: value })}
            />
            <Form.Input
              label="Memo"
              value={this.state.offerMemo}
              onChange={(e, { value }) => this.setState({ offerMemo: value })}
            />
            <Form.Input
              label="Offer id (optional — generated if empty when recording)"
              value={this.state.l1OfferId}
              onChange={(e, { value }) => this.setState({ l1OfferId: value })}
              placeholder="leave blank to auto-generate"
            />
            <Form.Checkbox
              label="Post DOCUMENT_OFFER marker to activity chat when recording on sidechain"
              checked={this.state.offerAnnounceChat}
              onChange={(e, { checked }) => this.setState({ offerAnnounceChat: !!checked })}
            />
            <Divider />
            <Button type="button" size="small" onClick={() => this._genEscrowPreimage()}>
              Generate escrow preimage (32 bytes)
            </Button>
            <Form.Input
              label="Escrow preimage hex (secret — same machine until reveal step)"
              value={this.state.escrowPreimageHex}
              onChange={(e, { value }) => this.setState({
                escrowPreimageHex: value,
                escrowPaymentHashHex: paymentHashHexFromPreimageHex(value)
              })}
            />
            <Form.Input
              label="Payment hash SHA256(preimage) — auto from preimage"
              value={this.state.escrowPaymentHashHex}
              readOnly
            />
            <Form.Input
              label="Deliverer compressed pubkey (66 hex) — claim path"
              value={this.state.escrowDelivererPubkey}
              onChange={(e, { value }) => this.setState({ escrowDelivererPubkey: value })}
            />
            <Form.Input
              label="Initiator refund compressed pubkey (66 hex) — CLTV refund path"
              value={this.state.escrowInitiatorRefundPubkey}
              onChange={(e, { value }) => this.setState({ escrowInitiatorRefundPubkey: value })}
            />
            <Form.Group widths="equal">
              <Form.Input
                label="refundLockHeight (absolute block height)"
                value={this.state.escrowRefundLockHeight}
                onChange={(e, { value }) => this.setState({ escrowRefundLockHeight: value })}
              />
              <Form.Input
                label="Delta blocks (used with button below)"
                value={this.state.escrowRefundDelta}
                onChange={(e, { value }) => this.setState({ escrowRefundDelta: value })}
              />
            </Form.Group>
            <Button type="button" size="small" onClick={() => this._syncRefundLockFromTip()}>
              Set refund lock from chain tip + delta
            </Button>
            <Divider />
            <Button type="button" primary onClick={() => this._buildEscrowAddress()}>
              Build escrow address (RPC)
            </Button>
            <Button type="button" color="teal" style={{ marginLeft: '0.5em' }} onClick={() => this._recordL1OfferOnSidechain()}>
              Record offer on sidechain (funding_pending)
            </Button>
          </Form>
          {this.state.escrowBuildResult && this.state.escrowBuildResult.paymentAddress && (
            <Message positive style={{ marginTop: '1em' }}>
              <Message.Header>Escrow funding</Message.Header>
              <p><strong>Address:</strong> <code>{this.state.escrowBuildResult.paymentAddress}</code></p>
              {this.state.escrowBuildResult.bitcoinUri ? (
                <p><strong>BIP21:</strong> <code style={{ wordBreak: 'break-all' }}>{this.state.escrowBuildResult.bitcoinUri}</code></p>
              ) : null}
            </Message>
          )}

          <Header as="h4" style={{ marginTop: '1.25em' }}>2. Confirm L1 funding</Header>
          <Form>
            <Form.Input
              label="Funding txid"
              value={this.state.l1FundingTxid}
              onChange={(e, { value }) => this.setState({ l1FundingTxid: value })}
            />
            <Button type="button" onClick={() => this._verifyL1FundingAndPatch()}>
              Verify funding and patch to funded
            </Button>
          </Form>

          <Header as="h4" style={{ marginTop: '1.25em' }}>3. Delivery — reveal preimage (initiator)</Header>
          <Button type="button" onClick={() => this._revealPreimageDelivered()}>
            Patch offer → delivered + revealedPreimageHex
          </Button>

          <Header as="h4" style={{ marginTop: '1.25em' }}>4a. Exit — deliverer claim</Header>
          <Form>
            <Form.Input
              label="Claim payout address"
              value={this.state.l1ClaimDestAddress}
              onChange={(e, { value }) => this.setState({ l1ClaimDestAddress: value })}
            />
            <Form.Input
              label="Fee (sats)"
              value={this.state.l1FeeClaimSats}
              onChange={(e, { value }) => this.setState({ l1FeeClaimSats: value })}
            />
            <Form.Input
              label="Deliverer secp256k1 privkey (64 hex) — stays in browser"
              type="password"
              autoComplete="off"
              value={this.state.l1DelivererPrivHex}
              onChange={(e, { value }) => this.setState({ l1DelivererPrivHex: value })}
            />
            <Button type="button" onClick={() => this._prepareDelivererClaim()}>
              Prepare claim PSBT
            </Button>
            <Button type="button" positive style={{ marginLeft: '0.5em' }} onClick={() => this._signAndBroadcastClaim()}>
              Sign and broadcast claim
            </Button>
          </Form>
          {this.state.l1LastPsbtClaim ? (
            <p style={{ fontSize: '11px', color: '#666', wordBreak: 'break-all' }}>
              Last claim PSBT (base64): {this.state.l1LastPsbtClaim.slice(0, 80)}…
            </p>
          ) : null}

          <Header as="h4" style={{ marginTop: '1.25em' }}>4b. Exit — initiator refund (after CLTV height)</Header>
          <Form>
            <Form.Input
              label="Refund payout address"
              value={this.state.l1RefundDestAddress}
              onChange={(e, { value }) => this.setState({ l1RefundDestAddress: value })}
            />
            <Form.Input
              label="Fee (sats)"
              value={this.state.l1FeeRefundSats}
              onChange={(e, { value }) => this.setState({ l1FeeRefundSats: value })}
            />
            <Form.Input
              label="Initiator refund privkey (64 hex) — stays in browser"
              type="password"
              autoComplete="off"
              value={this.state.l1InitiatorPrivHex}
              onChange={(e, { value }) => this.setState({ l1InitiatorPrivHex: value })}
            />
            <Button type="button" onClick={() => this._prepareInitiatorRefund()}>
              Prepare refund PSBT
            </Button>
            <Button type="button" color="orange" style={{ marginLeft: '0.5em' }} onClick={() => this._signAndBroadcastRefund()}>
              Sign &amp; broadcast refund
            </Button>
          </Form>

          <Divider />
          <Header as="h4">Sidechain-only rehearsal (no L1)</Header>
          <Button type="button" color="teal" size="small" onClick={() => this._submitDocumentOfferDemo()}>
            Create offer on sidechain (no escrow)
          </Button>
          <p style={{ color: '#666', marginTop: '0.75em' }}>Operator phase override:</p>
          <Button.Group size="small">
            <Button onClick={() => this._advanceOfferPhase('funding_pending')}>funding_pending</Button>
            <Button onClick={() => this._advanceOfferPhase('funded')}>funded</Button>
            <Button onClick={() => this._advanceOfferPhase('delivered')}>delivered</Button>
            <Button onClick={() => this._advanceOfferPhase('settled')}>settled</Button>
          </Button.Group>
        </Segment>
      </Segment.Group>
    );
  }
}

module.exports = SidechainHome;
