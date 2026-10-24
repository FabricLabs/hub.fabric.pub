'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Form,
  Header,
  Icon,
  Input,
  Label,
  List,
  Message,
  Modal,
  Segment,
  Table
} = require('semantic-ui-react');
const QRCode = require('qrcode');

const {
  broadcastRawTransaction,
  createCrowdfundingCampaign,
  createPayjoinDeposit,
  fetchBitcoinStatus,
  fetchCrowdfundingCampaigns,
  fetchCrowdfundingCampaign,
  fetchCrowdfundingAcpDonationPsbt,
  fetchCrowdfundingPayoutPsbt,
  postCrowdfundingPayoutSignArbiter,
  postCrowdfundingPayoutBroadcast,
  postCrowdfundingRefundPrepare,
  getCrowdfundingBeneficiaryPubkeyHex,
  getCrowdfundingBeneficiaryPayoutAddress,
  signCrowdfundingPayoutPsbtBeneficiary,
  getNextReceiveWalletContext,
  loadUpstreamSettings,
  loadPayjoinPreferences,
  buildCrowdfundFunderBitcoinUri,
  buildCrowdfundPaymentsDeepLink,
  crowdfundCampaignApiUrl
} = require('../functions/bitcoinClient');
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { copyToClipboard, pushUiNotification } = require('../functions/uiNotifications');
const { loadHubUiFeatureFlags, subscribeHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { SATS_PER_BTC } = require('../constants');
const { classifyHubBrowserIdentity } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const L = t.payments.crowdfunds;

function identityHowTo (identity) {
  const state = classifyHubBrowserIdentity(identity);
  if (state === 'password_locked') return t.common.identity.howToUnlock;
  if (state === 'watch_only') return t.common.identity.howToImport;
  return t.common.identity.howToLogIn;
}

class CrowdfundingHome extends React.Component {
  constructor (props) {
    super(props);
    const upstream = loadUpstreamSettings();
    const payjoinPrefs = loadPayjoinPreferences();
    this.state = {
      loading: true,
      refreshing: false,
      upstream,
      payjoinEnabled: !!payjoinPrefs.operatorDeposit,
      bitcoinStatus: { available: false, status: 'STARTING' },
      crowdfundingCampaigns: [],
      cfTitle: '',
      cfGoalSats: '500000',
      cfMinSats: '10000',
      cfBeneficiaryHex: '',
      cfBusy: false,
      cfError: null,
      cfSuccess: null,
      cfAcpAmountSats: '10000',
      cfPayjoinAmountSats: '25000',
      cfPayjoinBip21: '',
      cfPayjoinSessionId: '',
      cfVaultStats: {},
      cfRefundAfterBlocks: '1008',
      cfShareAmountSats: '10000',
      cfQrDataUrl: '',
      cfQrOpen: false,
      cfQrUri: '',
      cfPayoutModal: null,
      cfPayoutDest: '',
      cfPayoutFeeSats: '2000',
      cfPayoutPsbt: '',
      cfPayoutBusy: false,
      cfPayoutErr: null,
      cfPayoutTxid: null,
      cfPayoutHint: null,
      cfRefundModal: null,
      cfRefundDest: '',
      cfRefundFundedTxid: '',
      cfRefundVout: '',
      cfRefundFeeSats: '2000',
      cfRefundBusy: false,
      cfRefundErr: null,
      cfRefundTxHex: '',
      cfRefundTxid: null,
      hubUiFlagsRev: 0
    };
  }

  componentDidMount () {
    this.refresh();
    // A short follow-up refresh smooths over startup races where the first
    // fetch happens before wallet/index state is fully ready.
    this._delayedRefreshTimer = setTimeout(() => {
      this.refresh();
    }, 1200);
    this._hubUiFlagsUnsub = subscribeHubUiFeatureFlags(() => {
      this.setState((s) => ({ hubUiFlagsRev: (s.hubUiFlagsRev || 0) + 1 }));
    });
  }

  componentWillUnmount () {
    if (this._delayedRefreshTimer) clearTimeout(this._delayedRefreshTimer);
    if (typeof this._hubUiFlagsUnsub === 'function') this._hubUiFlagsUnsub();
  }

  getIdentity () {
    const i = (this.props && this.props.identity) || {};
    const a = (this.props && this.props.auth) || {};
    const bridge = this.props && this.props.bridgeRef && this.props.bridgeRef.current;
    let bridgeAuth = {};
    let bridgeKey = {};
    try {
      bridgeAuth = (bridge && bridge.props && bridge.props.auth) || {};
      bridgeKey = (bridge && typeof bridge._getIdentityKey === 'function' && bridge._getIdentityKey()) || {};
    } catch (e) {}
    return {
      ...a,
      ...i,
      xprv: i.xprv || a.xprv || bridgeAuth.xprv || bridgeKey.xprv,
      xpub: i.xpub || a.xpub || bridgeAuth.xpub || bridgeKey.xpub
    };
  }

  getAddressPlaceholder (network) {
    const n = String(network || '').toLowerCase();
    if (n === 'regtest') return L.addressPlaceholders.regtest;
    if (n === 'testnet' || n === 'signet') return L.addressPlaceholders.testnet;
    if (n === 'mainnet' || n === 'main') return L.addressPlaceholders.mainnet;
    return L.addressPlaceholders.other;
  }

  satsToBTC (value) {
    return formatBtcFromSats(value);
  }

  async refresh () {
    const upstream = loadUpstreamSettings();
    this.setState({ refreshing: true, upstream });
    try {
      const bitcoinStatus = await fetchBitcoinStatus(upstream).catch(() => ({ available: false }));
      const crowdfundingCampaigns = await fetchCrowdfundingCampaigns(upstream).catch(() => []);
      const campaignsNorm = Array.isArray(crowdfundingCampaigns) ? crowdfundingCampaigns : [];
      let cfVaultStats = {};
      if (campaignsNorm.length > 0 && bitcoinStatus && bitcoinStatus.available) {
        const detailRows = await Promise.all(campaignsNorm.map(async (c) => {
          const id = c && String(c.campaignId || '').trim();
          if (!id) return null;
          try {
            const d = await fetchCrowdfundingCampaign(upstream, id);
            return {
              id,
              balanceSats: Number(d.balanceSats) || 0,
              unspentCount: Number(d.unspentCount) || 0,
              goalMet: !!d.goalMet,
              vaultUtxos: Array.isArray(d.vaultUtxos) ? d.vaultUtxos : []
            };
          } catch (err) {
            return { id, error: err && err.message ? err.message : 'unavailable' };
          }
        }));
        for (const x of detailRows) {
          if (x && x.id) cfVaultStats[x.id] = x;
        }
      }
      this.setState({
        loading: false,
        refreshing: false,
        bitcoinStatus: bitcoinStatus && typeof bitcoinStatus === 'object' ? bitcoinStatus : { available: false },
        crowdfundingCampaigns: campaignsNorm,
        cfVaultStats
      });
    } catch (e) {
      this.setState({ loading: false, refreshing: false });
    }
  }

  _bip21ForRow (row) {
    const addr = String(row && row.address || '').trim();
    const minC = Math.round(Number(row && row.minContributionSats || 0)) || 546;
    const share = Math.round(Number(this.state.cfShareAmountSats || 0));
    const sats = Number.isFinite(share) && share >= minC ? share : minC;
    return buildCrowdfundFunderBitcoinUri(addr, sats / SATS_PER_BTC);
  }

  _paymentsLinkForRow (row) {
    const addr = String(row && row.address || '').trim();
    const minC = Math.round(Number(row && row.minContributionSats || 0)) || 546;
    const share = Math.round(Number(this.state.cfShareAmountSats || 0));
    const sats = Number.isFinite(share) && share >= minC ? share : minC;
    return buildCrowdfundPaymentsDeepLink({ payTo: addr, amountSats: sats });
  }

  handleCfShowBip21Qr (row) {
    const uri = this._bip21ForRow(row);
    if (!uri) return;
    QRCode.toDataURL(uri, { width: 220, margin: 1, errorCorrectionLevel: 'M' }, (err, url) => {
      if (err) return;
      this.setState({ cfQrDataUrl: url, cfQrOpen: true, cfQrUri: uri });
    });
  }

  _closeCfQr () {
    this.setState({ cfQrOpen: false, cfQrDataUrl: '', cfQrUri: '' });
  }

  handleCfFillBeneficiaryFromWallet () {
    const hex = getCrowdfundingBeneficiaryPubkeyHex(this.getIdentity());
    if (!hex) {
      if (this.props && typeof this.props.onRequireUnlock === 'function') {
        try { this.props.onRequireUnlock(); } catch (e) {}
      }
      this.setState({
        cfError: `${L.errors.beneficiaryKey} ${identityHowTo(this.getIdentity())}`,
        cfSuccess: null
      });
      return;
    }
    this.setState({ cfBeneficiaryHex: hex, cfError: null, cfSuccess: null });
  }

  handleCfFillPayoutAddressFromWallet () {
    const bitcoinNetwork = String((this.state.bitcoinStatus && this.state.bitcoinStatus.network) || '').toLowerCase() || 'regtest';
    const addr = getCrowdfundingBeneficiaryPayoutAddress(this.getIdentity(), bitcoinNetwork);
    if (!addr) {
      if (this.props && typeof this.props.onRequireUnlock === 'function') {
        try { this.props.onRequireUnlock(); } catch (e) {}
      }
      this.setState({
        cfPayoutErr: `${L.errors.payoutAddress} ${identityHowTo(this.getIdentity())}`
      });
      return;
    }
    this.setState({ cfPayoutDest: addr, cfPayoutErr: null });
  }

  handleCfPayoutBeneficiarySign () {
    const psbt = String(this.state.cfPayoutPsbt || '').trim();
    if (!psbt) return;
    const bitcoinNetwork = String((this.state.bitcoinStatus && this.state.bitcoinStatus.network) || '').toLowerCase() || 'regtest';
    this.setState({ cfPayoutBusy: true, cfPayoutErr: null });
    try {
      const nextB64 = signCrowdfundingPayoutPsbtBeneficiary(psbt, this.getIdentity(), bitcoinNetwork);
      this.setState({ cfPayoutBusy: false, cfPayoutPsbt: nextB64 });
    } catch (error) {
      this.setState({
        cfPayoutBusy: false,
        cfPayoutErr: error && error.message ? error.message : String(error)
      });
    }
  }

  async handleCrowdfundingCreate () {
    const admin = readHubAdminTokenFromBrowser(this.props.adminToken);
    if (!admin) {
      this.setState({
        cfError: t.common.errors.adminTokenRequired,
        cfSuccess: null
      });
      return;
    }
    const ben = String(this.state.cfBeneficiaryHex || '').trim().toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/.test(ben)) {
      this.setState({ cfError: L.errors.beneficiaryFormat, cfSuccess: null });
      return;
    }
    const goalSats = Math.round(Number(this.state.cfGoalSats || 0));
    const minSats = Math.round(Number(this.state.cfMinSats || 0));
    if (!Number.isFinite(goalSats) || goalSats < 1000 || !Number.isFinite(minSats) || minSats < 546) {
      this.setState({ cfError: L.errors.goalMin, cfSuccess: null });
      return;
    }
    if (minSats > goalSats) {
      this.setState({ cfError: L.errors.minOverGoal, cfSuccess: null });
      return;
    }
    let refundAfterBlocks = Math.round(Number(this.state.cfRefundAfterBlocks || 1008));
    if (!Number.isFinite(refundAfterBlocks) || refundAfterBlocks < 48) refundAfterBlocks = 1008;
    this.setState({ cfBusy: true, cfError: null, cfSuccess: null });
    try {
      const res = await createCrowdfundingCampaign(this.state.upstream, {
        title: String(this.state.cfTitle || L.defaultTitle).trim().slice(0, 200) || L.defaultTitle,
        goalSats,
        minContributionSats: minSats,
        beneficiaryPubkeyHex: ben,
        refundAfterBlocks
      }, admin);
      const camp = res && res.campaign ? res.campaign : null;
      this.setState({
        cfBusy: false,
        cfSuccess: camp
          ? L.notices.created(camp.campaignId, camp.address)
          : L.notices.createdPlain,
        cfTitle: ''
      });
      await this.refresh();
    } catch (error) {
      this.setState({
        cfBusy: false,
        cfError: error && error.message ? error.message : String(error)
      });
    }
  }

  async handleCrowdfundingCopyAcpPsbt (campaignId) {
    const id = String(campaignId || '').trim();
    const amt = Math.round(Number(this.state.cfAcpAmountSats || 0));
    if (!id) return;
    if (!Number.isFinite(amt) || amt < 546) {
      this.setState({ cfError: L.errors.donationMin, cfSuccess: null });
      return;
    }
    try {
      const data = await fetchCrowdfundingAcpDonationPsbt(this.state.upstream, id, amt);
      const b64 = data && data.psbtBase64 ? String(data.psbtBase64) : '';
      if (!b64) throw new Error(L.errors.noPsbt);
      await copyToClipboard(b64);
      this.setState({
        cfError: null,
        cfSuccess: L.notices.donationCopied(amt)
      });
      pushUiNotification({
        id: `cf-acp-${id}-${amt}`,
        kind: 'bitcoin',
        title: L.notices.donationCopiedTitle,
        subtitle: L.notices.donationCopiedSubtitle(amt, id.slice(0, 8))
      });
    } catch (error) {
      this.setState({
        cfError: error && error.message ? error.message : String(error),
        cfSuccess: null
      });
    }
  }

  async handleCrowdfundingPayjoinToVault (campaign) {
    if (!this.state.payjoinEnabled) {
      this.setState({ cfError: L.errors.payjoinOff, cfSuccess: null });
      return;
    }
    const c = campaign || {};
    const addr = String(c.address || '').trim();
    const cid = String(c.campaignId || '').trim();
    if (!addr) {
      this.setState({ cfError: L.errors.noAddress, cfSuccess: null });
      return;
    }
    const amountSats = Math.round(Number(this.state.cfPayjoinAmountSats || 0));
    if (!Number.isFinite(amountSats) || amountSats < 1) {
      this.setState({ cfError: L.errors.payjoinAmount, cfSuccess: null });
      return;
    }
    try {
      const receiveWallet = getNextReceiveWalletContext(this.getIdentity());
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        address: addr,
        amountSats,
        label: String(c.title || L.defaultTitle).slice(0, 80),
        memo: `crowdfund:${cid}`
      });
      const uri = String(session.bip21Uri || '').trim();
      this.setState({
        cfError: null,
        cfSuccess: uri
          ? L.notices.payjoinOpening
          : L.notices.payjoinCreated,
        cfPayjoinBip21: uri,
        cfPayjoinSessionId: String(session.id || '').trim()
      });
      if (uri) {
        try {
          pushUiNotification({
            id: `cf-pj-${session.id || cid}`,
            kind: 'payjoin',
            title: L.notices.payjoinTitle,
            subtitle: L.notices.payjoinSubtitle(amountSats),
            href: `/payments?bitcoinUri=${encodeURIComponent(uri)}`,
            copyText: uri
          });
        } catch (e) { /* ignore */ }
        const nav = this.props.navigate;
        if (typeof nav === 'function') {
          nav(`/payments?bitcoinUri=${encodeURIComponent(uri)}`);
        }
      }
      await this.refresh();
    } catch (error) {
      this.setState({
        cfError: error && error.message ? error.message : String(error),
        cfSuccess: null
      });
    }
  }

  _closeCfPayoutModal () {
    this.setState({
      cfPayoutModal: null,
      cfPayoutDest: '',
      cfPayoutFeeSats: '2000',
      cfPayoutPsbt: '',
      cfPayoutBusy: false,
      cfPayoutErr: null,
      cfPayoutTxid: null,
      cfPayoutHint: null
    });
  }

  async handleCfPayoutBuildPsbt () {
    const row = this.state.cfPayoutModal;
    if (!row || !row.campaignId) return;
    const dest = String(this.state.cfPayoutDest || '').trim();
    const feeSats = Math.max(1, Math.round(Number(this.state.cfPayoutFeeSats || 1000)));
    if (!dest) {
      this.setState({
        cfPayoutErr: L.errors.payoutDest
      });
      return;
    }
    this.setState({
      cfPayoutBusy: true,
      cfPayoutErr: null,
      cfPayoutTxid: null,
      cfPayoutHint: null,
      cfPayoutPsbt: ''
    });
    try {
      const res = await fetchCrowdfundingPayoutPsbt(this.state.upstream, row.campaignId, {
        destination: dest,
        feeSats
      });
      const b64 = res && res.psbtBase64 ? String(res.psbtBase64) : '';
      if (!b64) throw new Error(L.errors.noPsbt);
      this.setState({
        cfPayoutBusy: false,
        cfPayoutPsbt: b64,
        cfPayoutHint: res && res.next ? String(res.next) : null
      });
    } catch (error) {
      this.setState({
        cfPayoutBusy: false,
        cfPayoutPsbt: '',
        cfPayoutErr: error && error.message ? error.message : String(error)
      });
    }
  }

  async handleCfPayoutArbiterSign () {
    const row = this.state.cfPayoutModal;
    const psbt = String(this.state.cfPayoutPsbt || '').trim();
    if (!row || !row.campaignId || !psbt) return;
    const admin = readHubAdminTokenFromBrowser(this.props.adminToken);
    if (!admin) {
      this.setState({ cfPayoutErr: t.common.errors.adminTokenRequired });
      return;
    }
    this.setState({ cfPayoutBusy: true, cfPayoutErr: null });
    try {
      const res = await postCrowdfundingPayoutSignArbiter(
        this.state.upstream,
        row.campaignId,
        psbt,
        admin
      );
      const nextB64 = res && res.psbtBase64 ? String(res.psbtBase64) : '';
      if (!nextB64) throw new Error(L.errors.noArbiterPsbt);
      this.setState({ cfPayoutBusy: false, cfPayoutPsbt: nextB64 });
    } catch (error) {
      this.setState({
        cfPayoutBusy: false,
        cfPayoutErr: error && error.message ? error.message : String(error)
      });
    }
  }

  async handleCfPayoutBroadcast () {
    const row = this.state.cfPayoutModal;
    const psbt = String(this.state.cfPayoutPsbt || '').trim();
    if (!row || !row.campaignId || !psbt) return;
    this.setState({ cfPayoutBusy: true, cfPayoutErr: null });
    try {
      const res = await postCrowdfundingPayoutBroadcast(this.state.upstream, row.campaignId, psbt);
      const txid = res && res.txid ? String(res.txid) : '';
      if (!txid) throw new Error(L.errors.noBroadcastTxid);
      this.setState({ cfPayoutBusy: false, cfPayoutTxid: txid });
      await this.refresh();
    } catch (error) {
      this.setState({
        cfPayoutBusy: false,
        cfPayoutErr: error && error.message ? error.message : String(error)
      });
    }
  }

  _closeCfRefundModal () {
    this.setState({
      cfRefundModal: null,
      cfRefundDest: '',
      cfRefundFundedTxid: '',
      cfRefundVout: '',
      cfRefundFeeSats: '2000',
      cfRefundBusy: false,
      cfRefundErr: null,
      cfRefundTxHex: '',
      cfRefundTxid: null
    });
  }

  async handleCfRefundPrepare () {
    const row = this.state.cfRefundModal;
    if (!row || !row.campaignId) return;
    const admin = readHubAdminTokenFromBrowser(this.props.adminToken);
    if (!admin) {
      this.setState({ cfRefundErr: t.common.errors.adminTokenRequired });
      return;
    }
    const dest = String(this.state.cfRefundDest || '').trim();
    const fundedTxid = String(this.state.cfRefundFundedTxid || '').trim();
    const feeSats = Math.max(1, Math.round(Number(this.state.cfRefundFeeSats || 1000)));
    const voutRaw = String(this.state.cfRefundVout || '').trim();
    let voutOpt;
    if (voutRaw !== '' && Number.isFinite(Number(voutRaw))) voutOpt = Number(voutRaw);
    if (!dest || !fundedTxid) {
      this.setState({ cfRefundErr: L.errors.refundRequired });
      return;
    }
    this.setState({ cfRefundBusy: true, cfRefundErr: null, cfRefundTxHex: '', cfRefundTxid: null });
    try {
      const res = await postCrowdfundingRefundPrepare(
        this.state.upstream,
        row.campaignId,
        { destinationAddress: dest, fundedTxid, feeSats, vout: voutOpt },
        admin
      );
      const hex = res && res.txHex ? String(res.txHex) : '';
      const txid = res && res.txid ? String(res.txid) : '';
      if (!hex) throw new Error(L.errors.noRefundHex);
      this.setState({
        cfRefundBusy: false,
        cfRefundTxHex: hex,
        cfRefundTxid: txid || null
      });
    } catch (error) {
      this.setState({
        cfRefundBusy: false,
        cfRefundErr: error && error.message ? error.message : String(error)
      });
    }
  }

  async handleCfRefundBroadcast () {
    const hex = String(this.state.cfRefundTxHex || '').trim();
    if (!hex) return;
    const admin = readHubAdminTokenFromBrowser(this.props.adminToken);
    if (!admin) {
      this.setState({ cfRefundErr: t.common.errors.adminTokenRequired });
      return;
    }
    this.setState({ cfRefundBusy: true, cfRefundErr: null });
    try {
      const out = await broadcastRawTransaction(this.state.upstream, hex, { adminToken: admin });
      const txid = out && (out.txid || out.result) ? String(out.txid || out.result) : '';
      if (!txid) throw new Error(L.errors.noRefundTxid);
      this.setState({ cfRefundBusy: false, cfRefundTxid: txid });
      await this.refresh();
    } catch (error) {
      this.setState({
        cfRefundBusy: false,
        cfRefundErr: error && error.message ? error.message : String(error)
      });
    }
  }
  render () {
    void this.state.hubUiFlagsRev;
    const hubUi = loadHubUiFeatureFlags();
    const bitcoinNetwork = String((this.state.bitcoinStatus && this.state.bitcoinStatus.network) || '').toLowerCase();
    const hasAdminToken = !!readHubAdminTokenFromBrowser(this.props.adminToken);
    const addressPlaceholder = this.getAddressPlaceholder(bitcoinNetwork);
    const bc = this.state.bitcoinStatus && this.state.bitcoinStatus.blockchain;
    const chainHeight = bc && bc.blocks != null
      ? Number(bc.blocks)
      : (this.state.bitcoinStatus && this.state.bitcoinStatus.height != null
        ? Number(this.state.bitcoinStatus.height)
        : null);

    return (
      <div className="fade-in">
        <Segment>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em', marginBottom: '0.75em' }}>
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="heart outline" color="red" aria-hidden="true" />
              <Header.Content>{L.title}</Header.Content>
            </Header>
            <Button primary loading={this.state.refreshing} onClick={() => this.refresh()}>
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
            <Button as={Link} to="/services/bitcoin" basic>
              <Icon name="bitcoin" />
              {L.bitcoin}
            </Button>
            <Button as={Link} to="/contracts" basic title={L.contractsTitle}>
              <Icon name="file code" />
              {L.contracts}
            </Button>
            {hubUi.bitcoinPayments ? (
              <Button as={Link} to="/payments" basic>{L.payments}</Button>
            ) : null}
          </div>
          <p style={{ color: '#666' }}>{L.summary}</p>
        </Segment>
        <Segment id="fabric-bitcoin-crowdfunding" data-testid="hub-crowdfund-page">
          <Header as='h3'>{L.howTitle}</Header>
          <List ordered style={{ color: '#666', marginBottom: '0.5em' }}>
            <List.Item><strong>{L.steps.donation.title}</strong> {L.steps.donation.body}</List.Item>
            <List.Item>
              <strong>{L.steps.payjoin.title}</strong> {L.steps.payjoin.before}{' '}
              {hubUi.bitcoinPayments ? (
                <Link to="/payments#fabric-btc-make-payment-h4">{L.steps.payjoin.link}</Link>
              ) : (
                <strong>{L.steps.payjoin.link}</strong>
              )}{' '}{L.steps.payjoin.after}
            </List.Item>
            <List.Item><strong>{L.steps.payout.title}</strong> {L.steps.payout.body}</List.Item>
            <List.Item><strong>{L.steps.refund.title}</strong> {L.steps.refund.body}</List.Item>
          </List>
          <p style={{ color: '#666', marginBottom: '0.75em' }}>{L.refreshNote}</p>
          <div style={{ maxWidth: '22em', marginBottom: '0.75em' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.35em' }} htmlFor="fabric-cf-share-sats">{L.shareAmount}</label>
            <Input
              id="fabric-cf-share-sats"
              type="number"
              min="546"
              step="1"
              value={this.state.cfShareAmountSats}
              onChange={(e) => this.setState({ cfShareAmountSats: e.target.value })}
              aria-describedby="fabric-cf-share-sats-hint"
            />
            <span id="fabric-cf-share-sats-hint" style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
              {L.shareAmountHint}
            </span>
          </div>
          <Form>
            <Form.Group widths="equal">
              <Form.Field>
                <label htmlFor="fabric-cf-title">{L.campaignTitle}</label>
                <Input
                  id="fabric-cf-title"
                  placeholder={L.campaignTitlePlaceholder}
                  value={this.state.cfTitle}
                  onChange={(e) => this.setState({ cfTitle: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fabric-cf-goal">{L.goal}</label>
                <Input
                  id="fabric-cf-goal"
                  type="number"
                  min="1000"
                  step="1"
                  value={this.state.cfGoalSats}
                  onChange={(e) => this.setState({ cfGoalSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fabric-cf-min">{L.minContribution}</label>
                <Input
                  id="fabric-cf-min"
                  aria-describedby="fabric-cf-min-hint"
                  type="number"
                  min="546"
                  step="1"
                  value={this.state.cfMinSats}
                  onChange={(e) => this.setState({ cfMinSats: e.target.value })}
                />
                <span id="fabric-cf-min-hint" style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                  {L.minContributionHint}
                </span>
              </Form.Field>
            </Form.Group>
            <Form.Field>
              <label htmlFor="fabric-cf-refund-delay">{L.refundDelay}</label>
              <Input
                id="fabric-cf-refund-delay"
                aria-describedby="fabric-cf-refund-delay-hint"
                type="number"
                min="48"
                step="1"
                value={this.state.cfRefundAfterBlocks}
                onChange={(e) => this.setState({ cfRefundAfterBlocks: e.target.value })}
                style={{ maxWidth: '12em' }}
              />
              <span id="fabric-cf-refund-delay-hint" style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                {L.refundDelayHint}
              </span>
            </Form.Field>
            <Form.Field>
              <label htmlFor="fabric-cf-beneficiary">{L.beneficiary}</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
                  id="fabric-cf-beneficiary"
                  placeholder={L.beneficiaryPlaceholder}
                  value={this.state.cfBeneficiaryHex}
                  onChange={(e) => this.setState({ cfBeneficiaryHex: e.target.value.trim() })}
                  style={{ flex: '1 1 20em', minWidth: '16em', fontFamily: 'monospace', fontSize: '0.9em' }}
                />
                <Button type="button" basic onClick={() => this.handleCfFillBeneficiaryFromWallet()}>
                  {L.useWalletKey}
                </Button>
              </div>
            </Form.Field>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65em', alignItems: 'center', marginBottom: '0.65em' }}>
              <Form.Field style={{ marginBottom: 0 }}>
                <label style={{ display: 'block' }} htmlFor="fabric-cf-donation-amount">{L.donationAmount}</label>
                <Input
                  id="fabric-cf-donation-amount"
                  type="number"
                  min="546"
                  step="1"
                  value={this.state.cfAcpAmountSats}
                  onChange={(e) => this.setState({ cfAcpAmountSats: e.target.value })}
                  style={{ width: '10em' }}
                />
              </Form.Field>
              <Form.Field style={{ marginBottom: 0 }}>
                <label style={{ display: 'block' }} htmlFor="fabric-cf-payjoin-amount">{L.payjoinAmount}</label>
                <Input
                  id="fabric-cf-payjoin-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={this.state.cfPayjoinAmountSats}
                  onChange={(e) => this.setState({ cfPayjoinAmountSats: e.target.value })}
                  style={{ width: '10em' }}
                />
              </Form.Field>
            </div>
            <Button
              primary
              type="button"
              loading={this.state.cfBusy}
              disabled={this.state.cfBusy || !hasAdminToken}
              onClick={() => this.handleCrowdfundingCreate()}
            >
              <Icon name="plus" />
              {L.create}
            </Button>
            {!hasAdminToken && (
              <span style={{ marginLeft: '0.75em', color: '#888', fontSize: '0.9em' }}>{L.createNeedsToken}</span>
            )}
          </Form>
          {(this.state.cfError || this.state.cfSuccess) && (
            <Message
              style={{ marginTop: '1em' }}
              negative={!!this.state.cfError}
              positive={!this.state.cfError && !!this.state.cfSuccess}
            >
              {this.state.cfError ? <span>{this.state.cfError}</span> : <span>{this.state.cfSuccess}</span>}
            </Message>
          )}
          {this.state.cfPayjoinBip21 && (
            <Message info style={{ marginTop: '1em' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                <Button size="small" basic type="button" onClick={() => copyToClipboard(this.state.cfPayjoinBip21)}>
                  <Icon name="copy outline" />
                  {L.copyPaymentLink}
                </Button>
                <Button
                  as={Link}
                  size="small"
                  primary
                  to={`/payments?bitcoinUri=${encodeURIComponent(this.state.cfPayjoinBip21)}`}
                >
                  {L.openInPayments}
                </Button>
                {this.state.cfPayjoinSessionId && (
                  <span style={{ fontSize: '0.88em', color: '#555' }}>
                    {L.session} <code>{this.state.cfPayjoinSessionId.slice(0, 12)}…</code>
                  </span>
                )}
              </div>
            </Message>
          )}
          <Header as="h4" style={{ marginTop: '1.25em' }}>{L.campaignsTitle}</Header>
          {(this.state.loading || this.state.refreshing) && (!this.state.crowdfundingCampaigns || this.state.crowdfundingCampaigns.length === 0) ? (
            <p style={{ color: '#888' }}>{L.loading}</p>
          ) : (!this.state.crowdfundingCampaigns || this.state.crowdfundingCampaigns.length === 0) ? (
            <p style={{ color: '#888' }}>{L.empty}</p>
          ) : (
            <Table compact celled unstackable>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{L.colCampaign}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colVault}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colRaised}</Table.HeaderCell>
                  <Table.HeaderCell textAlign="center">{L.colCoins}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colRefund}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colGoal}</Table.HeaderCell>
                  <Table.HeaderCell>{L.colActions}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.crowdfundingCampaigns.map((row) => {
                  const cid = String(row.campaignId || '');
                  const addr = String(row.address || '');
                  const shortAddr = addr.length > 22 ? `${addr.slice(0, 14)}…${addr.slice(-8)}` : addr;
                  const st = cid ? (this.state.cfVaultStats[cid] || null) : null;
                  const goalNum = Number(row.goalSats) || 0;
                  const balNum = st && !st.error ? Number(st.balanceSats) : 0;
                  const pct = goalNum > 0 && st && !st.error
                    ? Math.min(100, Math.round((balNum / goalNum) * 100))
                    : null;
                  const rt = row.refundLocktimeHeight;
                  const refundEta = rt != null && chainHeight != null && Number.isFinite(chainHeight)
                    ? (rt <= chainHeight ? 'active' : rt - chainHeight)
                    : null;
                  const canPayout = !!(st && !st.error && st.goalMet);
                  const refundUnlocked = refundEta === 'active';
                  const canRefundUi = refundUnlocked && hasAdminToken;
                  const refundTitle = !refundUnlocked
                    ? (rt != null && chainHeight != null && typeof refundEta === 'number'
                      ? L.refundTitles.inBlocks(refundEta, rt)
                      : L.refundTitles.unknown)
                    : !hasAdminToken
                      ? L.refundTitles.needsToken
                      : L.refundTitles.ready;
                  const payoutTitle = !st
                    ? L.payoutTitles.notLoaded
                    : st.error
                      ? String(st.error)
                      : !st.goalMet
                        ? L.payoutTitles.notMet
                        : L.payoutTitles.ready;
                  return (
                    <Table.Row key={cid || addr}>
                      <Table.Cell>
                        <div><strong>{row.title || t.common.none}</strong></div>
                        <div style={{ fontSize: '0.82em', color: '#666', fontFamily: 'monospace' }}>{cid}</div>
                      </Table.Cell>
                      <Table.Cell style={{ fontFamily: 'monospace', fontSize: '0.85em', wordBreak: 'break-all' }} title={addr}>
                        <div>{shortAddr}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', marginTop: '0.35em' }}>
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!addr}
                            onClick={() => copyToClipboard(addr)}
                          >
                            <Icon name="copy outline" />
                            {L.copyAddress}
                          </Button>
                          {cid
                            ? (
                              <Button
                                as="a"
                                size="mini"
                                basic
                                href={crowdfundCampaignApiUrl(this.state.upstream, cid) || `#`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={L.viewJsonTitle}
                              >
                                {L.viewJson}
                              </Button>
                              )
                            : null}
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!addr}
                            onClick={() => copyToClipboard(this._bip21ForRow(row))}
                          >
                            {L.copyPaymentLink}
                          </Button>
                          <Button
                            as={Link}
                            size="mini"
                            basic
                            to={this._paymentsLinkForRow(row)}
                            disabled={!addr || !hubUi.bitcoinPayments}
                            title={hubUi.bitcoinPayments ? L.openPaymentsTitle : L.paymentsOff}
                          >
                            {L.openInPayments}
                          </Button>
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!addr}
                            onClick={() => this.handleCfShowBip21Qr(row)}
                          >
                            {L.showQr}
                          </Button>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        {st && st.error
                          ? <span style={{ color: '#a33', fontSize: '0.88em' }} title={st.error}>{t.common.none}</span>
                          : st
                            ? (
                              <div>
                                <div>{L.raised(formatSatsDisplay(st.balanceSats || 0))}</div>
                                {pct != null ? (
                                  <div style={{ fontSize: '0.8em', color: '#888' }}>{L.percentOfGoal(pct)}</div>
                                ) : null}
                                {st.goalMet ? <Label size="tiny" color="green" style={{ marginTop: '0.35em' }}>{L.goalMet}</Label> : null}
                              </div>
                              )
                            : <span style={{ color: '#aaa' }} title={L.refreshForBalance}>…</span>}
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        {st && !st.error ? (st.unspentCount != null ? st.unspentCount : t.common.none) : t.common.none}
                      </Table.Cell>
                      <Table.Cell style={{ fontSize: '0.85em' }}>
                        {rt != null ? (
                          <div>
                            <div>{L.height(rt)}</div>
                            {refundEta === 'active'
                              ? <div style={{ color: '#2185d0' }}>{L.refundOpen}</div>
                              : refundEta != null && typeof refundEta === 'number'
                                ? <div style={{ color: '#888' }}>{L.blocksToGo(refundEta)}</div>
                                : null}
                          </div>
                        ) : t.common.none}
                      </Table.Cell>
                      <Table.Cell>
                        {L.goalValue(formatSatsDisplay(row.goalSats))}
                        <div style={{ fontSize: '0.8em', color: '#888' }}>{L.minimum(formatSatsDisplay(row.minContributionSats))}</div>
                      </Table.Cell>
                      <Table.Cell>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em', alignItems: 'flex-start' }}>
                          <Button
                            size="small"
                            basic
                            type="button"
                            disabled={!cid}
                            onClick={() => this.handleCrowdfundingCopyAcpPsbt(cid)}
                          >
                            {L.copyDonationPsbt}
                          </Button>
                          <Button
                            size="small"
                            primary
                            type="button"
                            disabled={!cid || !addr || !hubUi.bitcoinPayments}
                            title={hubUi.bitcoinPayments ? L.payjoinToVaultTitle : L.paymentsOff}
                            onClick={() => this.handleCrowdfundingPayjoinToVault(row)}
                          >
                            {L.payjoinToVault}
                          </Button>
                      <Button
                        size="small"
                        type="button"
                        color="green"
                        basic
                        disabled={!cid || !canPayout}
                        title={payoutTitle}
                        onClick={() => this.setState({
                              cfPayoutModal: row,
                              cfPayoutDest: '',
                              cfPayoutFeeSats: '2000',
                              cfPayoutPsbt: '',
                              cfPayoutBusy: false,
                              cfPayoutErr: null,
                              cfPayoutTxid: null,
                              cfPayoutHint: null
                            })}
                          >
                            {L.payOut}
                          </Button>
                          <Button
                            size="small"
                            type="button"
                            color="orange"
                            basic
                            disabled={!cid || !canRefundUi}
                            title={refundTitle}
                            onClick={() => {
                              const stNow = cid ? (this.state.cfVaultStats[cid] || null) : null;
                              const u0 = stNow && Array.isArray(stNow.vaultUtxos) && stNow.vaultUtxos[0]
                                ? stNow.vaultUtxos[0]
                                : null;
                              this.setState({
                                cfRefundModal: row,
                                cfRefundDest: '',
                                cfRefundFundedTxid: u0 ? String(u0.txid) : '',
                                cfRefundVout: u0 && u0.vout != null ? String(u0.vout) : '',
                                cfRefundFeeSats: '2000',
                                cfRefundBusy: false,
                                cfRefundErr: null,
                                cfRefundTxHex: '',
                                cfRefundTxid: null
                              });
                            }}
                          >
                            {L.refund}
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
          <Modal
            open={!!this.state.cfPayoutModal}
            onClose={() => this._closeCfPayoutModal()}
            size="small"
            closeIcon
          >
            <Modal.Header>
              {L.payoutModalTitle(this.state.cfPayoutModal && this.state.cfPayoutModal.title)}
            </Modal.Header>
            <Modal.Content>
              {this.state.cfPayoutModal && this.state.cfPayoutModal.campaignId
                ? (
                  <p style={{ fontSize: '0.88em', color: '#666', wordBreak: 'break-all' }}>
                    <code>{this.state.cfPayoutModal.campaignId}</code>
                  </p>
                  )
                : null}
              <Form>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-payout-dest">{L.payoutAddress}</label>
                  <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Input
                      id="fabric-crowdfunding-payout-dest"
                      placeholder={addressPlaceholder}
                      value={this.state.cfPayoutDest}
                      onChange={(e) => this.setState({ cfPayoutDest: e.target.value })}
                      style={{ flex: '1 1 18em', minWidth: '14em' }}
                      aria-describedby="fabric-crowdfunding-payout-dest-hint"
                    />
                    <Button type="button" basic onClick={() => this.handleCfFillPayoutAddressFromWallet()}>
                      {L.useWalletAddress}
                    </Button>
                  </div>
                  <span id="fabric-crowdfunding-payout-dest-hint" style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                    {L.payoutAddressHint}
                  </span>
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-payout-fee">{L.payoutFee}</label>
                  <Input
                    id="fabric-crowdfunding-payout-fee"
                    type="number"
                    min="1"
                    step="1"
                    value={this.state.cfPayoutFeeSats}
                    onChange={(e) => this.setState({ cfPayoutFeeSats: e.target.value })}
                    style={{ maxWidth: '10em' }}
                  />
                </Form.Field>
              </Form>
              <Button
                primary
                type="button"
                loading={this.state.cfPayoutBusy && !this.state.cfPayoutPsbt}
                disabled={this.state.cfPayoutBusy || !this.state.cfPayoutModal}
                onClick={() => this.handleCfPayoutBuildPsbt()}
              >
                {L.buildPayout}
              </Button>
              {this.state.cfPayoutErr && (
                <Message negative style={{ marginTop: '1em' }}>
                  {this.state.cfPayoutErr}
                </Message>
              )}
              {this.state.cfPayoutHint && (
                <Message info style={{ marginTop: '1em' }}>
                  {this.state.cfPayoutHint}
                </Message>
              )}
              {this.state.cfPayoutPsbt
                ? (
                  <Message style={{ marginTop: '1em' }}>
                    <p style={{ marginBottom: '0.75em' }}>
                      {L.payoutOrder}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                      <Button
                        size="small"
                        basic
                        type="button"
                        onClick={() => copyToClipboard(this.state.cfPayoutPsbt)}
                      >
                        <Icon name="copy outline" />
                        {L.copyPsbt}
                      </Button>
                      <Button
                        size="small"
                        color="blue"
                        type="button"
                        disabled={this.state.cfPayoutBusy}
                        title={L.signWithWalletTitle}
                        onClick={() => this.handleCfPayoutBeneficiarySign()}
                      >
                        {L.signWithWallet}
                      </Button>
                      <Button
                        size="small"
                        type="button"
                        disabled={this.state.cfPayoutBusy || !hasAdminToken}
                        title={hasAdminToken ? L.arbiterSignTitle : L.needsToken}
                        onClick={() => this.handleCfPayoutArbiterSign()}
                      >
                        {L.arbiterSign}
                      </Button>
                      <Button
                        size="small"
                        positive
                        type="button"
                        disabled={this.state.cfPayoutBusy}
                        onClick={() => this.handleCfPayoutBroadcast()}
                      >
                        {L.broadcast}
                      </Button>
                    </div>
                  </Message>
                  )
                : null}
              {this.state.cfPayoutTxid
                ? (
                  <Message positive style={{ marginTop: '1em' }}>
                    {L.broadcastDone}{' '}
                    {hubUi.bitcoinExplorer ? (
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(this.state.cfPayoutTxid)}`}>{this.state.cfPayoutTxid}</Link>
                    ) : (
                      <code>{this.state.cfPayoutTxid}</code>
                    )}
                  </Message>
                  )
                : null}
            </Modal.Content>
            <Modal.Actions>
              <Button type="button" onClick={() => this._closeCfPayoutModal()}>{t.common.actions.close}</Button>
            </Modal.Actions>
          </Modal>
          <Modal
            open={!!this.state.cfRefundModal}
            onClose={() => this._closeCfRefundModal()}
            size="small"
            closeIcon
          >
            <Modal.Header>
              {L.refundModalTitle(this.state.cfRefundModal && this.state.cfRefundModal.title)}
            </Modal.Header>
            <Modal.Content>
              {this.state.cfRefundModal && this.state.cfRefundModal.campaignId
                ? (
                  <p style={{ fontSize: '0.88em', color: '#666', wordBreak: 'break-all' }}>
                    <code>{this.state.cfRefundModal.campaignId}</code>
                  </p>
                  )
                : null}
              <Message warning size="small" style={{ marginBottom: '1em' }}>
                {L.refundWarning}
              </Message>
              {(() => {
                const mid = this.state.cfRefundModal && this.state.cfRefundModal.campaignId
                  ? String(this.state.cfRefundModal.campaignId)
                  : '';
                const stR = mid ? (this.state.cfVaultStats[mid] || null) : null;
                const ux = stR && Array.isArray(stR.vaultUtxos) ? stR.vaultUtxos : [];
                if (ux.length === 0) return null;
                return (
                  <div style={{ marginBottom: '1em', fontSize: '0.88em', color: '#555' }}>
                    <strong>{L.vaultCoins}</strong>{' '}{L.vaultCoinsHint}
                    <List relaxed divided style={{ marginTop: '0.5em' }}>
                      {ux.slice(0, 8).map((u, i) => (
                        <List.Item key={`${u.txid}:${u.vout}:${i}`}>
                          <List.Content>
                            <code style={{ wordBreak: 'break-all', fontSize: '0.82em' }}>{u.txid}</code>
                            {' '}{L.output(u.vout != null ? u.vout : t.common.none)}
                            {u.amountSats != null ? ` · ${L.raised(formatSatsDisplay(u.amountSats))}` : ''}
                            <Button
                              size="mini"
                              basic
                              type="button"
                              style={{ marginLeft: '0.5em' }}
                              onClick={() => this.setState({
                                cfRefundFundedTxid: String(u.txid),
                                cfRefundVout: u.vout != null ? String(u.vout) : ''
                              })}
                            >
                              {L.use}
                            </Button>
                          </List.Content>
                        </List.Item>
                      ))}
                    </List>
                  </div>
                );
              })()}
              <Form>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-refund-dest">{L.refundAddress}</label>
                  <Input
                    id="fabric-crowdfunding-refund-dest"
                    placeholder={addressPlaceholder}
                    value={this.state.cfRefundDest}
                    onChange={(e) => this.setState({ cfRefundDest: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-refund-txid">{L.vaultTxid}</label>
                  <Input
                    id="fabric-crowdfunding-refund-txid"
                    placeholder={L.txidPlaceholder}
                    value={this.state.cfRefundFundedTxid}
                    onChange={(e) => this.setState({ cfRefundFundedTxid: e.target.value.trim() })}
                    style={{ fontFamily: 'monospace', fontSize: '0.88em' }}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-refund-vout">{L.outputIndex}</label>
                  <Input
                    id="fabric-crowdfunding-refund-vout"
                    type="number"
                    min="0"
                    step="1"
                    placeholder={L.outputIndexPlaceholder}
                    value={this.state.cfRefundVout}
                    onChange={(e) => this.setState({ cfRefundVout: e.target.value })}
                    style={{ maxWidth: '8em' }}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-refund-fee">{L.refundFee}</label>
                  <Input
                    id="fabric-crowdfunding-refund-fee"
                    type="number"
                    min="1"
                    step="1"
                    value={this.state.cfRefundFeeSats}
                    onChange={(e) => this.setState({ cfRefundFeeSats: e.target.value })}
                    style={{ maxWidth: '10em' }}
                  />
                </Form.Field>
              </Form>
              <Button
                primary
                type="button"
                loading={this.state.cfRefundBusy && !this.state.cfRefundTxHex}
                disabled={this.state.cfRefundBusy || !this.state.cfRefundModal}
                onClick={() => this.handleCfRefundPrepare()}
              >
                {L.prepareRefund}
              </Button>
              {this.state.cfRefundErr && (
                <Message negative style={{ marginTop: '1em' }}>
                  {this.state.cfRefundErr}
                </Message>
              )}
              {this.state.cfRefundTxHex
                ? (
                  <Message style={{ marginTop: '1em' }}>
                    <p style={{ marginBottom: '0.75em' }}>
                      {L.refundSigned}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                      <Button
                        size="small"
                        basic
                        type="button"
                        onClick={() => copyToClipboard(this.state.cfRefundTxHex)}
                      >
                        <Icon name="copy outline" />
                        {L.copyHex}
                      </Button>
                      <Button
                        size="small"
                        positive
                        type="button"
                        disabled={this.state.cfRefundBusy || !hasAdminToken}
                        title={hasAdminToken ? L.broadcastRefundTitle : L.needsToken}
                        onClick={() => this.handleCfRefundBroadcast()}
                      >
                        {L.broadcast}
                      </Button>
                    </div>
                  </Message>
                  )
                : null}
              {this.state.cfRefundTxid
                ? (
                  <Message positive style={{ marginTop: '1em' }}>
                    {L.transactionId}{' '}
                    {hubUi.bitcoinExplorer ? (
                      <Link to={`/services/bitcoin/transactions/${encodeURIComponent(this.state.cfRefundTxid)}`}>
                        {this.state.cfRefundTxid}
                      </Link>
                    ) : (
                      <code>{this.state.cfRefundTxid}</code>
                    )}
                  </Message>
                  )
                : null}
            </Modal.Content>
            <Modal.Actions>
              <Button type="button" onClick={() => this._closeCfRefundModal()}>{t.common.actions.close}</Button>
            </Modal.Actions>
          </Modal>
        </Segment>
        <Modal open={this.state.cfQrOpen} onClose={() => this._closeCfQr()} size="tiny">
          <Modal.Header>{L.qrTitle}</Modal.Header>
          <Modal.Content style={{ textAlign: 'center' }}>
            {this.state.cfQrDataUrl ? (
              <img src={this.state.cfQrDataUrl} alt={L.qrAlt} style={{ maxWidth: '100%' }} />
            ) : null}
            {this.state.cfQrUri ? (
              <p style={{ wordBreak: 'break-all', fontSize: '0.85em', marginTop: '0.75em' }}>{this.state.cfQrUri}</p>
            ) : null}
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => this._closeCfQr()}>{t.common.actions.close}</Button>
          </Modal.Actions>
        </Modal>
      </div>
    );
  }
}

module.exports = CrowdfundingHome;
