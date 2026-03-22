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
    setAcceptingId(proposal.id);
    bridgeInstance.sendAcceptDistributeProposalRequest(proposal);
    setTimeout(() => setAcceptingId(null), 3000);
  };

  const handleReject = (proposal) => {
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
    bridgeInstance.sendDistributeDocumentRequest(docId, {
      amountSats: invoice ? invoice.amountSats : proposal.amountSats,
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

  return (
    <Segment basic={!!props.embedded} style={props.embedded ? { padding: 0 } : undefined}>
      <Header as="h3">
        <Icon name="handshake" />
        Hosting proposals
        {pendingProposals.length > 0 && (
          <Label size="small" color="orange">{pendingProposals.length} pending</Label>
        )}
        {bondedProposals.length > 0 && (
          <Label size="small" color="green">{bondedProposals.length} bonded</Label>
        )}
      </Header>
      <p style={{ color: '#666', marginBottom: '1em' }}>
        Peers want to pay you to host their files. Accept to create a payment invoice and begin receiving payments.
      </p>
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
          <Header as="h4" style={{ marginTop: '1.5em' }}>
            <Icon name="check circle" color="green" />
            Bonded (payment confirmed)
          </Header>
          <p style={{ color: '#666', marginBottom: '0.75em', fontSize: '0.9em' }}>
            These offers have been paid. Storage contracts are active.
          </p>
          <List divided relaxed>
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
        </>
      )}

      {!hasProposals && (
        <p style={{ color: '#888', fontStyle: 'italic', marginTop: '0.5em' }}>No offers yet.</p>
      )}
    </Segment>
  );
}

module.exports = DistributeProposalsList;
