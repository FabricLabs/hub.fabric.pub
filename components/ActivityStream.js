'use strict';

// Dependencies
const fetch = require('cross-fetch');
const React = require('react');
const { Form, Input } = require('semantic-ui-react');

class ActivityStreamElement extends React.Component {
  constructor (props) {
    super(props);

    this.settings = Object.assign({
      authority: 'https://hub.fabric.pub',
      includeHeader: true,
      activities: []
    }, props);

    this.state = {
      ...this.settings,
      chatInput: ''
    };

    return this;
  }

  componentDidMount () {
    console.debug('[FABRIC:STREAM]', 'Stream mounted!');
    if (this.props.fetchResource) this.props.fetchResource('/activities');
    window.addEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
    // Initial load from persisted/restored state (survives refresh)
    const bridgeInstance = this.props.bridgeRef && this.props.bridgeRef.current;
    if (bridgeInstance && typeof bridgeInstance.getGlobalState === 'function') {
      const gs = bridgeInstance.getGlobalState();
      if (gs) this._handleGlobalStateUpdate({ detail: { globalState: gs } });
    }
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

  _handleChatSubmit = (e) => {
    e.preventDefault();
    const text = (this.state.chatInput || '').trim();
    if (!text) return;
    const onSubmit = this.props.onSubmitChat || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function' && this.props.bridge.current.submitChatMessage.bind(this.props.bridge.current));
    if (typeof onSubmit === 'function') {
      onSubmit(text);
      this.setState({ chatInput: '' });
    }
  };

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
          <div style={{ marginTop: '1em' }}>
            <h4>Chat</h4>
            {chats.length > 0 && (
              <div style={{ marginBottom: '0.75em' }}>
                {chats.map((chat, index) => {
                  const created = (chat.object && chat.object.created) || Date.now();
                  const actor = (chat.actor && (chat.actor.username || chat.actor.id)) || 'unknown';
                  const content = (chat.object && (chat.object.content || chat.object.text)) || '';
                  const isPending = chat.status === 'pending';
                  const isQueued = chat.status === 'queued';
                  const style = {
                    marginBottom: '0.5em',
                    opacity: (isPending || isQueued) ? 0.7 : 1,
                    color: isQueued ? '#888' : undefined
                  };
                  return (
                    <div key={`${created}-${index}`} style={style}>
                      <strong>@{actor}</strong>
                      {isPending && ' (sending…)'}
                      {isQueued && ' (!)'}: {content}
                    </div>
                  );
                })}
              </div>
            )}
            {((typeof this.props.onSubmitChat === 'function') || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function')) && (
              <Form onSubmit={this._handleChatSubmit}>
                <Form.Field>
                  <Input
                    action={{ content: 'Send', type: 'submit' }}
                    placeholder="Type a message…"
                    value={this.state.chatInput}
                    onChange={(e) => this.setState({ chatInput: e.target.value })}
                  />
                </Form.Field>
              </Form>
            )}
          </div>
        </div>
      </fabric-activity-stream>
    );
  }
}

function ActivityStream (props) {
  return <ActivityStreamElement {...props} />;
}

module.exports = ActivityStream;
