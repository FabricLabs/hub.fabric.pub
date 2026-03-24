'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  Segment,
  Icon
} = require('semantic-ui-react');

class BottomPanel extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      now: new Date(),
      hubUiTick: 0
    };

    this._timer = null;
    this._hubUiUnsub = null;

    return this;
  }

  componentDidMount () {
    this._timer = setInterval(() => {
      this.setState({ now: new Date() });
    }, 1000);
    this._hubUiUnsub = subscribeHubUiFeatureFlags(() => {
      this.setState((s) => ({ hubUiTick: (s.hubUiTick || 0) + 1 }));
    });
  }

  componentWillUnmount () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (typeof this._hubUiUnsub === 'function') {
      this._hubUiUnsub();
      this._hubUiUnsub = null;
    }
  }

  render () {
    const { now, hubUiTick } = this.state;
    void hubUiTick;
    const uf = loadHubUiFeatureFlags();
    const peerFooterLink = !!(
      uf.peers &&
      readHubAdminTokenFromBrowser(this.props && this.props.adminToken)
    );
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
        role="contentinfo"
        aria-label="Hub status footer"
        style={{
          flexShrink: 0,
          marginTop: '1em',
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0,
          zIndex: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75em',
          flexWrap: 'wrap',
          borderTop: '1px solid rgba(0, 0, 0, 0.08)',
          background: 'rgba(255, 255, 255, 0.97)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.06)',
          paddingTop: '0.65em',
          paddingBottom: 'max(0.65em, env(safe-area-inset-bottom, 0px))',
          paddingLeft: 'max(1em, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(1em, env(safe-area-inset-right, 0px))'
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0, color: '#666' }}>
          {pubkeyText ? (
            <span title={rawPubkey}>
              {peerFooterLink ? (
                <Link
                  to={`/peers/${encodeURIComponent(rawPubkey)}`}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <code>{pubkeyText}</code>
                </Link>
              ) : (
                <code title="Peers detail requires hub admin token in this browser (paste under Admin)">
                  {pubkeyText}
                </code>
              )}
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
