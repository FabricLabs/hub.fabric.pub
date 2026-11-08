'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Card, Header, Icon, Progress, Segment } = require('semantic-ui-react');
const t = require('../locales/en');

const c = t.bitcoin.scroller;

/** BIP141 max block weight — how full a block is. */
const MAX_BLOCK_WEIGHT = 4000000;

function blockPath (hash) {
  const h = String(hash || '').trim();
  if (!h) return null;
  return `/services/bitcoin/blocks/${encodeURIComponent(h)}`;
}

function fmtInt (n) {
  if (n == null || n === '') return t.common.none;
  const x = Number(n);
  if (!Number.isFinite(x)) return t.common.none;
  return x.toLocaleString();
}

/**
 * Percent of the block weight limit used, or null when the block reports neither weight nor size.
 * @param {object} block
 * @returns {number|null}
 */
function fullnessPercent (block) {
  const weight = block && block.weight != null ? Number(block.weight) : NaN;
  const size = block && block.size != null ? Number(block.size) : NaN;
  let units = null;
  if (Number.isFinite(weight) && weight >= 0) units = weight;
  // Pre-segwit approx: 1 byte ≈ 4 weight units.
  else if (Number.isFinite(size) && size >= 0) units = size * 4;
  if (units == null) return null;
  return Math.max(0, Math.min(100, Math.round((units / MAX_BLOCK_WEIGHT) * 100)));
}

/**
 * Semantic UI color for a block's average fee rate.
 * @param {object} block
 * @returns {string|undefined}
 */
function feeColor (block) {
  const rate = block && block.avgFeeRateSatVb != null ? Number(block.avgFeeRateSatVb) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  if (rate < 2) return 'green';
  if (rate < 10) return 'yellow';
  if (rate < 50) return 'orange';
  return 'red';
}

/**
 * Horizontal chain scroller for Hub block view.
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
    <Segment
      secondary
      loading={loading}
      className="fabric-bitcoin-block-scroller"
      role="region"
      aria-label={c.title}
    >
      <Header as="h4">
        <Icon name="cubes" aria-hidden="true" />
        <Header.Content>
          {c.title}
          <Header.Subheader>{loading ? c.loading : c.hint}</Header.Subheader>
        </Header.Content>
      </Header>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        style={{ overflowX: 'auto', userSelect: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <Card.Group itemsPerRow={8} doubling style={{ flexWrap: 'nowrap' }}>
          {blocks.map((block, idx) => {
            const hash = block && block.hash ? String(block.hash).trim() : '';
            const path = blockPath(hash);
            const height = block && block.height != null ? Number(block.height) : null;
            const isSelected = (selectedHash && hash.toLowerCase() === selectedHash)
              || (selectedHeight != null && height === selectedHeight);
            const fullness = fullnessPercent(block);
            const txCount = block && block.txCount != null ? Number(block.txCount) : null;
            const feeLabel = block && block.avgFeeRateSatVb != null && Number.isFinite(Number(block.avgFeeRateSatVb))
              ? c.feeRate(Number(block.avgFeeRateSatVb))
              : (block && block.totalFeeSats != null
                ? c.fees(fmtInt(block.totalFeeSats))
                : null);
            const linked = !!path && !isSelected;
            const linkProps = linked ? { as: Link, to: path, link: true, draggable: false } : {};

            return (
              <Card
                key={hash || `h-${height}-${idx}`}
                {...linkProps}
                data-block-scroller-index={idx}
                title={isSelected
                  ? (height != null ? c.currentTitle(height) : c.current)
                  : (height != null ? c.blockTitle(height) : hash)}
                aria-current={isSelected ? 'page' : undefined}
                color={isSelected ? 'blue' : undefined}
                raised={isSelected}
                style={{ flexShrink: 0 }}
              >
                <Card.Content>
                  <Card.Header>
                    {height != null && Number.isFinite(height) ? `#${fmtInt(height)}` : t.common.none}
                  </Card.Header>
                  <Card.Meta title={hash}>
                    <code>{hash ? `${hash.slice(0, 6)}…` : t.common.none}</code>
                  </Card.Meta>
                  <Card.Description>
                    {txCount != null && Number.isFinite(txCount)
                      ? c.txCount(fmtInt(txCount))
                      : t.common.none}
                  </Card.Description>
                </Card.Content>
                {feeLabel ? <Card.Content extra>{feeLabel}</Card.Content> : null}
                {fullness != null ? (
                  <Progress
                    attached="bottom"
                    percent={fullness}
                    color={feeColor(block)}
                    title={c.full(fullness)}
                  />
                ) : null}
              </Card>
            );
          })}
        </Card.Group>
      </div>
    </Segment>
  );
}

module.exports = BitcoinBlockScroller;
