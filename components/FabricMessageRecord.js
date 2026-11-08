'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Container, Header, Icon, Label, List, Message, Segment } = require('semantic-ui-react');
const { browserContractsClient } = require('../functions/hubContractsBrowser');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { recordLinks, hrefFor } = require('../functions/collectionRecords');
const { shortId, shortKey } = require('../functions/federationView');
const t = require('../locales/en');

const c = t.messages.record;

function copy (text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(String(text));
  } catch (_) {}
}

const LINK_LABEL = { federation: c.federation, contract: c.contract, document: c.document };

function MessageLink (props) {
  const m = props.message;
  return (
    <List.Item>
      <List.Content>
        <List.Header as={Link} to={m.href}>{m.label}</List.Header>
        <List.Description>#{m.seq}{m.created ? ` · ${new Date(m.created).toLocaleString()}` : ''}</List.Description>
      </List.Content>
    </List.Item>
  );
}

/**
 * `/messages/:id`: one Fabric message with its signer, the message before it
 * and after it, the data it carries, and the raw `fabric:` frame when it has one.
 * @param {{ adminToken?: string, messageId?: string }} props
 */
function FabricMessageRecord (props) {
  const params = useParams();
  const id = (props && props.messageId) || (params && params.id) || '';
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const client = React.useMemo(() => browserContractsClient(adminToken), [adminToken]);
  const [m, setM] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [missing, setMissing] = React.useState(false);
  const [showData, setShowData] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setM(null);
    setMissing(false);
    setError(null);
    client.getMessage(id)
      .then((r) => { if (live) setM(r); })
      .catch((e) => {
        if (!live) return;
        if (e && e.status === 404) setMissing(true);
        else setError(e.message);
      });
    return () => { live = false; };
  }, [client, id]);

  const links = m ? recordLinks(m.payload) : [];
  if (m && m.federationId && !links.some((l) => l.kind === 'federation' && l.id === m.federationId)) {
    links.unshift({ kind: 'federation', id: m.federationId, href: hrefFor('federation', m.federationId) });
  }
  const frame = m && m.frame;

  return (
    <Container style={{ maxWidth: 980, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to="/messages" basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {c.back}
      </Button>
      {error ? <Message negative>{c.loadFailed(error)}</Message> : null}
      {missing ? <Message info>{c.notFound}</Message> : null}
      {!m && !error && !missing ? <Segment loading style={{ minHeight: '6em' }}>{c.loading}</Segment> : null}
      {m ? (
        <div>
          <Segment raised style={{ borderRadius: 10 }}>
            <Header as="h1" style={{ marginTop: 0 }}>
              <Icon name="envelope outline" color="blue" aria-hidden="true" />
              <Header.Content>
                {m.label}
                <Header.Subheader style={{ marginTop: '0.35em' }}>
                  {c.seq(m.seq)}
                  {m.source === 'federation-mailbox' ? <span>{' · '}{c.mailbox}</span> : null}
                </Header.Subheader>
              </Header.Content>
            </Header>
            <List relaxed>
              {m.frameId ? (
                <List.Item>
                  <List.Header>{c.frameId}</List.Header>
                  <code style={{ wordBreak: 'break-all' }}>{m.frameId}</code>{' '}
                  <Button size="mini" basic onClick={() => copy(m.frameId)}>{c.copy}</Button>
                </List.Item>
              ) : null}
              {m.id && m.id !== m.frameId ? (
                <List.Item>
                  <List.Header>{c.logId}</List.Header>
                  <code style={{ wordBreak: 'break-all' }}>{m.id}</code>
                </List.Item>
              ) : null}
              {m.created ? (
                <List.Item>
                  <List.Header>{c.created}</List.Header>
                  {new Date(m.created).toLocaleString()}
                </List.Item>
              ) : null}
              <List.Item>
                <List.Header>{c.author}</List.Header>
                {m.author || (frame && frame.author)
                  ? <code title={m.author || frame.author}>{shortKey(m.author || frame.author)}</code>
                  : c.unsigned}
              </List.Item>
            </List>
            {links.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em' }}>
                {links.map((l) => (
                  <Button key={`${l.kind}:${l.id}`} as={Link} to={l.href} size="small" basic>
                    {LINK_LABEL[l.kind] || l.kind}{' '}<code style={{ marginLeft: '0.35em' }}>{shortId(l.id)}</code>
                  </Button>
                ))}
              </div>
            ) : null}
          </Segment>

          <Segment style={{ borderRadius: 10 }}>
            <Header as="h3" style={{ marginTop: 0 }}>{c.parent}</Header>
            {m.parentMessage ? (
              <List><MessageLink message={m.parentMessage} /></List>
            ) : (m.parent
              ? <code style={{ wordBreak: 'break-all' }}>{m.parent}</code>
              : <p style={{ color: '#666' }}>{c.genesis}</p>)}
            <Header as="h3">{c.children}</Header>
            {(m.children || []).length
              ? <List>{m.children.map((child) => <MessageLink key={child.id || child.seq} message={child} />)}</List>
              : <p style={{ color: '#666' }}>{c.noChildren}</p>}
            {(m.chain || []).length > 1 ? (
              <div>
                <Header as="h4">{c.chain}</Header>
                <List>{m.chain.slice(1).map((row) => <MessageLink key={row.id || row.seq} message={row} />)}</List>
              </div>
            ) : null}
          </Segment>

          <Segment style={{ borderRadius: 10 }}>
            <Header as="h3" style={{ marginTop: 0 }}>{c.data}</Header>
            {m.payload == null ? <p style={{ color: '#666' }}>{c.noData}</p> : (
              <div>
                <Button type="button" size="small" basic onClick={() => setShowData((v) => !v)}>
                  {showData ? c.hideData : c.showData}
                </Button>
                {showData ? (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em', background: '#f8f8f8', padding: '0.75em', borderRadius: 6 }}>
                    {JSON.stringify(m.payload, null, 2)}
                  </pre>
                ) : null}
              </div>
            )}
          </Segment>

          {m.fabric || frame ? (
            <Segment style={{ borderRadius: 10 }}>
              <Header as="h3" style={{ marginTop: 0 }}>{c.frame}</Header>
              {frame && frame.ok ? (
                <p>
                  <Label size="small">{c.frameType}: {frame.summary.typeName}</Label>{' '}
                  <Label size="small" basic>{c.frameBytes(frame.summary.byteLength)}</Label>{' '}
                  <Label size="small" color={frame.signed ? 'green' : 'grey'}>{frame.signed ? c.author : c.unsigned}</Label>
                </p>
              ) : null}
              {frame && !frame.ok ? <Message warning size="small">{c.frameInvalid(frame.error)}</Message> : null}
              {frame && frame.ok && frame.summary.bodyPreview ? (
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em', background: '#f8f8f8', padding: '0.75em', borderRadius: 6 }}>
                  {frame.summary.bodyPreview}
                </pre>
              ) : null}
              {m.fabric ? <Button size="small" basic onClick={() => copy(m.fabric)}>{c.copyFabric}</Button> : null}
            </Segment>
          ) : null}
        </div>
      ) : null}
    </Container>
  );
}

module.exports = FabricMessageRecord;
