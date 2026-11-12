'use strict';

/**
 * Shows a Fabric message for review: a `fabric:` link opened in the desktop
 * app (`fabricDesktop.onMessagePrompt`), or a sign request from an execution
 * contract run (`fabric:messagePrompt` window event). Nothing here signs;
 * signing a contract request needs a full key unlocked in this browser.
 */

const React = require('react');
const { Modal, Button, Header, Icon, Message } = require('semantic-ui-react');
const { DEFAULT_SIGN_PROMPT } = require('../functions/fabricMessageEnvelope');
const { fabricMessageSummaryFromHex } = require('../functions/fabricProtocolUrl');
const t = require('../locales/en');

const copy = t.identity.messagePrompt;

/** Window event a page dispatches with `{ wireHex, source }` to show a message. */
const MESSAGE_PROMPT_EVENT = 'fabric:messagePrompt';

class FabricMessagePrompt extends React.Component {
  constructor (props) {
    super(props);
    this.state = { prompt: null };
    this._seen = new Set();
    this._unsubscribe = null;
    this._onEvent = this._onEvent.bind(this);
  }

  componentDidMount () {
    if (typeof window === 'undefined') return;
    window.addEventListener(MESSAGE_PROMPT_EVENT, this._onEvent);
    const desktop = window.fabricDesktop;
    if (desktop && desktop.isDesktopShell) {
      if (typeof desktop.pullPendingMessagePrompt === 'function') {
        Promise.resolve(desktop.pullPendingMessagePrompt()).then((p) => this._show(p)).catch(() => {});
      }
      if (typeof desktop.onMessagePrompt === 'function') {
        this._unsubscribe = desktop.onMessagePrompt((p) => this._show(p));
      }
    }
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') window.removeEventListener(MESSAGE_PROMPT_EVENT, this._onEvent);
    if (typeof this._unsubscribe === 'function') this._unsubscribe();
  }

  _onEvent (ev) {
    const d = ev && ev.detail;
    if (!d || typeof d.wireHex !== 'string') return;
    const fm = fabricMessageSummaryFromHex(d.wireHex);
    if (!fm.ok) return;
    this._show({
      kind: 'fabricMessage',
      fabricMessageHex: fm.hex,
      fabricMessageSummary: fm.summary,
      source: d.source || null
    });
  }

  _show (payload) {
    if (!payload || payload.kind !== 'fabricMessage' || typeof payload.fabricMessageHex !== 'string') return;
    const key = payload.fabricMessageHex.slice(0, 64);
    if (this._seen.has(key)) return;
    this._seen.add(key);
    this.setState({ prompt: payload });
  }

  render () {
    const { prompt } = this.state;
    if (!prompt) return null;
    const fs = prompt.fabricMessageSummary || {};
    const fromContract = prompt.source === 'RunExecutionContract';
    const promptLine = (fs.envelopeMeta && fs.envelopeMeta.prompt) || DEFAULT_SIGN_PROMPT;
    const close = () => this.setState({ prompt: null });
    return (
      <Modal size="small" open onClose={close} data-testid="fabric-message-prompt">
        <Header icon>
          <Icon name="envelope open outline" />
          {copy.title}
        </Header>
        <Modal.Content>
          {fromContract ? (
            <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>{copy.fromContract}</p>
          ) : null}
          <p style={{ marginBottom: '0.65em', fontSize: '1.02em' }}>{promptLine}</p>
          <p style={{ marginBottom: '0.35em' }}><strong>{copy.contentsHeading}</strong></p>
          {fs.envelopeMeta && fs.envelopeMeta.signersCount > 0 ? (
            <p style={{ fontSize: '0.88em', color: '#555' }}>{copy.signers(fs.envelopeMeta.signersCount)}</p>
          ) : null}
          <p style={{ fontSize: '0.92em', color: '#444' }}>
            {copy.type} <code>{fs.typeName || 'unknown'}</code>
            {fs.byteLength ? ` · ${copy.bytes(fs.byteLength)}` : ''}
          </p>
          {fs.verified && fs.signed === false ? (
            <p style={{ fontSize: '0.85em', color: '#a5673f' }}>{copy.unsigned}</p>
          ) : null}
          {fs.verified && fs.signed && fs.author ? (
            <p style={{ fontSize: '0.85em', color: '#666', wordBreak: 'break-all' }}>
              {copy.signedBy} <code>{fs.author}</code>
            </p>
          ) : fs.authorHex ? (
            <p style={{ fontSize: '0.85em', color: '#666', wordBreak: 'break-all' }}>
              {copy.author} <code>{fs.authorHex.length > 48 ? `${fs.authorHex.slice(0, 48)}…` : fs.authorHex}</code>
            </p>
          ) : null}
          <pre
            style={{
              maxHeight: '28vh',
              overflow: 'auto',
              fontSize: '0.82em',
              padding: '0.65em',
              background: '#f4f4f4',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {fs.bodyPreview || copy.noBody}
          </pre>
          {fromContract ? (
            <Message info size="small">{copy.needsKey}</Message>
          ) : (
            <p style={{ color: '#666', fontSize: '0.95em' }}>{copy.viewOnly}</p>
          )}
          <details className="hub-developer-details">
            <summary>{t.common.developerDetails}</summary>
            <p style={{ color: '#666', fontSize: '0.9em', margin: '0.35em 0 0' }}>{copy.developer}</p>
          </details>
        </Modal.Content>
        <Modal.Actions>
          <Button onClick={close}>{t.common.actions.close}</Button>
        </Modal.Actions>
      </Modal>
    );
  }
}

FabricMessagePrompt.MESSAGE_PROMPT_EVENT = MESSAGE_PROMPT_EVENT;

module.exports = FabricMessagePrompt;
