'use strict';

/**
 * First-time setup flow for Hub.
 * Creates and signs an admin token, sets initial configuration.
 * Adapted from sensemaker's Onboarding component.
 */

const React = require('react');
const {
  Modal,
  Button,
  Header,
  Icon,
  Form,
  Input,
  Message,
  Segment,
  Select,
  Checkbox
} = require('semantic-ui-react');

const BITCOIN_NETWORKS = [
  { key: 'regtest', value: 'regtest', text: 'Regtest (local dev)', rpcPort: 18443 },
  { key: 'signet', value: 'signet', text: 'Signet (stable testing)', rpcPort: 38332 },
  { key: 'testnet', value: 'testnet', text: 'Testnet (public testing)', rpcPort: 18332 },
  { key: 'mainnet', value: 'mainnet', text: 'Mainnet (production)', rpcPort: 8332 }
];

class Onboarding extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      open: true,
      nodeName: props.nodeName || 'Hub',
      bitcoinNetwork: props.bitcoinNetwork || 'regtest',
      bitcoinManaged: props.bitcoinManaged !== false,
      bitcoinHost: props.bitcoinHost || '127.0.0.1',
      bitcoinRpcPort: props.bitcoinRpcPort || String(BITCOIN_NETWORKS.find((n) => n.value === (props.bitcoinNetwork || 'regtest'))?.rpcPort ?? 18443),
      bitcoinUsername: props.bitcoinUsername || '',
      bitcoinPassword: props.bitcoinPassword || '',
      lightningManaged: props.lightningManaged !== false,
      lightningSocket: props.lightningSocket || '',
      diskAllocationMb: props.diskAllocationMb || '1024',
      costPerByteSats: (props.costPerByteSats != null && String(props.costPerByteSats).trim() !== '') ? String(props.costPerByteSats) : '0.01',
      saving: false,
      error: null
    };
  }

  getBaseUrl () {
    if (typeof window !== 'undefined' && window.location) {
      const protocol = window.location.protocol || 'http:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port || (protocol === 'https:' ? '443' : '80');
      return `${protocol}//${host}${port === '80' || port === '443' ? '' : ':' + port}`;
    }
    return 'http://localhost:8080';
  }

  handleComplete = async () => {
    this.setState({ saving: true, error: null });
    try {
      const baseUrl = this.getBaseUrl();
      const response = await fetch(`${baseUrl}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          NODE_NAME: this.state.nodeName.trim() || 'Hub',
          NODE_PERSONALITY: JSON.stringify(['helpful']),
          NODE_TEMPERATURE: 0,
          NODE_GOALS: JSON.stringify([]),
          BITCOIN_NETWORK: this.state.bitcoinNetwork,
          BITCOIN_MANAGED: this.state.bitcoinManaged,
          DISK_ALLOCATION_MB: Math.max(1, parseInt(this.state.diskAllocationMb, 10) || 1024),
          COST_PER_BYTE_SATS: this.state.costPerByteSats.trim()
            ? Math.max(0, parseFloat(this.state.costPerByteSats) || 0)
            : 0.01,
          ...(this.state.bitcoinManaged ? {} : {
            BITCOIN_HOST: this.state.bitcoinHost,
            BITCOIN_RPC_PORT: this.state.bitcoinRpcPort,
            BITCOIN_USERNAME: this.state.bitcoinUsername,
            BITCOIN_PASSWORD: this.state.bitcoinPassword
          }),
          LIGHTNING_MANAGED: this.state.lightningManaged,
          ...(this.state.lightningManaged ? {} : {
            LIGHTNING_SOCKET: this.state.lightningSocket
          })
        })
      });

      const text = await response.text();
      if (!response.ok) {
        let errBody = {};
        if (!text.trim().startsWith('<')) {
          try { errBody = JSON.parse(text); } catch (_) {}
        }
        throw new Error(errBody.message || errBody.error || `Setup failed: ${response.status}`);
      }

      if (text.trim().startsWith('<')) {
        throw new Error('Server returned HTML instead of JSON. Ensure the Hub is running (npm start) and the proxy target is correct.');
      }
      const result = JSON.parse(text);
      if (this.props.onConfigurationComplete) {
        this.props.onConfigurationComplete({
          token: result.token,
          configured: result.configured,
          expiresAt: result.expiresAt
        });
      }
      this.setState({ open: false, saving: false });
    } catch (err) {
      let message = err && err.message ? err.message : 'Setup failed';
      if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('NetworkError')) {
        message = 'Cannot reach the Hub. Ensure the server is running (npm start) and try again.';
      }
      this.setState({
        saving: false,
        error: message
      });
    }
  };

  render () {
    const { open, nodeName, saving, error } = this.state;

    return (
      <Modal
        open={open}
        onClose={() => {}}
        size="small"
        closeIcon={false}
      >
        <Modal.Header>
          <Icon name="settings" />
          First-Time Setup
        </Modal.Header>
        <Modal.Content>
          <Segment basic>
            <Message info>
              <Message.Header>Welcome to Hub</Message.Header>
              <p>
                Configure your node to get started. This creates an admin token
                (stored in your browser only) and sets initial parameters. The
                admin token authenticates privileged operations like block
                generation on regtest.
              </p>
            </Message>
            <Form>
              <Form.Field>
                <label>Node name</label>
                <Input
                  placeholder="e.g. Hub, My Node"
                  value={nodeName}
                  onChange={(e) => this.setState({ nodeName: e.target.value })}
                />
              </Form.Field>
              <Form.Field>
                <label>Bitcoin network</label>
                <Select
                  options={BITCOIN_NETWORKS}
                  value={this.state.bitcoinNetwork}
                  onChange={(e, { value }) => {
                    const net = BITCOIN_NETWORKS.find((n) => n.value === value);
                    this.setState({
                      bitcoinNetwork: value,
                      bitcoinRpcPort: net && net.rpcPort ? String(net.rpcPort) : this.state.bitcoinRpcPort
                    });
                  }}
                />
              </Form.Field>
              <Form.Field>
                <Checkbox
                  label="Launch managed Bitcoin node (bitcoind)"
                  checked={this.state.bitcoinManaged}
                  onChange={(e, { checked }) => this.setState({ bitcoinManaged: !!checked })}
                />
              </Form.Field>
              {!this.state.bitcoinManaged && (
                <Segment basic style={{ marginLeft: '1.5em', paddingTop: 0 }}>
                  <Form.Field>
                    <label>Bitcoin RPC host</label>
                    <Input
                      placeholder="127.0.0.1"
                      value={this.state.bitcoinHost}
                      onChange={(e) => this.setState({ bitcoinHost: e.target.value })}
                    />
                  </Form.Field>
                  <Form.Field>
                    <label>Bitcoin RPC port</label>
                    <Input
                      placeholder={BITCOIN_NETWORKS.find((n) => n.value === this.state.bitcoinNetwork)?.rpcPort ?? 8332}
                      type="number"
                      value={this.state.bitcoinRpcPort}
                      onChange={(e) => this.setState({ bitcoinRpcPort: e.target.value })}
                    />
                    <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                      Default: regtest 18443, signet 38332, testnet 18332, mainnet 8332
                    </small>
                  </Form.Field>
                  <Form.Field>
                    <label>Bitcoin RPC username</label>
                    <Input
                      placeholder="rpcuser"
                      value={this.state.bitcoinUsername}
                      onChange={(e) => this.setState({ bitcoinUsername: e.target.value })}
                    />
                  </Form.Field>
                  <Form.Field>
                    <label>Bitcoin RPC password</label>
                    <Input
                      type="password"
                      placeholder="rpcpassword"
                      value={this.state.bitcoinPassword}
                      onChange={(e) => this.setState({ bitcoinPassword: e.target.value })}
                    />
                  </Form.Field>
                </Segment>
              )}
              <Form.Field>
                <label>Disk space allocation (MB)</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1024"
                  value={this.state.diskAllocationMb}
                  onChange={(e) => this.setState({ diskAllocationMb: e.target.value })}
                />
                <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                  Maximum storage for documents (used for HTLC purchase limits).
                </small>
              </Form.Field>
              <Form.Field>
                <label>Cost per byte (sats)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  placeholder="0.01"
                  value={this.state.costPerByteSats}
                  onChange={(e) => this.setState({ costPerByteSats: e.target.value })}
                />
                <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                  Per-byte floor for document serving (HTLC purchase price). 0.01 ≈ 10k sats/MB. ~0.000001 sat/byte ≈ 1 sat/MB; typical cloud egress ~$0.05/GB. Leave empty for no floor.
                </small>
              </Form.Field>
              <Form.Field>
                <Checkbox
                  label="Launch managed Lightning node (lightningd)"
                  checked={this.state.lightningManaged}
                  onChange={(e, { checked }) => this.setState({ lightningManaged: !!checked })}
                />
                <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                  Optional. Requires managed Bitcoin. Run with FABRIC_CLEAN_ALICE=1 if you see socket errors after a prior run.
                </small>
              </Form.Field>
              {!this.state.lightningManaged && (
                <Segment basic style={{ marginLeft: '1.5em', paddingTop: 0 }}>
                  <Form.Field>
                    <label>Lightning RPC socket path</label>
                    <Input
                      placeholder="/path/to/lightningd.sock"
                      value={this.state.lightningSocket}
                      onChange={(e) => this.setState({ lightningSocket: e.target.value })}
                    />
                    <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                      Full path to lightningd RPC socket (e.g. ~/.lightning/regtest/lightningd.sock)
                    </small>
                  </Form.Field>
                </Segment>
              )}
              {this.state.bitcoinNetwork === 'regtest' && this.state.bitcoinManaged && (
                <Message info size='small'>
                  Regtest runs managed bitcoind automatically. Lightning (lightningd) is optional and requires bitcoind.
                </Message>
              )}
              {(this.state.bitcoinNetwork === 'signet' || this.state.bitcoinNetwork === 'testnet') && this.state.bitcoinManaged && (
                <Message info size='small'>
                  Managed signet/testnet runs bitcoind locally. Signet has predictable ~1 min blocks; testnet uses PoW and can be unstable.
                </Message>
              )}
            </Form>
            {error && (
              <Message negative>
                <Message.Header>Error</Message.Header>
                <p>{error}</p>
              </Message>
            )}
          </Segment>
        </Modal.Content>
        <Modal.Actions>
          <Button
            primary
            loading={saving}
            disabled={saving}
            onClick={this.handleComplete}
          >
            <Icon name="check" />
            Complete Setup
          </Button>
        </Modal.Actions>
      </Modal>
    );
  }
}

module.exports = Onboarding;
