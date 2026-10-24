'use strict';

// Dependencies
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
  Label,
  Table,
  Statistic
} = require('semantic-ui-react');

// Fabric Types
const Actor = require('@fabric/core/types/actor');

const { toast } = require('../functions/toast');
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const { sha256 } = require('@noble/hashes/sha2.js');
const {
  getSidechainState,
  getSidechainJournal,
  getSidechainSnapshots,
  submitSidechainStatePatch,
  fetchDistributedEpoch,
  fetchDistributedManifest
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
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { DOCUMENT_OFFER } = require('../functions/messageTypes');
const { loadHubUiFeatureFlags, subscribeHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { Link } = require('react-router-dom');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const t = require('../locales/en');

const sh = t.federation.sidechainHome;
const tt = sh.toasts;

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
  return new Actor({
    type: 'HubEphemeralId',
    purpose: 'sidechain.documentOffer',
    nonce: Actor.randomBytes(8).toString('hex'),
    at: Date.now()
  }).id;
}

class SidechainHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      sidechain: null,
      epoch: null,
      epochError: null,
      manifest: null,
      journal: null,
      snapshots: null,
      showContentJson: false,
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
    toast.info(tt.incoming);
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
      const [st, ep, man, jr, sn] = await Promise.all([
        getSidechainState(),
        fetchDistributedEpoch(),
        fetchDistributedManifest(),
        getSidechainJournal({ limit: 40 }),
        getSidechainSnapshots({ limit: 40 })
      ]);
      const next = {
        sidechain: st.ok ? st.state : null,
        journal: jr.ok ? jr.journal : null,
        snapshots: sn.ok ? sn.snapshots : null,
        manifest: man.ok ? man.data : null
      };
      const errs = [];
      if (!st.ok) errs.push(st.error || sh.errors.state);
      if (!ep.ok) errs.push(ep.error || sh.errors.epoch);
      if (!jr.ok) errs.push(jr.error || sh.errors.journal);
      if (!sn.ok) errs.push(sn.error || sh.errors.snapshots);
      if (errs.length) next.epochError = errs.join(' · ');
      if (ep.ok) next.epoch = ep.data;
      if (st.ok && st.state && typeof st.state.clock === 'number') {
        next.patchJson = this.state.patchJson;
        next.basisClockNote = sh.status.basisClock(st.state.clock);
      }
      this.setState(next);
    } catch (e) {
      this.setState({ epochError: e && e.message ? e.message : String(e) });
    } finally {
      this.setState({ loading: false });
    }
  }

  _shortDigest (hex, n = 10) {
    const s = String(hex || '');
    if (s.length <= n * 2) return s || t.common.none;
    return `${s.slice(0, n)}…${s.slice(-n)}`;
  }

  _effectivePolicy () {
    const fromState = this.state.sidechain && this.state.sidechain.policy;
    if (fromState) return fromState;
    const fromMan = this.state.manifest && this.state.manifest.sidechainPolicy;
    return fromMan || null;
  }

  _sealedDigestHint () {
    const { sidechain, epoch } = this.state;
    const last = epoch && epoch.beacon && epoch.beacon.last;
    const payload = last && last.payload;
    const sc = payload && payload.sidechain;
    if (!sc || sc.stateDigest == null) {
      return { text: sh.seal.none, color: 'grey' };
    }
    const cur = sidechain && sidechain.stateDigest;
    if (!cur) return { text: sh.seal.last(sc.stateDigest), color: 'blue' };
    if (String(sc.stateDigest) === String(cur)) {
      return { text: sh.seal.match, color: 'green' };
    }
    return {
      text: sh.seal.differs,
      color: 'orange'
    };
  }

  _parseFederationWitnessFromState () {
    const raw = String(this.state.federationWitnessJson || '').trim();
    if (!raw) return { ok: true, witness: null };
    try {
      return { ok: true, witness: JSON.parse(raw) };
    } catch (_) {
      return { ok: false, error: tt.invalidWitness };
    }
  }

  /**
   * Admin token + optional witness for every `submitSidechainStatePatch` call on this page.
   * @returns {{ ok: true, adminToken?: string, federationWitness?: object } | { ok: false, error: string }}
   */
  _sidechainPatchAuth () {
    const adminToken = this._adminToken();
    const fw = this._parseFederationWitnessFromState();
    if (!fw.ok) return { ok: false, error: fw.error };
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
      toast.error(tt.invalidPatchJson);
      return;
    }
    if (!Array.isArray(patches) || !patches.length) {
      toast.error(tt.emptyPatch);
      return;
    }
    const basisClock = this.state.sidechain && Number.isFinite(Number(this.state.sidechain.clock))
      ? Number(this.state.sidechain.clock)
      : NaN;
    if (!Number.isFinite(basisClock)) {
      toast.error(tt.loadFirst);
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
      toast.error(out.error || tt.patchFailed);
      return;
    }
    this.setState({ lastPatchResult: out.result });
    toast.success(tt.patchApplied);
    await this.refresh();
  }

  async _submitDocumentOfferWithoutEscrow () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const documentId = String(this.state.offerDocumentId || '').trim();
    const rewardSats = Math.max(0, Math.floor(Number(this.state.offerRewardSats) || 0));
    const initiatorFabricId = this._getInitiatorId();
    if (!documentId) {
      toast.error(tt.documentIdRequired);
      return;
    }
    if (!initiatorFabricId) {
      toast.error(
        `${fabricIdentityNeedFullKeyPlain(this.props.identity || {})} ${tt.initiatorUnknown}`
      );
      return;
    }
    if (!this.state.sidechain) {
      toast.error(tt.loadFirst);
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
      toast.error(out.error || tt.offerFailed);
      return;
    }
    toast.success(tt.offerRecorded(offerId));

    const br = this.props.bridgeRef && this.props.bridgeRef.current;
    if (this.state.offerAnnounceChat && br && typeof br.submitChatMessage === 'function') {
      const env = buildDocumentOfferEnvelope(
        { id: initiatorFabricId },
        { offerId, documentId, rewardSats, phase: record.phase, kind: DOCUMENT_OFFER }
      );
      const line = `[${DOCUMENT_OFFER}] ${JSON.stringify(env)}`;
      br.submitChatMessage(line);
      toast.info(tt.offerPosted);
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
      toast.error(tt.offerIdRequired);
      return;
    }
    if (!id || !this.state.sidechain || !this.state.sidechain.content) return;
    const offers = this.state.sidechain.content.documentOffers;
    if (!offers || !offers[id]) {
      toast.error(tt.unknownOffer);
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
      toast.error(out.error || tt.updateFailed);
      return;
    }
    toast.success(tt.phaseSet(id, sh.offer.phase(phase)));
    await this.refresh();
  }

  _adminToken () {
    return readHubAdminTokenFromBrowser(this.props.adminToken) || '';
  }

  _genEscrowPreimage () {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.getRandomValues) {
      toast.error(tt.noRandom);
      return;
    }
    const u8 = new Uint8Array(32);
    window.crypto.getRandomValues(u8);
    const hex = Buffer.from(u8).toString('hex');
    const ph = paymentHashHexFromPreimageHex(hex);
    this.setState({ escrowPreimageHex: hex, escrowPaymentHashHex: ph });
    toast.success(tt.secretGenerated);
  }

  async _syncRefundLockFromTip () {
    const tip = await getBitcoinTipHeight();
    if (!tip.ok) {
      toast.error(tip.error || tt.tipFailed);
      return;
    }
    const delta = Math.max(1, Math.floor(Number(this.state.escrowRefundDelta) || 144));
    this.setState({ escrowRefundLockHeight: String(tip.height + delta) });
    toast.info(tt.refundHeightSet(tip.height + delta, tip.height, delta));
  }

  async _buildEscrowAddress () {
    const paymentHashHex = String(this.state.escrowPaymentHashHex || '').trim().toLowerCase();
    const delivererPubkeyHex = String(this.state.escrowDelivererPubkey || '').trim().replace(/\s+/g, '');
    const initiatorRefundPubkeyHex = String(this.state.escrowInitiatorRefundPubkey || '').trim().replace(/\s+/g, '');
    const refundLockHeight = Math.floor(Number(this.state.escrowRefundLockHeight) || 0);
    if (!paymentHashHex || paymentHashHex.length !== 64) {
      toast.error(tt.needSecret);
      return;
    }
    if (!delivererPubkeyHex || delivererPubkeyHex.length !== 66) {
      toast.error(tt.badDelivererKey);
      return;
    }
    if (!initiatorRefundPubkeyHex || initiatorRefundPubkeyHex.length !== 66) {
      toast.error(tt.badInitiatorKey);
      return;
    }
    if (!Number.isFinite(refundLockHeight) || refundLockHeight < 1) {
      toast.error(tt.needRefundHeight);
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
      toast.error(out.error || (out.result && out.result.message) || tt.buildFailed);
      return;
    }
    this.setState({ escrowBuildResult: out.result });
    toast.success(tt.built);
  }

  async _recordL1OfferOnSidechain () {
    const auth = this._sidechainPatchAuth();
    if (!auth.ok) {
      toast.error(auth.error);
      return;
    }
    const br = this.state.escrowBuildResult;
    if (!br || !br.paymentAddress) {
      toast.error(tt.buildFirst);
      return;
    }
    const documentId = String(this.state.offerDocumentId || '').trim();
    const rewardSats = Math.max(0, Math.floor(Number(this.state.offerRewardSats) || 0));
    const initiatorFabricId = this._getInitiatorId();
    if (!documentId) {
      toast.error(tt.documentIdRequired);
      return;
    }
    if (!initiatorFabricId) {
      toast.error(`${fabricIdentityNeedFullKeyPlain(this.props.identity || {})} ${tt.initiatorUnknown}`);
      return;
    }
    if (!this.state.sidechain) {
      toast.error(tt.loadFirst);
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
      toast.error(out.error || tt.patchFailed);
      return;
    }
    this.setState({ l1OfferId: offerId, lastPatchResult: out.result });
    toast.success(tt.recordedFund(offerId, br.paymentAddress));

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
      toast.error(tt.needOfferAndTxid);
      return;
    }
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error(tt.offerNotLoaded);
      return;
    }
    const offers = this.state.sidechain.content.documentOffers;
    const rec = offers[offerId];
    if (!rec || !rec.paymentAddress) {
      toast.error(rec ? tt.noEscrowAddress : tt.unknownOffer);
      return;
    }
    const rewardSats = Math.max(0, Math.floor(Number(rec.rewardSats) || 0));
    const v = await verifyDocumentOfferFunding({
      fundingTxid: txid,
      paymentAddress: rec.paymentAddress,
      rewardSats
    });
    if (!v.ok || !v.result || v.result.status !== 'success' || !v.result.verified) {
      toast.error(v.error || (v.result && v.result.message) || tt.notVerified);
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
      toast.error(out.error || tt.patchFailed);
      return;
    }
    toast.success(tt.markedFunded);
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
      toast.error(tt.needOfferAndSecret);
      return;
    }
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error(tt.loadFirst);
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec) {
      toast.error(tt.unknownOffer);
      return;
    }
    const want = String(rec.paymentHashHex || '').toLowerCase();
    const got = paymentHashHexFromPreimageHex(preimage);
    if (want && got !== want) {
      toast.error(tt.secretMismatch);
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
      toast.error(out.error || tt.patchFailed);
      return;
    }
    toast.success(tt.revealed);
    await this.refresh();
  }

  async _prepareDelivererClaim () {
    const offerId = String(this.state.l1OfferId || '').trim();
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error(tt.loadFirst);
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec || !rec.fundingTxid || !rec.revealedPreimageHex) {
      toast.error(tt.claimNotReady);
      return;
    }
    const dest = String(this.state.l1ClaimDestAddress || '').trim();
    if (!dest) {
      toast.error(tt.claimAddressRequired);
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
      toast.error(prep.error || (prep.result && prep.result.message) || tt.prepareFailed);
      return;
    }
    this.setState({ l1LastPsbtClaim: prep.result.psbtBase64 });
    toast.success(tt.claimReady);
  }

  _signAndBroadcastClaim () {
    const psbtB64 = String(this.state.l1LastPsbtClaim || '').trim();
    const priv = String(this.state.l1DelivererPrivHex || '').trim().replace(/^0x/i, '');
    if (!psbtB64 || !/^[0-9a-f]{64}$/i.test(priv)) {
      toast.error(tt.claimNeedsKey);
      return;
    }
    const offerId = String(this.state.l1OfferId || '').trim();
    const rec = this.state.sidechain && this.state.sidechain.content && this.state.sidechain.content.documentOffers
      ? this.state.sidechain.content.documentOffers[offerId]
      : null;
    const preimage = String((rec && rec.revealedPreimageHex) || this.state.escrowPreimageHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(preimage)) {
      toast.error(tt.claimNeedsSecret);
      return;
    }
    let txHex;
    try {
      ({ txHex } = signDelivererClaimFromPsbtBase64(psbtB64, preimage, priv));
    } catch (e) {
      this.setState({ l1DelivererPrivHex: '' });
      toast.error(e && e.message ? e.message : tt.signFailed);
      return;
    }
    this.setState({ l1DelivererPrivHex: '' });
    this._broadcastExitTx(txHex, 'claim');
  }

  async _prepareInitiatorRefund () {
    const offerId = String(this.state.l1OfferId || '').trim();
    if (!this.state.sidechain || !this.state.sidechain.content || !this.state.sidechain.content.documentOffers) {
      toast.error(tt.loadFirst);
      return;
    }
    const rec = this.state.sidechain.content.documentOffers[offerId];
    if (!rec || !rec.fundingTxid || !rec.refundLockHeight) {
      toast.error(tt.refundNotReady);
      return;
    }
    const dest = String(this.state.l1RefundDestAddress || '').trim();
    if (!dest) {
      toast.error(tt.refundAddressRequired);
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
      toast.error(prep.error || (prep.result && prep.result.message) || tt.prepareFailed);
      return;
    }
    if (prep.result.refundValidOnChain === false) {
      toast.warning(tt.refundEarly);
    }
    this.setState({ l1LastPsbtRefund: prep.result.psbtBase64 });
    toast.success(tt.refundReady);
  }

  _signAndBroadcastRefund () {
    const psbtB64 = String(this.state.l1LastPsbtRefund || '').trim();
    const priv = String(this.state.l1InitiatorPrivHex || '').trim().replace(/^0x/i, '');
    if (!psbtB64 || !/^[0-9a-f]{64}$/i.test(priv)) {
      toast.error(tt.refundNeedsKey);
      return;
    }
    let txHex;
    try {
      ({ txHex } = signInitiatorRefundFromPsbtBase64(psbtB64, priv));
    } catch (e) {
      this.setState({ l1InitiatorPrivHex: '' });
      toast.error(e && e.message ? e.message : tt.signFailed);
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
      toast.error(b.error || (b.result && b.result.message) || tt.broadcastFailed);
      return;
    }
    const txid = b.result.txid;
    this.setState({ l1LastSignedTxHex: txHex });
    toast.success(exitKind === 'claim' ? tt.broadcastClaim(txid) : tt.broadcastRefund(txid));

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
    const {
      loading, sidechain, epoch, epochError, patchJson, basisClockNote, lastPatchResult, inboundOffer,
      journal, snapshots, showContentJson
    } = this.state;
    void this.state.hubUiFlagsRev;
    const hubUi = loadHubUiFeatureFlags();
    const hint = this._sealedDigestHint();
    const beacon = epoch && epoch.beacon;
    const lastPayload = beacon && beacon.last && beacon.last.payload;
    const policy = this._effectivePolicy();
    const journalEntries = (journal && Array.isArray(journal.entries)) ? journal.entries : [];
    const snapshotRows = (snapshots && Array.isArray(snapshots.snapshots)) ? snapshots.snapshots : [];
    const links = t.federation.shared.links;
    const offer = sh.offer;
    const legendStyle = { fontWeight: 700, fontSize: '1.07em', marginBottom: '0.5em', padding: 0 };
    const stepStyle = { marginTop: '1.25em' };

    return (
      <Segment.Group>
        <Segment>
          <Header as="h2">
            <Icon name="chain" aria-hidden="true" />
            {sh.title}
          </Header>
          <p style={{ color: '#666', maxWidth: '52em' }}>{sh.intro}</p>
          <div
            role="toolbar"
            aria-label={sh.shortcutsLabel}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center', marginBottom: '0.65em' }}
          >
            <Button as={Link} to="/" basic size="small" icon labelPosition="left">
              <Icon name="arrow left" aria-hidden="true" />
              {t.federation.shared.backTo(t.federation.shared.home)}
            </Button>
            <Button as={Link} to="/contracts" basic size="small" title={sh.shortcuts.contractsTitle}>
              {sh.shortcuts.contracts}
            </Button>
            <Button as={Link} to="/federations" basic size="small" title={sh.shortcuts.federationsTitle}>
              <Icon name="users" aria-hidden="true" />
              {sh.shortcuts.federations}
            </Button>
            <Button as={Link} to="/services/bitcoin" basic size="small" title={sh.shortcuts.bitcoinTitle}>
              {sh.shortcuts.bitcoin}
            </Button>
            {hubUi.bitcoinPayments ? (
              <Button as={Link} to="/payments" basic size="small" title={sh.shortcuts.paymentsTitle}>
                {sh.shortcuts.payments}
              </Button>
            ) : null}
            {hubUi.bitcoinResources ? (
              <Button as={Link} to="/services/bitcoin/resources" basic size="small" title={sh.shortcuts.resourcesTitle}>
                {sh.shortcuts.resources}
              </Button>
            ) : null}
            {hubUi.bitcoinCrowdfund ? (
              <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" title={sh.shortcuts.crowdfundsTitle}>
                <Icon name="heart" aria-hidden="true" />
                {sh.shortcuts.crowdfunds}
              </Button>
            ) : null}
          </div>
          <Button primary icon labelPosition="left" loading={loading} onClick={() => this.refresh()}>
            <Icon name="refresh" aria-hidden="true" />
            {sh.refresh}
          </Button>
          {epochError && (
            <Message warning style={{ marginTop: '1em' }}>
              <Message.Header>{sh.warningTitle}</Message.Header>
              <p>{epochError}</p>
            </Message>
          )}
          <DistributedFederationPanel hideSidechainNavLink style={{ marginTop: '1em' }} />
          <details className="hub-developer-details" style={{ fontSize: '0.9em', color: '#666' }}>
            <summary>{t.common.developerDetails}</summary>
            {sh.developer.map((line) => <p key={line} style={{ margin: '0.35em 0' }}>{line}</p>)}
            <a href="/services/distributed/sidechain" target="_blank" rel="noopener noreferrer">{links.sidechainState}</a>
            {' · '}
            <a href="/services/distributed/sidechain/journal" target="_blank" rel="noopener noreferrer">{links.sidechainJournal}</a>
          </details>
        </Segment>

        <Segment>
          <Header as="h3">{sh.status.title}</Header>
          <p style={{ color: '#666', fontSize: '0.9em' }}>{sh.status.clockHelp}</p>
          <Statistic.Group size="tiny" style={{ marginBottom: '0.75em' }}>
            <Statistic>
              <Statistic.Value>{sidechain && sidechain.clock != null ? String(sidechain.clock) : t.common.none}</Statistic.Value>
              <Statistic.Label>{sh.status.clock}</Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>{journal && journal.unsealedCount != null ? String(journal.unsealedCount) : t.common.none}</Statistic.Value>
              <Statistic.Label>{sh.status.unsealed}</Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>{snapshots && snapshots.snapshotCount != null ? String(snapshots.snapshotCount) : t.common.none}</Statistic.Value>
              <Statistic.Label>{sh.status.snapshots}</Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>{beacon && beacon.epochCount != null ? String(beacon.epochCount) : t.common.none}</Statistic.Value>
              <Statistic.Label>{sh.status.epochs}</Statistic.Label>
            </Statistic>
          </Statistic.Group>
          <Label color={hint.color} style={{ marginBottom: '0.5em' }}>{hint.text}</Label>
          {sidechain && sidechain.stateDigest ? (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#444', wordBreak: 'break-all' }}>
              {sh.status.digest(sidechain.stateDigest)}
            </p>
          ) : null}
          {basisClockNote && <p style={{ color: '#555' }}>{basisClockNote}</p>}
        </Segment>

        <Segment>
          <Header as="h3">{sh.policy.title}</Header>
          <p style={{ color: '#666', fontSize: '0.9em', maxWidth: '48em' }}>{sh.policy.body}</p>
          {policy ? (
            <pre style={{ fontSize: '12px', overflow: 'auto' }}>{safeJson(policy)}</pre>
          ) : (
            <Message info>{sh.policy.none}</Message>
          )}
          <details className="hub-developer-details" style={{ fontSize: '0.85em', color: '#666' }}>
            <summary>{t.common.developerDetails}</summary>
            <p style={{ margin: '0.35em 0' }}>{sh.policy.developer}</p>
          </details>
        </Segment>

        <Segment>
          <Header as="h3">{sh.epoch.title}</Header>
          <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em', maxWidth: '48em' }}>{sh.epoch.body}</p>
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
            <Message info>{sh.epoch.empty}</Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">{sh.snapshots.title}</Header>
          <p style={{ color: '#666', fontSize: '0.9em' }}>{sh.snapshots.body}</p>
          {snapshotRows.length ? (
            <Table celled compact size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{sh.snapshots.beaconClock}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.snapshots.sidechainClock}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.snapshots.digest}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {snapshotRows.map((row) => (
                  <Table.Row key={`snap-${row.beaconClock}`}>
                    <Table.Cell>{row.beaconClock}</Table.Cell>
                    <Table.Cell>{row.sidechainClock}</Table.Cell>
                    <Table.Cell style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {this._shortDigest(row.stateDigest, 12)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          ) : (
            <Message info>{sh.snapshots.empty}</Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">{sh.journal.title}</Header>
          <p style={{ color: '#666', fontSize: '0.9em' }}>
            {sh.journal.body}
            {journal ? ` ${sh.journal.showing(journalEntries.length, journal.entryCount)}` : ''}
          </p>
          {journalEntries.length ? (
            <Table celled compact size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{sh.journal.seq}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.journal.clock}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.journal.sealed}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.journal.ops}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.journal.paths}</Table.HeaderCell>
                  <Table.HeaderCell>{sh.journal.digest}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {journalEntries.map((row) => (
                  <Table.Row key={`j-${row.seq}`} warning={row.sealedBeaconClock == null}>
                    <Table.Cell>{row.seq}</Table.Cell>
                    <Table.Cell>{row.basisClock}→{row.clock}</Table.Cell>
                    <Table.Cell>
                      {row.sealedBeaconClock == null ? (
                        <Label size="mini" color="orange">{sh.journal.unsealed}</Label>
                      ) : (
                        row.sealedBeaconClock
                      )}
                    </Table.Cell>
                    <Table.Cell>{row.opCount}</Table.Cell>
                    <Table.Cell style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {(row.paths || []).join(', ') || t.common.none}
                    </Table.Cell>
                    <Table.Cell style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {this._shortDigest(row.patchDigest, 8)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          ) : (
            <Message info>{sh.journal.empty}</Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">{sh.document.title}</Header>
          <Label color={hint.color} style={{ marginBottom: '0.75em' }}>{hint.text}</Label>
          <Button
            size="small"
            basic
            style={{ marginBottom: '0.75em' }}
            aria-expanded={showContentJson}
            onClick={() => this.setState({ showContentJson: !showContentJson })}
          >
            {showContentJson ? sh.document.hide : sh.document.show}
          </Button>
          {showContentJson ? (
            sidechain ? (
              <pre style={{ fontSize: '12px', overflow: 'auto', maxHeight: '22em' }}>{safeJson(sidechain)}</pre>
            ) : (
              <Message warning>{sh.document.loadFailed}</Message>
            )
          ) : (
            <p style={{ color: '#666' }}>{sh.document.hidden}</p>
          )}
        </Segment>

        <Segment>
          <Header as="h3">{sh.patch.title}</Header>
          <p style={{ color: '#666' }}>
            {sh.patch.intro}{' '}
            {sh.patch.auth}
          </p>
          <Form>
            <fieldset>
              <legend style={legendStyle}>{sh.patch.witnessLegend}</legend>
              <p style={{ margin: '0 0 0.5em', color: '#666', fontSize: '0.9em' }} id="fabric-sidechain-witness-intro">
                {sh.patch.witnessIntro}
              </p>
              <Form.Field>
                <label htmlFor="fabric-sidechain-federation-witness">{sh.patch.witnessLabel}</label>
                <TextArea
                  id="fabric-sidechain-federation-witness"
                  rows={5}
                  value={this.state.federationWitnessJson}
                  onChange={(e, { value }) => this.setState({ federationWitnessJson: value })}
                  placeholder='{"version":1,"signatures":{}}'
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                  aria-describedby="fabric-sidechain-witness-intro"
                />
              </Form.Field>
              <details className="hub-developer-details" style={{ fontSize: '0.85em', color: '#666' }}>
                <summary>{t.common.developerDetails}</summary>
                <code style={{ fontSize: '11px' }}>{sh.patch.witnessExample}</code>
              </details>
            </fieldset>
            <fieldset style={stepStyle}>
              <legend style={legendStyle}>{sh.patch.operationsLegend}</legend>
              <Form.Field>
                <label htmlFor="fabric-sidechain-patch-json">{sh.patch.operationsLabel}</label>
                <TextArea
                  id="fabric-sidechain-patch-json"
                  rows={12}
                  value={patchJson}
                  onChange={(e, { value }) => this.setState({ patchJson: value })}
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
              </Form.Field>
              <Button type="button" primary onClick={() => this._submitRawPatch()}>
                {sh.patch.apply}
              </Button>
            </fieldset>
          </Form>
          {lastPatchResult && (
            <Message success style={{ marginTop: '1em' }}>
              <Message.Header>{sh.patch.resultTitle}</Message.Header>
              <pre style={{ fontSize: '11px' }}>{safeJson(lastPatchResult)}</pre>
            </Message>
          )}
        </Segment>

        <Segment>
          <Header as="h3">{offer.title}</Header>
          <p style={{ color: '#666', maxWidth: '52em' }}>{offer.intro}</p>
          <p style={{ color: '#666', maxWidth: '52em' }}>{offer.how}</p>
          <p style={{ color: '#666', fontSize: '0.9em', maxWidth: '52em' }}>
            {offer.auth}{' '}
            {offer.broadcast}
          </p>
          <details className="hub-developer-details" style={{ fontSize: '0.85em', color: '#666', marginBottom: '0.75em' }}>
            <summary>{t.common.developerDetails}</summary>
            <p style={{ margin: '0.35em 0' }}>{offer.developer}</p>
          </details>
          {inboundOffer && (
            <Message info onDismiss={() => this.setState({ inboundOffer: null })}>
              <Message.Header>{offer.inboundTitle}</Message.Header>
              <pre style={{ fontSize: '11px' }}>{safeJson(inboundOffer)}</pre>
            </Message>
          )}
          <Form>
            <fieldset>
              <legend style={legendStyle}>{offer.step1}</legend>
              <Form.Input
                id="sidechain-offer-document-id"
                label={offer.documentId}
                value={this.state.offerDocumentId}
                onChange={(e, { value }) => this.setState({ offerDocumentId: value })}
              />
              <Form.Input
                id="sidechain-offer-reward"
                label={offer.reward}
                type="number"
                min={0}
                value={this.state.offerRewardSats}
                onChange={(e, { value }) => this.setState({ offerRewardSats: value })}
              />
              <Form.Input
                id="sidechain-offer-memo"
                label={offer.memo}
                value={this.state.offerMemo}
                onChange={(e, { value }) => this.setState({ offerMemo: value })}
              />
              <Form.Input
                id="sidechain-offer-id"
                label={offer.offerId}
                value={this.state.l1OfferId}
                onChange={(e, { value }) => this.setState({ l1OfferId: value })}
                placeholder={offer.offerIdPlaceholder}
              />
              <Form.Checkbox
                id="sidechain-offer-announce"
                label={offer.announce}
                checked={this.state.offerAnnounceChat}
                onChange={(e, { checked }) => this.setState({ offerAnnounceChat: !!checked })}
              />
              <Divider />
              <Button type="button" size="small" onClick={() => this._genEscrowPreimage()}>
                {offer.generateSecret}
              </Button>
              <Form.Input
                id="sidechain-offer-preimage"
                label={offer.secret}
                autoComplete="off"
                value={this.state.escrowPreimageHex}
                onChange={(e, { value }) => this.setState({
                  escrowPreimageHex: value,
                  escrowPaymentHashHex: paymentHashHexFromPreimageHex(value)
                })}
              />
              <Form.Input
                id="sidechain-offer-payment-hash"
                label={offer.paymentHash}
                value={this.state.escrowPaymentHashHex}
                readOnly
              />
              <Form.Input
                id="sidechain-offer-deliverer-pubkey"
                label={offer.delivererKey}
                value={this.state.escrowDelivererPubkey}
                onChange={(e, { value }) => this.setState({ escrowDelivererPubkey: value })}
              />
              <Form.Input
                id="sidechain-offer-initiator-pubkey"
                label={offer.initiatorKey}
                value={this.state.escrowInitiatorRefundPubkey}
                onChange={(e, { value }) => this.setState({ escrowInitiatorRefundPubkey: value })}
              />
              <Form.Group widths="equal">
                <Form.Input
                  id="sidechain-offer-refund-height"
                  label={offer.refundHeight}
                  type="number"
                  min={1}
                  value={this.state.escrowRefundLockHeight}
                  onChange={(e, { value }) => this.setState({ escrowRefundLockHeight: value })}
                />
                <Form.Input
                  id="sidechain-offer-refund-delta"
                  label={offer.refundDelta}
                  type="number"
                  min={1}
                  value={this.state.escrowRefundDelta}
                  onChange={(e, { value }) => this.setState({ escrowRefundDelta: value })}
                />
              </Form.Group>
              <Button type="button" size="small" onClick={() => this._syncRefundLockFromTip()}>
                {offer.setRefundHeight}
              </Button>
              <Divider />
              <Button type="button" primary onClick={() => this._buildEscrowAddress()}>
                {offer.buildEscrow}
              </Button>
              <Button type="button" color="teal" style={{ marginLeft: '0.5em' }} onClick={() => this._recordL1OfferOnSidechain()}>
                {offer.record}
              </Button>
            </fieldset>
          </Form>
          {this.state.escrowBuildResult && this.state.escrowBuildResult.paymentAddress && (
            <Message positive style={{ marginTop: '1em' }}>
              <Message.Header>{offer.escrowTitle}</Message.Header>
              <p><strong>{offer.escrowAddress}</strong> <code>{this.state.escrowBuildResult.paymentAddress}</code></p>
              {this.state.escrowBuildResult.bitcoinUri ? (
                <p><strong>{offer.escrowUri}</strong> <code style={{ wordBreak: 'break-all' }}>{this.state.escrowBuildResult.bitcoinUri}</code></p>
              ) : null}
            </Message>
          )}

          <Form style={stepStyle}>
            <fieldset>
              <legend style={legendStyle}>{offer.step2}</legend>
              <Form.Input
                id="sidechain-offer-funding-txid"
                label={offer.fundingTxid}
                value={this.state.l1FundingTxid}
                onChange={(e, { value }) => this.setState({ l1FundingTxid: value })}
              />
              <Button type="button" onClick={() => this._verifyL1FundingAndPatch()}>
                {offer.verify}
              </Button>
            </fieldset>
          </Form>

          <Form style={stepStyle}>
            <fieldset>
              <legend style={legendStyle}>{offer.step3}</legend>
              <p style={{ color: '#666', fontSize: '0.9em' }}>{offer.step3Help}</p>
              <Button type="button" onClick={() => this._revealPreimageDelivered()}>
                {offer.reveal}
              </Button>
            </fieldset>
          </Form>

          <Form style={stepStyle}>
            <fieldset>
              <legend style={legendStyle}>{offer.step4a}</legend>
              <Form.Input
                id="sidechain-offer-claim-address"
                label={offer.claimAddress}
                value={this.state.l1ClaimDestAddress}
                onChange={(e, { value }) => this.setState({ l1ClaimDestAddress: value })}
              />
              <Form.Input
                id="sidechain-offer-claim-fee"
                label={offer.claimFee}
                type="number"
                min={1}
                value={this.state.l1FeeClaimSats}
                onChange={(e, { value }) => this.setState({ l1FeeClaimSats: value })}
              />
              <Form.Input
                id="sidechain-offer-deliverer-private-key"
                label={offer.delivererPrivateKey}
                type="password"
                autoComplete="off"
                value={this.state.l1DelivererPrivHex}
                onChange={(e, { value }) => this.setState({ l1DelivererPrivHex: value })}
              />
              <Button type="button" onClick={() => this._prepareDelivererClaim()}>
                {offer.prepareClaim}
              </Button>
              <Button type="button" positive style={{ marginLeft: '0.5em' }} onClick={() => this._signAndBroadcastClaim()}>
                {offer.signClaim}
              </Button>
            </fieldset>
          </Form>
          {this.state.l1LastPsbtClaim ? (
            <p style={{ fontSize: '11px', color: '#666', wordBreak: 'break-all' }}>
              {offer.lastClaimPsbt(this.state.l1LastPsbtClaim.slice(0, 80))}
            </p>
          ) : null}

          <Form style={stepStyle}>
            <fieldset>
              <legend style={legendStyle}>{offer.step4b}</legend>
              <Form.Input
                id="sidechain-offer-refund-address"
                label={offer.refundAddress}
                value={this.state.l1RefundDestAddress}
                onChange={(e, { value }) => this.setState({ l1RefundDestAddress: value })}
              />
              <Form.Input
                id="sidechain-offer-refund-fee"
                label={offer.refundFee}
                type="number"
                min={1}
                value={this.state.l1FeeRefundSats}
                onChange={(e, { value }) => this.setState({ l1FeeRefundSats: value })}
              />
              <Form.Input
                id="sidechain-offer-initiator-private-key"
                label={offer.initiatorPrivateKey}
                type="password"
                autoComplete="off"
                value={this.state.l1InitiatorPrivHex}
                onChange={(e, { value }) => this.setState({ l1InitiatorPrivHex: value })}
              />
              <Button type="button" onClick={() => this._prepareInitiatorRefund()}>
                {offer.prepareRefund}
              </Button>
              <Button type="button" color="orange" style={{ marginLeft: '0.5em' }} onClick={() => this._signAndBroadcastRefund()}>
                {offer.signRefund}
              </Button>
            </fieldset>
          </Form>

          <Divider />
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={legendStyle}>{offer.noEscrowLegend}</legend>
            <p style={{ color: '#666', fontSize: '0.9em' }}>{offer.noEscrowHelp}</p>
            <Button type="button" color="teal" size="small" onClick={() => this._submitDocumentOfferWithoutEscrow()}>
              {offer.createNoEscrow}
            </Button>
            <p style={{ color: '#666', marginTop: '0.75em' }} id="sidechain-offer-phase-label">{offer.phaseOverride}</p>
            <Button.Group size="small" role="group" aria-labelledby="sidechain-offer-phase-label">
              {['funding_pending', 'funded', 'delivered', 'settled'].map((phase) => (
                <Button key={phase} type="button" onClick={() => this._advanceOfferPhase(phase)}>
                  {offer.phase(phase)}
                </Button>
              ))}
            </Button.Group>
          </fieldset>
        </Segment>
      </Segment.Group>
    );
  }
}

module.exports = SidechainHome;
