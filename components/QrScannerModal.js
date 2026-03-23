'use strict';

const React = require('react');
const { Modal, Button, Icon, Message } = require('semantic-ui-react');

const Html5Qrcode = require('html5-qrcode').Html5Qrcode;

class QrScannerModal extends React.Component {
  constructor (props) {
    super(props);
    this.state = { error: null, started: false };
    this._scanner = null;
    this._scannerId = 'qr-scanner-' + Math.random().toString(36).slice(2);
  }

  async componentDidMount () {
    if (this.props.open) await this._startScanner();
  }

  async componentDidUpdate (prevProps) {
    if (this.props.open && !prevProps.open) {
      await this._startScanner();
    } else if (!this.props.open && prevProps.open) {
      await this._stopScanner();
    }
  }

  componentWillUnmount () {
    this._stopScanner();
  }

  async _startScanner () {
    if (this._scanner) return;
    this._scanned = false;
    try {
      this._scanner = new Html5Qrcode(this._scannerId);
      await this._scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (this._scanned) return;
          this._scanned = true;
          if (this.props.onScan) this.props.onScan(decodedText);
        }
      );
      this.setState({ error: null, started: true });
    } catch (err) {
      this.setState({ error: err && err.message ? err.message : 'Camera access failed.' });
    }
  }

  async _stopScanner () {
    if (!this._scanner) return;
    try {
      if (this._scanner.isScanning) await this._scanner.stop();
    } catch (e) {}
    this._scanner.clear();
    this._scanner = null;
    this.setState({ started: false });
  }

  render () {
    const { open, onClose, onScan } = this.props;
    return (
      <Modal open={!!open} onClose={onClose} size="small">
        <Modal.Header>
          <Icon name="camera" />
          Scan QR Code
        </Modal.Header>
        <Modal.Content>
          <div id={this._scannerId} style={{ width: '100%', minHeight: '250px' }} />
          {this.state.error && (
            <Message negative size="small" style={{ marginTop: '0.75em' }}>
              {this.state.error}
            </Message>
          )}
          <p style={{ color: '#666', fontSize: '0.9em', marginTop: '0.5em' }}>
            Point your camera at a Bitcoin address or Lightning invoice QR code.
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button basic onClick={onClose}>Cancel</Button>
        </Modal.Actions>
      </Modal>
    );
  }
}

module.exports = QrScannerModal;
