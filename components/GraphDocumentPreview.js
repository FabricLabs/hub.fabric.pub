'use strict';

const React = require('react');
const { Button } = require('semantic-ui-react');

let GraphvizWasm = null;
try {
  GraphvizWasm = require('graphviz-wasm').default;
} catch (e) {
  GraphvizWasm = null;
}

/**
 * Heuristic: treat document body as Graphviz DOT when MIME/name suggest it or
 * the trimmed source opens with a graph/digraph statement (aligned with
 * Sensemaker `fabric_type === 'Graph'` content shape).
 */
function looksLikeDotSource (text, mime, name) {
  if (text == null || typeof text !== 'string') return false;
  const m = String(mime || '').toLowerCase();
  if (m.includes('graphviz') || m === 'text/dot' || m === 'text/x-dot') return true;
  if (/\.(dot|gv)$/i.test(String(name || ''))) return true;
  const t = text.replace(/^\uFEFF/, '').trimStart();
  return /^(strict\s+)?(graph|digraph)\b/i.test(t);
}

function GraphDocumentPreview (props) {
  const dotSource = props.dotSource;
  const mayRender = !!(props.hasDocumentKey || props.skipIdentityGate === true);
  const [status, setStatus] = React.useState('idle');
  const [error, setError] = React.useState(null);
  const [objectUrl, setObjectUrl] = React.useState(null);
  const [renderNonce, setRenderNonce] = React.useState(0);
  const objectUrlRef = React.useRef(null);

  const revokeCurrentUrl = React.useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setObjectUrl(null);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!dotSource || !mayRender) {
        revokeCurrentUrl();
        setStatus('idle');
        setError(null);
        return;
      }
      if (!GraphvizWasm) {
        revokeCurrentUrl();
        setStatus('error');
        setError('Graph preview needs graphviz-wasm (bundle or install).');
        return;
      }
      setStatus('loading');
      setError(null);
      revokeCurrentUrl();
      try {
        await GraphvizWasm.loadWASM();
        if (cancelled) return;
        const svg = GraphvizWasm.layout(dotSource, 'svg', 'dot');
        if (cancelled) return;
        if (typeof svg !== 'string' || !svg.trim()) {
          setStatus('error');
          setError('Graphviz returned empty output.');
          return;
        }
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const next = URL.createObjectURL(blob);
        objectUrlRef.current = next;
        setObjectUrl(next);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setError((e && e.message) ? String(e.message) : 'Graph layout failed.');
        revokeCurrentUrl();
      }
    };

    run();
    return () => {
      cancelled = true;
      revokeCurrentUrl();
    };
  }, [dotSource, mayRender, revokeCurrentUrl]);

  if (!dotSource || !mayRender) return null;

  if (status === 'loading' || status === 'idle') {
    return (
      <div style={{ padding: '1rem', color: '#666' }} aria-busy="true">
        Rendering graph…
      </div>
    );
  }

  if (status === 'error' && error) {
    return (
      <div
        style={{
          padding: '0.75rem',
          background: '#fff6f6',
          border: '1px solid #ffcdd2',
          borderRadius: 6,
          color: '#9f3a38'
        }}
        role="alert"
      >
        <strong>Graph preview</strong>
        <div style={{ marginTop: '0.35rem', whiteSpace: 'pre-wrap' }}>{error}</div>
        <Button
          type="button"
          size="small"
          basic
          style={{ marginTop: '0.65rem' }}
          onClick={() => setRenderNonce((n) => n + 1)}
        >
          Retry render
        </Button>
      </div>
    );
  }

  if (objectUrl) {
    return (
      <div style={{ overflow: 'auto', maxHeight: 560, textAlign: 'center', background: '#fafafa', borderRadius: 6, padding: '0.5rem' }}>
        <img
          src={objectUrl}
          alt="Graphviz diagram"
          style={{ maxWidth: '100%', height: 'auto', verticalAlign: 'middle' }}
        />
      </div>
    );
  }

  return null;
}

module.exports = GraphDocumentPreview;
module.exports.looksLikeDotSource = looksLikeDotSource;
