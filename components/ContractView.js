'use strict';

const React = require('react');
const { useParams, Link } = require('react-router-dom');
const { Segment, Header, Icon, Button, Loader, Table, Label } = require('semantic-ui-react');

function ContractView () {
  const params = useParams();
  const id = params && params.id ? params.id : '';

  const [contract, setContract] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/contracts/${encodeURIComponent(id)}`, { method: 'GET' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body || body.status === 'error') {
          setError((body && body.message) || 'Failed to load contract.');
          setContract(null);
          return;
        }
        const c = body.contract || body.result || body;
        setContract(c || null);
      } catch (e) {
        if (cancelled) return;
        setError(e && e.message ? e.message : 'Failed to load contract.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  const created = contract && contract.created ? new Date(contract.created).toLocaleString() : '';

  return (
    <fabric-contract-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/documents" title="Back to documents">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>Contract</span>
          {contract && (
            <Label size="small" color="purple">
              <Icon name="cloud" />
              Storage
            </Label>
          )}
        </Header>

        <Segment>
          {loading && (
            <div style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader active inline="centered" />
            </div>
          )}
          {!loading && error && (
            <div style={{ color: '#b00' }}>{error}</div>
          )}
          {!loading && !error && contract && (
            <React.Fragment>
              <Header as="h3">Details</Header>
              <Table definition>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell width={3}>ID</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.document && (
                    <Table.Row>
                      <Table.Cell>Document</Table.Cell>
                      <Table.Cell><code>{contract.document}</code></Table.Cell>
                    </Table.Row>
                  )}
                  {contract.amountSats != null && (
                    <Table.Row>
                      <Table.Cell>Amount</Table.Cell>
                      <Table.Cell>{contract.amountSats} sats</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.durationYears != null && (
                    <Table.Row>
                      <Table.Cell>Duration</Table.Cell>
                      <Table.Cell>{contract.durationYears} years</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.challengeCadence && (
                    <Table.Row>
                      <Table.Cell>Challenge cadence</Table.Cell>
                      <Table.Cell>{contract.challengeCadence}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.responseDeadline && (
                    <Table.Row>
                      <Table.Cell>Response deadline</Table.Cell>
                      <Table.Cell>{contract.responseDeadline}</Table.Cell>
                    </Table.Row>
                  )}
                  {created && (
                    <Table.Row>
                      <Table.Cell>Created</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && !contract && (
            <div style={{ color: '#666' }}>No contract data.</div>
          )}
        </Segment>
      </Segment>
    </fabric-contract-detail>
  );
}

module.exports = ContractView;
