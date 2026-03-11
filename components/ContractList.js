'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Segment, Header, List, Icon, Label, Loader, Button } = require('semantic-ui-react');

function ContractList (props) {
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/contracts', { method: 'GET' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body || body.status === 'error') {
          setError((body && body.message) || 'Failed to load contracts.');
          setContracts([]);
          return;
        }
        const list = Array.isArray(body.contracts) ? body.contracts : (body.result || []);
        setContracts(list || []);
      } catch (e) {
        if (cancelled) return;
        setError(e && e.message ? e.message : 'Failed to load contracts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <fabric-contracts class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/" title="Back">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>Contracts</span>
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
          {!loading && !error && (
            <List divided relaxed>
              {contracts.map((c) => {
                if (!c || !c.id) return null;
                const created = c.created ? new Date(c.created).toLocaleString() : '';
                return (
                  <List.Item key={c.id}>
                    <List.Content>
                      <List.Header>
                        <Link to={`/contracts/${encodeURIComponent(c.id)}`}>
                          {c.name || c.id}
                        </Link>
                        <Label size="mini" color="purple" style={{ marginLeft: '0.5em' }}>
                          <Icon name="cloud" />
                          Storage
                        </Label>
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {c.document ? `Document: ${c.document}` : 'Document storage contract'}
                        {created ? ` — ${created}` : ''}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
              {contracts.length === 0 && !loading && !error && (
                <List.Item>
                  <List.Content>
                    <List.Description style={{ color: '#666' }}>No contracts yet.</List.Description>
                  </List.Content>
                </List.Item>
              )}
            </List>
          )}
        </Segment>
      </Segment>
    </fabric-contracts>
  );
}

module.exports = ContractList;

