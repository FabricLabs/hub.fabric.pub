'use strict';

// Dependencies
const React = require('react');
const { Link, useParams } = require('react-router-dom');

const {
  Button,
  Card,
  Divider,
  Header,
  Icon,
  Label,
  Loader,
  Segment
} = require('semantic-ui-react');

function DocumentDetail (props) {
  const params = useParams();
  const encoded = params && params.id ? params.id : '';
  const id = encoded ? decodeURIComponent(encoded) : '';

  const [doc, setDoc] = React.useState(null);
  const [decryptedContent, setDecryptedContent] = React.useState(null);
  const [unlocked, setUnlocked] = React.useState(false);
  const [autoTriedDecrypt, setAutoTriedDecrypt] = React.useState(false);

  React.useEffect(() => {
    if (typeof props.onGetDocument === 'function' && id) props.onGetDocument(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (!gs || !gs.documents) return;
      const candidate = gs.documents[id];
      if (candidate) {
        setDoc(candidate);
        setDecryptedContent(null);
        setUnlocked(false);
      }
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [id]);

  // Decrypt only when user clicks Unlock (for encrypted docs)
  const handleUnlock = React.useCallback(() => {
    if (!doc || decryptedContent !== null) return;
    const raw = doc.contentBase64 || (typeof props.onGetDecryptedContent === 'function' && props.onGetDecryptedContent(id));
    if (raw) setDecryptedContent(raw);
    setUnlocked(true);
  }, [doc, id, decryptedContent, props.onGetDecryptedContent]);

  const isEncrypted = !!(doc && doc.contentEncrypted);
  const name = (doc && doc.name) || id;
  const mime = (doc && doc.mime) || 'application/octet-stream';
  const created = doc && doc.created ? new Date(doc.created).toLocaleString() : '';
  const publishedAt = doc && doc.published ? new Date(doc.published).toLocaleString() : '';

  const contentBase64 = doc && (doc.contentBase64 || decryptedContent);
  let downloadHref = null;
  if (contentBase64) {
    downloadHref = `data:${mime};base64,${contentBase64}`;
  }

  // Basic type helpers
  const looksText = (mime && mime.startsWith('text/')) || /\.(md|txt|json|js|ts|html|css|log)$/i.test(name || '');
  const looksImage = (mime && mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg)$/i.test(name || '');

  // Text preview (only when it looks like text)
  let text = null;
  if (contentBase64 && looksText) {
    try {
      text = atob(contentBase64);
    } catch (e) {}
  }

  // Image preview (data URL)
  const imageSrc = (contentBase64 && looksImage) ? `data:${mime};base64,${contentBase64}` : null;

  // If the application is already unlocked and Bridge can decrypt, try once automatically so
  // the user doesn't have to click "Unlock" again just to view a document.
  React.useEffect(() => {
    if (!doc) return;
    if (!isEncrypted) return;
    if (contentBase64) return; // already have cleartext
    if (decryptedContent !== null) return;
    if (autoTriedDecrypt) return;
    if (typeof props.onGetDecryptedContent !== 'function') return;

    setAutoTriedDecrypt(true);
    try {
      const raw = props.onGetDecryptedContent(id);
      if (raw) {
        setDecryptedContent(raw);
        setUnlocked(true);
      }
    } catch (e) {}
  }, [doc, id, isEncrypted, contentBase64, decryptedContent, autoTriedDecrypt, props.onGetDecryptedContent]);

  return (
    <fabric-document-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/documents" title="Back to documents">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>{name}</span>
          {isEncrypted && (
            <Label size="small" color="green" title="Encrypted with your key">
              <Icon name="lock" />
              Encrypted
            </Label>
          )}
          {doc && doc.published && (
            <Label size="small" color="blue" title={publishedAt ? `Published: ${publishedAt}` : 'Published'}>
              <Icon name="bullhorn" />
              Published
            </Label>
          )}
        </Header>

        <Divider />

        <Card fluid>
          <Card.Content>
            <Card.Header>Document</Card.Header>
            <Card.Meta>{created}</Card.Meta>
            <Card.Description>
              <div><strong>ID:</strong> <code>{id}</code></div>
              <div><strong>MIME:</strong> {mime}</div>
              <div><strong>Size:</strong> {doc && doc.size != null ? `${doc.size} bytes` : ''}</div>
              <div><strong>SHA-256:</strong> <code>{doc && (doc.sha256 || doc.id) ? (doc.sha256 || doc.id) : id}</code></div>
              {isEncrypted && !contentBase64 && (
                <div style={{ marginTop: '0.5em' }}>
                  <Button size="small" onClick={handleUnlock} title="Decrypt and show content">
                    <Icon name="unlock" />
                    Unlock
                  </Button>
                </div>
              )}
            </Card.Description>
          </Card.Content>
          <Card.Content extra>
            <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => typeof props.onGetDocument === 'function' && props.onGetDocument(id)}
              >
                <Icon name="refresh" />
                Refresh
              </Button>
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => typeof props.onPublishDocument === 'function' && props.onPublishDocument(id)}
                disabled={!doc}
                title="Publish this document ID to the hub global store"
              >
                <Icon name="bullhorn" />
                Publish
              </Button>
              {downloadHref && (
                <Button
                  size="small"
                  primary
                  as="a"
                  href={downloadHref}
                  download={name}
                >
                  <Icon name="download" />
                  Download
                </Button>
              )}
            </div>
          </Card.Content>
        </Card>

        {!doc && (
          <Segment
            placeholder
            secondary
            style={{ marginTop: '1em', minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div>
              <Loader active inline="centered" />
              <Header as="h4" style={{ marginTop: '1em', textAlign: 'center' }}>
                Loading document…
                <Header.Subheader>
                  Fetching document details from hub.
                </Header.Subheader>
              </Header>
            </div>
          </Segment>
        )}

        {doc && isEncrypted && !contentBase64 && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <p style={{ color: '#666' }}>Encrypted. Click Unlock above to decrypt and view.</p>
          </Segment>
        )}

        {doc && imageSrc && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Preview</Header>
            <div style={{ textAlign: 'center' }}>
              <img
                src={imageSrc}
                alt={name}
                style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
              />
            </div>
          </Segment>
        )}

        {doc && text != null && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 520, overflow: 'auto' }}>
              {text}
            </pre>
          </Segment>
        )}

        {doc && !imageSrc && text == null && contentBase64 && (
          <Segment secondary style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <p style={{ color: '#666' }}>
              A preview is not available for this file type. Use the Download button above to view it with a native application.
            </p>
          </Segment>
        )}
      </Segment>
    </fabric-document-detail>
  );
}

module.exports = DocumentDetail;
