'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Segment,
  Icon
} = require('semantic-ui-react');

class BottomPanel extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      now: new Date()
    };

    this._timer = null;

    return this;
  }

  componentDidMount () {
    this._timer = setInterval(() => {
      this.setState({ now: new Date() });
    }, 1000);
  }

  componentWillUnmount () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  render () {
    const { now } = this.state;
    const timeText = now.toLocaleTimeString();
    const iso = now.toISOString();

    const formatPubkey = (value) => {
      if (!value) return '';
      const s = String(value);
      if (s.length <= 24) return s;
      const head = s.slice(0, 12);
      const tail = s.slice(-12);
      return `${head}…${tail}`;
    };

    const rawPubkey = this.props.pubkey;
    const pubkeyText = formatPubkey(rawPubkey);

    return (
      <Segment
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75em',
          flexWrap: 'wrap',
          marginTop: '1em',
          borderTop: '1px solid rgba(0,0,0,0.05)'
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0, color: '#666' }}>
          {pubkeyText ? (
            <span title={rawPubkey}>
              <Link
                to={`/peers/${encodeURIComponent(rawPubkey)}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <code>{pubkeyText}</code>
              </Link>
            </span>
          ) : (
            <code>hub.fabric.pub</code>
          )}
        </div>
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35em',
            color: '#999'
          }}
        >
          <Icon name="clock outline" size="small" />
          <abbr
            className="timestamp"
            title={iso}
            style={{ textDecoration: 'none', cursor: 'default' }}
          >
            {timeText}
          </abbr>
        </div>
      </Segment>
    );
  }
}

module.exports = BottomPanel;
