'use strict';

// Dependencies
const React = require('react');

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

function DistributeProposalsList (props) {
  const bridgeRef = props.bridgeRef;
  const [proposalsState, setProposalsState] = React.useState({});
  const [acceptingId, setAcceptingId] = React.useState(null);
  const [txidByProposal, setTxidByProposal] = React.useState({});
  const [invoiceByProposal, setInvoiceByProposal] = React.useState({});
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
    (p) => p && p.status === 'pending'
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

  if (pendingProposals.length === 0) return null;

  return (
    <Segment>
      <Header as="h3">
        <Icon name="handshake" />
        Hosting proposals
        <Label size="small" color="orange">{pendingProposals.length}</Label>
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
                    {proposal.amountSats} sats
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
                      Amount: {invoice.amountSats} sats
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
    </Segment>
  );
}

module.exports = DistributeProposalsList;
