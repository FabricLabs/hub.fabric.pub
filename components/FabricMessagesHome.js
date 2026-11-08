'use strict';

const React = require('react');
const { Link, useSearchParams } = require('react-router-dom');
const { Button, Container, Form, Header, Icon, Label, Message, Segment, Table } = require('semantic-ui-react');
const { browserContractsClient } = require('../functions/hubContractsBrowser');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { messageLabel } = require('../functions/fabricMessageView');
const { shortId } = require('../functions/federationView');
const t = require('../locales/en');

const c = t.messages.home;
const PAGE = 50;

/**
 * `/messages`: this Hub's Fabric message log with type chips, an id filter,
 * a text filter, and paging. Filters live in the query string.
 * @param {{ adminToken?: string }} props
 */
function FabricMessagesHome (props) {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const contract = params.get('contract') || '';
  const q = params.get('q') || '';
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const client = React.useMemo(() => browserContractsClient(adminToken), [adminToken]);
  const [data, setData] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState(null);
  const [contractDraft, setContractDraft] = React.useState(contract);
  const [qDraft, setQDraft] = React.useState(q);
  const [types, setTypes] = React.useState({});

  React.useEffect(() => { setContractDraft(contract); setQDraft(q); }, [contract, q]);

  const load = React.useCallback(async (before) => {
    try {
      const r = await client.listMessages({ type, contract, q, before, limit: PAGE });
      setData(r);
      setRows((prev) => (before ? prev.concat(r.messages || []) : (r.messages || [])));
      if (r.types) setTypes(r.types);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [client, type, contract, q]);

  React.useEffect(() => { void load(undefined); }, [load]);

  const setFilter = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  const typeNames = Object.keys(types).filter(Boolean).sort();
  return (
    <Container style={{ maxWidth: 1080, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to="/activities" basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {c.back}
      </Button>
      <Segment raised style={{ borderRadius: 10 }}>
        <Header as="h1" id="fabric-messages-heading" style={{ marginTop: 0 }}>
          <Icon name="list alternate outline" color="blue" aria-hidden="true" />
          <Header.Content>
            {c.title}
            <Header.Subheader style={{ marginTop: '0.35em' }}>{c.subheader}</Header.Subheader>
          </Header.Content>
        </Header>
        <div role="group" aria-label={c.filters.label} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', marginBottom: '0.75em' }}>
          <Label as="a" color={!type ? 'blue' : undefined} onClick={() => setFilter({ type: '' })}>{c.filters.allTypes}</Label>
          {typeNames.map((name) => (
            <Label as="a" key={name} color={type === name ? 'blue' : undefined} onClick={() => setFilter({ type: name })}>
              {messageLabel(name)}
              <Label.Detail>{types[name]}</Label.Detail>
            </Label>
          ))}
        </div>
        <Form onSubmit={() => setFilter({ contract: contractDraft.trim(), q: qDraft.trim() })}>
          <Form.Group widths="equal">
            <Form.Input label={c.filters.contract} value={contractDraft} onChange={(e, d) => setContractDraft(d.value)} />
            <Form.Input label={c.filters.text} value={qDraft} onChange={(e, d) => setQDraft(d.value)} />
          </Form.Group>
          <Button type="submit" size="small" primary>{c.filters.apply}</Button>
          {type || contract || q ? (
            <Button type="button" size="small" basic onClick={() => setParams(new URLSearchParams())}>{c.filters.clear}</Button>
          ) : null}
        </Form>
      </Segment>

      {error ? <Message negative>{c.loadFailed(error)}</Message> : null}
      {!data && !error ? <Segment loading style={{ minHeight: '6em' }}>{c.loading}</Segment> : null}
      {data ? (
        <Segment style={{ borderRadius: 10 }}>
          <p style={{ color: '#666' }}>{c.count(rows.length, data.total)}</p>
          {!rows.length ? <p>{c.none}</p> : (
            <Table basic="very" compact unstackable selectable>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.columns.seq}</Table.HeaderCell>
                  <Table.HeaderCell>{c.columns.type}</Table.HeaderCell>
                  <Table.HeaderCell>{c.columns.refs}</Table.HeaderCell>
                  <Table.HeaderCell>{c.columns.time}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((m) => (
                  <Table.Row key={m.id || m.seq}>
                    <Table.Cell><Link to={m.href}>{m.seq}</Link></Table.Cell>
                    <Table.Cell><Link to={m.href}>{m.label}</Link></Table.Cell>
                    <Table.Cell>
                      {(m.refs || []).slice(0, 3).map((ref) => (
                        <Label key={ref} size="tiny" basic as={Link} to={`/messages?contract=${encodeURIComponent(ref)}`} title={ref}>
                          {shortId(ref)}
                        </Label>
                      ))}
                    </Table.Cell>
                    <Table.Cell>{m.created ? new Date(m.created).toLocaleString() : '—'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
          {data.more ? <Button type="button" size="small" basic onClick={() => load(data.next)}>{c.more}</Button> : null}
        </Segment>
      ) : null}
    </Container>
  );
}

module.exports = FabricMessagesHome;
