'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Label, Table } = require('semantic-ui-react');
const { applicationTimeline, journalRows } = require('../functions/contractJournalView');
const t = require('../locales/en');

const c = t.messages.journal;
const SOURCE_COLOR = { log: 'blue', seal: 'teal', queue: 'orange' };

/**
 * A contract journal: one row per event with its time, a Data toggle, and a
 * Fabric button to the message behind it (disabled when there is none).
 * Pass `application` (`GET /contracts/:id` `application`), `journal` (raw
 * entries), or ready `rows` from {@link module:functions/contractJournalView}.
 * @param {{ application?: Object, journal?: Object[], rows?: Object[], title?: string, help?: string }} props
 */
function ContractJournal (props) {
  const p = props || {};
  const rows = Array.isArray(p.rows)
    ? p.rows
    : (p.application ? applicationTimeline(p.application) : journalRows(p.journal || []));
  const [open, setOpen] = React.useState({});
  const toggle = (key) => setOpen((prev) => Object.assign({}, prev, { [key]: !prev[key] }));

  return (
    <section aria-label={p.title || c.title}>
      <Header as="h3">{p.title || c.title}</Header>
      <p style={{ color: '#666' }}>{p.help || c.help}</p>
      {!rows.length ? <p style={{ color: '#666' }}>{c.none}</p> : (
        <Table basic="very" compact unstackable>
          <Table.Body>
            {rows.map((row) => (
              <React.Fragment key={row.key}>
                <Table.Row>
                  <Table.Cell collapsing>
                    {row.source ? <Label size="tiny" color={SOURCE_COLOR[row.source]}>{c.sources[row.source] || row.source}</Label> : null}
                  </Table.Cell>
                  <Table.Cell>{row.label}</Table.Cell>
                  <Table.Cell collapsing style={{ color: '#666' }}>{row.at ? new Date(row.at).toLocaleString() : '—'}</Table.Cell>
                  <Table.Cell collapsing textAlign="right">
                    <Button type="button" size="mini" basic aria-expanded={!!open[row.key]} onClick={() => toggle(row.key)}>
                      {open[row.key] ? c.hide : c.data}
                    </Button>
                    {row.fabricHref ? (
                      <Button size="mini" basic as={Link} to={row.fabricHref}>{c.fabric}</Button>
                    ) : (
                      <Button size="mini" basic disabled title={c.fabricMissing}>{c.fabric}</Button>
                    )}
                  </Table.Cell>
                </Table.Row>
                {open[row.key] ? (
                  <Table.Row>
                    <Table.Cell colSpan={4}>
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.8em', background: '#f8f8f8', padding: '0.6em', borderRadius: 6, margin: 0 }}>
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    </Table.Cell>
                  </Table.Row>
                ) : null}
              </React.Fragment>
            ))}
          </Table.Body>
        </Table>
      )}
    </section>
  );
}

module.exports = ContractJournal;
