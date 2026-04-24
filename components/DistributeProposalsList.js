'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Header,
  Icon,
  Input,
  Label,
  List,
  Message,
  Segment
} = require('semantic-ui-react');
const { formatSatsDisplay } = require('../functions/formatSats');

function DistributeProposalsList (props) {
  const bridgeRef = props.bridgeRef;
  const [proposalsState, setProposalsState] = React.useState({});
  const [acceptingId, setAcceptingId] = React.useState(null);
  const [txidByProposal, setTxidByProposal] = React.useState({});
  const [invoiceByProposal, setInvoiceByProposal] = React.useState({});
  const [contractByProposal, setContractByProposal] = React.useState({});
  const [bondFail, setBondFail] = React.useState(null);
  const [acceptFail, setAcceptFail] = React.useState(null);
  const pendingAcceptRef = React.useRef({});

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (gs && gs.distributeProposals) setProposalsState(gs.distributeProposals);
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, []);

  React.useEffect(() => {
    const bridgeInstance = bridgeRef && bridgeRef.current;
    if (bridgeInstance && bridgeInstance.globalState && bridgeInstance.globalState.distributeProposals) {
      setProposalsState(bridgeInstance.globalState.distributeProposals);
    }
  }, [bridgeRef]);

  // When payment is bonded, update proposals to show the contract.
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.contractId || !detail.documentId) return;
      const docId = detail.documentId;
      const contractId = detail.contractId;
      setProposalsState((prev) => {
        const next = { ...prev };
        let updated = false;
        for (const [pid, p] of Object.entries(next)) {
          if (!p) continue;
          const matches = p.documentId === docId ||
            (p.document && (p.document.sha256 === docId || p.document.id === docId));
          if (matches) {
            next[pid] = { ...p, status: 'bonded' };
            setContractByProposal((c) => ({ ...c, [pid]: contractId }));
            updated = true;
          }
        }
        return updated ? next : prev;
      });
    };
    window.addEventListener('storageContractBonded', handler);
    return () => window.removeEventListener('storageContractBonded', handler);
  }, []);

  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.documentId) return;
      const docId = detail.documentId;
      const gs = bridgeRef && bridgeRef.current && bridgeRef.current.globalState;
      const map = (gs && gs.distributeProposals) || {};
      const pid = Object.keys(map).find((id) => {
        const p = map[id];
        if (!p) return false;
        return p.documentId === docId ||
          (p.document && (p.document.sha256 === docId || p.document.id === docId));
      });
      if (pid) setBondFail({ proposalId: pid, message: detail.message || 'Contract creation failed.' });
    };
    window.addEventListener('storageContractBondFailed', handler);
    return () => window.removeEventListener('storageContractBondFailed', handler);
  }, [bridgeRef]);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e && e.detail;
      if (!d || !d.proposalId) return;
      setAcceptingId(null);
      try {
        if (d.documentId && pendingAcceptRef.current) {
          delete pendingAcceptRef.current[d.documentId];
        }
      } catch (_) {}
      setAcceptFail({ proposalId: String(d.proposalId), message: String(d.message || 'Accept failed') });
    };
    window.addEventListener('acceptDistributeProposalFailed', handler);
    return () => window.removeEventListener('acceptDistributeProposalFailed', handler);
  }, []);

  // Listen for distributeInvoiceReady when we accept a proposal (host flow)
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail;
      if (!detail || !detail.fromProposal) return;
      const docId = detail.documentId;
      let proposalId = pendingAcceptRef.current[docId];
      if (!proposalId) {
        proposalId = Object.keys(proposalsState).find((id) => {
          const p = proposalsState[id];
          if (!p) return false;
          return p.documentId === docId ||
            (p.document && (p.document.sha256 === docId || p.document.id === docId));
        });
      }
      if (proposalId) {
        delete pendingAcceptRef.current[docId];
        setInvoiceByProposal((prev) => ({
          ...prev,
          [proposalId]: {
            address: detail.address,
            amountSats: detail.amountSats,
            network: detail.network
          }
        }));
      }
    };
    window.addEventListener('distributeInvoiceReady', handler);
    return () => window.removeEventListener('distributeInvoiceReady', handler);
  }, [proposalsState]);

  const pendingProposals = Object.values(proposalsState || {}).filter(
    (p) => p && (p.status === 'pending' || p.status === 'accepted')
  );
  const bondedProposals = Object.values(proposalsState || {}).filter(
    (p) => p && p.status === 'bonded'
  );

  const handleAccept = (proposal) => {
    if (!bridgeRef || !bridgeRef.current) return;
    const bridgeInstance = bridgeRef.current;
    if (typeof bridgeInstance.sendAcceptDistributeProposalRequest !== 'function') return;
    const doc = bridgeInstance.globalState && bridgeInstance.globalState.documents && bridgeInstance.globalState.documents[proposal.documentId];
    const backendId = (doc && doc.sha256) || proposal.documentId;
    pendingAcceptRef.current[backendId] = proposal.id;
    setAcceptFail((prev) => (prev && prev.proposalId === proposal.id ? null : prev));
    setAcceptingId(proposal.id);
    bridgeInstance.sendAcceptDistributeProposalRequest(proposal);
    setTimeout(() => setAcceptingId(null), 3000);
  };

  const handleReject = (proposal) => {
    setAcceptFail((prev) => (prev && prev.proposalId === proposal.id ? null : prev));
    if (!bridgeRef || !bridgeRef.current) return;
    const gs = bridgeRef.current.globalState || {};
    gs.distributeProposals = gs.distributeProposals || {};
    const updated = { ...proposal, status: 'rejected' };
    gs.distributeProposals[proposal.id] = updated;
    if (typeof bridgeRef.current._writeJSONToStorage === 'function') {
      bridgeRef.current._writeJSONToStorage('fabric:distributeProposals', gs.distributeProposals);
    }
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/distributeProposals/${proposal.id}`, value: updated },
        globalState: gs
      }
    }));
  };

  const handleConfirmPayment = (proposal, txid) => {
    if (!bridgeRef || !bridgeRef.current || !txid || !txid.trim()) return;
    const bridgeInstance = bridgeRef.current;
    if (typeof bridgeInstance.sendDistributeDocumentRequest !== 'function') return;
    const docId = proposal.documentId;
    const invoice = invoiceByProposal[proposal.id];
    setBondFail((prev) => (prev && prev.proposalId === proposal.id ? null : prev));
    bridgeInstance.sendDistributeDocumentRequest(docId, {
      amountSats: invoice ? invoice.amountSats : proposal.amountSats,
      durationYears: proposal.durationYears,
      challengeCadence: proposal.challengeCadence,
      responseDeadline: proposal.responseDeadline,
      desiredCopies: proposal.desiredCopies,
      txid: txid.trim()
    });
    setTxidByProposal((prev) => {
      const next = { ...prev };
      delete next[proposal.id];
      return next;
    });
    const gs = bridgeInstance.globalState || {};
    gs.distributeProposals = gs.distributeProposals || {};
    const updated = { ...proposal, status: 'accepted' };
    gs.distributeProposals[proposal.id] = updated;
    window.dispatchEvent(new CustomEvent('globalStateUpdate', {
      detail: {
        operation: { op: 'add', path: `/distributeProposals/${proposal.id}`, value: updated },
        globalState: gs
      }
    }));
  };

  const hasProposals = pendingProposals.length > 0 || bondedProposals.length > 0;
  const bridge = bridgeRef && bridgeRef.current;
  const wireLocal = !!(bridge && typeof bridge.hasLocalWireSigningKey === 'function' && bridge.hasLocalWireSigningKey());

  return (
    <Segment basic={!!props.embedded} style={props.embedded ? { padding: 0 } : undefined}>
      <section aria-labelledby="distribute-hosting-heading" aria-describedby="distribute-hosting-summary">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5em',
            marginBottom: '0.35em'
          }}
        >
          <Header as="h3" id="distribute-hosting-heading" style={{ margin: 0 }}>
            <Icon name="handshake" aria-hidden="true" />
            Hosting proposals
          </Header>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.35em' }} aria-hidden="true">
            {pendingProposals.length > 0 && (
              <Label size="small" color="orange">{pendingProposals.length} pending</Label>
            )}
            {bondedProposals.length > 0 && (
              <Label size="small" color="green">{bondedProposals.length} bonded</Label>
            )}
          </span>
        </div>
        <p id="distribute-hosting-summary" style={{ color: '#666', marginBottom: '1em' }}>
          Peers want to pay you to host their files. Accept to create a payment invoice and begin receiving payments.
        </p>
        {bridge && !wireLocal && (
          <Message warning size="small" style={{ marginBottom: '1em' }} id="distribute-hosting-external-signing">
            <Message.Header>External signing mode</Message.Header>
            <p style={{ margin: '0.35em 0 0', color: '#333' }}>
              This browser has no local Fabric private key, so storage-contract requests go to the Hub without a client Schnorr signature on the wire envelope.
              Approve any delegation prompts in the desktop app or shell. When you are done on a shared machine, end the session under{' '}
              <Link to="/settings/security">Security &amp; delegation</Link>.
            </p>
          </Message>
        )}
      </section>
      <List divided relaxed>
        {pendingProposals.map((proposal) => {
          const invoice = invoiceByProposal[proposal.id];
          const hasInvoice = !!invoice;
          const txid = txidByProposal[proposal.id] || '';
          const isAccepting = acceptingId === proposal.id;
          return (
            <List.Item key={proposal.id}>
              <List.Content>
                <List.Header>
                  {proposal.documentName || proposal.documentId}
                  <Label size="mini" color="orange" style={{ marginLeft: '0.5em' }}>
                    {formatSatsDisplay(proposal.amountSats)} sats
                  </Label>
                </List.Header>
                <List.Description>
                  From {proposal.senderAddress ? `${String(proposal.senderAddress).slice(0, 12)}…` : 'unknown'}
                </List.Description>
                {!hasInvoice ? (
                  <div style={{ marginTop: '0.5em' }}>
                    {acceptFail && acceptFail.proposalId === proposal.id && (
                      <Message
                        negative
                        size="small"
                        style={{ marginBottom: '0.65em' }}
                        onDismiss={() => setAcceptFail((prev) => (prev && prev.proposalId === proposal.id ? null : prev))}
                      >
                        {acceptFail.message}
                      </Message>
                    )}
                    <Button
                      size="small"
                      primary
                      loading={isAccepting}
                      disabled={isAccepting}
                      onClick={() => handleAccept(proposal)}
                    >
                      <Icon name="check" />
                      Accept
                    </Button>
                    <Button
                      size="small"
                      basic
                      onClick={() => handleReject(proposal)}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Message size="small" style={{ marginTop: '0.5em' }}>
                    <Message.Header>Invoice sent to proposer</Message.Header>
                    {bondFail && bondFail.proposalId === proposal.id && (
                      <Message
                        negative
                        size="small"
                        style={{ marginBottom: '0.75em' }}
                        onDismiss={() => setBondFail((prev) => (prev && prev.proposalId === proposal.id ? null : prev))}
                        content={bondFail.message}
                      />
                    )}
                    <p>
                      Address: <code>{invoice.address}</code><br />
                      Amount: {formatSatsDisplay(invoice.amountSats)} sats
                    </p>
                    <p>When the proposer pays, enter the transaction ID below:</p>
                    <Input
                      placeholder="Transaction ID (txid)"
                      value={txid}
                      onChange={(e) => setTxidByProposal((prev) => ({ ...prev, [proposal.id]: e.target.value }))}
                      style={{ marginBottom: '0.5em', fontFamily: 'monospace', width: '100%' }}
                    />
                    <Button
                      size="small"
                      primary
                      onClick={() => handleConfirmPayment(proposal, txid)}
                      disabled={!txid.trim()}
                    >
                      Confirm payment & create contract
                    </Button>
                  </Message>
                )}
              </List.Content>
            </List.Item>
          );
        })}
      </List>

      {bondedProposals.length > 0 && (
        <>
          <section
            aria-labelledby="distribute-bonded-heading"
            aria-describedby="distribute-bonded-summary"
            style={{ marginTop: '1.5em' }}
          >
            <Header as="h4" id="distribute-bonded-heading" style={{ marginTop: 0 }}>
              <Icon name="check circle" color="green" aria-hidden="true" />
              Bonded (payment confirmed)
            </Header>
            <p id="distribute-bonded-summary" style={{ color: '#666', marginBottom: '0.75em', fontSize: '0.9em' }}>
              These offers have been paid. Storage contracts are active.
            </p>
          <List divided relaxed aria-label="Bonded hosting proposals">
            {bondedProposals.map((proposal) => {
              const contractId = contractByProposal[proposal.id];
              return (
                <List.Item key={proposal.id}>
                  <List.Content>
                    <List.Header>
                      {proposal.documentName || proposal.documentId}
                      <Label size="mini" color="green" style={{ marginLeft: '0.5em' }}>
                        <Icon name="check" />
                        Bonded
                      </Label>
                    </List.Header>
                    <List.Description>
                      From {proposal.senderAddress ? `${String(proposal.senderAddress).slice(0, 12)}…` : 'unknown'}
                      {proposal.amountSats ? ` — ${formatSatsDisplay(proposal.amountSats)} sats` : ''}
                    </List.Description>
                    {contractId && (
                      <div style={{ marginTop: '0.5em' }}>
                        <Button
                          size="small"
                          as={Link}
                          to={`/contracts/${encodeURIComponent(contractId)}`}
                          primary
                        >
                          <Icon name="file alternate" />
                          View contract
                        </Button>
                      </div>
                    )}
                  </List.Content>
                </List.Item>
              );
            })}
          </List>
          </section>
        </>
      )}

      {!hasProposals && (
        <p style={{ color: '#888', fontStyle: 'italic', marginTop: '0.5em' }}>No offers yet.</p>
      )}
    </Segment>
  );
}

module.exports = DistributeProposalsList;
