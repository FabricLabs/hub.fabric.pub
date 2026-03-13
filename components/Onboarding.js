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
  Select
} = require('semantic-ui-react');

const BITCOIN_NETWORKS = [
  { key: 'regtest', value: 'regtest', text: 'Regtest (local dev)' },
  { key: 'signet', value: 'signet', text: 'Signet' },
  { key: 'testnet', value: 'testnet', text: 'Testnet' },
  { key: 'mainnet', value: 'mainnet', text: 'Mainnet' }
];

class Onboarding extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      open: true,
      nodeName: props.nodeName || 'Hub',
      bitcoinNetwork: props.bitcoinNetwork || 'regtest',
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
          BITCOIN_NETWORK: this.state.bitcoinNetwork
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
      this.setState({
        saving: false,
        error: err && err.message ? err.message : 'Setup failed'
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
                and sets initial parameters. The admin token authenticates
                privileged operations.
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
                  onChange={(e, { value }) => this.setState({ bitcoinNetwork: value })}
                />
              </Form.Field>
              {this.state.bitcoinNetwork === 'regtest' && (
                <Message info size='small'>
                  Regtest runs managed bitcoind and Lightning (lightningd) automatically.
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
