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
  Segment
} = require('semantic-ui-react');

function DocumentDetail (props) {
  const params = useParams();
  const encoded = params && params.id ? params.id : '';
  const id = encoded ? decodeURIComponent(encoded) : '';

  const [doc, setDoc] = React.useState(null);

  React.useEffect(() => {
    if (typeof props.onGetDocument === 'function' && id) props.onGetDocument(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    const handler = (event) => {
      const gs = event && event.detail && event.detail.globalState;
      if (!gs || !gs.documents) return;
      const candidate = gs.documents[id];
      if (candidate) setDoc(candidate);
    };
    window.addEventListener('globalStateUpdate', handler);
    return () => window.removeEventListener('globalStateUpdate', handler);
  }, [id]);

  const name = (doc && doc.name) || id;
  const mime = (doc && doc.mime) || 'application/octet-stream';
  const created = doc && doc.created ? new Date(doc.created).toLocaleString() : '';
  const publishedAt = doc && doc.published ? new Date(doc.published).toLocaleString() : '';

  let downloadHref = null;
  if (doc && doc.contentBase64) {
    downloadHref = `data:${mime};base64,${doc.contentBase64}`;
  }

  // Text preview
  let text = null;
  if (doc && doc.contentBase64) {
    const looksText = (mime && mime.startsWith('text/')) || /\.(md|txt|json|js|ts|html|css|log)$/i.test(name || '');
    if (looksText) {
      try {
        text = atob(doc.contentBase64);
      } catch (e) {}
    }
  }

  return (
    <fabric-document-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/documents" title="Back to documents">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>{name}</span>
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

        {text != null && (
          <Segment style={{ marginTop: '1em' }}>
            <Header as="h3">Contents</Header>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: '0.75em', borderRadius: 6, maxHeight: 520, overflow: 'auto' }}>
              {text}
            </pre>
          </Segment>
        )}

        {!doc && (
          <Segment secondary style={{ marginTop: '1em' }}>
            Loading document…
          </Segment>
        )}
      </Segment>
    </fabric-document-detail>
  );
}

module.exports = DocumentDetail;
