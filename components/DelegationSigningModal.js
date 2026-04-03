'use strict';

/**
 * Shared signing queue for delegated Hub signatures + Electron fabric://login approval.
 * — Web: pending rows come from global state (Bridge) + localStorage delegation token.
 * — Electron: polls GET /sessions (loopback); fabric://login uses IPC + pullPendingLoginPrompt.
 */

const React = require('react');
const { Modal, Button, Header, Icon } = require('semantic-ui-react');
const { toast } = require('../functions/toast');
const { isDelegationSignatureRequestActivity } = require('../functions/messageTypes');
const { DEFAULT_SIGN_PROMPT } = require('../functions/fabricMessageEnvelope');
const { fabricMessageSummaryFromHex } = require('../functions/fabricProtocolUrl');
const { DELEGATION_STORAGE_KEY } = require('../functions/fabricDelegationLocal');
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const { readStorageJSON } = require('../functions/fabricBrowserState');

class DelegationSigningModal extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      current: null,
      busy: false,
      loginPrompt: null,
      loginBusy: false
    };
    this._openIds = new Set();
    this._seenLoginSessionIds = new Set();
    this._loginUnsub = null;
    this._pollTimer = null;
    this._onGlobal = this._onGlobal.bind(this);
    this._onDelegationSignRequest = this._onDelegationSignRequest.bind(this);
  }

  componentDidMount () {
    if (typeof window === 'undefined') return;
    window.addEventListener('globalStateUpdate', this._onGlobal);
    window.addEventListener('fabric:delegationSignRequest', this._onDelegationSignRequest);
    const br = this.props.bridgeRef && this.props.bridgeRef.current;
    if (br && typeof br.getGlobalState === 'function') {
      const gs = br.getGlobalState();
      if (gs && gs.messages) this._ingestMessages(gs.messages);
    }
    if (window.fabricDesktop && window.fabricDesktop.isDesktopShell) {
      this._pollTimer = setInterval(() => void this._pollLoopbackSessions(), 2000);
      void this._pollLoopbackSessions();
      void this._pullPendingLoginPrompt();
      if (typeof window.fabricDesktop.onLoginPrompt === 'function') {
        this._loginUnsub = window.fabricDesktop.onLoginPrompt((payload) => {
          this._maybeSetLoginPrompt(payload);
        });
      }
    }
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('globalStateUpdate', this._onGlobal);
      window.removeEventListener('fabric:delegationSignRequest', this._onDelegationSignRequest);
    }
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (typeof this._loginUnsub === 'function') this._loginUnsub();
  }

  _onDelegationSignRequest (ev) {
    const d = ev && ev.detail;
    if (!d || typeof d.wireHex !== 'string') return;
    const fm = fabricMessageSummaryFromHex(d.wireHex);
    if (!fm.ok) return;
    this._maybeSetLoginPrompt({
      kind: 'fabricMessage',
      sessionId: null,
      hubBase: typeof window !== 'undefined' ? window.location.origin : '',
      fabricMessageHex: fm.hex,
      fabricMessageSummary: fm.summary,
      fabricMessageOnly: true,
      delegationSource: d.source || 'event'
    });
  }

  async _pullPendingLoginPrompt () {
    const pull = window.fabricDesktop && typeof window.fabricDesktop.pullPendingLoginPrompt === 'function'
      ? window.fabricDesktop.pullPendingLoginPrompt
      : null;
    if (!pull) return;
    try {
      const payload = await pull();
      this._maybeSetLoginPrompt(payload);
    } catch (_) {}
  }

  _maybeSetLoginPrompt (payload) {
    if (!payload) return;
    if (payload.fabricMessageOnly && payload.fabricMessageHex) {
      const sid = `msg:${String(payload.fabricMessageHex).slice(0, 48)}`;
      if (this._seenLoginSessionIds.has(sid)) return;
      this._seenLoginSessionIds.add(sid);
      this.setState((s) => {
        if (s.loginPrompt && s.loginPrompt.fabricMessageHex === payload.fabricMessageHex) return null;
        return { loginPrompt: payload };
      });
      return;
    }
    if (!payload.sessionId) return;
    const sid = String(payload.sessionId);
    if (this._seenLoginSessionIds.has(sid)) return;
    this._seenLoginSessionIds.add(sid);
    this.setState((s) => {
      if (s.loginPrompt && String(s.loginPrompt.sessionId) === sid) return null;
      return { loginPrompt: payload };
    });
  }

  async _completeLogin (approve) {
    const { loginPrompt } = this.state;
    if (!loginPrompt) return;
    if (loginPrompt.fabricMessageOnly) {
      this.setState({ loginPrompt: null });
      return;
    }
    if (!loginPrompt.sessionId) return;
    if (!approve) {
      this.setState({ loginPrompt: null });
      return;
    }
    const hubBase = String(loginPrompt.hubBase || window.location.origin).replace(/\/$/, '');
    const sessionId = encodeURIComponent(String(loginPrompt.sessionId).trim());
    this.setState({ loginBusy: true });
    try {
      const res = await fetch(`${hubBase}/sessions/${sessionId}/signatures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error('Could not complete browser login.');
        console.error('[DESKTOP:UI] sessions/.../signatures failed:', res.status, data);
      } else {
        toast.success('Browser login signed.');
      }
    } catch (e) {
      toast.error(safeIdentityErr(e) || 'Login signing failed.');
    } finally {
      this.setState({ loginPrompt: null, loginBusy: false });
    }
  }

  _getDelegationToken () {
    try {
      const d = readStorageJSON(DELEGATION_STORAGE_KEY, null);
      if (!d) return null;
      return d && d.token ? String(d.token) : null;
    } catch (_) {
      return null;
    }
  }

  _onGlobal (event) {
    const gs = event && event.detail && event.detail.globalState;
    if (!gs || !gs.messages) return;
    this._ingestMessages(gs.messages);
  }

  _ingestMessages (messages) {
    if (this.state.loginPrompt || this.state.loginBusy) return;
    const token = this._getDelegationToken();
    if (!token) return;
    if (this.state.current || this.state.busy) return;
    for (const k of Object.keys(messages)) {
      const m = messages[k];
      if (!m || !isDelegationSignatureRequestActivity(m)) continue;
      const o = m.object || {};
      if ((o.status || m.status) !== 'pending') continue;
      const mid = o.messageId;
      if (!mid || this._openIds.has(mid)) continue;
      this._openIds.add(mid);
      this.setState({
        current: {
          sessionId: token,
          messageId: mid,
          preview: typeof o.content === 'string' ? o.content : '',
          purpose: typeof o.purpose === 'string' ? o.purpose : 'sign',
          origin: typeof window !== 'undefined' ? window.location.origin : ''
        }
      });
      return;
    }
  }

  async _pollLoopbackSessions () {
    if (typeof window === 'undefined') return;
    if (this.state.loginPrompt || this.state.loginBusy) return;
    if (this.state.current || this.state.busy) return;
    const origin = window.location.origin;
    let res;
    try {
      res = await fetch(`${origin}/sessions`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch (_) {
      return;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok || !Array.isArray(j.sessions)) return;
    const pendingItems = [];
    for (const s of j.sessions) {
      const sid = s && s.tokenId ? String(s.tokenId) : '';
      const arr = s && Array.isArray(s.pendingDelegationMessages) ? s.pendingDelegationMessages : [];
      for (const p of arr) {
        if (p && p.messageId && sid) {
          pendingItems.push({
            sessionId: sid,
            messageId: p.messageId,
            preview: p.preview,
            purpose: p.purpose || 'sign',
            origin: p.origin || s.origin || ''
          });
        }
      }
    }
    if (pendingItems.length === 0) return;
    const first = pendingItems.find((p) => !this._openIds.has(p.messageId));
    if (!first) return;
    this._openIds.add(first.messageId);
    this.setState({ current: first });
  }

  async _resolve (status) {
    const { current } = this.state;
    if (!current || !current.sessionId || !current.messageId) return;
    this.setState({ busy: true });
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const mid = current.messageId;
    let ok = false;
    try {
      const r = await fetch(`${origin}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'ResolveDelegationSignatureMessage',
          params: [{
            sessionId: current.sessionId,
            messageId: mid,
            status
          }]
        }),
        cache: 'no-store'
      });
      const j2 = await r.json().catch(() => ({}));
      ok = r.ok && j2 && !j2.error && j2.result && j2.result.ok;
      if (ok && status === 'approved') toast.success('Signature request approved.');
      else if (ok) toast.warning('Signature request rejected.');
      else toast.error((j2 && j2.error && j2.error.message) || 'Delegation resolution failed.');
    } catch (e) {
      toast.error(e && e.message ? e.message : 'Delegation resolution failed.');
    } finally {
      if (!ok) this._openIds.delete(mid);
      this.setState({ current: null, busy: false });
    }
  }

  render () {
    const { current, busy, loginPrompt, loginBusy } = this.state;
    const isDesktop = typeof window !== 'undefined' && window.fabricDesktop && window.fabricDesktop.isDesktopShell;
    const showLogin = !!(isDesktop && loginPrompt);

    if (showLogin) {
      const messageToSign = loginPrompt && typeof loginPrompt.message === 'string' ? loginPrompt.message : '';
      const loginPreview = messageToSign.length > 1200 ? `${messageToSign.slice(0, 1200)}…` : messageToSign;
      const loginOrigin = loginPrompt && typeof loginPrompt.origin === 'string' ? loginPrompt.origin : '';
      const loginNonce = loginPrompt && typeof loginPrompt.nonce === 'string' ? loginPrompt.nonce : '';
      const fs = loginPrompt && loginPrompt.fabricMessageSummary ? loginPrompt.fabricMessageSummary : null;
      const messageOnly = !!(loginPrompt && loginPrompt.fabricMessageOnly);
      const promptLine = (fs && fs.envelopeMeta && fs.envelopeMeta.prompt) || DEFAULT_SIGN_PROMPT;
      const fromContract = loginPrompt && loginPrompt.delegationSource === 'RunExecutionContract';

      return (
        <Modal
          size="small"
          open
          onClose={() => !loginBusy && this._completeLogin(false)}
          closeOnDimmerClick={!loginBusy}
          closeOnEscape={!loginBusy}
        >
          <Header icon>
            <Icon name="sign-in" />
            {messageOnly ? 'Fabric message' : 'Fabric Hub — browser login'}
          </Header>
          <Modal.Content>
            {fs ? (
              <div style={{ marginBottom: '1em' }}>
                {fromContract ? (
                  <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.5em' }}>From execution contract (hub run)</p>
                ) : null}
                <p style={{ marginBottom: '0.65em', fontSize: '1.02em' }}>{promptLine}</p>
                <p style={{ marginBottom: '0.35em' }}>
                  <strong>Fabric Message</strong> (wire format)
                </p>
                {fs.envelopeMeta && fs.envelopeMeta.signersCount > 0 ? (
                  <p style={{ fontSize: '0.88em', color: '#555' }}>
                    Co-signers / parties to notify: <strong>{fs.envelopeMeta.signersCount}</strong> (multisig-ready)
                  </p>
                ) : null}
                <p style={{ fontSize: '0.92em', color: '#444' }}>
                  Type <code>{fs.typeName}</code>
                  {fs.byteLength ? ` · ${fs.byteLength} bytes` : ''}
                </p>
                {fs.authorHex ? (
                  <p style={{ fontSize: '0.85em', color: '#666', wordBreak: 'break-all' }}>
                    Author <code>{fs.authorHex.length > 48 ? `${fs.authorHex.slice(0, 48)}…` : fs.authorHex}</code>
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
                  {fs.bodyPreview || '(no body)'}
                </pre>
              </div>
            ) : null}
            {!messageOnly ? (
              <>
                <p style={{ marginBottom: '0.75em' }}>
                  A browser tab is asking to link this Hub identity for external signing.
                </p>
                {loginOrigin ? <p><strong>Origin</strong>{': '}{loginOrigin}</p> : null}
                {loginNonce ? (
                  <p style={{ color: '#666', fontSize: '0.9em' }}>
                    <strong>Nonce</strong>{': '}{loginNonce.length > 16 ? `${loginNonce.slice(0, 16)}…` : loginNonce}
                  </p>
                ) : null}
                <p style={{ marginTop: '0.75em', marginBottom: '0.35em' }}>
                  <strong>Message you will sign</strong> (BIP340 Schnorr over UTF-8 bytes):
                </p>
                <pre
                  style={{
                    maxHeight: '40vh',
                    overflow: 'auto',
                    fontSize: '0.85em',
                    padding: '0.75em',
                    background: '#f7f7f7',
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {loginPreview || '(empty)'}
                </pre>
              </>
            ) : (
              <p style={{ color: '#666', fontSize: '0.95em' }}>
                Opaque link <code>{'fabric:<hex>'}</code> or legacy <code>fabric://message?hex=…</code>. No browser login session.
              </p>
            )}
          </Modal.Content>
          <Modal.Actions>
            <Button disabled={loginBusy} onClick={() => this._completeLogin(false)}>
              {messageOnly ? 'Close' : 'Cancel'}
            </Button>
            {!messageOnly ? (
              <Button
                primary
                disabled={loginBusy}
                loading={loginBusy}
                onClick={() => void this._completeLogin(true)}
              >
                Sign &amp; approve
              </Button>
            ) : null}
          </Modal.Actions>
        </Modal>
      );
    }

    return (
      <Modal
        size="small"
        open={!!current}
        onClose={() => !busy && void this._resolve('rejected')}
        closeOnDimmerClick={!busy}
        closeOnEscape={!busy}
      >
        <Header icon>
          <Icon name="key" />
          Delegation signature
        </Header>
        <Modal.Content>
          <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {current && typeof current.preview === 'string'
              ? String(current.preview).slice(0, 800)
              : '(empty message)'}
          </p>
          <p style={{ color: '#666', fontSize: '0.92em', marginTop: '0.75em' }}>
            <strong>Purpose</strong>{': '}{current && current.purpose ? String(current.purpose) : 'sign'}
            <br />
            <strong>Origin</strong>{': '}{current && current.origin ? String(current.origin) : '—'}
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button disabled={busy} onClick={() => void this._resolve('rejected')}>
            Reject
          </Button>
          <Button primary disabled={busy} loading={busy} onClick={() => void this._resolve('approved')}>
            Approve
          </Button>
        </Modal.Actions>
      </Modal>
    );
  }
}

module.exports = DelegationSigningModal;
