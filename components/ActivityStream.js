'use strict';

// Dependencies
const fetch = require('cross-fetch');
const React = require('react');
const { Link } = require('react-router-dom');
const ChatInput = require('./ChatInput');

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
      chatInput: '',
      entries: []
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
      const allMessages = Object.values(messages).filter((m) => m && typeof m === 'object');

      const entries = allMessages
        .sort((a, b) => {
          const ta = (a.object && a.object.created) || 0;
          const tb = (b.object && b.object.created) || 0;
          return ta - tb; // oldest first
        })
        .slice(-200);

      this.setState({ entries });
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
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const text = (this.state.chatInput || '').trim();
    if (!text) return;
    const onSubmit = this.props.onSubmitChat || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function' && this.props.bridge.current.submitChatMessage.bind(this.props.bridge.current));
    if (typeof onSubmit === 'function') {
      onSubmit(text);
      this.setState({ chatInput: '' });
    }
  };

  render () {
    const apiActivities = (this.props.api && this.props.api.resource && this.props.api.resource.activities) || [];
    const entries = Array.isArray(this.state.entries) && this.state.entries.length > 0
      ? this.state.entries
      : apiActivities;
    return (
      <fabric-activity-stream className='activity-stream'>
        {this.props.includeHeader && <h3>Activity Stream</h3>}
        <div>
          {entries.length > 0 && (
            <div style={{ marginBottom: '1em' }}>
              {entries.map((entry, index) => {
                const isChat = entry.type === 'P2P_CHAT_MESSAGE';
                const created = (entry.object && entry.object.created) || entry.created || null;
                const actorId = (entry.actor && (entry.actor.username || entry.actor.id)) || (isChat ? 'unknown' : 'system');
                const target = entry.target;
                const targetLabel = typeof target === 'string'
                  ? target
                  : (target && (target.name || target.id)) || null;

                if (isChat) {
                  const content = (entry.object && (entry.object.content || entry.object.text)) || '';
                  const isPending = entry.status === 'pending';
                  const isQueued = entry.status === 'queued';
                  const style = {
                    marginBottom: '0.5em',
                    opacity: (isPending || isQueued) ? 0.7 : 1,
                    color: isQueued ? '#888' : undefined
                  };
                  const actorNode = actorId && actorId !== 'unknown'
                    ? (
                      <Link
                        to={`/peers/${encodeURIComponent(actorId)}`}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        <strong>@{actorId}</strong>
                      </Link>
                      )
                    : <strong>@{actorId}</strong>;
                  return (
                    <div key={`${created || 'chat'}-${index}`} style={style}>
                      {actorNode}
                      {isPending && ' (sending…)'}
                      {isQueued && ' (!)'}: {content}
                    </div>
                  );
                }

                const verb = entry.type || 'Activity';
                const objectType = entry.object && entry.object.type ? entry.object.type : 'Object';
                const objectName = entry.object && (entry.object.name || entry.object.id);

                const objectId = entry.object && entry.object.id;
                let objectHref = null;
                if (objectType === 'Document' && objectId) {
                  objectHref = `/documents/${encodeURIComponent(objectId)}`;
                } else if (objectType === 'StorageContract' && objectId) {
                  objectHref = `/contracts/${encodeURIComponent(objectId)}`;
                }

                let targetHref = null;
                if (typeof target === 'string' && target) {
                  targetHref = `/peers/${encodeURIComponent(target)}`;
                } else if (target && target.type === 'Collection' && target.name === 'documents') {
                  targetHref = '/documents';
                }

                return (
                  <div key={`${created || 'activity'}-${index}`} style={{ marginBottom: '0.35em' }}>
                    {actorId && actorId !== 'system'
                      ? (
                        <Link
                          to={`/peers/${encodeURIComponent(actorId)}`}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <strong>@{actorId}</strong>
                        </Link>
                        )
                      : <strong>@{actorId}</strong>}{' '}
                    {verb}{' '}
                    {objectHref
                      ? (
                        <Link
                          to={objectHref}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <strong>{objectType}{objectName ? `:${objectName}` : ''}</strong>
                        </Link>
                        )
                      : <strong>{objectType}{objectName ? `:${objectName}` : ''}</strong>}
                    {targetLabel && (
                      <> → {targetHref
                        ? (
                          <Link
                            to={targetHref}
                            style={{ color: 'inherit', textDecoration: 'none' }}
                          >
                            <span>{targetLabel}</span>
                          </Link>
                          )
                        : <span>{targetLabel}</span>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: '1em' }}>
            {((typeof this.props.onSubmitChat === 'function') || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function')) && (
              <ChatInput
                value={this.state.chatInput}
                onChange={(value) => this.setState({ chatInput: value })}
                onSubmit={(text) => {
                  const onSubmit = this.props.onSubmitChat || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function' && this.props.bridge.current.submitChatMessage.bind(this.props.bridge.current));
                  if (typeof onSubmit === 'function') {
                    onSubmit(text);
                    this.setState({ chatInput: '' });
                  }
                }}
                placeholder="Type a message…"
                title="Send chat message"
              />
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
