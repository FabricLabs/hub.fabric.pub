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
const strings = require('../locales/en');

const common = strings.common;
const co = strings.network.collaboration;

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
      throw new Error(co.notReady);
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
    if (raw === 'accepted') return { text: co.invitations.status.accepted, color: 'green' };
    if (raw === 'declined') return { text: co.invitations.status.declined, color: 'red' };
    if (raw === 'expired') return { text: co.invitations.status.expired, color: 'grey' };
    return { text: co.invitations.status.pending, color: 'blue' };
  }, []);

  const formatTs = React.useCallback((ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return common.none;
    try {
      return new Date(n).toLocaleString();
    } catch (_) {
      return common.none;
    }
  }, []);

  if (!token) {
    return (
      <Segment style={{ maxWidth: 720, margin: '1em auto' }}>
        <Message warning>
          <Message.Header>{co.noToken.heading}</Message.Header>
          <p>
            {co.noToken.bodyBefore}{' '}
            <Link to="/settings/admin">{co.noToken.link}</Link>{co.noToken.bodyAfter}
          </p>
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
            {co.title}
            <Header.Subheader>{co.subtitle}</Header.Subheader>
          </Header.Content>
        </Header>
      </div>

      {error ? (
        <Message negative onDismiss={() => setError(null)} content={error} role="alert" />
      ) : null}

      <Button primary icon="refresh" content={common.actions.refresh} loading={busy} disabled={busy} onClick={() => refresh()} />

      <Divider />

      <Header as="h3">{co.contacts.heading}</Header>
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
              throw new Error(co.contacts.needEmailOrPeer);
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
          <Form.Input id="collab-input-contact-email" label={co.contacts.email} placeholder={co.contacts.emailPlaceholder} value={newEmail} onChange={(e, d) => setNewEmail(d.value)} />
          <Form.Input
            id="collab-input-contact-peerid"
            label={co.contacts.peerId}
            placeholder={co.contacts.peerIdPlaceholder}
            value={newPeerId}
            onChange={(e, d) => setNewPeerId(d.value)}
          />
          <Form.Input id="collab-input-contact-pubkey" label={co.contacts.publicKey} placeholder={co.contacts.publicKeyPlaceholder} value={newPub} onChange={(e, d) => setNewPub(d.value)} />
        </Form.Group>
        <Form.Button id="collab-btn-contact-add" primary type="submit" loading={busy} disabled={busy}>{co.contacts.add}</Form.Button>
      </Form>
      <Table compact celled size="small">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{co.contacts.columns.name}</Table.HeaderCell>
            <Table.HeaderCell>{co.contacts.columns.email}</Table.HeaderCell>
            <Table.HeaderCell>{co.contacts.columns.peerId}</Table.HeaderCell>
            <Table.HeaderCell>{co.contacts.columns.publicKey}</Table.HeaderCell>
            <Table.HeaderCell>{co.contacts.columns.actions}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(contacts || []).length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5} style={{ color: '#666' }}>{co.contacts.empty}</Table.Cell>
            </Table.Row>
          ) : null}
          {(contacts || []).map((c) => (
            <Table.Row key={c.id}>
              <Table.Cell>{c.label || common.none}</Table.Cell>
              <Table.Cell>{c.email || common.none}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{c.fabricPeerId || common.none}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{c.publicKeyHex || common.none}</Table.Cell>
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
                  {co.remove}
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        {co.contacts.knownPeers}{' '}
        {(peers || []).slice(0, 12).map((p) => (
          <code key={String(p.id)} style={{ marginRight: '0.5em' }}>{String(p.id).slice(0, 18)}…</code>
        ))}
        {(!peers || peers.length === 0) ? <em>{co.contacts.noKnownPeers}</em> : null}
      </p>

      <Divider />

      <Header as="h3">{co.groups.heading}</Header>
      <p style={{ color: '#555' }}>{co.groups.intro}</p>
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
            <Form.Input id="collab-input-group-name-field" label={co.groups.name} value={groupName} onChange={(e, d) => setGroupName(d.value)} required />
          </div>
          <Form.Input
            id="collab-input-group-threshold"
            label={co.groups.threshold}
            type="number"
            min={1}
            value={groupThreshold}
            onChange={(e, d) => setGroupThreshold(Number(d.value) || 1)}
          />
        </Form.Group>
        <span id="collab-btn-group-create">
          <Form.Button primary type="submit" loading={busy} disabled={busy}>{co.groups.create}</Form.Button>
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
          <Form.Input id="collab-input-member-groupid" label={co.groups.memberGroup} placeholder="grp_…" value={memberGroupId} onChange={(e, d) => setMemberGroupId(d.value)} />
          <Form.Input id="collab-input-member-pubkey" label={co.groups.memberKey} value={memberPub} onChange={(e, d) => setMemberPub(d.value)} />
        </Form.Group>
        <Form.Button id="collab-btn-member-add" type="submit" loading={busy} disabled={busy}>{co.groups.addMember}</Form.Button>
      </Form>

      <Table compact celled size="small" style={{ marginTop: '1em' }}>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{co.groups.columns.name}</Table.HeaderCell>
            <Table.HeaderCell>{co.groups.columns.id}</Table.HeaderCell>
            <Table.HeaderCell>{co.groups.columns.threshold}</Table.HeaderCell>
            <Table.HeaderCell>{co.groups.columns.members}</Table.HeaderCell>
            <Table.HeaderCell>{co.groups.columns.actions}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(groups || []).length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5} style={{ color: '#666' }}>{co.groups.empty}</Table.Cell>
            </Table.Row>
          ) : null}
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
                  {co.groups.preview}
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {preview && previewGroupId ? (
        <Message info>
          <Message.Header>{co.preview.heading(previewGroupId)}</Message.Header>
          <p style={{ margin: '0.35em 0 0.55em' }}>
            {co.preview.readiness}{' '}
            {Array.isArray(preview.missing) && preview.missing.length > 0 ? (
              <Label color="orange" size="small">
                {co.preview.missing(preview.missing.length)}
              </Label>
            ) : (
              <Label color="green" size="small">{co.preview.ready}</Label>
            )}
            {' '}
            <Label size="small">
              {co.preview.mOfN(Number(preview.threshold || 0), Number(preview.uniquePubkeys || 0))}
            </Label>
          </p>
          {preview.receiveReady && preview.receiveAddress ? (
            <Message positive>
              <Message.Header>{co.preview.receiveHeading}</Message.Header>
              <p style={{ marginTop: '0.35em', marginBottom: '0.45em' }}>
                {co.preview.receiveAddress} <code style={{ wordBreak: 'break-all' }}>{preview.receiveAddress}</code>
              </p>
              <Button
                size="mini"
                type="button"
                basic
                onClick={() => copyText('receiveAddress', preview.receiveAddress)}
              >
                {copyState === 'receiveAddress' ? co.preview.copiedAddress : co.preview.copyAddress}
              </Button>
            </Message>
          ) : null}
          {preview.federationPolicy && preview.federationPolicy.ready ? (
            <Message>
              <Message.Header>{co.preview.federationHeading}</Message.Header>
              <p style={{ marginTop: '0.35em', marginBottom: '0.5em' }}>
                {co.preview.federationBody}{' '}
                <code style={{ wordBreak: 'break-all' }}>{preview.federationPolicy.vaultAddress || common.none}</code>
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
                    if (!validators.length) throw new Error(co.preview.noValidators);
                    const out = await rpc('SetDistributedFederationPolicy', {
                      validators,
                      threshold: thresholdNum
                    });
                    if (out && out.status === 'error') throw new Error(out.message || co.preview.saveFailed);
                    setFederationApplyStatus(co.preview.saved(thresholdNum, validators.length, previewGroupId));
                  } catch (err) {
                    setError(err && err.message ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {co.preview.useForFederation}
              </Button>
              <Button
                size="mini"
                type="button"
                basic
                onClick={() => copyText('federationValidators', JSON.stringify(preview.federationPolicy.validatorsCompressedSorted || [], null, 2))}
              >
                {copyState === 'federationValidators' ? co.preview.copiedValidators : co.preview.copyValidators}
              </Button>
              <Button
                as={Link}
                to="/settings/federation"
                size="mini"
                basic
                type="button"
              >
                {co.preview.openFederation}
              </Button>
              {federationApplyStatus ? (
                <Message positive size="small" style={{ marginTop: '0.75em', marginBottom: 0 }} content={federationApplyStatus} role="status" />
              ) : null}
            </Message>
          ) : null}
          <details className="hub-developer-details">
            <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
            <pre id="collab-multisig-preview-json" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(preview, null, 2)}</pre>
          </details>
        </Message>
      ) : null}

      <Divider />

      <Header as="h3">{co.invitations.heading}</Header>
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
              throw new Error(co.invitations.needRecipient);
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
          <Form.Input id="collab-input-invite-email" label={co.invitations.email} placeholder={co.invitations.emailPlaceholder} value={inviteEmail} onChange={(e, d) => setInviteEmail(d.value)} />
          <Form.Input
            id="collab-input-invite-peer"
            label={co.invitations.peer}
            placeholder={co.invitations.peerPlaceholder}
            value={invitePeerIdentity}
            onChange={(e, d) => setInvitePeerIdentity(d.value)}
          />
          <Form.Select
            id="collab-input-invite-group"
            label={co.invitations.group}
            placeholder={co.invitations.groupPlaceholder}
            value={inviteGroupId}
            onChange={(e, d) => setInviteGroupId(String(d.value || ''))}
            options={[
              { key: '_none', value: '', text: co.invitations.noGroup },
              ...(groups || []).map((g) => ({ key: g.id, value: g.id, text: co.invitations.groupOption(g.name, g.id) }))
            ]}
          />
        </Form.Group>
        <Form.Button id="collab-btn-invite-send" primary type="submit" loading={busy} disabled={busy}>{co.invitations.send}</Form.Button>
      </Form>
      <Table compact celled size="small">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{co.invitations.columns.email}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.recipient}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.group}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.status}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.expires}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.id}</Table.HeaderCell>
            <Table.HeaderCell>{co.invitations.columns.actions}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(invitations || []).length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={7} style={{ color: '#666' }}>{co.invitations.empty}</Table.Cell>
            </Table.Row>
          ) : null}
          {(invitations || []).map((inv) => (
            <Table.Row key={inv.id}>
              <Table.Cell>{inv.email || common.none}</Table.Cell>
              <Table.Cell style={{ wordBreak: 'break-all' }}>{inv.recipientPeerIdentity || common.none}</Table.Cell>
              <Table.Cell>{inv.groupId ? ((groupMap[inv.groupId] && groupMap[inv.groupId].name) || inv.groupId) : common.none}</Table.Cell>
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
                  {co.remove}
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {preview && previewGroupId ? (
        <Message>
          <Message.Header>{co.handoff.heading}</Message.Header>
          <p style={{ marginTop: '0.4em' }}>
            {co.handoff.bodyBefore}{' '}
            <Link to="/contracts">{co.handoff.link}</Link> {co.handoff.bodyAfter}
          </p>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('preview', JSON.stringify(preview, null, 2))}
          >
            {copyState === 'preview' ? co.handoff.copiedPreview : co.handoff.copyPreview}
          </Button>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('fingerprint', preview.policyFingerprint || '')}
            disabled={!preview.policyFingerprint}
          >
            {copyState === 'fingerprint' ? co.handoff.copiedFingerprint : co.handoff.copyFingerprint}
          </Button>
          <Button
            size="mini"
            type="button"
            basic
            onClick={() => copyText('descriptor', preview.receiveDescriptor || '')}
            disabled={!preview.receiveDescriptor}
          >
            {copyState === 'descriptor' ? co.handoff.copiedDescriptor : co.handoff.copyDescriptor}
          </Button>
        </Message>
      ) : null}
    </Segment>
  );
}

module.exports = CollaborationHome;
