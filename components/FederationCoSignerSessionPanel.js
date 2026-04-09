'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Dropdown,
  Form,
  Header,
  Icon,
  Message,
  Segment
} = require('semantic-ui-react');
const {
  buildFederationContractInviteJson,
  normalizeProposedPolicy,
  normalizeSpendingTerms
} = require('../functions/federationContractInvite');

const DRAFT_KEY = 'fabric.federation.coSignerSessionDraft';

function readDraft () {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch (e) {
    return null;
  }
}

function writeDraft (obj) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(obj));
  } catch (e) { /* ignore */ }
}

function fabricPeersFromBridge (bridge) {
  const ns = bridge && bridge.networkStatus;
  const peers = ns && Array.isArray(ns.peers) ? ns.peers : [];
  return peers.filter((peer) => {
    if (!peer || typeof peer !== 'object') return false;
    const id = String(peer.id || '');
    const address = String(peer.address || '');
    if (id.startsWith('fabric-bridge-') || address.startsWith('fabric-bridge-')) return false;
    return !!(peer.id || peer.address);
  });
}

function peerSendTarget (peer) {
  if (!peer) return '';
  return String(peer.address || peer.id || '').trim();
}

/**
 * @param {{
 *   bridgeRef: object,
 *   validatorRows: string[],
 *   setValidatorRows: function,
 *   normalizePubkeyRows: function,
 *   threshold: string,
 *   PUBKEY_RE: RegExp
 * }} props
 */
function FederationCoSignerSessionPanel (props) {
  const bridgeRef = props && props.bridgeRef;
  const validatorRows = (props && props.validatorRows) || [];
  const setValidatorRows = props && props.setValidatorRows;
  const normalizePubkeyRows = props && props.normalizePubkeyRows;
  const thresholdStr = props && props.threshold != null ? String(props.threshold) : '1';
  const PUBKEY_RE = props && props.PUBKEY_RE;

  const [tick, setTick] = React.useState(0);
  const [spendMode, setSpendMode] = React.useState('percent');
  const [spendValue, setSpendValue] = React.useState('10');
  const [termsSummary, setTermsSummary] = React.useState('');
  const [shortNote, setShortNote] = React.useState('');
  const [peerChoice, setPeerChoice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  React.useEffect(() => {
    const d = readDraft();
    if (d) {
      if (d.spendMode === 'percent' || d.spendMode === 'sats') setSpendMode(d.spendMode);
      if (d.spendValue != null) setSpendValue(String(d.spendValue));
      if (d.termsSummary) setTermsSummary(String(d.termsSummary));
      if (d.shortNote) setShortNote(String(d.shortNote));
    }
  }, []);

  React.useEffect(() => {
    writeDraft({
      spendMode,
      spendValue,
      termsSummary,
      shortNote,
      savedAt: Date.now()
    });
  }, [spendMode, spendValue, termsSummary, shortNote]);

  React.useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('networkStatusUpdate', bump);
    return () => window.removeEventListener('networkStatusUpdate', bump);
  }, []);

  const bridge = bridgeRef && bridgeRef.current;
  const fabricPeers = fabricPeersFromBridge(bridge);
  void tick;

  const openIdentityModal = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
  };

  const insertMyWirePubkey = () => {
    setMsg(null);
    if (!bridge || typeof bridge.getHtlcRefundPublicKeyHex !== 'function') {
      setMsg('Bridge is not ready.');
      return;
    }
    if (!bridge.hasLocalWireSigningKey || !bridge.hasLocalWireSigningKey()) {
      setMsg('Unlock your identity first (Log in & unlock).');
      return;
    }
    const pk = bridge.getHtlcRefundPublicKeyHex();
    if (!pk || !(PUBKEY_RE && PUBKEY_RE.test(pk))) {
      setMsg('Could not read a compressed secp256k1 pubkey from this session.');
      return;
    }
    const lower = pk.toLowerCase();
    setValidatorRows((rows) => {
      const cur = normalizePubkeyRows(rows);
      if (cur.some((k) => k.toLowerCase() === lower)) {
        setMsg('Your wire pubkey is already listed.');
        return rows;
      }
      return [...cur, pk];
    });
    setMsg('Inserted this browser’s wire signing pubkey as a validator row.');
  };

  const publishToPeers = async () => {
    setMsg(null);
    if (!bridge || typeof bridge.sendPeerMessageRequest !== 'function') {
      setMsg('Bridge is not ready.');
      return;
    }
    if (!bridge.hasLocalWireSigningKey || !bridge.hasLocalWireSigningKey()) {
      setMsg('Unlock your identity to send P2P invites.');
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setMsg('Add at least one validator public key before publishing.');
      return;
    }
    if (lines.some((k) => !(PUBKEY_RE && PUBKEY_RE.test(k)))) {
      setMsg('Fix invalid validator rows (need 02/03 + 64 hex).');
      return;
    }
    let thr = Number(thresholdStr);
    if (!Number.isFinite(thr) || thr < 1) thr = 1;
    if (thr > lines.length) thr = lines.length;
    const proposedPolicy = normalizeProposedPolicy({ validators: lines, threshold: thr });
    if (!proposedPolicy) {
      setMsg('Could not build proposed policy.');
      return;
    }
    const sv = Number(spendValue);
    const spendingTerms = normalizeSpendingTerms({
      mode: spendMode,
      value: sv
    });
    if (!spendingTerms) {
      setMsg('Enter a valid spending limit (percent 0–100 or sats ≥ 0).');
      return;
    }

    const ns = bridge.networkStatus;
    const inviterHubId = ns && ns.fabricPeerId != null ? String(ns.fabricPeerId) : '';

    const targets = [];
    if (peerChoice === '__all__') {
      for (const p of fabricPeers) {
        const t = peerSendTarget(p);
        if (t) targets.push(t);
      }
    } else if (peerChoice) {
      targets.push(peerChoice);
    }
    if (targets.length === 0) {
      setMsg('Pick a connected peer or “All Fabric peers” to publish the session.');
      return;
    }

    const inviteId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `fed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const publishSessionId = inviteId;
    const json = buildFederationContractInviteJson({
      inviteId,
      inviterHubId: inviterHubId || null,
      contractId: null,
      note: shortNote.trim() || null,
      spendingTerms,
      termsSummary: termsSummary.trim() || null,
      proposedPolicy,
      publishSessionId
    });

    setBusy(true);
    try {
      let n = 0;
      for (const t of targets) {
        bridge.sendPeerMessageRequest(t, json);
        n++;
      }
      setMsg(`Published pending federation session to ${n} peer(s). Co-signers will see a hub notification, then can review and accept.`);
    } catch (e) {
      setMsg(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const peerOptions = [
    { key: 'x', value: '', text: 'Select peer…' },
    ...fabricPeers.map((p, i) => {
      const t = peerSendTarget(p);
      const nick = p.nickname ? String(p.nickname) : '';
      return {
        key: `${t}-${i}`,
        value: t,
        text: nick ? `${nick} (${t.slice(0, 14)}…)` : t
      };
    }),
    { key: 'all', value: '__all__', text: 'All connected Fabric peers' }
  ];

  return (
    <Segment style={{ marginTop: '1rem' }}>
      <Header as="h3" style={{ marginTop: 0 }}>
        <Icon name="paper plane" color="violet" />
        Co-signer session (publish)
      </Header>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '0.85rem' }}>
        Draft a <strong>pending federation</strong> with UI-visible spending rules, then publish over P2P chat so other operators can
        join the same session from their phone or browser. They get an in-app notification first; accepting opens a detail modal and
        only then sends their pubkey back.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <Button
          type="button"
          as={Link}
          to="/settings/security"
          basic
          icon
          labelPosition="left"
        >
          <Icon name="sign in" />
          Log in (security)
        </Button>
        <Button type="button" basic icon labelPosition="left" onClick={openIdentityModal}>
          <Icon name="user secret" />
          Unlock identity…
        </Button>
        <Button type="button" primary icon labelPosition="left" onClick={insertMyWirePubkey}>
          <Icon name="key" />
          Import my wire pubkey
        </Button>
      </div>

      <Form onSubmit={(e) => { e.preventDefault(); }}>
        <Form.Group widths="equal">
          <Form.Field>
            <label htmlFor="fed-cosign-spend-mode">Spending limit type</label>
            <Dropdown
              id="fed-cosign-spend-mode"
              selection
              options={[
                { value: 'percent', text: 'Percent of treasury' },
                { value: 'sats', text: 'Exact sats' }
              ]}
              value={spendMode}
              onChange={(_, d) => setSpendMode(String(d.value))}
            />
          </Form.Field>
          <Form.Field>
            <label htmlFor="fed-cosign-spend-value">{spendMode === 'percent' ? 'Percent (0–100)' : 'Sats'}</label>
            <Form.Input
              id="fed-cosign-spend-value"
              type="number"
              min={0}
              max={spendMode === 'percent' ? 100 : undefined}
              step={spendMode === 'percent' ? 1 : 1}
              value={spendValue}
              onChange={(e) => setSpendValue(e.target.value)}
            />
          </Form.Field>
        </Form.Group>
        <Form.Field>
          <label htmlFor="fed-cosign-terms">Contract terms (shown to co-signers)</label>
          <Form.TextArea
            id="fed-cosign-terms"
            rows={4}
            placeholder="Human-readable agreement: roles, review windows, emergency contacts, etc."
            value={termsSummary}
            onChange={(e) => setTermsSummary(e.target.value)}
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="fed-cosign-note">Short note (optional, P2P invite)</label>
          <Form.Input
            id="fed-cosign-note"
            placeholder="e.g. Regtest treasury — please review by Friday"
            value={shortNote}
            onChange={(e) => setShortNote(e.target.value)}
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="fed-cosign-peer">Send session to</label>
          <Dropdown
            id="fed-cosign-peer"
            selection
            search
            placeholder={fabricPeers.length ? 'Choose peer or broadcast' : 'No Fabric peers yet — open Peers'}
            options={peerOptions}
            value={peerChoice || undefined}
            onChange={(_, d) => setPeerChoice(d.value != null ? String(d.value) : '')}
          />
        </Form.Field>
        <Button
          type="button"
          color="violet"
          icon
          labelPosition="left"
          loading={busy}
          disabled={busy}
          onClick={() => void publishToPeers()}
        >
          <Icon name="send" />
          Publish pending federation
        </Button>
      </Form>

      {msg ? (
        <Message info size="small" style={{ marginTop: '1rem' }} onDismiss={() => setMsg(null)}>
          {msg}
        </Message>
      ) : null}
    </Segment>
  );
}

module.exports = FederationCoSignerSessionPanel;
