'use strict';

// Dependencies
const React = require('react');
const { Link, useNavigate } = require('react-router-dom');

// Semantic UI
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

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const DistributeProposalsList = require('./DistributeProposalsList');

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
  const [recentDocId, setRecentDocId] = React.useState(null);

  const navigate = useNavigate();

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

  // Briefly highlight the most recently added document.
  React.useEffect(() => {
    if (!recentDocId) return;
    const timer = setTimeout(() => setRecentDocId(null), 1500);
    return () => clearTimeout(timer);
  }, [recentDocId]);

  React.useEffect(() => {
    if (typeof props.onListDocuments === 'function') props.onListDocuments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unified model: all docs in documents store; hub index = published refs
  const allDocs = Object.values(docsState || {}).filter((d) => d && d.id);
  const docsById = {};

  // Start with all local documents (private by default).
  for (const d of allDocs) {
    docsById[d.id] = { ...d, isLocal: true };
  }

  // Merge in published index entries and mark them as published.
  // Prefer existing local Actor IDs (opaque ids) that share the same sha256,
  // so the same document doesn't appear twice (once by Actor id, once by sha).
  if (indexed && typeof indexed === 'object') {
    for (const value of Object.values(indexed)) {
      if (!value || !value.id) continue;
      const sha = value.sha256 || value.id;

      let targetId = value.id;

      if (sha) {
        const localMatch = allDocs.find((d) => {
          const dSha = d.sha256 || d.sha || d.id;
          return dSha === sha;
        });
        if (localMatch && localMatch.id) {
          targetId = localMatch.id;
        }
      }

      const existing = docsById[targetId] || {};
      docsById[targetId] = { ...existing, ...value, id: targetId, isPublished: true };
    }
  }

  const docs = Object.values(docsById)
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
      // Wrap file metadata in a Fabric Actor so the public document ID
      // is an opaque Actor id, not the raw sha256 hash.
      const payload = {
        sha256,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        size: f.size
      };
      const actor = new Actor({ content: payload });
      const meta = {
        id: actor.id,
        sha256,
        name: payload.name,
        mime: payload.mime,
        size: payload.size,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      setRecentDocId(meta.id);
      setFile(null);
      // Navigate directly to the new document detail view
      navigate(`/documents/${encodeURIComponent(meta.id)}`);
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
      const payload = {
        sha256,
        name,
        mime: 'text/plain',
        size: buffer.length
      };
      const actor = new Actor({ content: payload });
      const meta = {
        id: actor.id,
        sha256,
        name: payload.name,
        mime: payload.mime,
        size: payload.size,
        contentBase64
      };
      if (typeof props.onAddLocalDocument === 'function') {
        props.onAddLocalDocument(meta);
      }
      setRecentDocId(meta.id);
      setCreateDocName('');
      setCreateDocContent('');
      setShowCreateDoc(false);
      // Navigate directly to the new document detail view
      navigate(`/documents/${encodeURIComponent(meta.id)}`);
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
          <Segment loading={busy}>
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

        <Segment>
          <Header as="h3">
            <Icon name="gift" />
            Offers
          </Header>
          <DistributeProposalsList bridgeRef={props.bridgeRef} embedded />
        </Segment>

        <Segment>
          <Header as="h3">Documents</Header>
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
              {docs.map((doc) => {
                const labels = [];
                if (doc.isPublished) {
                  labels.push(
                    <Label
                      key="published"
                      size="mini"
                      color="blue"
                      style={{ marginLeft: '0.5em' }}
                      title="Published to hub"
                    >
                      <Icon name="bullhorn" />
                      Published
                    </Label>
                  );
                } else if (doc.isLocal) {
                  labels.push(
                    <Label
                      key="local"
                      size="mini"
                      color="grey"
                      style={{ marginLeft: '0.5em' }}
                      title="Private (local to this browser)"
                    >
                      <Icon name="lock" />
                      Private
                    </Label>
                  );
                }

                if (doc.contentEncrypted) {
                  labels.push(
                    <Label
                      key="encrypted"
                      size="mini"
                      color="green"
                      style={{ marginLeft: '0.25em' }}
                      title="Encrypted with your key"
                    >
                      <Icon name="shield" />
                      Encrypted
                    </Label>
                  );
                }

                const isRecent = recentDocId && recentDocId === doc.id;
                const itemStyle = isRecent
                  ? {
                      background: '#f5f8ff',
                      transform: 'scale(1.01)',
                      transition: 'background 0.4s ease, transform 0.2s ease'
                    }
                  : {
                      transition: 'background 0.4s ease, transform 0.2s ease'
                    };

                return (
                  <List.Item key={doc.id} style={itemStyle}>
                    <List.Content>
                      <List.Header>
                        <Link to={`/documents/${encodeURIComponent(doc.id)}`}>{doc.name || doc.id}</Link>
                        {labels}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {doc.mime || 'application/octet-stream'} — {doc.size != null ? `${doc.size} bytes` : ''}
                        {doc.created ? ` — ${new Date(doc.created).toLocaleString()}` : ''}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
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
