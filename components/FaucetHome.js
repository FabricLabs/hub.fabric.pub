'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Form, Header, Icon, Input, Message, Segment } = require('semantic-ui-react');
const {
  fetchReceiveAddress,
  getNextReceiveWalletContext,
  loadUpstreamSettings,
  requestFaucet
} = require('../functions/bitcoinClient');

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
      faucetLastStatus: null
    };
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
    this.setState({
      loading: true,
      faucetResult: null,
      faucetNotice: `Submitting faucet request for ${amountSats} sats...`
    });
    try {
      const result = await requestFaucet(this.state.upstream, { address, amountSats });
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
    const bitcoinNetwork = (this.props && this.props.bitcoin && this.props.bitcoin.network)
      ? String(this.props.bitcoin.network).toLowerCase()
      : 'regtest';
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
