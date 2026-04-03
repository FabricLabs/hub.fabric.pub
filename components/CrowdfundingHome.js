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
    if (n === 'regtest') return "bcrt1... or m/44'/0'/0'/0/0";
    if (n === 'testnet' || n === 'signet') return 'tb1... or 2N...';
    if (n === 'mainnet' || n === 'main') return 'bc1... or 3...';
    return 'address for current network';
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
    return buildCrowdfundFunderBitcoinUri(addr, sats / 1e8);
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
        cfError: 'Unlock identity so we can derive your payment wallet pubkey at m/44\'/0\'/0\'/0/0.',
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
        cfPayoutErr: 'Cannot derive payout address from wallet context. Unlock identity (or enter any destination manually).'
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
        cfError: 'Save the Hub admin token (Settings / Bitcoin home) to create Taproot campaigns.',
        cfSuccess: null
      });
      return;
    }
    const ben = String(this.state.cfBeneficiaryHex || '').trim().toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/.test(ben)) {
      this.setState({ cfError: 'Beneficiary must be a compressed secp256k1 pubkey hex (02 or 03 + 64 hex).', cfSuccess: null });
      return;
    }
    const goalSats = Math.round(Number(this.state.cfGoalSats || 0));
    const minSats = Math.round(Number(this.state.cfMinSats || 0));
    if (!Number.isFinite(goalSats) || goalSats < 1000 || !Number.isFinite(minSats) || minSats < 546) {
      this.setState({ cfError: 'Goal must be ≥ 1000 sats; minimum contribution ≥ 546.', cfSuccess: null });
      return;
    }
    if (minSats > goalSats) {
      this.setState({ cfError: 'Minimum contribution cannot exceed goal.', cfSuccess: null });
      return;
    }
    let refundAfterBlocks = Math.round(Number(this.state.cfRefundAfterBlocks || 1008));
    if (!Number.isFinite(refundAfterBlocks) || refundAfterBlocks < 48) refundAfterBlocks = 1008;
    this.setState({ cfBusy: true, cfError: null, cfSuccess: null });
    try {
      const res = await createCrowdfundingCampaign(this.state.upstream, {
        title: String(this.state.cfTitle || 'Crowdfund').trim().slice(0, 200) || 'Crowdfund',
        goalSats,
        minContributionSats: minSats,
        beneficiaryPubkeyHex: ben,
        refundAfterBlocks
      }, admin);
      const camp = res && res.campaign ? res.campaign : null;
      this.setState({
        cfBusy: false,
        cfSuccess: camp
          ? `Campaign ${camp.campaignId} — vault ${camp.address}`
          : 'Campaign created.',
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
      this.setState({ cfError: 'Set ACP leg amount (sats) ≥ 546.', cfSuccess: null });
      return;
    }
    try {
      const data = await fetchCrowdfundingAcpDonationPsbt(this.state.upstream, id, amt);
      const b64 = data && data.psbtBase64 ? String(data.psbtBase64) : '';
      if (!b64) throw new Error('Hub did not return psbtBase64.');
      await copyToClipboard(b64);
      this.setState({
        cfError: null,
        cfSuccess: `Copied outputs-only PSBT (${amt} sats to campaign). Add inputs; sign with SIGHASH_ALL|ANYONECANPAY (0x81).`
      });
      pushUiNotification({
        id: `cf-acp-${id}-${amt}`,
        kind: 'bitcoin',
        title: 'ACP crowdfund PSBT copied',
        subtitle: `${amt} sats output to campaign ${id.slice(0, 8)}…`
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
      this.setState({ cfError: 'Enable Payjoin (above) for deposit sessions.', cfSuccess: null });
      return;
    }
    const c = campaign || {};
    const addr = String(c.address || '').trim();
    const cid = String(c.campaignId || '').trim();
    if (!addr) {
      this.setState({ cfError: 'Campaign has no address.', cfSuccess: null });
      return;
    }
    const amountSats = Math.round(Number(this.state.cfPayjoinAmountSats || 0));
    if (!Number.isFinite(amountSats) || amountSats < 1) {
      this.setState({ cfError: 'Set Payjoin request amount (sats) for the BIP21 link.', cfSuccess: null });
      return;
    }
    try {
      const receiveWallet = getNextReceiveWalletContext(this.getIdentity());
      const session = await createPayjoinDeposit(this.state.upstream, receiveWallet, {
        address: addr,
        amountSats,
        label: String(c.title || 'Crowdfund').slice(0, 80),
        memo: `crowdfund:${cid}`
      });
      const uri = String(session.bip21Uri || '').trim();
      this.setState({
        cfError: null,
        cfSuccess: uri
          ? 'Payjoin session points at the campaign vault. Opening Payments with the BIP21 URI…'
          : 'Payjoin session created.',
        cfPayjoinBip21: uri,
        cfPayjoinSessionId: String(session.id || '').trim()
      });
      if (uri) {
        try {
          pushUiNotification({
            id: `cf-pj-${session.id || cid}`,
            kind: 'payjoin',
            title: 'Payjoin → crowdfund vault',
            subtitle: `${amountSats} sats`,
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
        cfPayoutErr: 'Enter a beneficiary payout address (bech32), or use Fill from wallet.'
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
      if (!b64) throw new Error('Hub did not return psbtBase64.');
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
      this.setState({ cfPayoutErr: 'Admin token required for Hub arbiter co-sign.' });
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
      if (!nextB64) throw new Error('No psbtBase64 after arbiter sign.');
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
      if (!txid) throw new Error('No txid after broadcast.');
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
      this.setState({ cfRefundErr: 'Admin token required for arbiter refund.' });
      return;
    }
    const dest = String(this.state.cfRefundDest || '').trim();
    const fundedTxid = String(this.state.cfRefundFundedTxid || '').trim();
    const feeSats = Math.max(1, Math.round(Number(this.state.cfRefundFeeSats || 1000)));
    const voutRaw = String(this.state.cfRefundVout || '').trim();
    let voutOpt;
    if (voutRaw !== '' && Number.isFinite(Number(voutRaw))) voutOpt = Number(voutRaw);
    if (!dest || !fundedTxid) {
      this.setState({ cfRefundErr: 'Destination address and funding txid (vault UTXO) are required.' });
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
      if (!hex) throw new Error('Hub did not return txHex.');
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
      this.setState({ cfRefundErr: 'Admin token required to broadcast.' });
      return;
    }
    this.setState({ cfRefundBusy: true, cfRefundErr: null });
    try {
      const out = await broadcastRawTransaction(this.state.upstream, hex, { adminToken: admin });
      const txid = out && (out.txid || out.result) ? String(out.txid || out.result) : '';
      if (!txid) throw new Error('Broadcast did not return txid.');
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
              <Header.Content>Crowdfunds</Header.Content>
            </Header>
            <Button primary loading={this.state.refreshing} onClick={() => this.refresh()}>
              <Icon name="refresh" />
              Refresh
            </Button>
            <Button as={Link} to="/services/bitcoin" basic>
              <Icon name="bitcoin" />
              Bitcoin
            </Button>
            <Button as={Link} to="/contracts" basic title="Storage, execution, and Taproot crowdfunds on this hub">
              <Icon name="file code" />
              Contracts
            </Button>
            {hubUi.bitcoinPayments ? (
              <Button as={Link} to="/payments" basic>Payments</Button>
            ) : null}
          </div>
          <p style={{ color: '#666' }}>Taproot campaign vaults on this Hub. Campaigns are stored locally on this node (not synced to other hubs).</p>
        </Segment>
        <Segment id="fabric-bitcoin-crowdfunding">
          <Header as='h3'>Crowdfund · ACP · Payjoin to vault</Header>
          <p style={{ color: '#666', marginBottom: '0.75em' }}>
            <strong>Step A — ACP:</strong> outputs-only PSBT paying the campaign vault; donors add UTXOs and sign with{' '}
            <code>SIGHASH_ALL|ANYONECANPAY</code> (0x81), merge until fees clear, broadcast.
            {' '}<strong>Step B — Payjoin:</strong> a BIP77 deposit session uses the <em>same</em> vault address so payers can use{' '}
            {hubUi.bitcoinPayments ? (
              <Link to="/payments#fabric-btc-make-payment-h4">Payments</Link>
            ) : (
              <strong>Payments</strong>
            )}{' '}(e.g. local Payjoin or <strong>ACP + Hub boost</strong>).
            {' '}
            <strong>Step C — Payout:</strong> when raised ≥ goal, beneficiary signs the unsigned payout PSBT, then Hub arbiter co-signs (admin), then broadcast.
            {' '}
            <strong>Step D — Refund:</strong> after the refund CLTV height (see table), the Hub arbiter can sweep a vault UTXO to a destination you choose (admin): prepare returns a <strong>signed</strong> raw tx — copy hex or broadcast from the modal.
            {' '}If the goal was met, prefer <strong>Payout</strong> so the beneficiary receives funds via the 2-of-2 path.
            {' '}Vault balance, UTXO hints, and goal status refresh with <strong>Refresh</strong> above.
          </p>
          <div style={{ maxWidth: '22em', marginBottom: '0.75em' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.35em' }} htmlFor="fabric-cf-share-sats">Default for funder links — BIP21 / Payments (sats)</label>
            <Input
              id="fabric-cf-share-sats"
              type="number"
              min="546"
              step="1"
              value={this.state.cfShareAmountSats}
              onChange={(e) => this.setState({ cfShareAmountSats: e.target.value })}
              aria-label="Default amount in sats for BIP21, QR, and Open Payments links"
            />
            <span style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
              Must be at least each campaign&apos;s min per UTXO (below). Used for Copy BIP21, QR, and Open Payments.
            </span>
          </div>
          <Form>
            <Form.Group widths="equal">
              <Form.Field>
                <label>Title</label>
                <Input
                  placeholder="Regtest demo campaign"
                  value={this.state.cfTitle}
                  onChange={(e) => this.setState({ cfTitle: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Goal (sats)</label>
                <Input
                  type="number"
                  min="1000"
                  step="1"
                  value={this.state.cfGoalSats}
                  onChange={(e) => this.setState({ cfGoalSats: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Min per vault UTXO (sats)</label>
                <Input
                  type="number"
                  min="546"
                  step="1"
                  value={this.state.cfMinSats}
                  onChange={(e) => this.setState({ cfMinSats: e.target.value })}
                />
                <span style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                  Each separate output sent to the vault must be at least this (policy enforced when building payout).
                </span>
              </Form.Field>
            </Form.Group>
            <Form.Field>
              <label>Refund path delay (+blocks from tip at create)</label>
              <Input
                type="number"
                min="48"
                step="1"
                value={this.state.cfRefundAfterBlocks}
                onChange={(e) => this.setState({ cfRefundAfterBlocks: e.target.value })}
                style={{ maxWidth: '12em' }}
              />
              <span style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                Absolute CLTV height = chain tip at create + this value (minimum 48; default 1008 ≈ one week on mainnet cadence).
              </span>
            </Form.Field>
            <Form.Field>
              <label>Beneficiary compressed pubkey hex (02/03…)</label>
              <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
                  placeholder="033…"
                  value={this.state.cfBeneficiaryHex}
                  onChange={(e) => this.setState({ cfBeneficiaryHex: e.target.value.trim() })}
                  style={{ flex: '1 1 20em', minWidth: '16em', fontFamily: 'monospace', fontSize: '0.9em' }}
                />
                <Button type="button" basic onClick={() => this.handleCfFillBeneficiaryFromWallet()}>
                  Fill from unlocked wallet
                </Button>
              </div>
            </Form.Field>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65em', alignItems: 'center', marginBottom: '0.65em' }}>
              <Form.Field style={{ marginBottom: 0 }}>
                <label style={{ display: 'block' }}>ACP output leg (sats)</label>
                <Input
                  type="number"
                  min="546"
                  step="1"
                  value={this.state.cfAcpAmountSats}
                  onChange={(e) => this.setState({ cfAcpAmountSats: e.target.value })}
                  style={{ width: '10em' }}
                />
              </Form.Field>
              <Form.Field style={{ marginBottom: 0 }}>
                <label style={{ display: 'block' }}>Payjoin request (sats)</label>
                <Input
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
              Create Taproot campaign
            </Button>
            {!hasAdminToken && (
              <span style={{ marginLeft: '0.75em', color: '#888', fontSize: '0.9em' }}>Admin token required to create.</span>
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
                  Copy crowdfund BIP21
                </Button>
                <Button
                  as={Link}
                  size="small"
                  primary
                  to={`/payments?bitcoinUri=${encodeURIComponent(this.state.cfPayjoinBip21)}`}
                >
                  Open Payments (prefill)
                </Button>
                {this.state.cfPayjoinSessionId && (
                  <span style={{ fontSize: '0.88em', color: '#555' }}>
                    Session <code>{this.state.cfPayjoinSessionId.slice(0, 12)}…</code>
                  </span>
                )}
              </div>
            </Message>
          )}
          <Header as="h4" style={{ marginTop: '1.25em' }}>Campaigns</Header>
          {(this.state.loading || this.state.refreshing) && (!this.state.crowdfundingCampaigns || this.state.crowdfundingCampaigns.length === 0) ? (
            <p style={{ color: '#888' }}>Loading campaigns...</p>
          ) : (!this.state.crowdfundingCampaigns || this.state.crowdfundingCampaigns.length === 0) ? (
            <p style={{ color: '#888' }}>No campaigns yet. Create one above when Bitcoin is available (admin token required).</p>
          ) : (
            <Table compact celled unstackable>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Title / id</Table.HeaderCell>
                  <Table.HeaderCell>Vault address</Table.HeaderCell>
                  <Table.HeaderCell>Raised</Table.HeaderCell>
                  <Table.HeaderCell textAlign="center">UTXOs</Table.HeaderCell>
                  <Table.HeaderCell>Refund CLTV</Table.HeaderCell>
                  <Table.HeaderCell>Goal</Table.HeaderCell>
                  <Table.HeaderCell>Actions</Table.HeaderCell>
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
                      ? `Refund unlocks in ~${refundEta} blocks (height ${rt})`
                      : 'Refund unlocks after CLTV height (refresh for chain tip)')
                    : !hasAdminToken
                      ? 'Admin token required for arbiter refund'
                      : 'After CLTV: arbiter-signed refund (vault UTXO → destination)';
                  const payoutTitle = !st
                    ? 'Refresh (toolbar) to load vault balance from the node'
                    : st.error
                      ? String(st.error)
                      : !st.goalMet
                        ? 'Payout unlocks when raised ≥ goal'
                        : 'Build payout PSBT (beneficiary signs, then arbiter, then broadcast)';
                  return (
                    <Table.Row key={cid || addr}>
                      <Table.Cell>
                        <div><strong>{row.title || '—'}</strong></div>
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
                            Copy address
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
                                title="Campaign JSON + live balance"
                              >
                                API
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
                            Copy BIP21
                          </Button>
                          <Button
                            as={Link}
                            size="mini"
                            basic
                            to={this._paymentsLinkForRow(row)}
                            disabled={!addr || !hubUi.bitcoinPayments}
                            title={hubUi.bitcoinPayments ? 'Open Payments with campaign BIP21 prefill' : 'Enable Bitcoin Payments in Admin feature visibility first'}
                          >
                            Open Payments
                          </Button>
                          <Button
                            size="mini"
                            basic
                            type="button"
                            disabled={!addr}
                            onClick={() => this.handleCfShowBip21Qr(row)}
                          >
                            QR
                          </Button>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        {st && st.error
                          ? <span style={{ color: '#a33', fontSize: '0.88em' }} title={st.error}>—</span>
                          : st
                            ? (
                              <div>
                                <div>{formatSatsDisplay(st.balanceSats || 0)} sats</div>
                                {pct != null ? (
                                  <div style={{ fontSize: '0.8em', color: '#888' }}>{pct}% of goal</div>
                                ) : null}
                                {st.goalMet ? <Label size="tiny" color="green" style={{ marginTop: '0.35em' }}>Goal met</Label> : null}
                              </div>
                              )
                            : <span style={{ color: '#aaa' }} title="Use Refresh above">…</span>}
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        {st && !st.error ? (st.unspentCount != null ? st.unspentCount : '—') : '—'}
                      </Table.Cell>
                      <Table.Cell style={{ fontSize: '0.85em' }}>
                        {rt != null ? (
                          <div>
                            <div>height {rt}</div>
                            {refundEta === 'active'
                              ? <div style={{ color: '#2185d0' }}>Refund path active</div>
                              : refundEta != null && typeof refundEta === 'number'
                                ? <div style={{ color: '#888' }}>{refundEta} blocks to CLTV</div>
                                : null}
                          </div>
                        ) : '—'}
                      </Table.Cell>
                      <Table.Cell>
                        {formatSatsDisplay(row.goalSats)} sats
                        <div style={{ fontSize: '0.8em', color: '#888' }}>min {formatSatsDisplay(row.minContributionSats)}</div>
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
                            Copy ACP PSBT
                          </Button>
                          <Button
                            size="small"
                            primary
                            type="button"
                            disabled={!cid || !addr || !hubUi.bitcoinPayments}
                            title={hubUi.bitcoinPayments ? 'Create a Payjoin session for this vault' : 'Enable Bitcoin Payments in Admin feature visibility first'}
                            onClick={() => this.handleCrowdfundingPayjoinToVault(row)}
                          >
                            Payjoin → vault
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
                            Payout…
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
                            Refund…
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
              Payout campaign
              {this.state.cfPayoutModal && this.state.cfPayoutModal.title
                ? ` — ${this.state.cfPayoutModal.title}`
                : ''}
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
                  <label htmlFor="fabric-crowdfunding-payout-dest">Beneficiary payout address (bech32)</label>
                  <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Input
                      id="fabric-crowdfunding-payout-dest"
                      placeholder={addressPlaceholder}
                      value={this.state.cfPayoutDest}
                      onChange={(e) => this.setState({ cfPayoutDest: e.target.value })}
                      style={{ flex: '1 1 18em', minWidth: '14em' }}
                      aria-label="Beneficiary payout address (bech32)"
                    />
                    <Button type="button" basic onClick={() => this.handleCfFillPayoutAddressFromWallet()}>
                      Fill from wallet (0/0)
                    </Button>
                  </div>
                  <span style={{ display: 'block', marginTop: '0.25em', fontSize: '0.82em', color: '#888' }}>
                    Same BIP44 external index 0 as the campaign beneficiary key — convenient default; you may use any destination.
                  </span>
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-crowdfunding-payout-fee">Fee (sats)</label>
                  <Input
                    id="fabric-crowdfunding-payout-fee"
                    type="number"
                    min="1"
                    step="1"
                    value={this.state.cfPayoutFeeSats}
                    onChange={(e) => this.setState({ cfPayoutFeeSats: e.target.value })}
                    style={{ maxWidth: '10em' }}
                    aria-label="Payout transaction fee in sats"
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
                Build unsigned payout PSBT
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
                      Beneficiary signs all inputs with their key first. Then Hub arbiter co-sign (admin token), then broadcast.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                      <Button
                        size="small"
                        basic
                        type="button"
                        onClick={() => copyToClipboard(this.state.cfPayoutPsbt)}
                      >
                        <Icon name="copy outline" />
                        Copy PSBT
                      </Button>
                      <Button
                        size="small"
                        color="blue"
                        type="button"
                        disabled={this.state.cfPayoutBusy}
                        title="Sign all inputs with m/44'/0'/0'/0/0 (must match campaign beneficiary pubkey)"
                        onClick={() => this.handleCfPayoutBeneficiarySign()}
                      >
                        Sign with unlocked wallet
                      </Button>
                      <Button
                        size="small"
                        type="button"
                        disabled={this.state.cfPayoutBusy || !hasAdminToken}
                        title={hasAdminToken ? 'Apply Hub arbiter Schnorr signatures' : 'Admin token required'}
                        onClick={() => this.handleCfPayoutArbiterSign()}
                      >
                        Arbiter co-sign
                      </Button>
                      <Button
                        size="small"
                        positive
                        type="button"
                        disabled={this.state.cfPayoutBusy}
                        onClick={() => this.handleCfPayoutBroadcast()}
                      >
                        Broadcast
                      </Button>
                    </div>
                  </Message>
                  )
                : null}
              {this.state.cfPayoutTxid
                ? (
                  <Message positive style={{ marginTop: '1em' }}>
                    Broadcast{' '}
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
              <Button type="button" onClick={() => this._closeCfPayoutModal()}>Close</Button>
            </Modal.Actions>
          </Modal>
          <Modal
            open={!!this.state.cfRefundModal}
            onClose={() => this._closeCfRefundModal()}
            size="small"
            closeIcon
          >
            <Modal.Header>
              Arbiter refund (after CLTV)
              {this.state.cfRefundModal && this.state.cfRefundModal.title
                ? ` — ${this.state.cfRefundModal.title}`
                : ''}
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
                Hub identity signs the refund tapleaf. Use only when the campaign should not pay out via the 2-of-2 path
                (e.g. goal not met and contributors should receive funds at the address you enter).
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
                    <strong>Vault UTXOs</strong> (from node scan; pick one for funding txid / vout):
                    <List relaxed divided style={{ marginTop: '0.5em' }}>
                      {ux.slice(0, 8).map((u, i) => (
                        <List.Item key={`${u.txid}:${u.vout}:${i}`}>
                          <List.Content>
                            <code style={{ wordBreak: 'break-all', fontSize: '0.82em' }}>{u.txid}</code>
                            {' '}vout {u.vout != null ? u.vout : '—'}
                            {u.amountSats != null ? ` · ${formatSatsDisplay(u.amountSats)} sats` : ''}
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
                              Use
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
                  <label>Refund destination (bech32)</label>
                  <Input
                    placeholder={addressPlaceholder}
                    value={this.state.cfRefundDest}
                    onChange={(e) => this.setState({ cfRefundDest: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Funding txid (payment into vault)</label>
                  <Input
                    placeholder="64 hex chars"
                    value={this.state.cfRefundFundedTxid}
                    onChange={(e) => this.setState({ cfRefundFundedTxid: e.target.value.trim() })}
                    style={{ fontFamily: 'monospace', fontSize: '0.88em' }}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Output index (vout)</label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="auto if omitted"
                    value={this.state.cfRefundVout}
                    onChange={(e) => this.setState({ cfRefundVout: e.target.value })}
                    style={{ maxWidth: '8em' }}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Fee (sats)</label>
                  <Input
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
                Prepare signed refund tx
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
                      Signed raw transaction. Broadcast with admin token, or paste into <code>sendrawtransaction</code>.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                      <Button
                        size="small"
                        basic
                        type="button"
                        onClick={() => copyToClipboard(this.state.cfRefundTxHex)}
                      >
                        <Icon name="copy outline" />
                        Copy hex
                      </Button>
                      <Button
                        size="small"
                        positive
                        type="button"
                        disabled={this.state.cfRefundBusy || !hasAdminToken}
                        title={hasAdminToken ? 'POST /services/bitcoin/broadcast' : 'Admin token required'}
                        onClick={() => this.handleCfRefundBroadcast()}
                      >
                        Broadcast
                      </Button>
                    </div>
                  </Message>
                  )
                : null}
              {this.state.cfRefundTxid
                ? (
                  <Message positive style={{ marginTop: '1em' }}>
                    Txid{' '}
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
              <Button type="button" onClick={() => this._closeCfRefundModal()}>Close</Button>
            </Modal.Actions>
          </Modal>
        </Segment>
        <Modal open={this.state.cfQrOpen} onClose={() => this._closeCfQr()} size="tiny">
          <Modal.Header>Bitcoin URI (BIP21)</Modal.Header>
          <Modal.Content style={{ textAlign: 'center' }}>
            {this.state.cfQrDataUrl ? (
              <img src={this.state.cfQrDataUrl} alt="QR code" style={{ maxWidth: '100%' }} />
            ) : null}
            {this.state.cfQrUri ? (
              <p style={{ wordBreak: 'break-all', fontSize: '0.85em', marginTop: '0.75em' }}>{this.state.cfQrUri}</p>
            ) : null}
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={() => this._closeCfQr()}>Close</Button>
          </Modal.Actions>
        </Modal>
      </div>
    );
  }
}

module.exports = CrowdfundingHome;
