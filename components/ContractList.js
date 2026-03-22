'use strict';

const React = require('react');
const { Link, useNavigate } = require('react-router-dom');
const {
  Segment,
  Header,
  List,
  Icon,
  Label,
  Loader,
  Button,
  ButtonGroup,
  Table,
  Form,
  TextArea,
  Message
} = require('semantic-ui-react');
const { fetchLightningChannels, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');

const FILTER_ALL = 'all';
const FILTER_NEW = 'new';
const FILTER_PARTIAL = 'partial';
const FILTER_COMPLETE = 'complete';

const DEFAULT_EXEC_PROGRAM = JSON.stringify({
  version: 1,
  steps: [
    { op: 'FabricOpcode', fabricType: 'ChatMessage' },
    { op: 'FabricOpcode', fabricType: 'JSONCall' },
    { op: 'Push', value: { demo: true } },
    { op: 'Dup' },
    { op: 'Pop' }
  ]
}, null, 2);

function trimHash (value = '', left = 8, right = 8) {
  const text = String(value || '');
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function ContractList (props) {
  const navigate = useNavigate();
  const [contracts, setContracts] = React.useState([]);
  const [lightningChannels, setLightningChannels] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [filter, setFilter] = React.useState(FILTER_ALL);
  const [execName, setExecName] = React.useState('');
  const [execJson, setExecJson] = React.useState(DEFAULT_EXEC_PROGRAM);
  const [execBusy, setExecBusy] = React.useState(false);
  const [execFeedback, setExecFeedback] = React.useState(null);

  const loadContracts = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contractsRes, lightningRes] = await Promise.all([
        fetch('/contracts', { method: 'GET' }),
        fetchLightningChannels(loadUpstreamSettings()).catch(() => ({ channels: [] }))
      ]);

      const body = await contractsRes.json();
      if (!contractsRes.ok || !body || body.status === 'error') {
        setError((body && body.message) || 'Failed to load contracts.');
        setContracts([]);
      } else {
        const list = Array.isArray(body.contracts) ? body.contracts : (body.result || []);
        setContracts(list || []);
      }

      const channels = lightningRes && Array.isArray(lightningRes.channels) ? lightningRes.channels : [];
      setLightningChannels(channels);
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to load contracts.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  React.useEffect(() => {
    const onCreated = () => {
      setExecFeedback({ positive: true, content: 'Execution contract created.' });
      loadContracts();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('executionContractCreated', onCreated);
      return () => window.removeEventListener('executionContractCreated', onCreated);
    }
    return undefined;
  }, [loadContracts]);

  const storageContracts = React.useMemo(() => {
    return contracts.filter((c) => {
      if (!c) return false;
      if (c.type === 'ExecutionContract') return false;
      if (c.type === 'StorageContract') return true;
      return !!c.document;
    });
  }, [contracts]);

  const executionContracts = React.useMemo(() => {
    return contracts.filter((c) => c && c.type === 'ExecutionContract');
  }, [contracts]);

  // Group storage contracts by document to compute accepted count vs desired
  const contractsByDoc = React.useMemo(() => {
    const map = {};
    for (const c of storageContracts) {
      if (!c || !c.document) continue;
      const docId = c.document;
      if (!map[docId]) map[docId] = [];
      map[docId].push(c);
    }
    return map;
  }, [storageContracts]);

  const filteredContracts = React.useMemo(() => {
    return storageContracts.filter((c) => {
      if (!c || !c.document) return false;
      const docContracts = contractsByDoc[c.document] || [];
      const acceptedCount = docContracts.length;
      const desired = Math.max(1, Number(c.desiredCopies || 1));
      if (filter === FILTER_ALL) return true;
      if (filter === FILTER_NEW) return acceptedCount === 1;
      if (filter === FILTER_PARTIAL) return acceptedCount >= 1 && acceptedCount < desired;
      if (filter === FILTER_COMPLETE) return acceptedCount >= desired;
      return true;
    });
  }, [storageContracts, contractsByDoc, filter]);

  const submitExecutionContract = React.useCallback(() => {
    setExecFeedback(null);
    let program;
    try {
      program = JSON.parse(execJson);
    } catch (e) {
      setExecFeedback({ negative: true, content: 'Program must be valid JSON.' });
      return;
    }
    const bridge = props.bridgeRef && props.bridgeRef.current;
    if (!bridge || typeof bridge.sendCreateExecutionContractRequest !== 'function') {
      setExecFeedback({ negative: true, content: 'Connect to the hub (bridge) to create an execution contract.' });
      return;
    }
    setExecBusy(true);
    try {
      bridge.sendCreateExecutionContractRequest({
        name: execName.trim() || undefined,
        program
      });
      setExecFeedback({ info: true, content: 'Create request sent. The list refreshes when the hub confirms.' });
    } finally {
      setExecBusy(false);
    }
  }, [execJson, execName, props.bridgeRef]);

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
            <>
              <Header as='h4'>
                <Icon name='cloud' />
                Storage Contracts
              </Header>
              <div style={{ marginBottom: '1em', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <span style={{ color: '#666', fontSize: '0.9em' }}>Filter:</span>
                <ButtonGroup size="small">
                  <Button
                    active={filter === FILTER_ALL}
                    onClick={() => setFilter(FILTER_ALL)}
                  >
                    All
                  </Button>
                  <Button
                    active={filter === FILTER_NEW}
                    onClick={() => setFilter(FILTER_NEW)}
                    title="First copy bonded"
                  >
                    New
                  </Button>
                  <Button
                    active={filter === FILTER_PARTIAL}
                    onClick={() => setFilter(FILTER_PARTIAL)}
                    title="Some copies bonded, not all"
                  >
                    Partial
                  </Button>
                  <Button
                    active={filter === FILTER_COMPLETE}
                    onClick={() => setFilter(FILTER_COMPLETE)}
                    title="All desired copies bonded"
                  >
                    Complete
                  </Button>
                </ButtonGroup>
              </div>
              <List divided relaxed>
              {filteredContracts.map((c) => {
                if (!c || !c.id) return null;
                const created = c.created ? new Date(c.created).toLocaleString() : '';
                const docContracts = contractsByDoc[c.document] || [];
                const acceptedCount = docContracts.length;
                const desired = Math.max(1, Number(c.desiredCopies || 1));
                const status = acceptedCount >= desired ? 'complete' : acceptedCount === 1 ? 'new' : 'partial';
                const statusLabel = status === 'complete' ? 'Complete' : status === 'new' ? 'New' : 'Partial';
                const statusColor = status === 'complete' ? 'green' : status === 'new' ? 'blue' : 'orange';
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
                        <Label size="mini" color={statusColor} style={{ marginLeft: '0.25em' }}>
                          {statusLabel}
                        </Label>
                        {desired > 1 && (
                          <Label size="mini" basic style={{ marginLeft: '0.25em' }}>
                            {acceptedCount}/{desired} copies
                          </Label>
                        )}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {c.document ? `Document: ${c.document}` : 'Document storage contract'}
                        {created ? ` — ${created}` : ''}
                        {c.txid && (
                          <span style={{ marginLeft: '0.5em' }}>
                            <Button size="mini" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(c.txid)}`} basic>
                              <Icon name="bitcoin" />
                              Tx
                            </Button>
                          </span>
                        )}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
              {filteredContracts.length === 0 && !loading && !error && (
                <List.Item>
                  <List.Content>
                    <List.Description style={{ color: '#666' }}>
                      {storageContracts.length === 0 && executionContracts.length === 0
                        ? 'No contracts yet.'
                        : `No storage contracts match "${filter}".`}
                    </List.Description>
                  </List.Content>
                </List.Item>
              )}
            </List>

              <Header as='h4' dividing style={{ marginTop: '1.5em' }}>
                <Icon name='microchip' />
                Execution contracts
              </Header>
              <p style={{ color: '#666', marginBottom: '0.75em' }}>
                Programs are lists of Fabric opcode descriptors and stack operations. They run in a sandboxed machine (no arbitrary code) — locally in the browser on the detail page, or validated when you create them on the hub.
              </p>
              {execFeedback && (
                <Message
                  positive={!!execFeedback.positive}
                  negative={!!execFeedback.negative}
                  info={!!execFeedback.info}
                  content={execFeedback.content}
                  onDismiss={() => setExecFeedback(null)}
                  style={{ marginBottom: '1em' }}
                />
              )}
              <Form style={{ marginBottom: '1.25em' }}>
                <Form.Field>
                  <label>Name (optional)</label>
                  <Form.Input
                    value={execName}
                    onChange={(e, d) => setExecName(d.value)}
                    placeholder="e.g. Ping demo"
                  />
                </Form.Field>
                <Form.Field>
                  <label>Program (JSON)</label>
                  <TextArea
                    value={execJson}
                    onChange={(e, d) => setExecJson(d.value)}
                    rows={12}
                    style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
                  />
                </Form.Field>
                <Button
                  primary
                  type="button"
                  loading={execBusy}
                  disabled={execBusy}
                  onClick={submitExecutionContract}
                >
                  <Icon name="plus" />
                  Create execution contract
                </Button>
              </Form>
              <List divided relaxed>
                {executionContracts.map((c) => {
                  if (!c || !c.id) return null;
                  const created = c.created ? new Date(c.created).toLocaleString() : '';
                  const steps = c.program && Array.isArray(c.program.steps) ? c.program.steps.length : 0;
                  return (
                    <List.Item key={c.id}>
                      <List.Content>
                        <List.Header>
                          <Link to={`/contracts/${encodeURIComponent(c.id)}`}>
                            {c.name || c.id}
                          </Link>
                          <Label size="mini" color="teal" style={{ marginLeft: '0.5em' }}>
                            <Icon name="code" />
                            Execution
                          </Label>
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {steps ? `${steps} step${steps === 1 ? '' : 's'}` : 'Program'}
                          {created ? ` — ${created}` : ''}
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  );
                })}
                {executionContracts.length === 0 && (
                  <List.Item>
                    <List.Content>
                      <List.Description style={{ color: '#666' }}>
                        No execution contracts yet. Create one above.
                      </List.Description>
                    </List.Content>
                  </List.Item>
                )}
              </List>

              <Header as='h4' dividing style={{ marginTop: '1.5em' }}>
                <Icon name='bolt' color='yellow' />
                <Link to="/services/bitcoin" style={{ color: 'inherit' }}>
                  Lightning Channels
                </Link>
                <Button as={Link} to="/services/bitcoin" basic size="small" style={{ marginLeft: '0.5em' }}>
                  Manage
                </Button>
              </Header>
              {lightningChannels.length === 0 ? (
                <p style={{ color: '#666' }}>No Lightning channels. Open a channel from the Bitcoin page.</p>
              ) : (
                <Table celled compact size='small'>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Peer</Table.HeaderCell>
                      <Table.HeaderCell>State</Table.HeaderCell>
                      <Table.HeaderCell>Capacity</Table.HeaderCell>
                      <Table.HeaderCell>Our balance</Table.HeaderCell>
                      <Table.HeaderCell>Short channel ID</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {lightningChannels.map((ch, idx) => {
                      const chId = ch.channel_id || ch.funding_txid || idx;
                      const toUrl = `/services/bitcoin/channels/${encodeURIComponent(chId)}`;
                      return (
                        <Table.Row
                          key={chId}
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(toUrl)}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{trimHash(ch.peer_id || ch.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{ch.state || '—'}</Table.Cell>
                          <Table.Cell>
                            {ch.amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.amount_msat) / 1000))} sats` : (ch.channel_sat != null ? `${formatSatsDisplay(ch.channel_sat)} sats` : '—')}
                          </Table.Cell>
                          <Table.Cell>
                            {ch.our_amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.our_amount_msat) / 1000))} sats` : '—'}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{ch.short_channel_id || '—'}</code>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              )}
            </>
          )}
        </Segment>
      </Segment>
    </fabric-contracts>
  );
}

module.exports = ContractList;

