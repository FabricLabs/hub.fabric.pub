'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Icon } = require('semantic-ui-react');

/** BIP141 max block weight — used for fill height like mempool.space cubes. */
const MAX_BLOCK_WEIGHT = 4000000;

const TILE_WIDTH = 112;
const TILE_GAP = 12;

function blockPath (hash) {
  const h = String(hash || '').trim();
  if (!h) return null;
  return `/services/bitcoin/blocks/${encodeURIComponent(h)}`;
}

function fmtInt (n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString();
}

function fillRatio (block) {
  const weight = block && block.weight != null ? Number(block.weight) : NaN;
  if (Number.isFinite(weight) && weight >= 0) {
    return Math.max(0.06, Math.min(1, weight / MAX_BLOCK_WEIGHT));
  }
  const size = block && block.size != null ? Number(block.size) : NaN;
  if (Number.isFinite(size) && size >= 0) {
    // Pre-segwit approx: 1 byte ≈ 4 weight units.
    return Math.max(0.06, Math.min(1, (size * 4) / MAX_BLOCK_WEIGHT));
  }
  const txCount = block && block.txCount != null ? Number(block.txCount) : NaN;
  if (Number.isFinite(txCount) && txCount > 0) {
    return Math.max(0.08, Math.min(0.85, 0.08 + Math.log10(txCount + 1) / 4));
  }
  return 0.12;
}

function feeTint (block) {
  const rate = block && block.avgFeeRateSatVb != null ? Number(block.avgFeeRateSatVb) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return { top: '#5dade2', bottom: '#2874a6' };
  if (rate < 2) return { top: '#58d68d', bottom: '#1e8449' };
  if (rate < 10) return { top: '#f4d03f', bottom: '#b7950b' };
  if (rate < 50) return { top: '#e67e22', bottom: '#a04000' };
  return { top: '#ec7063', bottom: '#922b21' };
}

/**
 * Mempool-style horizontal chain scroller for Hub block view.
 * @param {object} props
 * @param {object[]} props.blocks — summaries ascending by height
 * @param {string} [props.selectedHash]
 * @param {number|null} [props.selectedHeight]
 * @param {boolean} [props.loading]
 */
function BitcoinBlockScroller (props) {
  const blocks = Array.isArray(props.blocks) ? props.blocks : [];
  const selectedHash = props.selectedHash != null ? String(props.selectedHash).trim().toLowerCase() : '';
  const selectedHeight = props.selectedHeight != null && Number.isFinite(Number(props.selectedHeight))
    ? Number(props.selectedHeight)
    : null;
  const loading = !!props.loading;
  const trackRef = React.useRef(null);
  const dragRef = React.useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el || !blocks.length) return;
    const idx = blocks.findIndex((b) => {
      const h = b && b.hash ? String(b.hash).trim().toLowerCase() : '';
      if (selectedHash && h === selectedHash) return true;
      if (selectedHeight != null && b && Number(b.height) === selectedHeight) return true;
      return false;
    });
    if (idx < 0) return;
    const tile = el.querySelector(`[data-block-scroller-index="${idx}"]`);
    if (tile && typeof tile.scrollIntoView === 'function') {
      tile.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    } else {
      const left = idx * (TILE_WIDTH + TILE_GAP) - (el.clientWidth - TILE_WIDTH) / 2;
      el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }, [blocks, selectedHash, selectedHeight]);

  const onPointerDown = (e) => {
    const el = trackRef.current;
    if (!el || e.button != null && e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      scrollLeft: el.scrollLeft,
      moved: false
    };
    setDragging(true);
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  };

  const onPointerMove = (e) => {
    const el = trackRef.current;
    const d = dragRef.current;
    if (!el || !d.active) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 4) d.moved = true;
    el.scrollLeft = d.scrollLeft - dx;
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    d.active = false;
    setDragging(false);
    const el = trackRef.current;
    if (el && e && e.pointerId != null) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }
    }
  };

  const onClickCapture = (e) => {
    if (dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.moved = false;
    }
  };

  if (!loading && blocks.length === 0) return null;

  return (
    <div
      className="fabric-bitcoin-block-scroller"
      role="region"
      aria-label="Block chain scroller"
      style={{
        marginTop: '0.85rem',
        marginBottom: '0.25rem',
        userSelect: 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5em',
          marginBottom: '0.45rem',
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontSize: '0.85em', color: '#666', fontWeight: 600 }}>
          <Icon name="exchange" aria-hidden="true" />
          Chain
          {loading ? <span style={{ fontWeight: 400, marginLeft: '0.5em' }}>Loading…</span> : null}
        </span>
        <span style={{ fontSize: '0.8em', color: '#999' }}>
          Drag or scroll · older ← → newer
        </span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: `${TILE_GAP}px`,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '0.35rem 0.25rem 0.85rem',
          cursor: dragging ? 'grabbing' : 'grab',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%)',
          borderRadius: '8px',
          border: '1px solid rgba(0,0,0,0.06)'
        }}
      >
        {blocks.map((block, idx) => {
          const hash = block && block.hash ? String(block.hash).trim() : '';
          const path = blockPath(hash);
          const height = block && block.height != null ? Number(block.height) : null;
          const isSelected = (selectedHash && hash.toLowerCase() === selectedHash)
            || (selectedHeight != null && height === selectedHeight);
          const ratio = fillRatio(block);
          const tint = feeTint(block);
          const txCount = block && block.txCount != null ? Number(block.txCount) : null;
          const feeLabel = block && block.avgFeeRateSatVb != null && Number.isFinite(Number(block.avgFeeRateSatVb))
            ? `~${Number(block.avgFeeRateSatVb)} sat/vB`
            : (block && block.totalFeeSats != null
              ? `${fmtInt(block.totalFeeSats)} sats fees`
              : null);
          const fillH = Math.round(88 * ratio);
          const tileInner = (
            <>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 96,
                  borderRadius: '6px 6px 4px 4px',
                  background: 'linear-gradient(180deg, #d5d8dc 0%, #aeb6bf 100%)',
                  boxShadow: isSelected
                    ? '0 0 0 3px #f39c12, 0 6px 14px rgba(0,0,0,0.18)'
                    : '2px 4px 0 rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                  transform: isSelected ? 'translateY(-2px)' : 'none',
                  transition: 'box-shadow 0.15s ease, transform 0.15s ease'
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: fillH,
                    background: `linear-gradient(180deg, ${tint.top} 0%, ${tint.bottom} 100%)`,
                    opacity: 0.92
                  }}
                />
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.35rem',
                    textAlign: 'center',
                    color: '#1b1b1b',
                    textShadow: '0 1px 0 rgba(255,255,255,0.35)'
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '1.05em', letterSpacing: '-0.02em' }}>
                    {height != null && Number.isFinite(height) ? fmtInt(height) : '—'}
                  </div>
                  <div style={{ fontSize: '0.72em', fontWeight: 600, marginTop: 2, opacity: 0.9 }}>
                    {txCount != null && Number.isFinite(txCount)
                      ? `${fmtInt(txCount)} tx`
                      : '—'}
                  </div>
                  {feeLabel ? (
                    <div style={{ fontSize: '0.65em', marginTop: 2, opacity: 0.85 }}>{feeLabel}</div>
                  ) : null}
                </div>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: '0.68em',
                  color: isSelected ? '#b9770e' : '#888',
                  fontWeight: isSelected ? 700 : 500,
                  fontFamily: 'monospace'
                }}
                title={hash}
              >
                {hash ? `${hash.slice(0, 6)}…` : '—'}
              </div>
            </>
          );

          const commonStyle = {
            flex: `0 0 ${TILE_WIDTH}px`,
            width: TILE_WIDTH,
            textDecoration: 'none',
            color: 'inherit',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            outlineOffset: 4
          };

          if (path && !isSelected) {
            return (
              <Link
                key={hash || `h-${height}-${idx}`}
                to={path}
                data-block-scroller-index={idx}
                title={height != null ? `Block #${height}` : hash}
                aria-label={height != null ? `Block ${height}` : `Block ${hash}`}
                style={commonStyle}
                draggable={false}
              >
                {tileInner}
              </Link>
            );
          }

          return (
            <div
              key={hash || `h-${height}-${idx}`}
              data-block-scroller-index={idx}
              title={height != null ? `Block #${height} (current)` : 'Current block'}
              aria-current={isSelected ? 'page' : undefined}
              style={{ ...commonStyle, cursor: isSelected ? 'default' : 'grab' }}
            >
              {tileInner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

module.exports = BitcoinBlockScroller;
