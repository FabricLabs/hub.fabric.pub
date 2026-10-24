'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Input, Message, Segment } = require('semantic-ui-react');
const {
  fetchBitcoinStatus,
  fetchReceiveAddress,
  fetchUTXOs,
  getNextReceiveWalletContext,
  loadUpstreamSettings,
  requestFaucet,
  clearBalanceCache
} = require('../functions/bitcoinClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { computeHubWalletSpendHints } = require('../functions/bitcoinSpendBounds');
const { fundLocalKeyFromHubFaucet } = require('../functions/fundLocalKeyFromHubFaucet');
const { SATS_PER_BTC } = require('../constants');
const t = require('../locales/en');

const L = t.payments.faucet;

function hubWalletSatsFromDetail (detail) {
  if (!detail || typeof detail !== 'object' || !detail.available) return null;
  if (detail.balanceSats != null && Number.isFinite(Number(detail.balanceSats))) {
    return Math.round(Number(detail.balanceSats));
  }
  const b = Number(detail.balance != null ? detail.balance : NaN);
  if (Number.isFinite(b)) return Math.round(b * SATS_PER_BTC);
  return 0;
}

class FaucetHome extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: false,
      resolvingAddress: false,
      upstream: loadUpstreamSettings(),
      sendTo: '',
      amountSats: '10000',
      faucetResult: null,
      faucetNotice: '',
      faucetLastStatus: null,
      hubBitcoinDetail: null,
      hubBitcoinLoading: false,
      hubBitcoinError: null,
      hubWalletUtxos: null,
      hubUtxosError: null,
      fundMyBusy: false
    };
  }

  componentDidMount () {
    void this.refreshHubWalletStatus();
  }

  async fundMyWallet () {
    const identity = (this.props && this.props.identity) || {};
    if (!identity.xpub) {
      this.setState({
        faucetResult: { error: t.common.identity.needIdentity },
        faucetNotice: ''
      });
      return;
    }
    const hubDetail = this.state.hubBitcoinDetail;
    const network = hubDetail && hubDetail.network
      ? String(hubDetail.network).toLowerCase()
      : ((this.props && this.props.bitcoin && this.props.bitcoin.network)
        ? String(this.props.bitcoin.network).toLowerCase()
        : 'regtest');
    if (network !== 'regtest') {
      this.setState({
        faucetResult: { error: L.errors.regtestOnly },
        faucetNotice: ''
      });
      return;
    }
    const amountSats = Math.round(Number(this.state.amountSats || 10000));
    this.setState({
      fundMyBusy: true,
      loading: true,
      faucetResult: null,
      faucetNotice: L.notices.funding
    });
    try {
      const funded = await fundLocalKeyFromHubFaucet({
        identity,
        adminToken: this.props && this.props.adminToken,
        amountSats: Number.isFinite(amountSats) && amountSats > 0 ? amountSats : 10000,
        network,
        mineConfirm: true
      });
      this.setState({
        fundMyBusy: false,
        loading: false,
        sendTo: funded.address,
        faucetResult: {
          ok: true,
          address: funded.address,
          amountSats: funded.amountSats,
          txid: funded.txid,
          mined: funded.mined
        },
        faucetNotice: funded.mined && funded.mined.error
          ? L.notices.fundedUnconfirmed(funded.amountSats)
          : L.notices.funded(
            funded.amountSats,
            funded.txid ? funded.txid.slice(0, 12) : '',
            !!(funded.mined && !funded.mined.error)
          ),
        faucetLastStatus: {
          ok: true,
          when: Date.now(),
          address: funded.address,
          amountSats: funded.amountSats,
          txid: funded.txid || '',
          error: ''
        }
      }, () => {
        void this.refreshHubWalletStatus();
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this.setState({
        fundMyBusy: false,
        loading: false,
        faucetResult: { error: message },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address: String(this.state.sendTo || ''),
          amountSats: amountSats,
          txid: '',
          error: message
        }
      });
    }
  }

  async refreshHubWalletStatus () {
    const upstream = {
      ...loadUpstreamSettings(),
      hubAdminToken: readHubAdminTokenFromBrowser(this.props && this.props.adminToken) || ''
    };
    this.setState({ hubBitcoinLoading: true, hubBitcoinError: null, upstream });
    try {
      const detail = await fetchBitcoinStatus(upstream);
      const d = detail && typeof detail === 'object' ? detail : null;
      let hubWalletUtxos = [];
      let hubUtxosError = null;
      if (d && d.available && d.walletName) {
        try {
          const list = await fetchUTXOs(upstream, { walletId: String(d.walletName) }, {});
          hubWalletUtxos = Array.isArray(list) ? list : [];
        } catch (e) {
          hubUtxosError = e && e.message ? e.message : String(e);
          hubWalletUtxos = [];
        }
      }
      this.setState({
        hubBitcoinLoading: false,
        hubBitcoinDetail: d,
        hubBitcoinError: null,
        hubWalletUtxos,
        hubUtxosError
      });
    } catch (error) {
      this.setState({
        hubBitcoinLoading: false,
        hubBitcoinDetail: null,
        hubBitcoinError: error && error.message ? error.message : String(error),
        hubWalletUtxos: [],
        hubUtxosError: null
      });
    }
  }

  async useMyAddress () {
    this.setState({ resolvingAddress: true });
    try {
      const identity = (this.props && this.props.identity) || {};
      const wallet = getNextReceiveWalletContext(identity);
      const network = (this.props && this.props.bitcoin && this.props.bitcoin.network)
        ? String(this.props.bitcoin.network).toLowerCase()
        : 'regtest';
      const address = await fetchReceiveAddress(this.state.upstream, wallet, { network, identity });
      this.setState({ sendTo: String(address || ''), resolvingAddress: false });
    } catch (error) {
      this.setState({
        resolvingAddress: false,
        faucetResult: { error: error && error.message ? error.message : String(error) }
      });
    }
  }

  async requestFaucet () {
    const address = String(this.state.sendTo || '').trim();
    const amountSats = Math.round(Number(this.state.amountSats || 0));
    if (this.state.resolvingAddress) {
      this.setState({
        faucetResult: { error: L.errors.stillResolving },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address: '',
          amountSats: null,
          txid: '',
          error: L.errors.stillResolving
        }
      });
      return;
    }
    if (!address) {
      this.setState({
        faucetResult: { error: L.errors.addressRequired },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address: '',
          amountSats: null,
          txid: '',
          error: L.errors.addressRequired
        }
      });
      return;
    }
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      this.setState({
        faucetResult: { error: L.errors.amountRequired },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: L.errors.amountRequired
        }
      });
      return;
    }
    const hubDetail = this.state.hubBitcoinDetail;
    const hubSatsPre = hubWalletSatsFromDetail(hubDetail);
    const utxoList = Array.isArray(this.state.hubWalletUtxos) ? this.state.hubWalletUtxos : [];
    const netPre = hubDetail && hubDetail.network ? String(hubDetail.network).toLowerCase() : 'regtest';
    const hintsPre = computeHubWalletSpendHints({
      balanceSats: hubSatsPre != null ? hubSatsPre : 0,
      utxos: utxoList,
      mempoolInfo: hubDetail && hubDetail.mempoolInfo,
      network: netPre,
      faucetCapSats: 1000000,
      targetAmountSats: amountSats
    });
    if (amountSats < hintsPre.minRecipientSats) {
      this.setState({
        faucetResult: {
          error: L.errors.belowDust(hintsPre.minRecipientSats)
        },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: L.errors.belowDustShort(hintsPre.minRecipientSats)
        }
      });
      return;
    }
    if (hintsPre.canPayTarget === false) {
      this.setState({
        faucetResult: {
          error: L.errors.cannotCover
        },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: L.errors.cannotCoverShort
        }
      });
      return;
    }
    this.setState({
      loading: true,
      faucetResult: null,
      faucetNotice: L.notices.sending(amountSats)
    });
    try {
      const result = await requestFaucet(this.state.upstream || loadUpstreamSettings(), { address, amountSats });
      const normalized = (result && typeof result === 'object') ? result : {};
      const hasExplicitError = !!normalized.error;
      const txid = normalized.txid || normalized.transactionId || normalized.id;
      const faucetResult = hasExplicitError
        ? { error: String(normalized.error) }
        : {
            ok: true,
            txid: txid ? String(txid) : undefined,
            address,
            amountSats,
            network: normalized.network || (this.props && this.props.bitcoin && this.props.bitcoin.network) || 'regtest'
          };
      this.setState({
        loading: false,
        faucetResult,
        faucetNotice: faucetResult && faucetResult.error
          ? ''
          : L.notices.accepted(faucetResult && faucetResult.txid ? String(faucetResult.txid) : ''),
        faucetLastStatus: {
          ok: !faucetResult.error,
          when: Date.now(),
          address,
          amountSats,
          txid: faucetResult && faucetResult.txid ? String(faucetResult.txid) : '',
          error: faucetResult && faucetResult.error ? String(faucetResult.error) : ''
        }
      }, () => {
        if (!faucetResult.error) {
          void this.refreshHubWalletStatus();
          try {
            const identity = (this.props && this.props.identity) || {};
            const wallet = getNextReceiveWalletContext(identity);
            if (wallet && wallet.walletId) clearBalanceCache(wallet.walletId);
          } catch (_) {}
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('clientBalanceUpdate'));
          }
        }
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this.setState({
        loading: false,
        faucetResult: { error: message },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: message
        }
      });
    }
  }

  render () {
    const detail = this.state.hubBitcoinDetail;
    const wsBitcoin = (this.props && this.props.bitcoin) || {};
    const bitcoinNetwork = detail && detail.network
      ? String(detail.network).toLowerCase()
      : (wsBitcoin.network ? String(wsBitcoin.network).toLowerCase() : 'regtest');
    const hubSats = hubWalletSatsFromDetail(detail);
    const hubBtc = hubSats != null ? hubSats / SATS_PER_BTC : null;
    const chainHeight = detail && detail.height != null ? detail.height : (wsBitcoin.height != null ? wsBitcoin.height : null);
    const amountSatsNum = Math.round(Number(this.state.amountSats || 0));
    const utxoListRender = Array.isArray(this.state.hubWalletUtxos) ? this.state.hubWalletUtxos : [];
    const spendHints = computeHubWalletSpendHints({
      balanceSats: hubSats != null ? hubSats : 0,
      utxos: utxoListRender,
      mempoolInfo: detail && detail.mempoolInfo,
      network: bitcoinNetwork,
      faucetCapSats: 1000000,
      targetAmountSats: Number.isFinite(amountSatsNum) && amountSatsNum > 0 ? amountSatsNum : null
    });
    const maxAffordableSats =
      hubSats != null && Number.isFinite(hubSats) ? spendHints.maxAffordableSats : null;
    const suggestedFaucetSats =
      maxAffordableSats != null && maxAffordableSats > 0
        ? Math.min(1000000, Math.max(1, maxAffordableSats))
        : null;
    const amountExceedsHub =
      maxAffordableSats != null &&
      Number.isFinite(amountSatsNum) &&
      amountSatsNum > maxAffordableSats;
    const recipientBelowDust =
      Number.isFinite(amountSatsNum) &&
      amountSatsNum > 0 &&
      amountSatsNum < spendHints.minRecipientSats;
    const fragmentationBlocksPay =
      spendHints.hadUtxoList &&
      spendHints.canPayTarget === false &&
      Number.isFinite(amountSatsNum) &&
      amountSatsNum > 0;
    const hubReady = !!(detail && detail.available);
    const faucetAllowed = bitcoinNetwork === 'regtest';

    return (
      <div className="fade-in">
        <Segment loading={this.state.loading}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button as={Link} to="/services/bitcoin" basic size="small">
              <Icon name="arrow left" />
              {L.back}
            </Button>
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="tint" />
              <Header.Content>{L.title}</Header.Content>
            </Header>
          </div>
          <p style={{ color: '#666', marginTop: '0.6em', marginBottom: 0 }}>
            {L.intro}
          </p>
          {!faucetAllowed ? (
            <Message warning style={{ marginTop: '0.85em' }}>
              <Message.Header>{L.notRegtestTitle}</Message.Header>
              <p>{L.notRegtest(bitcoinNetwork)}</p>
            </Message>
          ) : null}
          {faucetAllowed ? (
            <div style={{ marginTop: '0.85em' }}>
              <Button
                primary
                type="button"
                size="large"
                disabled={this.state.loading || this.state.fundMyBusy || this.state.resolvingAddress || !hubReady}
                onClick={() => void this.fundMyWallet()}
              >
                <Icon name="tint" />
                {this.state.fundMyBusy ? L.fundingMine : L.fundMine}
              </Button>
              <p style={{ color: '#666', marginTop: '0.5em', marginBottom: 0, fontSize: '0.95em' }}>
                {L.fundMineHint}
              </p>
            </div>
          ) : null}
          {faucetAllowed ? (
            <Message info size="small" style={{ marginTop: '0.75em' }}>
              <Message.Header>{L.playnetTitle}</Message.Header>
              <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
                {L.playnetPorts}{' '}
                {L.playnetBitcoinBefore} <Link to="/services/bitcoin">{L.playnetBitcoinLink}</Link> {L.playnetBitcoinAfter}{' '}
                {L.playnetPeersBefore} <Link to="/peers">{L.playnetPeersLink}</Link>{L.playnetPeersAfter}
              </p>
              <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
                {L.playnetPublic}{' '}
                <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">{L.playnetPublicLink}</a>.{' '}
                {L.playnetConfirmBefore}{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">{L.playnetConfirmLink}</Link> {L.playnetConfirmAfter}
              </p>
            </Message>
          ) : null}
        </Segment>
        <Segment
          id="fabric-bitcoin-faucet-hub-wallet"
          loading={this.state.hubBitcoinLoading}
          aria-busy={this.state.hubBitcoinLoading ? 'true' : 'false'}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em', marginBottom: '0.75em' }}>
            <Header as="h3" style={{ margin: 0, flex: '1 1 auto' }}>
              {L.walletTitle}
            </Header>
            <Button
              type="button"
              basic
              size="small"
              disabled={this.state.hubBitcoinLoading}
              onClick={() => void this.refreshHubWalletStatus()}
            >
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
          </div>
          {this.state.hubBitcoinError ? (
            <Message negative size="small" style={{ marginTop: 0 }}>
              {L.loadStatusFailed(this.state.hubBitcoinError)}
            </Message>
          ) : null}
          {this.state.hubUtxosError ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.loadCoinsFailed(this.state.hubUtxosError)}
            </Message>
          ) : null}
          {!this.state.hubBitcoinError && !this.state.hubBitcoinLoading && !detail ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.noStatus}
            </Message>
          ) : null}
          {hubReady ? (
            <div style={{ lineHeight: 1.6 }}>
              <div>
                <strong>{L.network}:</strong> {bitcoinNetwork || t.common.none}
                {chainHeight != null ? (
                  <span>
                    {' '}
                    · <strong>{L.height}:</strong> {chainHeight}
                  </span>
                ) : null}
              </div>
              {hubSats != null ? (
                <div style={{ marginTop: '0.35em' }}>
                  <strong>{L.balance}:</strong>{' '}
                  {L.balanceValue(hubBtc != null ? hubBtc.toFixed(8) : '0.00000000', hubSats)}
                  {suggestedFaucetSats != null ? (
                    <span style={{ display: 'block', marginTop: '0.35em', color: '#555', fontSize: '0.95em' }}>
                      {L.maxHint(suggestedFaucetSats)}{' '}
                      {spendHints.hadUtxoList
                        ? L.feeHintCoins(spendHints.satPerVbyte, spendHints.utxoCount, spendHints.feeReserveSats)
                        : L.feeHintNoCoins(spendHints.satPerVbyte, spendHints.feeReserveSats)}
                    </span>
                  ) : hubSats != null && hubSats <= spendHints.feeReserveSats ? (
                    <span style={{ display: 'block', marginTop: '0.35em', color: '#8a6d3b', fontSize: '0.95em' }}>
                      {L.tooLow}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {detail && detail.mempoolTxCount != null && Number(detail.mempoolTxCount) > 0 ? (
                <p style={{ margin: '0.5em 0 0', color: '#666', fontSize: '0.95em' }}>
                  {L.mempool(Number(detail.mempoolTxCount))}
                  {faucetAllowed ? ` ${L.mempoolConfirm}` : ''}
                </p>
              ) : null}
              {faucetAllowed ? (
                <p style={{ margin: '0.5em 0 0', color: '#666', fontSize: '0.95em' }}>
                  {L.emptyBefore}{' '}
                  <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">{L.emptyLink}</Link>
                  {' '}{L.emptyAfter}
                </p>
              ) : null}
            </div>
          ) : null}
          {!hubReady && detail && !this.state.hubBitcoinLoading ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.unavailable(detail.status, detail.message)}
            </Message>
          ) : null}
        </Segment>
        <Segment>
          {this.state.faucetNotice ? (
            <Message info size="small" style={{ marginTop: 0 }}>
              {this.state.faucetNotice}
            </Message>
          ) : null}
          {this.state.faucetLastStatus ? (
            <Message
              size="small"
              positive={!!this.state.faucetLastStatus.ok}
              negative={!this.state.faucetLastStatus.ok}
              style={{ marginTop: this.state.faucetNotice ? '0.5em' : 0 }}
            >
              <p style={{ margin: 0 }}>
                <strong>{L.lastRequest}:</strong>{' '}
                {this.state.faucetLastStatus.ok ? L.lastAccepted : L.lastFailed}
                {this.state.faucetLastStatus.amountSats != null
                  ? ` · ${t.common.sats(this.state.faucetLastStatus.amountSats)}`
                  : ''}
                {this.state.faucetLastStatus.address
                  ? ` · ${this.state.faucetLastStatus.address}`
                  : ''}
              </p>
              {this.state.faucetLastStatus.txid ? (
                <p style={{ margin: '0.35em 0 0', wordBreak: 'break-all' }}>
                  {L.transactionId}: {this.state.faucetLastStatus.txid}
                </p>
              ) : null}
              {this.state.faucetLastStatus.error ? (
                <p style={{ margin: '0.35em 0 0' }}>
                  {L.errorLabel}: {this.state.faucetLastStatus.error}
                </p>
              ) : null}
            </Message>
          ) : null}
          {amountExceedsHub && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.overMax(Number.isFinite(amountSatsNum) ? amountSatsNum : 0, maxAffordableSats)}
            </Message>
          ) : null}
          {recipientBelowDust && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.belowDustWarning(spendHints.minRecipientSats)}
            </Message>
          ) : null}
          {fragmentationBlocksPay && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              {L.fragmented(spendHints.largestUtxoSats)}
            </Message>
          ) : null}
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              void this.requestFaucet();
            }}
          >
            <Form.Field>
              <label htmlFor="faucet-address">{L.addressLabel(bitcoinNetwork)}</label>
              <Input
                id="faucet-address"
                placeholder={L.addressPlaceholder}
                value={this.state.sendTo}
                onChange={(e) => this.setState({ sendTo: e.target.value })}
                action={{
                  type: 'button',
                  content: this.state.resolvingAddress ? L.findingAddress : L.useMyAddress,
                  disabled: this.state.resolvingAddress || this.state.loading,
                  onClick: () => this.useMyAddress()
                }}
              />
            </Form.Field>
            <Form.Field width={4}>
              <label htmlFor="faucet-amount">{L.amountLabel}</label>
              <Input
                id="faucet-amount"
                type="number"
                min="1"
                step="1"
                value={this.state.amountSats}
                onChange={(e) => this.setState({ amountSats: e.target.value })}
                action={
                  suggestedFaucetSats != null
                    ? {
                        type: 'button',
                        content: L.useMax(suggestedFaucetSats),
                        disabled: this.state.loading || this.state.resolvingAddress,
                        onClick: () =>
                          this.setState({
                            amountSats: String(suggestedFaucetSats),
                            faucetResult: null,
                            faucetNotice: ''
                          })
                      }
                    : undefined
                }
              />
            </Form.Field>
            <Button
              primary
              type="button"
              disabled={this.state.loading || this.state.resolvingAddress}
              onClick={() => this.requestFaucet()}
            >
              <Icon name="tint" />
              {L.request}
            </Button>
          </Form>
          {this.state.faucetResult && this.state.faucetResult.error ? (
            <Message negative style={{ marginTop: '1em' }}>
              {this.state.faucetResult.error}
            </Message>
          ) : null}
          {this.state.faucetResult && !this.state.faucetResult.error ? (
            <details className="hub-developer-details" style={{ marginTop: '1em' }}>
              <summary>{t.common.developerDetails}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(this.state.faucetResult, null, 2)}</pre>
            </details>
          ) : null}
        </Segment>
      </div>
    );
  }
}

module.exports = FaucetHome;
