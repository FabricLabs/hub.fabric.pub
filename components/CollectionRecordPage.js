'use strict';

const React = require('react');
const { Link, Navigate, useParams } = require('react-router-dom');
const { Button, Container, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const collectionRecords = require('../functions/collectionRecords');
const { browserContractsClient } = require('../functions/hubContractsBrowser');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.messages.collection;

/**
 * `/collections/:kind/:id`: a kind with its own page (federation, contract,
 * fabric-message, document, peer) is sent there; any other kind shows the
 * generic record from {@link module:functions/collectionRecords}.
 * @param {{ adminToken?: string, records?: Object, client?: Object }} props
 */
function CollectionRecordPage (props) {
  const params = useParams();
  const kind = String((params && params.kind) || '');
  const id = String((params && params.id) || '');
  const records = (props && props.records) || collectionRecords;
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const client = React.useMemo(
    () => (props && props.client) || browserContractsClient(adminToken),
    [props && props.client, adminToken]
  );
  const canonical = records.hasCanonicalPage(kind);
  const [record, setRecord] = React.useState(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (canonical) return undefined;
    let live = true;
    setDone(false);
    records.load(kind, id, client).then((r) => {
      if (!live) return;
      setRecord(r);
      setDone(true);
    });
    return () => { live = false; };
  }, [canonical, records, kind, id, client]);

  if (canonical) return <Navigate to={records.hrefFor(kind, id)} replace />;

  const empty = done && (!record || record.missing || record.record == null);
  return (
    <Container style={{ maxWidth: 980, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to="/" basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {c.back}
      </Button>
      {!done ? <Segment loading style={{ minHeight: '6em' }}>{c.loading}</Segment> : null}
      {empty ? <Message info>{c.notFound}</Message> : null}
      {done && !empty ? (
        <Segment raised style={{ borderRadius: 10 }}>
          <Header as="h1" style={{ marginTop: 0 }}>
            <Header.Content>
              {record.title}
              <Header.Subheader style={{ marginTop: '0.35em' }}>{record.subtitle}</Header.Subheader>
            </Header.Content>
          </Header>
          {(record.links || []).length ? (
            <div>
              <Header as="h3">{c.links}</Header>
              <List>
                {record.links.map((l) => (
                  <List.Item key={`${l.rel}:${l.href}`}><Link to={l.href}>{l.title}</Link></List.Item>
                ))}
              </List>
            </div>
          ) : null}
          <Header as="h3">{c.record}</Header>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em', background: '#f8f8f8', padding: '0.75em', borderRadius: 6 }}>
            {JSON.stringify(record.record, null, 2)}
          </pre>
        </Segment>
      ) : null}
    </Container>
  );
}

module.exports = CollectionRecordPage;
