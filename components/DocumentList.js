'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

const {
  Button,
  Divider,
  Form,
  Header,
  Icon,
  Input,
  Label,
  List,
  Loader,
  Segment
} = require('semantic-ui-react');

const { sha256: sha256Hash } = require('@noble/hashes/sha256');

function base64FromArrayBuffer (buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sha256Hex (buffer) {
  const bytes = sha256Hash(new Uint8Array(buffer));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function textToBase64 (str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function DocumentsPage (props) {
  const [file, setFile] = React.useState(null);
  const [meta, setMeta] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [createDocName, setCreateDocName] = React.useState('');
  const [createDocContent, setCreateDocContent] = React.useState('');
  const [showCreateDoc, setShowCreateDoc] = React.useState(false);

  // Pull documents index from hub networkStatus (metadata only), fallback to bridge globalState cache.
  const bridgeRef = props.bridgeRef;
  const current = bridgeRef && bridgeRef.current;
  const hasEncryptionKey = !!(current && typeof current.hasDocumentEncryptionKey === 'function' && current.hasDocumentEncryptionKey());
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
    const bridgeInstance = bridgeRef && bridgeRef.current;
    if (bridgeInstance && bridgeInstance.globalState && bridgeInstance.globalState.documents) {
      setDocsState(bridgeInstance.globalState.documents);
    }
  }, [bridgeRef]);

  React.useEffect(() => {
    if (typeof props.onListDocuments === 'function') props.onListDocuments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unified model: all docs in documents store; hub index = published refs
  const allDocs = Object.values(docsState || {}).filter((d) => d && d.id);
  const publishedIds = new Set(indexed && typeof indexed === 'object' ? Object.keys(indexed) : []);
  const localDocs = allDocs.filter((d) => !publishedIds.has(d.id));
  const docsIndex = indexed && typeof indexed === 'object' ? Object.values(indexed) : allDocs;
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
    if (!f || !hasEncryptionKey) return;
    try {
      setBusy(true);
      const buffer = await f.arrayBuffer();
      const sha256 = sha256Hex(buffer);
      const contentBase64 = base64FromArrayBuffer(buffer);
      const meta = {
        id: sha256,
        sha256,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        size: f.size,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      setFile(null);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCreateDocument = () => {
    if (!hasEncryptionKey || !createDocContent.trim()) return;
    setError(null);
    try {
      const text = createDocContent.trim();
      const encoder = new TextEncoder();
      const buffer = encoder.encode(text);
      const sha256 = sha256Hex(buffer);
      const contentBase64 = textToBase64(text);
      const name = (createDocName || 'Untitled').trim() || 'Untitled';
      const meta = {
        id: sha256,
        sha256,
        name,
        mime: 'text/plain',
        size: buffer.length,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      setCreateDocName('');
      setCreateDocContent('');
      setShowCreateDoc(false);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
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

        {hasEncryptionKey && (
          <Segment>
            <Header as="h3">Add content</Header>
            <p style={{ color: '#666' }}>
              Select a file or create a document from text. Publish later to add to the hub.
            </p>
            <Button
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => setShowCreateDoc((v) => !v)}
              style={{ marginBottom: showCreateDoc ? '1em' : 0 }}
            >
              <Icon name={showCreateDoc ? 'minus' : 'plus'} />
              Create Document
            </Button>
            {showCreateDoc && (
              <Form style={{ marginTop: '0.75em', maxWidth: 560 }}>
                <Form.Field>
                  <label>Name</label>
                  <Input
                    placeholder="Document name"
                    value={createDocName}
                    onChange={(e) => setCreateDocName(e.target.value)}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Content</label>
                  <Form.TextArea
                    placeholder="Enter your text here…"
                    value={createDocContent}
                    onChange={(e) => setCreateDocContent(e.target.value)}
                    rows={6}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Field>
                <Button size="small" primary onClick={onCreateDocument} disabled={!createDocContent.trim()}>
                  <Icon name="save" />
                  Create
                </Button>
                <Button size="small" basic onClick={() => { setShowCreateDoc(false); setCreateDocName(''); setCreateDocContent(''); }}>
                  Cancel
                </Button>
              </Form>
            )}
            <div style={{ marginTop: showCreateDoc ? '1em' : 0 }}>
              <label style={{ display: 'block', marginBottom: '0.5em', color: '#666' }}>Or add a file:</label>
                <Input
                type="file"
                onChange={(e) => onPickFile(e && e.target && e.target.files ? e.target.files[0] : null)}
                disabled={busy || !hasEncryptionKey}
              />
            </div>
            {error && (
              <Segment color="red" inverted style={{ marginTop: '1em' }}>
                <strong>Error:</strong> {error}
              </Segment>
            )}
          </Segment>
        )}

        {hasEncryptionKey && localDocs.length > 0 && (
          <Segment>
            <Header as="h3">Your Documents</Header>
            <List divided relaxed style={{ marginTop: '0.5em' }}>
              {localDocs.map((doc) => (
                <List.Item key={doc.id}>
                  <List.Content>
                    <List.Header>
                      <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                      <Label size="mini" color="grey" style={{ marginLeft: '0.5em' }}>local</Label>
                      {doc.contentEncrypted && (
                        <Label size="mini" color="green" style={{ marginLeft: '0.25em' }} title="Encrypted with your key">
                          <Icon name="lock" />
                          Encrypted
                        </Label>
                      )}
                    </List.Header>
                    <List.Description style={{ color: '#666' }}>
                      {doc.mime || 'application/octet-stream'} — {doc.size != null ? `${doc.size} bytes` : ''}
                      {typeof props.onPublishLocalDocument === 'function' && (
                        <Button
                          size="mini"
                          basic
                          compact
                          style={{ marginLeft: '0.5em' }}
                          onClick={() => props.onPublishLocalDocument(doc)}
                          title="Upload to hub and publish to global state"
                        >
                          <Icon name="bullhorn" />
                          Publish
                        </Button>
                      )}
                    </List.Description>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          </Segment>
        )}

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
          {(!indexed && allDocs.length === 0) ? (
            <Segment
              placeholder
              style={{ marginTop: '1em', minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div>
                <Loader active inline="centered" />
                <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                  Loading documents…
                  <Header.Subheader>
                    Fetching document index from hub.
                  </Header.Subheader>
                </Header>
              </div>
            </Segment>
          ) : (
            <List divided relaxed style={{ marginTop: '1em' }}>
              {docs.map((doc) => (
                <List.Item key={doc.id}>
                  <List.Content>
                    <List.Header>
                      <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                      {doc.contentEncrypted && (
                        <Label size="mini" color="green" style={{ marginLeft: '0.5em' }} title="Encrypted">
                          <Icon name="lock" />
                        </Label>
                      )}
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
          )}
        </Segment>
      </Segment>
    </fabric-documents>
  );
}

module.exports = DocumentsPage;
