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
  requestFaucet
} = require('../functions/bitcoinClient');
const { computeHubWalletSpendHints } = require('../functions/bitcoinSpendBounds');

function hubWalletSatsFromDetail (detail) {
  if (!detail || typeof detail !== 'object' || !detail.available) return null;
  if (detail.balanceSats != null && Number.isFinite(Number(detail.balanceSats))) {
    return Math.round(Number(detail.balanceSats));
  }
  const b = Number(detail.balance != null ? detail.balance : NaN);
  if (Number.isFinite(b)) return Math.round(b * 1e8);
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
      hubUtxosError: null
    };
  }

  componentDidMount () {
    void this.refreshHubWalletStatus();
  }

  async refreshHubWalletStatus () {
    const upstream = loadUpstreamSettings();
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
        faucetResult: { error: 'Still resolving your receive address. Please wait a moment and try again.' },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address: '',
          amountSats: null,
          txid: '',
          error: 'Still resolving your receive address. Please wait a moment and try again.'
        }
      });
      return;
    }
    if (!address) {
      this.setState({
        faucetResult: { error: 'Recipient address is required.' },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address: '',
          amountSats: null,
          txid: '',
          error: 'Recipient address is required.'
        }
      });
      return;
    }
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      this.setState({
        faucetResult: { error: 'Amount (sats) must be greater than zero.' },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: 'Amount (sats) must be greater than zero.'
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
          error: `Amount is below the typical dust floor (${hintsPre.minRecipientSats} sats). Use at least that many sats so the output is relayable.`
        },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: `Below dust floor (${hintsPre.minRecipientSats} sats).`
        }
      });
      return;
    }
    if (hintsPre.canPayTarget === false) {
      this.setState({
        faucetResult: {
          error: 'This amount plus fees cannot be covered by the hub UTXO set (fragmentation or fee market). Try a smaller amount, Use max affordable, or consolidate the hub wallet on the node.'
        },
        faucetNotice: '',
        faucetLastStatus: {
          ok: false,
          when: Date.now(),
          address,
          amountSats,
          txid: '',
          error: 'UTXO / fee simulation: cannot pay this amount.'
        }
      });
      return;
    }
    this.setState({
      loading: true,
      faucetResult: null,
      faucetNotice: `Submitting faucet request for ${amountSats} sats...`
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
      const txidText = faucetResult && faucetResult.txid ? ` Txid: ${String(faucetResult.txid)}.` : '';
      this.setState({
        loading: false,
        faucetResult,
        faucetNotice: faucetResult && faucetResult.error
          ? ''
          : `Faucet request accepted.${txidText}`,
        faucetLastStatus: {
          ok: !faucetResult.error,
          when: Date.now(),
          address,
          amountSats,
          txid: faucetResult && faucetResult.txid ? String(faucetResult.txid) : '',
          error: faucetResult && faucetResult.error ? String(faucetResult.error) : ''
        }
      }, () => {
        if (!faucetResult.error) void this.refreshHubWalletStatus();
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
    const hubBtc = hubSats != null ? hubSats / 1e8 : null;
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
              Bitcoin
            </Button>
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="tint" />
              <Header.Content>Faucet</Header.Content>
            </Header>
          </div>
          <p style={{ color: '#666', marginTop: '0.6em', marginBottom: 0 }}>
            Regtest faucet requests funds from the Hub wallet. Use your wallet receive address so balance updates in this browser.
          </p>
          {faucetAllowed ? (
            <Message info size="small" style={{ marginTop: '0.75em' }}>
              <Message.Header>Playnet past subsidy — use the network</Message.Header>
              <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
                <strong>Bitcoin P2P</strong> (regtest <code>:18444</code>) and <strong>Fabric TCP</strong> (<code>:7777</code>) are different layers.
                Under <Link to="/services/bitcoin">Bitcoin</Link> → <strong>Network</strong>, wait for outbound P2P connections to your configured{' '}
                <code>addnode</code> targets so you share the same chain as other playnet nodes.
                Under <Link to="/peers">Peers</Link>, use <strong>Add primary hub</strong> (<code>hub.fabric.pub:7777</code>) for block gossip and discovery.
                If <strong>this</strong> hub&apos;s wallet cannot fund you, open the public regtest faucet in another tab —{' '}
                <a href="https://hub.fabric.pub/services/bitcoin/faucet" target="_blank" rel="noopener noreferrer">hub.fabric.pub/services/bitcoin/faucet</a>
                {' — '}paste the same receive address as <strong>Use my address</strong> here, then use <strong>Generate block</strong> on{' '}
                <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">your Bitcoin</Link> dashboard so the payment confirms.
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
              Hub wallet (faucet source)
            </Header>
            <Button
              type="button"
              basic
              size="small"
              disabled={this.state.hubBitcoinLoading}
              onClick={() => void this.refreshHubWalletStatus()}
            >
              <Icon name="refresh" />
              Refresh
            </Button>
          </div>
          {this.state.hubBitcoinError ? (
            <Message negative size="small" style={{ marginTop: 0 }}>
              Could not load hub Bitcoin status: {this.state.hubBitcoinError}
            </Message>
          ) : null}
          {this.state.hubUtxosError ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              Could not load hub UTXO list (limits fragmentation checks): {this.state.hubUtxosError}
            </Message>
          ) : null}
          {!this.state.hubBitcoinError && !this.state.hubBitcoinLoading && !detail ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              No status loaded yet. Choose Refresh.
            </Message>
          ) : null}
          {hubReady ? (
            <div style={{ lineHeight: 1.6 }}>
              <div>
                <strong>Network:</strong> {bitcoinNetwork || '—'}
                {chainHeight != null ? (
                  <span>
                    {' '}
                    · <strong>Height:</strong> {chainHeight}
                  </span>
                ) : null}
              </div>
              {hubSats != null ? (
                <div style={{ marginTop: '0.35em' }}>
                  <strong>Trusted balance (hub bitcoind):</strong>{' '}
                  {hubBtc != null ? hubBtc.toFixed(8) : '0.00000000'} BTC ({hubSats.toLocaleString()} sats)
                  {suggestedFaucetSats != null ? (
                    <span style={{ display: 'block', marginTop: '0.35em', color: '#555', fontSize: '0.95em' }}>
                      On shared regtest / playnet, the hub wallet may be low if other nodes mined; pull at most{' '}
                      <strong>{suggestedFaucetSats.toLocaleString()} sats</strong>
                      {spendHints.hadUtxoList ? (
                        <>
                          {' '}
                          (~{spendHints.satPerVbyte} sat/vB, {spendHints.utxoCount} UTXO
                          {spendHints.utxoCount === 1 ? '' : 's'}, fee reserve ~{spendHints.feeReserveSats.toLocaleString()}{' '}
                          sats).
                        </>
                      ) : (
                        <>
                          {' '}
                          (~{spendHints.satPerVbyte} sat/vB, fee reserve ~{spendHints.feeReserveSats.toLocaleString()} sats;
                          refresh after UTXO list loads for tighter bounds).
                        </>
                      )}
                    </span>
                  ) : hubSats != null && hubSats <= spendHints.feeReserveSats ? (
                    <span style={{ display: 'block', marginTop: '0.35em', color: '#8a6d3b', fontSize: '0.95em' }}>
                      Balance is too low for a safe faucet send after fees — publish or trade on the network instead of
                      draining this hub.
                    </span>
                  ) : null}
                </div>
              ) : null}
              {detail && detail.mempoolTxCount != null && Number(detail.mempoolTxCount) > 0 ? (
                <p style={{ margin: '0.5em 0 0', color: '#666', fontSize: '0.95em' }}>
                  Mempool: {detail.mempoolTxCount} tx
                  {faucetAllowed
                    ? ' — unconfirmed sends (including faucet) confirm after you mine a block.'
                    : ''}
                </p>
              ) : null}
              {faucetAllowed ? (
                <p style={{ margin: '0.5em 0 0', color: '#666', fontSize: '0.95em' }}>
                  If the hub wallet is empty, open{' '}
                  <Link to="/services/bitcoin#fabric-bitcoin-regtest-toolbar">Bitcoin → Regtest toolbar</Link>
                  {' '}and use <strong>Generate block</strong> (admin) so coinbase pays into the hub wallet, then return here.
                </p>
              ) : (
                <Message warning size="small" style={{ marginTop: '0.75em' }}>
                  Faucet is only available on <strong>regtest</strong>. This hub reports <strong>{bitcoinNetwork || 'unknown'}</strong>.
                </Message>
              )}
            </div>
          ) : null}
          {!hubReady && detail && !this.state.hubBitcoinLoading ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              Bitcoin service is not available on this hub
              {detail.status ? ` (${detail.status})` : ''}.
              {detail.message ? ` ${detail.message}` : ''}
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
                <strong>Last faucet request:</strong>{' '}
                {this.state.faucetLastStatus.ok ? 'accepted' : 'failed'}
                {this.state.faucetLastStatus.amountSats != null
                  ? ` · ${this.state.faucetLastStatus.amountSats} sats`
                  : ''}
                {this.state.faucetLastStatus.address
                  ? ` · ${this.state.faucetLastStatus.address}`
                  : ''}
              </p>
              {this.state.faucetLastStatus.txid ? (
                <p style={{ margin: '0.35em 0 0', wordBreak: 'break-all' }}>
                  Txid: {this.state.faucetLastStatus.txid}
                </p>
              ) : null}
              {this.state.faucetLastStatus.error ? (
                <p style={{ margin: '0.35em 0 0' }}>
                  Error: {this.state.faucetLastStatus.error}
                </p>
              ) : null}
            </Message>
          ) : null}
          {amountExceedsHub && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              Request ({Number.isFinite(amountSatsNum) ? amountSatsNum.toLocaleString() : '—'} sats) is above what this hub
              can afford after fees and dust reserve ({maxAffordableSats.toLocaleString()} sats max). Lower the amount or use{' '}
              <strong>Use max affordable</strong>.
            </Message>
          ) : null}
          {recipientBelowDust && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              Amount is below the relay dust floor ({spendHints.minRecipientSats} sats). Enter at least that many sats.
            </Message>
          ) : null}
          {fragmentationBlocksPay && faucetAllowed ? (
            <Message warning size="small" style={{ marginTop: 0 }}>
              With the current UTXO set and fee rate, this amount is unlikely to build without merging inputs (largest coin{' '}
              {spendHints.largestUtxoSats.toLocaleString()} sats). Use a smaller amount or consolidate on the node.
            </Message>
          ) : null}
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              void this.requestFaucet();
            }}
          >
            <Form.Field>
              <label>Send to address ({bitcoinNetwork || 'any'})</label>
              <Input
                placeholder="bcrt1... or m/44'/0'/0'/0/0"
                value={this.state.sendTo}
                onChange={(e) => this.setState({ sendTo: e.target.value })}
                action={{
                  content: this.state.resolvingAddress ? 'Loading…' : 'Use my address',
                  disabled: this.state.resolvingAddress || this.state.loading,
                  onClick: () => this.useMyAddress()
                }}
              />
            </Form.Field>
            <Form.Field width={4}>
              <label>Amount (sats)</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={this.state.amountSats}
                onChange={(e) => this.setState({ amountSats: e.target.value })}
                action={
                  suggestedFaucetSats != null
                    ? {
                        content: `Use max affordable (${suggestedFaucetSats.toLocaleString()})`,
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
              Request from faucet
            </Button>
          </Form>
          {this.state.faucetResult ? (
            <Message negative={!!this.state.faucetResult.error} positive={!this.state.faucetResult.error} style={{ marginTop: '1em' }}>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(this.state.faucetResult, null, 2)}</pre>
            </Message>
          ) : null}
        </Segment>
      </div>
    );
  }
}

module.exports = FaucetHome;
