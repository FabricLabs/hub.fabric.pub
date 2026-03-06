'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

const {
  Button,
  Card,
  Divider,
  Header,
  Icon,
  Input,
  Label,
  List,
  Segment
} = require('semantic-ui-react');

function base64FromArrayBuffer (buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex (buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function DocumentsPage (props) {
  const [file, setFile] = React.useState(null);
  const [meta, setMeta] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Pull documents index from hub networkStatus (metadata only), fallback to bridge globalState cache.
  const bridge = props.bridge;
  const current = bridge && bridge.current;
  const networkStatus = current && (current.networkStatus || current.lastNetworkStatus);
  const indexed = networkStatus && networkStatus.documents ? networkStatus.documents : null;

  const [docsState, setDocsState] = React.useState({});

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (gs && gs.documents) setDocsState(gs.documents);
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, []);

  React.useEffect(() => {
    if (typeof props.onListDocuments === 'function') props.onListDocuments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docsIndex = indexed && typeof indexed === 'object' ? Object.values(indexed) : Object.values(docsState || {});
  const docs = docsIndex
    .filter((d) => d && d.id)
    .sort((a, b) => {
      const ta = a.created ? new Date(a.created).getTime() : 0;
      const tb = b.created ? new Date(b.created).getTime() : 0;
      return tb - ta;
    });

  const onPickFile = async (f) => {
    setError(null);
    setFile(f);
    setMeta(null);
    if (!f) return;
    try {
      setBusy(true);
      const buffer = await f.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const contentBase64 = base64FromArrayBuffer(buffer);
      const isText = (f.type && f.type.startsWith('text/')) || /\.(md|txt|json|js|ts|html|css|log)$/i.test(f.name || '');
      const preview = isText ? new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, 64 * 1024)) : null;
      setMeta({
        id: sha256,
        sha256,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        size: f.size,
        contentBase64,
        preview
      });
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    if (!meta || !meta.contentBase64) return;
    setError(null);
    setBusy(true);
    try {
      if (typeof props.onCreateDocument === 'function') {
        await props.onCreateDocument({
          name: meta.name,
          mime: meta.mime,
          size: meta.size,
          sha256: meta.sha256,
          contentBase64: meta.contentBase64
        });
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fabric-documents class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/" title="Back">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>Documents</span>
          <Label size="small" title="Documents in this hub node">{docs.length}</Label>
        </Header>

        <Divider />

        <Segment>
          <Header as="h3">Upload file</Header>
          <p style={{ color: '#666' }}>
            The file is processed locally (hash + optional preview), then sent to the hub node over the websocket.
          </p>
          <Input
            type="file"
            onChange={(e) => onPickFile(e && e.target && e.target.files ? e.target.files[0] : null)}
            disabled={busy}
          />
          {meta && (
            <Card fluid style={{ marginTop: '1em' }}>
              <Card.Content>
                <Card.Header>{meta.name}</Card.Header>
                <Card.Meta>
                  <span>{meta.mime}</span>
                </Card.Meta>
                <Card.Description>
                  <div><strong>Size:</strong> {meta.size} bytes</div>
                  <div><strong>SHA-256:</strong> <code>{meta.sha256}</code></div>
                  {meta.preview != null && (
                    <div style={{ marginTop: '0.75em' }}>
                      <strong>Preview:</strong>
                      <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
                        {meta.preview}
                      </pre>
                    </div>
                  )}
                </Card.Description>
              </Card.Content>
              <Card.Content extra>
                <Button primary onClick={onUpload} disabled={busy}>
                  <Icon name="upload" />
                  Upload to hub
                </Button>
                <Button basic as={Link} to={`/documents/${encodeURIComponent(meta.id)}`} disabled={!meta.id}>
                  <Icon name="eye" />
                  View (after upload)
                </Button>
              </Card.Content>
            </Card>
          )}
          {error && (
            <Segment color="red" inverted style={{ marginTop: '1em' }}>
              <strong>Error:</strong> {error}
            </Segment>
          )}
        </Segment>

        <Segment>
          <Header as="h3">Document index</Header>
          <Button
            size="small"
            icon
            labelPosition="left"
            basic
            onClick={() => typeof props.onListDocuments === 'function' && props.onListDocuments()}
            disabled={busy}
          >
            <Icon name="refresh" />
            Refresh
          </Button>
          <List divided relaxed style={{ marginTop: '1em' }}>
            {docs.map((doc) => (
              <List.Item key={doc.id}>
                <List.Content>
                  <List.Header>
                    <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                  </List.Header>
                  <List.Description style={{ color: '#666' }}>
                    {doc.mime || 'application/octet-stream'} — {doc.size != null ? `${doc.size} bytes` : ''}{doc.created ? ` — ${new Date(doc.created).toLocaleString()}` : ''}
                  </List.Description>
                </List.Content>
              </List.Item>
            ))}
            {docs.length === 0 && (
              <List.Item>
                <List.Content>
                  <List.Description style={{ color: '#666' }}>No documents yet.</List.Description>
                </List.Content>
              </List.Item>
            )}
          </List>
        </Segment>
      </Segment>
    </fabric-documents>
  );
}

module.exports = DocumentsPage;
