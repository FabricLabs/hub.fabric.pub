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
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const cs = t.federation.coSignerSession;

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
    const bump = () => setTick((n) => n + 1);
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
      setMsg(cs.notReady);
      return;
    }
    if (!bridge.hasLocalWireSigningKey || !bridge.hasLocalWireSigningKey()) {
      setMsg(fabricIdentityNeedFullKeyPlain(bridge.props && bridge.props.auth));
      return;
    }
    const pk = bridge.getHtlcRefundPublicKeyHex();
    if (!pk || !(PUBKEY_RE && PUBKEY_RE.test(pk))) {
      setMsg(cs.keyUnreadable);
      return;
    }
    const lower = pk.toLowerCase();
    setValidatorRows((rows) => {
      const cur = normalizePubkeyRows(rows);
      if (cur.some((k) => k.toLowerCase() === lower)) {
        setMsg(cs.keyListed);
        return rows;
      }
      return [...cur, pk];
    });
    setMsg(cs.keyAdded);
  };

  const publishToPeers = async () => {
    setMsg(null);
    if (!bridge || typeof bridge.sendPeerMessageRequest !== 'function') {
      setMsg(cs.notReady);
      return;
    }
    if (!bridge.hasLocalWireSigningKey || !bridge.hasLocalWireSigningKey()) {
      setMsg(fabricIdentityNeedFullKeyPlain(bridge.props && bridge.props.auth));
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setMsg(cs.needValidator);
      return;
    }
    if (lines.some((k) => !(PUBKEY_RE && PUBKEY_RE.test(k)))) {
      setMsg(cs.invalidKeys);
      return;
    }
    let thr = Number(thresholdStr);
    if (!Number.isFinite(thr) || thr < 1) thr = 1;
    if (thr > lines.length) thr = lines.length;
    const proposedPolicy = normalizeProposedPolicy({ validators: lines, threshold: thr });
    if (!proposedPolicy) {
      setMsg(cs.policyFailed);
      return;
    }
    const sv = Number(spendValue);
    const spendingTerms = normalizeSpendingTerms({
      mode: spendMode,
      value: sv
    });
    if (!spendingTerms) {
      setMsg(cs.invalidLimit);
      return;
    }

    const ns = bridge.networkStatus;
    const inviterHubId = ns && ns.fabricPeerId != null ? String(ns.fabricPeerId) : '';

    const targets = [];
    if (peerChoice === '__all__') {
      for (const p of fabricPeers) {
        const target = peerSendTarget(p);
        if (target) targets.push(target);
      }
    } else if (peerChoice) {
      targets.push(peerChoice);
    }
    if (targets.length === 0) {
      setMsg(cs.needPeer);
      return;
    }

    const g = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
    const inviteId = g && g.randomUUID
      ? g.randomUUID()
      : (() => {
        const a = new Uint8Array(8);
        if (g && g.getRandomValues) g.getRandomValues(a);
        return `fed-${Date.now()}-${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      })();
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
      for (const target of targets) {
        bridge.sendPeerMessageRequest(target, json);
        n++;
      }
      setMsg(cs.sent(n));
    } catch (e) {
      setMsg(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const peerOptions = [
    { key: 'x', value: '', text: cs.peerSelect },
    ...fabricPeers.map((p, i) => {
      const target = peerSendTarget(p);
      const nick = p.nickname ? String(p.nickname) : '';
      return {
        key: `${target}-${i}`,
        value: target,
        text: nick ? `${nick} (${target.slice(0, 14)}…)` : target
      };
    }),
    { key: 'all', value: '__all__', text: cs.peerAll }
  ];

  return (
    <Segment style={{ marginTop: '1rem' }}>
      <Header as="h3" style={{ marginTop: 0 }}>
        <Icon name="paper plane" color="violet" aria-hidden="true" />
        {cs.title}
      </Header>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '0.85rem' }}>{cs.intro}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <Button
          type="button"
          as={Link}
          to="/settings/security"
          basic
          icon
          labelPosition="left"
        >
          <Icon name="shield" aria-hidden="true" />
          {cs.security}
        </Button>
        <Button type="button" basic icon labelPosition="left" onClick={openIdentityModal}>
          <Icon name="user secret" aria-hidden="true" />
          {cs.manageIdentity}
        </Button>
        <Button type="button" primary icon labelPosition="left" onClick={insertMyWirePubkey}>
          <Icon name="key" aria-hidden="true" />
          {cs.addMyKey}
        </Button>
      </div>

      <Form onSubmit={(e) => { e.preventDefault(); }}>
        <Form.Group widths="equal">
          <Form.Field>
            <label htmlFor="fed-cosign-spend-mode">{cs.spendMode}</label>
            <Dropdown
              id="fed-cosign-spend-mode"
              selection
              options={[
                { value: 'percent', text: cs.spendPercent },
                { value: 'sats', text: cs.spendSats }
              ]}
              value={spendMode}
              onChange={(_, d) => setSpendMode(String(d.value))}
            />
          </Form.Field>
          <Form.Field>
            <label htmlFor="fed-cosign-spend-value">{spendMode === 'percent' ? cs.percentLabel : cs.satsLabel}</label>
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
          <label htmlFor="fed-cosign-terms">{cs.terms}</label>
          <Form.TextArea
            id="fed-cosign-terms"
            rows={4}
            placeholder={cs.termsPlaceholder}
            value={termsSummary}
            onChange={(e) => setTermsSummary(e.target.value)}
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="fed-cosign-note">{cs.note}</label>
          <Form.Input
            id="fed-cosign-note"
            placeholder={cs.notePlaceholder}
            value={shortNote}
            onChange={(e) => setShortNote(e.target.value)}
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="fed-cosign-peer">{cs.peer}</label>
          <Dropdown
            id="fed-cosign-peer"
            selection
            search
            placeholder={fabricPeers.length ? cs.peerPlaceholder : cs.peerPlaceholderEmpty}
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
          <Icon name="send" aria-hidden="true" />
          {cs.publish}
        </Button>
      </Form>

      {msg ? (
        <Message info size="small" role="status" style={{ marginTop: '1rem' }} onDismiss={() => setMsg(null)}>
          {msg}
        </Message>
      ) : null}
    </Segment>
  );
}

module.exports = FederationCoSignerSessionPanel;
