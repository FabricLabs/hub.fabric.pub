'use strict';

// Dependencies
const fetch = require('cross-fetch');
const React = require('react');

class ActivityStreamElement extends React.Component {
  constructor (props) {
    super(props);

    this.settings = Object.assign({
      authority: 'https://hub.fabric.pub',
      includeHeader: true,
      activities: []
    }, props);

    this.state = {
      ...this.settings
    };

    return this;
  }

  componentDidMount () {
    console.debug('[FABRIC:STREAM]', 'Stream mounted!');
    if (this.props.fetchResource) this.props.fetchResource('/activities');
    window.addEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
  }

  componentWillUnmount () {
    window.removeEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
  }

  _handleGlobalStateUpdate = (event) => {
    try {
      const globalState = event && event.detail && event.detail.globalState;
      if (!globalState) return;
      const messages = globalState.messages || {};
      const chats = Object.values(messages)
        .filter((m) => m && typeof m === 'object' && m.type === 'P2P_CHAT_MESSAGE')
        .sort((a, b) => {
          const ta = (a.object && a.object.created) || 0;
          const tb = (b.object && b.object.created) || 0;
          return ta - tb;
        })
        .slice(-100);
      this.setState({ chats });
    } catch (e) {
      console.error('[FABRIC:STREAM]', 'Error processing global state update:', e);
    }
  };

  async fetchResource (path) {
    // TODO: use Bridge to send `GET_DOCUMENT` request
    const authority = await fetch(`${this.settings.authority}${path}`);
    console.debug('authority says:', authority);
    // TODO: load other sources (local, etc.)
  }

  render () {
    const { activities = [] } = this.props.api?.resource || {};
    const chats = Array.isArray(this.state.chats) ? this.state.chats : [];
    return (
      <fabric-activity-stream className='activity-stream'>
        {this.props.includeHeader && <h3>Activity Stream</h3>}
        <div>
          {activities.map((activity, index) => {
            return (
              <div key={index}>
                <strong>{activity.actor}</strong> {activity.verb} <strong>{activity.object}</strong>
              </div>
            );
          })}
          {chats.length > 0 && (
            <div style={{ marginTop: '1em' }}>
              <h4>Chat</h4>
              {chats.map((chat, index) => {
                const created = (chat.object && chat.object.created) || Date.now();
                const actor = (chat.actor && (chat.actor.username || chat.actor.id)) || 'unknown';
                const content = (chat.object && (chat.object.content || chat.object.text)) || '';
                return (
                  <div key={`${created}-${index}`} style={{ marginBottom: '0.5em' }}>
                    <strong>@{actor}</strong>: {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </fabric-activity-stream>
    );
  }
}

function ActivityStream (props) {
  return <ActivityStreamElement {...props} />;
}

module.exports = ActivityStream;
