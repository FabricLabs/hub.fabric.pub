'use strict';

// Dependencies
const fetch = require('cross-fetch');
const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Icon, Label } = require('semantic-ui-react');
const ChatInput = require('./ChatInput');

const MESSAGE_PAGE_SIZE = 10;

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
      entries: [],
      displayLimit: MESSAGE_PAGE_SIZE,
      chatWarning: null
    };

    this._scrollContainerRef = React.createRef();
    this._lastEntryRef = React.createRef();
    this._loadMoreSentinelRef = React.createRef();
    this._intersectionObserver = null;
    this._shouldScrollToBottom = false;
    this._prevEntriesLength = 0;
    this._userHasLoadedMore = false;
    return this;
  }

  _scrollToBottom () {
    const lastEl = this._lastEntryRef.current;
    if (lastEl && typeof lastEl.scrollIntoView === 'function') {
      lastEl.scrollIntoView({ block: 'end', behavior: 'auto' });
      return;
    }
    const el = this._scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
  }

  _isScrolledToBottom () {
    const el = this._scrollContainerRef.current;
    if (!el) return true;
    const threshold = 20;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }

  componentDidMount () {
    console.debug('[FABRIC:STREAM]', 'Stream mounted!');
    if (this.props.fetchResource) this.props.fetchResource('/activities');
    window.addEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
    window.addEventListener('fabric:chatWarning', this._handleChatWarning);
    // Initial load from persisted/restored state (survives refresh)
    const activeBridgeRef = this.props.bridgeRef || this.props.bridge;
    const bridgeInstance = activeBridgeRef && activeBridgeRef.current;
    if (bridgeInstance && typeof bridgeInstance.getGlobalState === 'function') {
      const gs = bridgeInstance.getGlobalState();
      if (gs) this._handleGlobalStateUpdate({ detail: { globalState: gs } });
    }
    this._setupIntersectionObserver();
    this._prevEntriesLength = this.state.entries.length;
  }

  componentDidUpdate (prevProps, prevState) {
    this._observeSentinel();
    const prevLen = this._prevEntriesLength;
    const currLen = this.state.entries.length;
    this._prevEntriesLength = currLen;
    if (this._shouldScrollToBottom || (currLen > 0 && prevLen === 0)) {
      this._shouldScrollToBottom = false;
      this._scrollToBottom();
      requestAnimationFrame(() => this._scrollToBottom());
      setTimeout(() => this._scrollToBottom(), 100);
      setTimeout(() => this._scrollToBottom(), 300);
    }
  }

  componentWillUnmount () {
    window.removeEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
    window.removeEventListener('fabric:chatWarning', this._handleChatWarning);
    if (this._chatWarningTimer) clearTimeout(this._chatWarningTimer);
    if (this._intersectionObserver && this._loadMoreSentinelRef.current) {
      this._intersectionObserver.unobserve(this._loadMoreSentinelRef.current);
    }
    this._intersectionObserver = null;
  }

  _setupIntersectionObserver () {
    if (typeof IntersectionObserver === 'undefined') return;
    const root = this._scrollContainerRef.current;
    if (!root) {
      setTimeout(() => this._setupIntersectionObserver(), 0);
      return;
    }
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        const sentinel = entries[0];
        if (!sentinel || !sentinel.isIntersecting) return;
        this._userHasLoadedMore = true;
        this.setState((prev) => {
          const total = prev.entries.length;
          if (prev.displayLimit >= total) return null;
          return { displayLimit: Math.min(prev.displayLimit + MESSAGE_PAGE_SIZE, total) };
        });
      },
      { root, rootMargin: '0px', threshold: 0 }
    );
    this._observeSentinel();
  }

  _observeSentinel () {
    if (!this._intersectionObserver) return;
    if (this._observedSentinel) {
      try { this._intersectionObserver.unobserve(this._observedSentinel); } catch (_) {}
      this._observedSentinel = null;
    }
    if (this._loadMoreSentinelRef.current) {
      this._observedSentinel = this._loadMoreSentinelRef.current;
      this._intersectionObserver.observe(this._observedSentinel);
    }
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
        });

      this._shouldScrollToBottom = this._isScrolledToBottom();
      this.setState((s) => {
        const isFirstLoad = s.entries.length === 0;
        return {
          entries,
          displayLimit: isFirstLoad ? MESSAGE_PAGE_SIZE : s.displayLimit
        };
      });
    } catch (e) {
      console.error('[FABRIC:STREAM]', 'Error processing global state update:', e);
    }
  };

  _handleChatWarning = (event) => {
    const message = (
      event &&
      event.detail &&
      typeof event.detail.message === 'string' &&
      event.detail.message.trim()
    ) || 'Unlock identity to send chat messages.';

    this.setState({ chatWarning: message });

    if (this._chatWarningTimer) clearTimeout(this._chatWarningTimer);
    this._chatWarningTimer = setTimeout(() => {
      this.setState({ chatWarning: null });
      this._chatWarningTimer = null;
    }, 6000);
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
    const allEntries = Array.isArray(this.state.entries) && this.state.entries.length > 0
      ? this.state.entries
      : apiActivities;
    const total = allEntries.length;
    const effectiveLimit = this._userHasLoadedMore ? this.state.displayLimit : MESSAGE_PAGE_SIZE;
    const displayLimit = Math.min(effectiveLimit, total);
    const entries = allEntries.slice(-displayLimit);
    const hasMore = displayLimit < total;
    const activeBridgeRef = this.props.bridgeRef || this.props.bridge;
    const bridgeInstance = activeBridgeRef && activeBridgeRef.current;
    const meshStatus = bridgeInstance && typeof bridgeInstance.webrtcMeshStatus !== 'undefined'
      ? bridgeInstance.webrtcMeshStatus
      : null;
    const chatDebug = bridgeInstance && typeof bridgeInstance.webrtcChatDebugStatus !== 'undefined'
      ? bridgeInstance.webrtcChatDebugStatus
      : null;
    const lastDeliveredTo = chatDebug && Number.isFinite(chatDebug.lastDeliveredTo)
      ? chatDebug.lastDeliveredTo
      : null;
    const toShortId = (value) => {
      if (typeof value !== 'string' || !value) return '-';
      if (value.length <= 12) return value;
      return `${value.slice(0, 8)}...${value.slice(-4)}`;
    };
    const connectedPeerIds = chatDebug && Array.isArray(chatDebug.connectedPeerIds)
      ? chatDebug.connectedPeerIds
      : [];
    const recipientPeerIds = chatDebug && Array.isArray(chatDebug.lastRecipientPeerIds)
      ? chatDebug.lastRecipientPeerIds
      : [];
    const connectedPeerLabel = connectedPeerIds.length
      ? connectedPeerIds.map(toShortId).join(', ')
      : '-';
    const recipientPeerLabel = recipientPeerIds.length
      ? recipientPeerIds.map(toShortId).join(', ')
      : '-';
    const canSubmitChat = (
      bridgeInstance &&
      typeof bridgeInstance.hasUnlockedIdentity === 'function'
    ) ? bridgeInstance.hasUnlockedIdentity() : true;
    const chatDisabledReason = canSubmitChat ? null : 'Unlock identity to send chat messages.';
    return (
      <fabric-activity-stream className='activity-stream'>
        {this.props.includeHeader && <h3>Activity Stream</h3>}
        <div
          ref={this._scrollContainerRef}
          style={{
            maxHeight: '40vh',
            minHeight: '8em',
            overflowY: 'auto',
            overflowX: 'hidden',
            marginBottom: '0.5em',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {hasMore && (
            <div
              ref={this._loadMoreSentinelRef}
              style={{
                padding: '0.25em 0',
                fontSize: '0.85em',
                color: '#888',
                textAlign: 'center'
              }}
            >
              ↑ Scroll up for older messages ({total - displayLimit} more)
            </div>
          )}
          {entries.length > 0 && (
            <div>
              {entries.map((entry, index) => {
                const isChat = entry.type === 'P2P_CHAT_MESSAGE';
                const created = (entry.object && entry.object.created) || entry.created || null;
                const rawActorId = (entry.actor && (entry.actor.username || entry.actor.id)) || (isChat ? 'unknown' : 'system');
                const actorId = (bridgeInstance && typeof bridgeInstance.getPeerDisplayName === 'function' && entry.actor?.id)
                  ? bridgeInstance.getPeerDisplayName(entry.actor.id)
                  : rawActorId;
                const target = entry.target;
                const targetLabel = typeof target === 'string'
                  ? target
                  : (target && (target.name || target.id)) || null;

                if (isChat) {
                  const content = (entry.object && (entry.object.content || entry.object.text)) || '';
                  const isPending = entry.status === 'pending';
                  const isQueued = entry.status === 'queued';
                  const transport = entry.transport || null;
                  const deliveredTo = entry.delivery && Number.isFinite(entry.delivery.deliveredTo)
                    ? entry.delivery.deliveredTo
                    : null;
                  const fromPeerId = entry.delivery && entry.delivery.fromPeerId
                    ? entry.delivery.fromPeerId
                    : null;
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
                  const isLast = index === entries.length - 1;
                  return (
                    <div
                      key={`${created || 'chat'}-${index}`}
                      ref={isLast ? this._lastEntryRef : null}
                      style={style}
                    >
                      {actorNode}
                      {isPending && ' (sending…)'}
                      {isQueued && ' (!)'}: {content}
                      {transport === 'webrtc' && (
                        <span style={{ marginLeft: '0.5em' }}>
                          <Label size='tiny' basic color='teal' title='Delivered via WebRTC mesh'>
                            <Icon name='exchange' />
                            WebRTC
                          </Label>
                          {deliveredTo != null && (
                            <Label size='tiny' basic color='blue' title='Peers this message was delivered to'>
                              delivered: {deliveredTo}
                            </Label>
                          )}
                          {fromPeerId && (
                            <Label size='tiny' basic color='grey' title='Source mesh peer'>
                              from: {fromPeerId}
                            </Label>
                          )}
                        </span>
                      )}
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

                const isLast = index === entries.length - 1;
                return (
                  <div
                    key={`${created || 'activity'}-${index}`}
                    ref={isLast ? this._lastEntryRef : null}
                    style={{ marginBottom: '0.35em' }}
                  >
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
        </div>
        <div style={{ marginTop: '0.5em' }}>
          {(meshStatus || chatDebug) && (
            <div style={{ marginBottom: '0.5em', color: '#666', fontSize: '0.85em' }}>
              WebRTC Debug: mesh connected {meshStatus && Number.isFinite(meshStatus.connected) ? meshStatus.connected : 0}
              {' '}| self {toShortId(chatDebug && chatDebug.peerId)}
              {' '}| peers [{connectedPeerLabel}]
              {' '}| last deliveredTo {lastDeliveredTo != null ? lastDeliveredTo : '-'}
              {' '}| recipients [{recipientPeerLabel}]
            </div>
          )}
          {this.state.chatWarning && (
            <div style={{ marginBottom: '0.5em' }}>
              <Label basic color='orange'>
                <Icon name='lock' />
                {this.state.chatWarning}
              </Label>
              {typeof this.props.onRequireUnlock === 'function' && (
                <Button
                  size='mini'
                  basic
                  color='orange'
                  style={{ marginLeft: '0.5em' }}
                  onClick={() => this.props.onRequireUnlock()}
                >
                  Unlock
                </Button>
              )}
            </div>
          )}
          {((typeof this.props.onSubmitChat === 'function') || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function')) && (
            <ChatInput
              value={this.state.chatInput}
              onChange={(value) => this.setState({ chatInput: value })}
              onSubmit={(text) => {
                if (!canSubmitChat) {
                  if (typeof this.props.onRequireUnlock === 'function') this.props.onRequireUnlock();
                  this._handleChatWarning({ detail: { message: chatDisabledReason } });
                  return;
                }
                const onSubmit = this.props.onSubmitChat || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function' && this.props.bridge.current.submitChatMessage.bind(this.props.bridge.current));
                if (typeof onSubmit === 'function') {
                  onSubmit(text);
                  this.setState({ chatInput: '' });
                }
              }}
              placeholder="Type a message…"
              title={chatDisabledReason || 'Send chat message'}
              disabled={!canSubmitChat}
            />
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
