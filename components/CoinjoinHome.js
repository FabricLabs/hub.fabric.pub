'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Input,
  Label,
  Message,
  Segment,
  Table
} = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadJoinmarketPoolSizesBtc,
  saveJoinmarketPoolSizesBtc,
  poolLabels,
  btcToSats
} = require('../functions/joinmarketPoolPreferences');
const {
  bondLockText,
  bondCertificateText,
  offerFeeSats,
  fetchCoinjoinStatus,
  fetchCoinjoinOffers,
  saveMakerTerms,
  fetchCoinjoinRounds,
  startCoinjoinRound,
  fetchFidelityBonds,
  createFidelityBond,
  renewBondCertificate,
  redeemFidelityBond
} = require('../functions/coinjoinClient');
const t = require('../locales/en');

const L = t.payments.coinjoin;

const POLL_MS = 5000;
const TERMINAL = ['broadcast', 'aborted'];

function shortKey (hex) {
  const s = String(hex || '');
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

function sats (n) {
  return n == null ? t.common.none : t.common.sats(n);
}

function errText (err) {
  return err && err.message ? err.message : String(err);
}

/**
 * Coinjoin market: offers from makers on the Fabric network, the Hub's own
 * maker terms, coinjoin rounds, and fidelity bonds. Everything but the offer
 * list needs the Hub admin token.
 */
function CoinjoinHome (props) {
  const token = readHubAdminTokenFromBrowser(props && props.adminToken);
  const [status, setStatus] = React.useState(null);
  const [statusErr, setStatusErr] = React.useState(null);
  const [filterSats, setFilterSats] = React.useState('');
  const [offers, setOffers] = React.useState(null);
  const [rounds, setRounds] = React.useState([]);
  const [bonds, setBonds] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [busy, setBusy] = React.useState('');

  const [terms, setTerms] = React.useState(null);
  const [poolBtc, setPoolBtc] = React.useState(() => loadJoinmarketPoolSizesBtc());
  const [join, setJoin] = React.useState({ amountSats: '', makers: '2', feeRateSatVb: '2', maxFeeSats: '', requireBond: false });
  const [bondForm, setBondForm] = React.useState({ amountSats: '', locktime: '' });

  const loadOffers = React.useCallback(async () => {
    try {
      setOffers(await fetchCoinjoinOffers({ amountSats: Number(filterSats) > 0 ? Number(filterSats) : undefined }));
    } catch (err) {
      setOffers({ offers: [], own: [], error: errText(err) });
    }
  }, [filterSats]);

  const loadAdmin = React.useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetchCoinjoinRounds(token);
      setRounds(r.rounds || []);
    } catch (err) {
      setNotice({ error: true, text: L.roundsFailed(errText(err)) });
    }
    try {
      setBonds(await fetchFidelityBonds(token));
    } catch (err) {
      setBonds({ bonds: [], error: errText(err) });
    }
  }, [token]);

  const refresh = React.useCallback(async () => {
    try {
      const s = await fetchCoinjoinStatus();
      setStatus(s);
      setStatusErr(null);
      setTerms((prev) => prev || (s && s.maker ? {
        enable: s.maker.enabled !== false,
        feeSats: String(s.maker.feeSats),
        feePpm: String(s.maker.feePpm),
        txFeeContributionSats: String(s.maker.txFeeContributionSats)
      } : null));
    } catch (err) {
      setStatusErr(errText(err));
    }
    await loadOffers();
    await loadAdmin();
  }, [loadOffers, loadAdmin]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const anyLive = rounds.some((r) => r.role === 'taker' ? !TERMINAL.includes(r.status) : !['signed', 'aborted'].includes(r.status));
  React.useEffect(() => {
    if (!anyLive) return undefined;
    const timer = setInterval(() => { loadAdmin(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyLive, loadAdmin]);

  async function run (name, fn, done) {
    setBusy(name);
    setNotice(null);
    try {
      const out = await fn();
      if (done) setNotice({ text: done(out) });
      await refresh();
    } catch (err) {
      setNotice({ error: true, text: errText(err) });
    } finally {
      setBusy('');
    }
  }

  const available = !!(status && status.available);
  const amountFilter = Number(filterSats) > 0 ? Number(filterSats) : null;

  return (
    <Segment className="fade-in" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Header as="h2">
        <Icon name="random" />
        <Header.Content>
          {L.title}
        </Header.Content>
      </Header>
      {L.intro.map((line) => <p key={line} style={{ color: '#666' }}>{line}</p>)}

      {statusErr && <Message negative content={L.statusFailed(statusErr)} />}
      {status && !available && (
        <Message warning>
          <Message.Header>{L.unavailableTitle}</Message.Header>
          <p>{status.reason || L.unavailableUnknown}</p>
        </Message>
      )}
      {notice && <Message negative={!!notice.error} positive={!notice.error} content={notice.text} onDismiss={() => setNotice(null)} />}

      <Header as="h3">{L.offersTitle}</Header>
      <Form onSubmit={(e) => { e.preventDefault(); loadOffers(); }}>
        <Form.Group inline>
          <Form.Field>
            <label htmlFor="coinjoin-filter-amount">{L.filterLabel}</label>
            <Input
              id="coinjoin-filter-amount"
              type="number"
              min="0"
              value={filterSats}
              onChange={(e) => setFilterSats(e.target.value)}
            />
          </Form.Field>
          <Button type="submit" basic size="small"><Icon name="filter" />{L.filter}</Button>
          <Button type="button" basic size="small" onClick={() => refresh()}><Icon name="refresh" />{t.common.actions.refresh}</Button>
        </Form.Group>
      </Form>
      {offers && offers.index && (
        <p style={{ color: '#666' }}>
          {L.offersSummary(Number(offers.index.offers) || 0, Number(offers.index.makers) || 0, Number(offers.index.bondedMakers) || 0)}
          {offers.index.amountSats != null && offers.index.cheapestFeeSats != null
            ? ` ${L.offersForAmount(offers.index.amountSats, Number(offers.index.makersForAmount) || 0, offers.index.cheapestFeeSats, offers.index.medianFeeSats)}`
            : ''}
        </p>
      )}
      {offers && offers.error && <Message negative size="small" content={offers.error} />}
      <Table compact celled unstackable>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{L.colMaker}</Table.HeaderCell>
            <Table.HeaderCell>{L.colRange}</Table.HeaderCell>
            <Table.HeaderCell>{L.colFee}</Table.HeaderCell>
            {amountFilter && <Table.HeaderCell>{L.colFeeFor(amountFilter)}</Table.HeaderCell>}
            <Table.HeaderCell>{L.colBondValue}</Table.HeaderCell>
            <Table.HeaderCell>{L.colExpires}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(offers && offers.offers && offers.offers.length) ? offers.offers.map((o) => (
            <Table.Row key={o.id}>
              <Table.Cell><code title={o.makerPubkey}>{shortKey(o.makerPubkey)}</code></Table.Cell>
              <Table.Cell>{Number(o.minSats).toLocaleString()} – {Number(o.maxSats).toLocaleString()}</Table.Cell>
              <Table.Cell>{L.feeTerms(o.feeSats, o.feePpm)}</Table.Cell>
              {amountFilter && <Table.Cell>{sats(o.cjfeeSats != null ? o.cjfeeSats : offerFeeSats(o, amountFilter))}</Table.Cell>}
              <Table.Cell>{o.bondValue ? Number(o.bondValue).toLocaleString() : <span style={{ color: '#999' }}>{L.noBond}</span>}</Table.Cell>
              <Table.Cell>{o.expiresAt ? new Date(o.expiresAt).toLocaleTimeString() : t.common.none}</Table.Cell>
            </Table.Row>
          )) : (
            <Table.Row>
              <Table.Cell colSpan={amountFilter ? 6 : 5} style={{ color: '#888' }}>
                {L.noOffers}
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>

      {!token && (
        <Message info>
          {L.needTokenBefore} <Link to="/settings/admin">{L.needTokenLink}</Link>.
        </Message>
      )}

      {token && (
        <>
          <Header as="h3">{L.makerTitle}</Header>
          <p style={{ color: '#666' }}>
            {L.makerIntro}
          </p>
          {terms && (
            <Form>
              <Form.Field>
                <Checkbox
                  toggle
                  label={L.makerToggle}
                  checked={!!terms.enable}
                  onChange={(e, d) => setTerms({ ...terms, enable: !!d.checked })}
                />
              </Form.Field>
              <Form.Group widths="equal">
                {poolLabels().map((lbl, i) => (
                  <Form.Field key={lbl}>
                    <label htmlFor={`coinjoin-pool-${i}`}>{L.poolLabels[i] || lbl}</label>
                    <Input
                      id={`coinjoin-pool-${i}`}
                      type="number"
                      step="any"
                      min="1e-8"
                      value={poolBtc[i] != null ? String(poolBtc[i]) : ''}
                      onChange={(e) => {
                        const next = [...poolBtc];
                        next[i] = Number(e.target.value);
                        setPoolBtc(next);
                      }}
                    />
                    <span style={{ fontSize: '0.85em', color: '#888' }}>{L.approxSats(btcToSats(poolBtc[i]))}</span>
                  </Form.Field>
                ))}
              </Form.Group>
              <Form.Group widths="equal">
                <Form.Input id="coinjoin-base-fee" label={L.baseFee} type="number" min="0" value={terms.feeSats} onChange={(e) => setTerms({ ...terms, feeSats: e.target.value })} />
                <Form.Input id="coinjoin-fee-ppm" label={L.feePpm} type="number" min="0" value={terms.feePpm} onChange={(e) => setTerms({ ...terms, feePpm: e.target.value })} />
                <Form.Input id="coinjoin-tx-fee" label={L.txFeeContribution} type="number" min="0" value={terms.txFeeContributionSats} onChange={(e) => setTerms({ ...terms, txFeeContributionSats: e.target.value })} />
              </Form.Group>
              <Button
                primary
                type="button"
                disabled={!available}
                loading={busy === 'terms'}
                onClick={() => run('terms', () => {
                  const pools = saveJoinmarketPoolSizesBtc(poolBtc);
                  setPoolBtc(pools);
                  return saveMakerTerms(token, {
                    enable: terms.enable,
                    poolSizesBtc: pools,
                    feeSats: Number(terms.feeSats),
                    feePpm: Number(terms.feePpm),
                    txFeeContributionSats: Number(terms.txFeeContributionSats)
                  });
                }, (out) => {
                  const n = out && out.maker && out.maker.offers ? out.maker.offers.length : 0;
                  return terms.enable ? L.termsSaved(n) : L.makerOff;
                })}
              >
                {L.saveTerms}
              </Button>
            </Form>
          )}
          {status && status.maker && status.maker.offers && status.maker.offers.length > 0 && (
            <Table compact basic="very" style={{ marginTop: '0.75em' }}>
              <Table.Body>
                {status.maker.offers.map((o) => (
                  <Table.Row key={o.id}>
                    <Table.Cell>{L.yourOffer}</Table.Cell>
                    <Table.Cell>{L.offerRange(o.minSats, o.maxSats)}</Table.Cell>
                    <Table.Cell>{L.feeTerms(o.feeSats, o.feePpm)}</Table.Cell>
                    <Table.Cell>{o.fidelityBond ? <Label size="tiny" color="green">{L.bonded}</Label> : <Label size="tiny">{L.notBonded}</Label>}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}

          <Header as="h3">{L.takerTitle}</Header>
          <p style={{ color: '#666' }}>{L.takerIntro}</p>
          <Form>
            <Form.Group widths="equal">
              <Form.Input id="coinjoin-output-size" label={L.outputSize} type="number" min="1" value={join.amountSats} onChange={(e) => setJoin({ ...join, amountSats: e.target.value })} />
              <Form.Input id="coinjoin-maker-count" label={L.makerCount} type="number" min="1" value={join.makers} onChange={(e) => setJoin({ ...join, makers: e.target.value })} />
              <Form.Input id="coinjoin-fee-rate" label={L.feeRate} type="number" min="1" value={join.feeRateSatVb} onChange={(e) => setJoin({ ...join, feeRateSatVb: e.target.value })} />
              <Form.Input id="coinjoin-max-maker-fee" label={L.maxMakerFee} type="number" min="0" placeholder={L.noLimit} value={join.maxFeeSats} onChange={(e) => setJoin({ ...join, maxFeeSats: e.target.value })} />
            </Form.Group>
            <Form.Field>
              <Checkbox id="coinjoin-require-bond" label={L.requireBond} checked={join.requireBond} onChange={(e, d) => setJoin({ ...join, requireBond: !!d.checked })} />
            </Form.Field>
            <Button
              primary
              type="button"
              disabled={!available || !(Number(join.amountSats) > 0)}
              loading={busy === 'join'}
              onClick={() => run('join', () => startCoinjoinRound(token, {
                amountSats: Number(join.amountSats),
                makers: Number(join.makers) || undefined,
                feeRateSatVb: Number(join.feeRateSatVb) || undefined,
                maxFeeSats: join.maxFeeSats !== '' ? Number(join.maxFeeSats) : undefined,
                requireBond: join.requireBond
              }), (out) => L.started(shortKey(out.round && out.round.roundId), out.round && out.round.makers ? out.round.makers.length : 0))}
            >
              {L.start}
            </Button>
          </Form>

          <Header as="h3">{L.roundsTitle}</Header>
          <Table compact celled unstackable>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{L.colRole}</Table.HeaderCell>
                <Table.HeaderCell>{L.colRound}</Table.HeaderCell>
                <Table.HeaderCell>{L.colStatus}</Table.HeaderCell>
                <Table.HeaderCell>{L.colOutputSize}</Table.HeaderCell>
                <Table.HeaderCell>{L.colMakersFees}</Table.HeaderCell>
                <Table.HeaderCell>{L.colTransaction}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rounds.length ? rounds.map((r) => (
                <Table.Row key={`${r.role}-${r.roundId}-${r.fillId || ''}`} negative={r.status === 'aborted'} positive={r.status === 'broadcast'}>
                  <Table.Cell>{L.roles[r.role] || r.role}</Table.Cell>
                  <Table.Cell><code title={r.roundId}>{shortKey(r.roundId)}</code></Table.Cell>
                  <Table.Cell>
                    {r.status}
                    {r.error && <div style={{ color: '#b03', fontSize: '0.85em' }}>{r.error}</div>}
                  </Table.Cell>
                  <Table.Cell>{sats(r.amountSats)}</Table.Cell>
                  <Table.Cell>
                    {r.role === 'taker'
                      ? (r.makers || []).map((m) => (
                        <div key={m.offerId || m.makerPubkey}>
                          <code>{shortKey(m.makerPubkey)}</code> {m.stage}{m.cjfeeSats != null ? ` · ${sats(m.cjfeeSats)}` : ''}
                        </div>
                      ))
                      : L.earns(r.cjfeeSats)}
                  </Table.Cell>
                  <Table.Cell>
                    {r.txid
                      ? <Link to={`/services/bitcoin/transactions/${r.txid}`}><code>{shortKey(r.txid)}</code></Link>
                      : (r.signedTxids && r.signedTxids.length ? L.signed(shortKey(r.signedTxids[r.signedTxids.length - 1])) : t.common.none)}
                  </Table.Cell>
                </Table.Row>
              )) : (
                <Table.Row><Table.Cell colSpan={6} style={{ color: '#888' }}>{L.noRounds}</Table.Cell></Table.Row>
              )}
            </Table.Body>
          </Table>

          <Header as="h3">{L.bondsTitle}</Header>
          <p style={{ color: '#666' }}>
            {L.bondsIntro}
          </p>
          {bonds && bonds.error && <Message negative size="small" content={bonds.error} />}
          {bonds && bonds.available && (
            <Form>
              <Form.Group widths="equal">
                <Form.Input id="coinjoin-bond-amount" label={L.bondAmount} type="number" min="1" value={bondForm.amountSats} onChange={(e) => setBondForm({ ...bondForm, amountSats: e.target.value })} />
                <Form.Field>
                  <label htmlFor="coinjoin-bond-locktime">{L.lockUntil}</label>
                  <select id="coinjoin-bond-locktime" value={bondForm.locktime} onChange={(e) => setBondForm({ ...bondForm, locktime: e.target.value })}>
                    <option value="">{L.chooseHeight}</option>
                    {(bonds.locktimes || []).map((h) => (
                      <option key={h} value={h}>{L.heightOption(h, Number(h) - Number(bonds.tipHeight))}</option>
                    ))}
                  </select>
                </Form.Field>
              </Form.Group>
              <Button
                type="button"
                color="violet"
                disabled={!(Number(bondForm.amountSats) > 0) || !bondForm.locktime}
                loading={busy === 'bond'}
                onClick={() => run('bond', () => createFidelityBond(token, {
                  amountSats: Number(bondForm.amountSats),
                  locktime: Number(bondForm.locktime)
                }), (out) => L.bondFunded(out.bond && out.bond.id))}
              >
                <Icon name="lock" />
                {L.lockBond}
              </Button>
            </Form>
          )}
          <Table compact celled unstackable>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{L.colBond}</Table.HeaderCell>
                <Table.HeaderCell>{L.colAmount}</Table.HeaderCell>
                <Table.HeaderCell>{L.colValue}</Table.HeaderCell>
                <Table.HeaderCell>{L.colStatus}</Table.HeaderCell>
                <Table.HeaderCell>{L.colLock}</Table.HeaderCell>
                <Table.HeaderCell>{L.colCertificate}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {bonds && bonds.bonds && bonds.bonds.length ? bonds.bonds.map((b) => (
                <Table.Row key={b.id}>
                  <Table.Cell>
                    <code title={`${b.txid}:${b.vout}`}>{shortKey(b.txid)}:{b.vout}</code>
                    {bonds.bestBondId === b.id && <Label size="tiny" color="green" style={{ marginLeft: 6 }}>{L.inOffers}</Label>}
                  </Table.Cell>
                  <Table.Cell>{sats(b.valueSats)}</Table.Cell>
                  <Table.Cell>{b.value ? Number(b.value).toLocaleString() : '0'}</Table.Cell>
                  <Table.Cell>{b.status}{b.confirmations ? ` ${L.confirmations(Number(b.confirmations))}` : ''}</Table.Cell>
                  <Table.Cell>{bondLockText(b)}</Table.Cell>
                  <Table.Cell>{bondCertificateText(b)}</Table.Cell>
                  <Table.Cell collapsing>
                    {!['redeemed', 'spent'].includes(b.status) && (
                      <Button
                        size="mini"
                        basic
                        loading={busy === `renew-${b.id}`}
                        onClick={() => run(`renew-${b.id}`, () => renewBondCertificate(token, b.id), () => L.renewed)}
                      >
                        {L.renew}
                      </Button>
                    )}
                    {b.redeemable && (
                      <Button
                        size="mini"
                        color="orange"
                        loading={busy === `redeem-${b.id}`}
                        onClick={() => run(`redeem-${b.id}`, () => redeemFidelityBond(token, b.id), (out) => L.redeemed(out.bond && out.bond.redeemTxid))}
                      >
                        {L.redeem}
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              )) : (
                <Table.Row><Table.Cell colSpan={7} style={{ color: '#888' }}>{L.noBonds}</Table.Cell></Table.Row>
              )}
            </Table.Body>
          </Table>
        </>
      )}
    </Segment>
  );
}

module.exports = CoinjoinHome;
