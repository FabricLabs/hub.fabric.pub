'use strict';

/**
 * Admin: join a private Bitcoin + Fabric network (network-profile.json from `npm run deploy`).
 */

const React = require('react');
const { Button, Form, Message, Segment, TextArea, Label } = require('semantic-ui-react');
const { hubJsonRpc } = require('../functions/hubJsonRpc');
const t = require('../locales/en');

const c = t.settings.admin.privateNetwork;

function linesOf (text) {
  return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function unreached (applied) {
  const list = []
    .concat((applied && applied.addnodes) || [], (applied && applied.peers) || [])
    .filter((r) => r && r.ok === false)
    .map((r) => `${r.node || r.peer} (${r.error})`);
  return list.length ? list.join(', ') : null;
}

/**
 * @param {{ adminToken: (string|null) }} props
 */
function PrivateNetworkPanel (props) {
  const adminToken = props && props.adminToken;
  const [join, setJoin] = React.useState(null);
  const [profileText, setProfileText] = React.useState('');
  const [addnodesText, setAddnodesText] = React.useState('');
  const [peersText, setPeersText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      const r = await hubJsonRpc('GetNetworkJoin', [{ adminToken }]);
      if (r && r.status === 'error') throw new Error(r.message);
      setJoin(r);
      setAddnodesText((r.addnodes || []).join('\n'));
      setPeersText((r.peers || []).join('\n'));
    } catch (err) {
      setError(c.failed(err.message));
    }
  }, [adminToken]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const report = (applied, fallback) => {
    const missing = unreached(applied);
    if (missing) setNotice(c.partial(missing));
    else setNotice(fallback);
  };

  const importProfile = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let profile;
      try {
        profile = JSON.parse(profileText);
      } catch (_) {
        throw new Error('the profile is not valid JSON');
      }
      const r = await hubJsonRpc('ImportNetworkProfile', [{ adminToken, profile }]);
      if (!r || r.status !== 'success') throw new Error((r && r.message) || 'import failed');
      report(r.applied, c.imported(r.network, (r.instances || []).length));
      setProfileText('');
      await refresh();
    } catch (err) {
      setError(c.failed(err.message));
    } finally {
      setBusy(false);
    }
  };

  const save = async (name, text) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/settings/${name}`, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ value: linesOf(text) })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      report(body.applied, c.saved);
      await refresh();
    } catch (err) {
      setError(c.failed(err.message));
    } finally {
      setBusy(false);
    }
  };

  if (!adminToken) {
    return <Message info size="small">{c.needToken}</Message>;
  }

  const connected = new Map(((join && join.bitcoinPeers) || []).map((p) => [p.node, p.connected]));

  return (
    <Segment secondary data-testid="admin-private-network">
      {notice && <Message info size="small" onDismiss={() => setNotice(null)}>{notice}</Message>}
      {error && <Message negative size="small" onDismiss={() => setError(null)}>{error}</Message>}
      <Form>
        <Form.Field>
          <label htmlFor="admin-network-profile">{c.profileLabel}</label>
          <TextArea
            id="admin-network-profile"
            rows={4}
            placeholder={c.profilePlaceholder}
            value={profileText}
            onChange={(_, d) => setProfileText(d.value)}
            style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
          />
        </Form.Field>
        <Button primary type="button" loading={busy} disabled={busy || !profileText.trim()} onClick={importProfile}>
          {c.importButton}
        </Button>
        <Form.Group widths="equal" style={{ marginTop: '1em' }}>
          <Form.Field>
            <label htmlFor="admin-network-addnodes">{c.addnodesLabel}</label>
            <TextArea
              id="admin-network-addnodes"
              rows={3}
              value={addnodesText}
              onChange={(_, d) => setAddnodesText(d.value)}
              style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
            />
            <div style={{ marginTop: '0.35em' }}>
              {((join && join.addnodes) || []).map((node) => (
                <Label key={node} size="tiny" color={connected.get(node) ? 'green' : undefined}>
                  {node} · {connected.get(node) ? c.connected : c.notConnected}
                </Label>
              ))}
            </div>
            <Button size="small" type="button" disabled={busy} style={{ marginTop: '0.5em' }}
              onClick={() => save('BITCOIN_ADDNODES', addnodesText)}>
              {c.saveButton}
            </Button>
          </Form.Field>
          <Form.Field>
            <label htmlFor="admin-network-peers">{c.peersLabel}</label>
            <TextArea
              id="admin-network-peers"
              rows={3}
              value={peersText}
              onChange={(_, d) => setPeersText(d.value)}
              style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
            />
            <Button size="small" type="button" disabled={busy} style={{ marginTop: '0.5em' }}
              onClick={() => save('FABRIC_PEERS', peersText)}>
              {c.saveButton}
            </Button>
          </Form.Field>
        </Form.Group>
      </Form>
    </Segment>
  );
}

module.exports = PrivateNetworkPanel;
