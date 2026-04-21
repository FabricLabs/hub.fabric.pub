'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Divider,
  Form,
  Header,
  Icon,
  Label,
  Message,
  Segment,
  Table
} = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

/**
 * Hub operator UI: contacts, groups (nested members + multisig preview), invitations.
 * Uses {@link Bridge#callHubJsonRpc} → POST /services/rpc (admin token on each call).
 */
function CollaborationHome ({ bridgeRef, adminToken }) {
  const token = readHubAdminTokenFromBrowser(adminToken);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [contacts, setContacts] = React.useState([]);
  const [groups, setGroups] = React.useState([]);
  const [invitations, setInvitations] = React.useState([]);
  const [peers, setPeers] = React.useState([]);
  const [newEmail, setNewEmail] = React.useState('');
  const [newPeerId, setNewPeerId] = React.useState('');
  const [newPub, setNewPub] = React.useState('');
  const [groupName, setGroupName] = React.useState('');
  const [groupThreshold, setGroupThreshold] = React.useState(1);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [invitePeerIdentity, setInvitePeerIdentity] = React.useState('');
  const [inviteGroupId, setInviteGroupId] = React.useState('');
  const [copyState, setCopyState] = React.useState('');
  const [memberGroupId, setMemberGroupId] = React.useState('');
  const [memberPub, setMemberPub] = React.useState('');
  const [preview, setPreview] = React.useState(null);
  const [previewGroupId, setPreviewGroupId] = React.useState('');
  const [federationApplyStatus, setFederationApplyStatus] = React.useState('');

  const rpc = React.useCallback(async (method, params = {}) => {
    const b = bridgeRef && bridgeRef.current;
    if (!b || typeof b.callHubJsonRpc !== 'function') {
      throw new Error('Bridge is not ready yet.');
    }
    const out = await b.callHubJsonRpc(method, Object.assign({}, params, { adminToken: token }));
    if (out.error) throw new Error(out.error);
    return out.result;
  }, [bridgeRef, token]);

  const copyText = React.useCallback(async (key, value) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setCopyState(key);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setCopyState(''), 1500);
      }
    } catch (_) {}
  }, []);

  const refresh = React.useCallback(async () => {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      const [c, g, i, ns] = await Promise.all([
        rpc('ListCollaborationContacts', {}),
        rpc('ListCollaborationGroups', {}),
        rpc('ListCollaborationInvitations', {}),
        rpc('ListPeers', {})
      ]);
      setContacts(Array.isArray(c && c.contacts) ? c.contacts : []);
      setGroups(Array.isArray(g && g.groups) ? g.groups : []);
      setInvitations(Array.isArray(i && i.invitations) ? i.invitations : []);
      setPeers(Array.isArray(ns && ns.peers) ? ns.peers : []);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [rpc, token]);

  React.useEffect(() => {
    if (!token) return;
    refresh();
  }, [token, refresh]);

  const groupMap = React.useMemo(() => {
    const out = {};
    for (const g of groups || []) {
      if (g && g.id) out[String(g.id)] = g;
    }
    return out;
  }, [groups]);

  const inviteStatusMeta = React.useCallback((inv) => {
    const now = Date.now();
    const exp = Number(inv && inv.expiresAt);
    const expired = Number.isFinite(exp) && exp > 0 && now > exp && String(inv.status || '') === 'pending';
    const raw = expired ? 'expired' : String((inv && inv.status) || 'pending').toLowerCase();
    if (raw === 'accepted') return { text: 'accepted', color: 'green' };
    if (raw === 'declined') return { text: 'declined', color: 'red' };
    if (raw === 'expired') return { text: 'expired', color: 'grey' };
    return { text: 'pending', color: 'blue' };
  }, []);

  const formatTs = React.useCallback((ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
      return new Date(n).toLocaleString();
    } catch (_) {
      return '—';
    }
  }, []);

  if (!token) {
    return (
      <Segment style={{ maxWidth: 720, margin: '1em auto' }}>
        <Message warning>
          <Message.Header>Admin token required</Message.Header>
          <p>Save the hub admin token from first-time setup, then open <Link to="/settings/admin">Admin</Link>.</p>
        </Message>
      </Segment>
    );
  }

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <div id="collaboration-page-heading">
        <Header as="h2">
          <Icon name="users" />
          <Header.Content>
            Collaboration
            <Header.Subheader>Contacts, multisig-oriented groups, email invitations</Header.Subheader>
          </Header.Content>
        </Header>
      </div>

      {error ? (
        <Message negative onDismiss={() => setError(null)} content={error} />
      ) : null}

      <Button primary icon="refresh" content="Refresh" loading={busy} disabled={busy} onClick={() => refresh()} />

      <Divider />

      <Header as="h3">Contacts</Header>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = {};
            if (newEmail.trim()) body.email = newEmail.trim();
            if (newPeerId.trim()) body.fabricPeerId = newPeerId.trim();
            if (newPub.trim()) body.publicKeyHex = newPub.trim();
            if (!body.email && !body.fabricPeerId) {
              throw new Error('Enter an email and/or pick a Fabric peer id.');
            }
            await rpc('AddCollaborationContact', body);
            setNewEmail('');
            setNewPeerId('');
            setNewPub('');
            await refresh();
          } catch (err) {
            setError(err.message || String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Group widths="equal">
          <Form.Input id="collab-input-contact-email" label="Email" placeholder="friend@example.com" value={newEmail} onChange={(e, d) => setNewEmail(d.value)} />
          <Form.Input
            id="collab-input-contact-peerid"
            label="Fabric peer id (from list)"
            placeholder="id1… or webrtc:…"
            value={newPeerId}
            onChange={(e, d) => setNewPeerId(d.value)}
          />
          <Form.Input id="collab-input-contact-pubkey" label="Public key hex (optional)" placeholder="02… or x-only 64 hex" value={newPub} onChange={(e, d) => setNewPub(d.value)} />
        </Form.Group>
        <Form.Button id="collab-btn-contact-add" primary type="submit" loading={busy} disabled={busy}>Add contact</Form.Button>
      </Form>
      <Table compact celled size="small">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Label</Table.HeaderCell>
            <Table.HeaderCell>Email</Table.HeaderCell>
            <Table.HeaderCell>Fabric id</Table.HeaderCell>
            <Table.HeaderCell>Pubkey (x-only / hex)</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(contacts || []).map((c) => (
            <Table.Row key={c.id}>
              <Table.Cell>{c.label || '—'}</Table.Cell>
              <Table.Cell>{c.email || '—'}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{c.fabricPeerId || '—'}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{c.publicKeyHex || '—'}</Table.Cell>
              <Table.Cell collapsing>
                <Button
                  size="mini"
                  negative
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await rpc('RemoveCollaborationContact', { id: c.id });
                      await refresh();
                    } catch (err) {
                      setError(err.message || String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        Known peers (for paste):{' '}
        {(peers || []).slice(0, 12).map((p) => (
          <code key={String(p.id)} style={{ marginRight: '0.5em' }}>{String(p.id).slice(0, 18)}…</code>
        ))}
        {(!peers || peers.length === 0) ? <em>none yet</em> : null}
      </p>

      <Divider />

      <Header as="h3">Groups</Header>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await rpc('CreateCollaborationGroup', {
              name: groupName.trim(),
              threshold: Number(groupThreshold) || 1
            });
            setGroupName('');
            setGroupThreshold(1);
            await refresh();
          } catch (err) {
            setError(err.message || String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Group widths="equal">
          <div id="collab-input-group-name">
            <Form.Input label="Name" value={groupName} onChange={(e, d) => setGroupName(d.value)} required />
          </div>
          <Form.Input
            id="collab-input-group-threshold"
            label="Threshold (m-of-n when keys resolve)"
            type="number"
            min={1}
            value={groupThreshold}
            onChange={(e, d) => setGroupThreshold(Number(d.value) || 1)}
          />
        </Form.Group>
        <span id="collab-btn-group-create">
          <Form.Button primary type="submit" loading={busy} disabled={busy}>Create group</Form.Button>
        </span>
      </Form>

      <Form
        style={{ marginTop: '1em' }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!memberGroupId.trim() || !memberPub.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await rpc('AddCollaborationGroupMember', {
              groupId: memberGroupId.trim(),
              type: 'pubkey',
              publicKeyHex: memberPub.trim()
            });
            setMemberPub('');
            await refresh();
          } catch (err) {
            setError(err.message || String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Group widths="equal">
          <Form.Input id="collab-input-member-groupid" label="Group id" placeholder="grp_…" value={memberGroupId} onChange={(e, d) => setMemberGroupId(d.value)} />
          <Form.Input id="collab-input-member-pubkey" label="Member secp256k1 pubkey (hex)" value={memberPub} onChange={(e, d) => setMemberPub(d.value)} />
        </Form.Group>
        <Form.Button id="collab-btn-member-add" type="submit" loading={busy} disabled={busy}>Add pubkey member</Form.Button>
      </Form>

      <Table compact celled size="small" style={{ marginTop: '1em' }}>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Name</Table.HeaderCell>
            <Table.HeaderCell>Id</Table.HeaderCell>
            <Table.HeaderCell>m</Table.HeaderCell>
            <Table.HeaderCell>Members</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(groups || []).map((g) => (
            <Table.Row key={g.id}>
              <Table.Cell>{g.name}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{g.id}</Table.Cell>
              <Table.Cell>{g.threshold}</Table.Cell>
              <Table.Cell>{g.memberCount}</Table.Cell>
              <Table.Cell collapsing>
                <Button
                  id={`collab-btn-preview-${g.id}`}
                  size="mini"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const pr = await rpc('GetCollaborationGroupMultisigPreview', { groupId: g.id });
                      const pv = pr && pr.preview ? pr.preview : pr;
                      setPreview(pv);
                      setPreviewGroupId(g.id);
                      setFederationApplyStatus('');
                    } catch (err) {
                      setError(err.message || String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Preview
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {preview && previewGroupId ? (
        <Message info>
          <Message.Header>Multisig preview for {previewGroupId}</Message.Header>
          <p style={{ margin: '0.35em 0 0.55em' }}>
            Readiness:{' '}
            {Array.isArray(preview.missing) && preview.missing.length > 0 ? (
              <Label color="orange" size="small">
                Missing keys ({preview.missing.length})
              </Label>
            ) : (
              <Label color="green" size="small">Ready</Label>
            )}
            {' '}
            <Label size="small">
              {Number(preview.threshold || 0)}-of-{Number(preview.uniquePubkeys || 0)}
            </Label>
          </p>
          {preview.receiveReady && preview.receiveAddress ? (
            <Message positive>
              <Message.Header>Your group can now receive funds!</Message.Header>
              <p style={{ marginTop: '0.35em', marginBottom: '0.45em' }}>
                Taproot receive address: <code style={{ wordBreak: 'break-all' }}>{preview.receiveAddress}</code>
              </p>
              <Button
                size="mini"
                type="button"
                basic
                onClick={() => copyText('receiveAddress', preview.receiveAddress)}
              >
                {copyState === 'receiveAddress' ? 'Copied address' : 'Copy receive address'}
              </Button>
            </Message>
          ) : null}
          {preview.federationPolicy && preview.federationPolicy.ready ? (
            <Message>
              <Message.Header>Federation integration</Message.Header>
              <p style={{ marginTop: '0.35em', marginBottom: '0.5em' }}>
                This group can be reused as your distributed federation validator set.
                Vault address from the same signer policy:{' '}
                <code style={{ wordBreak: 'break-all' }}>{preview.federationPolicy.vaultAddress || '—'}</code>
              </p>
              <Button
                size="mini"
                type="button"
                primary
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setFederationApplyStatus('');
                  try {
                    const validators = Array.isArray(preview.federationPolicy.validatorsCompressedSorted)
                      ? preview.federationPolicy.validatorsCompressedSorted
                      : [];
                    const thresholdNum = Number(preview.federationPolicy.threshold || preview.threshold || 1);
                    if (!validators.length) throw new Error('No validators available in this group preview.');
                    const out = await rpc('SetDistributedFederationPolicy', {
                      validators,
                      threshold: thresholdNum
                    });
                    if (out && out.status === 'error') throw new Error(out.message || 'Could not save federation policy.');
                    setFederationApplyStatus(`Saved federation policy (${thresholdNum}-of-${validators.length}) from group ${previewGroupId}.`);
                  } catch (err) {
                    setError(err && err.message ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use this group as federation policy
              </Button>
              <Button
                size="mini"
                type="button"
                basic
                onClick={() => copyText('federationValidators', JSON.stringify(preview.federationPolicy.validatorsCompressedSorted || [], null, 2))}
              >
                {copyState === 'federationValidators' ? 'Copied validators' : 'Copy federation validators'}
              </Button>
              <Button
                as={Link}
                to="/settings/federation"
                size="mini"
                basic
                type="button"
              >
                Open federation settings
              </Button>
              {federationApplyStatus ? (
                <Message positive size="small" style={{ marginTop: '0.75em', marginBottom: 0 }} content={federationApplyStatus} />
              ) : null}
            </Message>
          ) : null}
          <pre id="collab-multisig-preview-json" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(preview, null, 2)}</pre>
        </Message>
      ) : null}

      <Divider />

      <Header as="h3">Invitations</Header>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = {};
            if (inviteEmail.trim()) body.email = inviteEmail.trim();
            if (invitePeerIdentity.trim()) body.recipientPeerIdentity = invitePeerIdentity.trim();
            if (inviteGroupId.trim()) body.groupId = inviteGroupId.trim();
            if (!body.email && !body.recipientPeerIdentity) {
              throw new Error('Enter invite email and/or recipient peer identity (id1...).');
            }
            await rpc('CreateCollaborationInvitation', body);
            setInviteEmail('');
            setInvitePeerIdentity('');
            setInviteGroupId('');
            await refresh();
          } catch (err) {
            setError(err.message || String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Group widths="equal">
          <Form.Input id="collab-input-invite-email" label="Email (optional)" placeholder="invitee@example.com" value={inviteEmail} onChange={(e, d) => setInviteEmail(d.value)} />
          <Form.Input
            id="collab-input-invite-peer"
            label="Recipient peer identity (id1..., optional)"
            placeholder="id1..."
            value={invitePeerIdentity}
            onChange={(e, d) => setInvitePeerIdentity(d.value)}
          />
          <Form.Select
            id="collab-input-invite-group"
            label="Attach group (optional)"
            placeholder="Select group"
            value={inviteGroupId}
            onChange={(e, d) => setInviteGroupId(String(d.value || ''))}
            options={[
              { key: '_none', value: '', text: 'No group attached' },
              ...(groups || []).map((g) => ({ key: g.id, value: g.id, text: `${g.name} (${g.id})` }))
            ]}
          />
        </Form.Group>
        <Form.Button id="collab-btn-invite-send" primary type="submit" loading={busy} disabled={busy}>Send invitation</Form.Button>
      </Form>
      <Table compact celled size="small">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Email</Table.HeaderCell>
            <Table.HeaderCell>Recipient peer</Table.HeaderCell>
            <Table.HeaderCell>Group</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Expires</Table.HeaderCell>
            <Table.HeaderCell>Id</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(invitations || []).map((inv) => (
            <Table.Row key={inv.id}>
              <Table.Cell>{inv.email || '—'}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{inv.recipientPeerIdentity || '—'}</Table.Cell>
              <Table.Cell>{inv.groupId ? ((groupMap[inv.groupId] && groupMap[inv.groupId].name) || inv.groupId) : '—'}</Table.Cell>
              <Table.Cell>
                {(() => {
                  const m = inviteStatusMeta(inv);
                  return <Label color={m.color} size="mini">{m.text}</Label>;
                })()}
              </Table.Cell>
              <Table.Cell>{formatTs(inv.expiresAt)}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{inv.id}</Table.Cell>
              <Table.Cell collapsing>
                <Button
                  size="mini"
                  negative
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await rpc('RemoveCollaborationInvitation', { id: inv.id });
                      await refresh();
                    } catch (err) {
                      setError(err.message || String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {preview && previewGroupId ? (
        <Message>
          <Message.Header>Execution handoff</Message.Header>
          <p style={{ marginTop: '0.4em' }}>
            Use this group preview as the input for contract execution policy authoring on the{' '}
            <Link to="/contracts">Contracts</Link> page.
          </p>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('preview', JSON.stringify(preview, null, 2))}
          >
            {copyState === 'preview' ? 'Copied preview' : 'Copy preview JSON'}
          </Button>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('fingerprint', preview.policyFingerprint || '')}
            disabled={!preview.policyFingerprint}
          >
            {copyState === 'fingerprint' ? 'Copied fingerprint' : 'Copy policy fingerprint'}
          </Button>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('descriptor', preview.receiveDescriptor || '')}
            disabled={!preview.receiveDescriptor}
          >
            {copyState === 'descriptor' ? 'Copied descriptor' : 'Copy Taproot descriptor'}
          </Button>
        </Message>
      ) : null}
    </Segment>
  );
}

module.exports = CollaborationHome;
