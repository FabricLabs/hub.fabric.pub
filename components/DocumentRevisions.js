'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Form,
  Header,
  Icon,
  Label,
  List,
  Message,
  Modal,
  Segment
} = require('semantic-ui-react');
const { createDocumentContractsClient, versionStatus } = require('../functions/documentContractsClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const rv = t.documents.revisions;

function shortHex (value) {
  const s = String(value || '');
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

function isTextMime (mime) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('text/') || /json|xml|javascript|markdown|yaml|csv/.test(m);
}

function decodeText (base64) {
  try {
    const bin = atob(String(base64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (_) {
    return '';
  }
}

function fileToBase64 (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function downloadJson (name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function VersionRow ({ rev, currentId, latestFrameId, isFork }) {
  const here = rev.documentIdentifier === currentId;
  return (
    <List.Item>
      <List.Content>
        <List.Header>
          {here
            ? <strong>{rv.revision(rev.revision)}</strong>
            : <Link to={`/documents/${encodeURIComponent(rev.documentIdentifier)}`}>{rv.revision(rev.revision)}</Link>}
          {' '}
          {rev.frameId === latestFrameId && <Label size='mini' color='green'>{rv.current}</Label>}
          {here && <Label size='mini' color='blue'>{rv.youAreHere}</Label>}
          {isFork && <Label size='mini'>{rv.fork}</Label>}
        </List.Header>
        <List.Description>
          {rev.name} · <code>{shortHex(rev.documentIdentifier)}</code>
          {rev.editedAt && <> · {new Date(rev.editedAt).toLocaleString()}</>}
          {' · '}
          {rev.held === false
            ? rv.notHeld
            : (rev.purchasePriceSats ? rv.price(rev.purchasePriceSats) : rv.free)}
          {rev.offers > 0 && <> · {rv.offers(rev.offers)}</>}
          {rev.note && <div style={{ marginTop: '0.2em' }}><em>{rv.note(rev.note)}</em></div>}
        </List.Description>
      </List.Content>
    </List.Item>
  );
}

/**
 * Versions of a document: make it editable, edit it, browse its history,
 * and download a version's signed provenance.
 * @param {Object} props
 * @param {string} props.documentId
 * @param {Object} [props.doc] Loaded document (name, mime, contentBase64).
 * @param {string} [props.adminToken]
 * @param {Function} [props.onChanged] `(documentId) => void` after a new version is saved.
 * @param {Function} [props.onNavigate] `(path) => void`
 */
function DocumentRevisions (props) {
  const documentId = String(props.documentId || '').toLowerCase();
  const client = React.useMemo(() => createDocumentContractsClient(), []);
  const [history, setHistory] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState({ content: '', name: '', note: '', contentBase64: null, fileName: '' });

  const adminToken = String(readHubAdminTokenFromBrowser(props.adminToken) || '').trim();
  const doc = props.doc || null;

  const load = React.useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    try {
      setHistory(await client.revisions(documentId));
      setError(null);
    } catch (err) {
      setHistory(null);
      if (err && err.status !== 404) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [client, documentId]);

  React.useEffect(() => { load(); }, [load]);

  const status = versionStatus(history, documentId);
  const latestFrameId = history && history.head ? history.head.frameId : null;

  const makeEditable = async () => {
    setBusy(true);
    try {
      await client.makeEditable(documentId, { adminToken });
      await load();
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openEditor = () => {
    const text = doc && doc.contentBase64 && isTextMime(doc.mime) ? decodeText(doc.contentBase64) : '';
    setDraft({ content: text, name: (doc && doc.name) || '', note: '', contentBase64: null, fileName: '' });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const change = { name: draft.name || undefined, note: draft.note || undefined, adminToken: adminToken || undefined };
      if (draft.contentBase64) change.contentBase64 = draft.contentBase64;
      else change.content = draft.content;
      const result = await client.edit(documentId, change);
      setEditing(false);
      const nextId = result && result.document && result.document.id;
      if (typeof props.onChanged === 'function' && nextId) props.onChanged(nextId);
      if (nextId && typeof props.onNavigate === 'function') props.onNavigate(`/documents/${encodeURIComponent(nextId)}`);
      else await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadProvenance = async () => {
    try {
      const provenance = await client.provenance(documentId);
      downloadJson(`${documentId.slice(0, 12)}-provenance.json`, provenance);
    } catch (err) {
      setError(err.message);
    }
  };

  const textEditable = !doc || isTextMime(doc.mime);
  const sealedWithoutContent = !!(doc && !doc.contentBase64);

  return (
    <Segment id='document-versions'>
      <Header as='h3'>
        <Icon name='history' />
        <Header.Content>
          {rv.title}
          {status.editable && history && (
            <Header.Subheader>
              {rv.contract}{' '}
              <Link to={`/contracts/${encodeURIComponent(history.contractId)}`}><code>{shortHex(history.contractId)}</code></Link>
            </Header.Subheader>
          )}
        </Header.Content>
      </Header>

      {error && <Message negative size='small' content={rv.failed(error)} onDismiss={() => setError(null)} />}
      {loading && !history && <p>{rv.loading}</p>}

      {status.newer && (
        <Message warning size='small'>
          <p>{rv.newer(status.newer.revision)}</p>
          <Button
            size='small'
            as={Link}
            to={`/documents/${encodeURIComponent(status.newer.documentIdentifier)}`}
            content={rv.openNewer}
          />
        </Message>
      )}

      {history && !status.editable && !(doc && doc.local === false) && (
        <>
          <p>{rv.notEditable}</p>
          {adminToken
            ? <Button primary size='small' loading={busy} disabled={busy} onClick={makeEditable} content={busy ? rv.makingEditable : rv.makeEditable} />
            : <p><em>{rv.adminOnly}</em></p>}
        </>
      )}

      {status.editable && history && (
        <>
          <List divided relaxed>
            {history.revisions.slice().reverse().map((rev) => (
              <VersionRow key={rev.frameId} rev={rev} currentId={documentId} latestFrameId={latestFrameId} />
            ))}
          </List>
          {Array.isArray(history.forks) && history.forks.length > 0 && (
            <>
              <Header as='h4'>{rv.forksTitle}</Header>
              <List divided relaxed>
                {history.forks.map((rev) => (
                  <VersionRow key={rev.frameId} rev={rev} currentId={documentId} latestFrameId={latestFrameId} isFork />
                ))}
              </List>
            </>
          )}
          <Button.Group size='small'>
            {history.editable && adminToken && (
              <Button primary icon='edit' content={rv.edit} onClick={openEditor} disabled={busy} />
            )}
            <Button icon='download' content={rv.provenance} title={rv.provenanceHint} onClick={downloadProvenance} />
          </Button.Group>
          {history.editable && !adminToken && <p style={{ marginTop: '0.5em' }}><em>{rv.adminOnly}</em></p>}
        </>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} size='large'>
        <Modal.Header>{rv.editTitle((doc && doc.name) || documentId.slice(0, 12))}</Modal.Header>
        <Modal.Content>
          <p>{status.latest ? rv.editHint : rv.editForkHint}</p>
          <Form>
            <Form.Input
              label={rv.nameLabel}
              value={draft.name}
              onChange={(e, { value }) => setDraft((d) => ({ ...d, name: value }))}
            />
            {textEditable && !sealedWithoutContent
              ? (
                <Form.TextArea
                  label={rv.contentLabel}
                  rows={16}
                  value={draft.content}
                  style={{ fontFamily: 'monospace' }}
                  onChange={(e, { value }) => setDraft((d) => ({ ...d, content: value }))}
                />
                )
              : (
                <Form.Field>
                  <label>{rv.contentLabel}</label>
                  <p>{rv.binaryHint}</p>
                  <input
                    type='file'
                    aria-label={rv.chooseFile}
                    onChange={async (e) => {
                      const file = e.target.files && e.target.files[0];
                      if (!file) return;
                      const contentBase64 = await fileToBase64(file);
                      setDraft((d) => ({ ...d, contentBase64, fileName: file.name }));
                    }}
                  />
                </Form.Field>
                )}
            <Form.Input
              label={rv.noteLabel}
              value={draft.note}
              maxLength={1024}
              onChange={(e, { value }) => setDraft((d) => ({ ...d, note: value }))}
            />
          </Form>
        </Modal.Content>
        <Modal.Actions>
          <Button onClick={() => setEditing(false)} content={rv.cancel} disabled={busy} />
          <Button
            primary
            loading={busy}
            disabled={busy || ((!textEditable || sealedWithoutContent) && !draft.contentBase64)}
            onClick={save}
            content={busy ? rv.saving : rv.save}
          />
        </Modal.Actions>
      </Modal>
    </Segment>
  );
}

module.exports = DocumentRevisions;
