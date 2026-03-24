'use strict';

// Dependencies
const React = require('react');
const { isLikelyBip32ExtendedKey } = require('../functions/isLikelyBip32ExtendedKey');
const { Link } = require('react-router-dom');
const { Button, Icon, Label } = require('semantic-ui-react');
const ChatInput = require('./ChatInput');
const { isDelegationSignatureRequestActivity } = require('../functions/messageTypes');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

const MESSAGE_PAGE_SIZE = 10;

/**
 * @param {object} entry
 * @returns {'chat'|'bitcoin'|'documents'|'network'|'signing'|null}
 */
function getActivityEntryCategory (entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type === 'CLIENT_NOTICE') return 'bitcoin';
  if (entry.type === 'P2P_CHAT_MESSAGE') return 'chat';
  if (isDelegationSignatureRequestActivity(entry)) return 'signing';
  if (entry.object && entry.object.type === 'BitcoinBlock') return 'bitcoin';
  if (entry.object && entry.object.type === 'Document') {
    const mime = String(entry.object.mime || '').toLowerCase();
    if (entry.object.bitcoinBlock === true || mime === 'application/x-fabric-bitcoin-block+json') return null;
    return 'documents';
  }
  return 'network';
}

/**
 * @param {object} entry
 * @param {string} filter
 */
function entryMatchesActivityFilter (entry, filter) {
  const f = (filter && String(filter).trim()) || 'all';
  if (f === 'all') return true;
  const cat = getActivityEntryCategory(entry);
  if (cat == null) return false;
  return cat === f;
}

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
    this._userHasScrolledInStream = false;
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
    // Optional: parent may pass fetchResource(path) for non-bridge activity sources.
    if (typeof this.props.fetchResource === 'function') {
      const preset = this.props.streamPreset || 'default';
      const uf = loadHubUiFeatureFlags();
      if (preset !== 'notifications' || uf.activities) {
        this.props.fetchResource('/activities');
      }
    }
    window.addEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
    window.addEventListener('fabric:chatWarning', this._handleChatWarning);
    window.addEventListener('fabric:l1PaymentActivity', this._handleL1PaymentActivity);
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
    if (typeof this._hubUiFlagsUnsub === 'function') {
      this._hubUiFlagsUnsub();
      this._hubUiFlagsUnsub = null;
    }
    window.removeEventListener('globalStateUpdate', this._handleGlobalStateUpdate);
    window.removeEventListener('fabric:chatWarning', this._handleChatWarning);
    window.removeEventListener('fabric:l1PaymentActivity', this._handleL1PaymentActivity);
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
        if (!this._userHasScrolledInStream) return;
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

  _tombstoneDocumentId (entry) {
    if (!entry || !entry.object) return null;
    if (entry.type === 'Add' && entry.object.type === 'Document' && entry.object.id) {
      return String(entry.object.id).trim();
    }
    return null;
  }

  _handlePurgeEntry = (messageKey, documentId) => {
    const mk = typeof messageKey === 'string' ? messageKey.trim() : '';
    const docId = typeof documentId === 'string' ? documentId.trim() : '';
    if (!mk && !docId) return;
    const activeBridgeRef = this.props.bridgeRef || this.props.bridge;
    const bridgeInstance = activeBridgeRef && activeBridgeRef.current;
    if (!bridgeInstance || typeof bridgeInstance.emitTombstone !== 'function') return;
    const token = (this.props && this.props.adminToken) ||
      (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken'));
    bridgeInstance.emitTombstone({
      messageId: mk || undefined,
      documentId: docId || undefined,
      adminToken: token
    });
  };

  _renderPurgeButton (entry) {
    if (entry && entry.object && entry.object.localOnly) return null;
    const adminToken = (this.props && this.props.adminToken) ||
      (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken'));
    if (!adminToken || !entry || !entry.messageKey) return null;
    const docId = this._tombstoneDocumentId(entry);
    const title = docId
      ? 'Remove this activity row and unpublish the document from the hub catalog (requires admin)'
      : 'Purge this entry from the hub activity log (requires admin)';
    return (
      <Button
        type="button"
        basic
        icon
        size="mini"
        compact
        title={title}
        style={{ marginLeft: '0.5em', verticalAlign: 'middle' }}
        onClick={(e) => {
          e.stopPropagation();
          this._handlePurgeEntry(entry.messageKey, docId || undefined);
        }}
      >
        <Icon name="trash" />
      </Button>
    );
  }

  _handleL1PaymentActivity = (event) => {
    try {
      const d = event && event.detail;
      if (!d || !d.txid) return;
      const activeBridgeRef = this.props.bridgeRef || this.props.bridge;
      const bridgeInstance = activeBridgeRef && activeBridgeRef.current;
      if (bridgeInstance && typeof bridgeInstance.applyL1InvoicePaymentActivity === 'function') {
        bridgeInstance.applyL1InvoicePaymentActivity(d);
      }
    } catch (e) {
      console.warn('[FABRIC:STREAM] l1PaymentActivity:', safeIdentityErr(e));
    }
  };

  _handleGlobalStateUpdate = (event) => {
    try {
      const globalState = event && event.detail && event.detail.globalState;
      if (!globalState) return;
      const messages = globalState.messages || {};
      const preset = this.props.streamPreset || 'default';
      const fabricEntries = Object.entries(messages)
        .filter(([, m]) => m && typeof m === 'object')
        .map(([messageKey, m]) => Object.assign({}, m, { messageKey }))
        .filter((m) => {
          if (preset === 'notifications') return isDelegationSignatureRequestActivity(m);
          return !isDelegationSignatureRequestActivity(m);
        })
        .sort((a, b) => {
          const ta = (a.object && a.object.created) || 0;
          const tb = (b.object && b.object.created) || 0;
          return ta - tb; // oldest first
        });

      const docAddLast = new Map();
      for (const m of fabricEntries) {
        if (m && m.type === 'Add' && m.object && m.object.type === 'Document' && m.object.id) {
          docAddLast.set(String(m.object.id), m);
        }
      }
      const fabricDeduped = fabricEntries.filter((m) => {
        if (m && m.type === 'Add' && m.object && m.object.type === 'Document' && m.object.id) {
          const id = String(m.object.id);
          return docAddLast.get(id) === m;
        }
        return true;
      });

      // Tombstones can be replayed or emitted through multiple paths; keep the latest
      // event per target so one purge action does not flood the visible feed.
      const tombstoneLast = new Map();
      for (const m of fabricDeduped) {
        if (!m || m.type !== 'Tombstone' || !m.object || typeof m.object !== 'object') continue;
        const activityId = m.object.activityMessageId != null ? String(m.object.activityMessageId).trim() : '';
        const documentId = m.object.documentId != null ? String(m.object.documentId).trim() : '';
        const key = activityId ? `activity:${activityId}` : (documentId ? `document:${documentId}` : '');
        if (key) tombstoneLast.set(key, m);
      }
      const fabricDedupedFinal = fabricDeduped.filter((m) => {
        if (!m || m.type !== 'Tombstone' || !m.object || typeof m.object !== 'object') return true;
        const activityId = m.object.activityMessageId != null ? String(m.object.activityMessageId).trim() : '';
        const documentId = m.object.documentId != null ? String(m.object.documentId).trim() : '';
        const key = activityId ? `activity:${activityId}` : (documentId ? `document:${documentId}` : '');
        if (!key) return true;
        return tombstoneLast.get(key) === m;
      });

      this._shouldScrollToBottom = this._isScrolledToBottom();
      this.setState((s) => {
        const isFirstLoad = s.entries.length === 0;
        const prevNotices = preset === 'notifications'
          ? []
          : (Array.isArray(s.entries) ? s.entries : []).filter(
            (e) => e && e.type === 'CLIENT_NOTICE'
          );
        const tNotice = (e) => {
          const c = e && e.object && e.object.created;
          return typeof c === 'number' ? c : new Date(c || 0).getTime() || 0;
        };
        const entries = fabricDedupedFinal.concat(prevNotices).sort((a, b) => tNotice(a) - tNotice(b));
        return {
          entries,
          displayLimit: isFirstLoad ? MESSAGE_PAGE_SIZE : s.displayLimit
        };
      });
    } catch (e) {
      console.error('[FABRIC:STREAM]', 'Error processing global state update:', safeIdentityErr(e));
    }
  };

  _handleChatWarning = (event) => {
    const message = (
      event &&
      event.detail &&
      typeof event.detail.message === 'string' &&
      event.detail.message.trim()
    ) || 'Unlock identity to send chat messages. Use Settings → Fabric identity or the top-bar Locked control.';

    this.setState({ chatWarning: message });

    if (this._chatWarningTimer) clearTimeout(this._chatWarningTimer);
    this._chatWarningTimer = setTimeout(() => {
      this.setState({ chatWarning: null });
      this._chatWarningTimer = null;
    }, 6000);
  };

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
    const entryTypeFilter = (this.props.entryTypeFilter && String(this.props.entryTypeFilter).trim()) || 'all';
    const filteredEntries = entryTypeFilter === 'all'
      ? allEntries
      : (Array.isArray(allEntries) ? allEntries.filter((e) => entryMatchesActivityFilter(e, entryTypeFilter)) : []);
    const total = filteredEntries.length;
    const effectiveLimit = this._userHasLoadedMore ? this.state.displayLimit : MESSAGE_PAGE_SIZE;
    const displayLimit = Math.min(effectiveLimit, total);
    const entries = filteredEntries.slice(-displayLimit);
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
    const chatDisabledReason = canSubmitChat
      ? null
      : 'Unlock identity to send chat messages. Use Settings → Fabric identity or the top-bar Locked control.';
    const streamPreset = this.props.streamPreset || 'default';
    const uf = loadHubUiFeatureFlags();
    const peerDetailNav = !!(
      uf.peers &&
      readHubAdminTokenFromBrowser(this.props.adminToken)
    );
    const headerTitle = typeof this.props.headerTitle === 'string' && this.props.headerTitle.trim()
      ? this.props.headerTitle.trim()
      : (streamPreset === 'notifications' ? 'Delegation & signing' : 'Activity Stream');
    const showChatChrome = streamPreset !== 'notifications';
    return (
      <fabric-activity-stream className='activity-stream'>
        {this.props.includeHeader && <h3>{headerTitle}</h3>}
        <div
          ref={this._scrollContainerRef}
          onScroll={() => { this._userHasScrolledInStream = true; }}
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
                if (entry.type === 'CLIENT_NOTICE') {
                  const isLast = index === entries.length - 1;
                  const txid = entry.object && entry.object.txid;
                  return (
                    <div
                      key={`notice-${entry.object && entry.object.created}-${index}`}
                      ref={isLast ? this._lastEntryRef : null}
                      style={{ marginBottom: '0.35em', fontSize: '0.92em', color: '#555' }}
                    >
                      <Icon name="bitcoin" color="orange" />
                      {' '}
                      {entry.object && entry.object.content}
                      {txid && (
                        <>
                          {' '}
                          {uf.bitcoinExplorer ? (
                            <Link
                              to={`/services/bitcoin/transactions/${encodeURIComponent(String(txid).trim())}`}
                              style={{ color: '#2185d0' }}
                            >
                              Transaction
                            </Link>
                          ) : (
                            <code style={{ fontSize: '0.88em', color: '#666' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">
                              {String(txid).slice(0, 16)}…
                            </code>
                          )}
                        </>
                      )}
                      {this._renderPurgeButton(entry)}
                    </div>
                  );
                }
                if (isDelegationSignatureRequestActivity(entry)) {
                  const o = entry.object || {};
                  const content = typeof o.content === 'string' ? o.content : '';
                  const purpose = typeof o.purpose === 'string' ? o.purpose : '';
                  const ost = o.status || entry.status;
                  const isPending = ost === 'pending';
                  const created = o.created || null;
                  const actorId = (entry.actor && (entry.actor.username || entry.actor.id)) || 'local';
                  const isLast = index === entries.length - 1;
                  return (
                    <div
                      key={`delegation-${o.messageId || created || index}`}
                      ref={isLast ? this._lastEntryRef : null}
                      style={{
                        marginBottom: '0.5em',
                        fontSize: '0.95em',
                        opacity: isPending ? 0.85 : 1
                      }}
                    >
                      <Label size="small" color="teal" style={{ marginRight: '0.35em' }}>
                        <Icon name="key" />
                        Signing
                      </Label>
                      <Label size="small" basic title="Same activity stream as public chat; delegation channel">
                        #delegation
                      </Label>
                      {' '}
                      <strong>@{actorId}</strong>
                      {purpose ? <> · {purpose}</> : null}
                      {isPending ? ' — waiting for Fabric Hub desktop…' : null}
                      {!isPending && ost === 'approved' ? ' — approved' : null}
                      {!isPending && ost === 'rejected' ? ' — rejected' : null}
                      {!isPending && ost === 'timeout' ? ' — timed out' : null}
                      <div style={{ marginTop: '0.25em', color: '#444', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content || '(no preview)'}
                      </div>
                    </div>
                  );
                }
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
                  const actorPeerPath = actorId && !isLikelyBip32ExtendedKey(actorId) && uf.peers
                    ? `/peers/${encodeURIComponent(actorId)}`
                    : null;
                  const actorNode = actorId && actorId !== 'unknown'
                    ? (
                        actorPeerPath
                          ? (
                            <Link
                              to={actorPeerPath}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              <strong>@{actorId}</strong>
                            </Link>
                            )
                          : <strong title={!uf.peers ? 'Peers disabled — enable Peers in Admin → Feature visibility' : 'BIP32 extended key — not a TCP peer route'}>@{actorId}</strong>
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
                      {this._renderPurgeButton(entry)}
                    </div>
                  );
                }

                if (entry.object && entry.object.type === 'BitcoinBlock') {
                  const o = entry.object;
                  const hash = String(o.hash || o.id || '').trim();
                  const height = o.height;
                  const txCount = o.txCount;
                  const net = o.network ? String(o.network) : '';
                  const isLast = index === entries.length - 1;
                  const bbCreated = o.created || null;
                  const heightLabel = height != null && Number.isFinite(Number(height)) ? `#${height}` : 'block';
                  const txLabel = txCount != null && Number.isFinite(Number(txCount))
                    ? `${Number(txCount)} tx${Number(txCount) === 1 ? '' : 's'}`
                    : null;
                  return (
                    <div
                      key={`${hash || 'block'}-${bbCreated || index}`}
                      ref={isLast ? this._lastEntryRef : null}
                      style={{ marginBottom: '0.4em', fontSize: '0.95em' }}
                    >
                      <Icon name='cube' color='yellow' title='New chain tip' />
                      {' '}
                      <strong>New block</strong>
                      {' '}
                      {hash
                        ? (
                          uf.bitcoinExplorer ? (
                            <Link
                              to={`/services/bitcoin/blocks/${encodeURIComponent(hash)}`}
                              style={{ color: '#2185d0' }}
                            >
                              {heightLabel}
                            </Link>
                          ) : (
                            <span title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the block viewer">{heightLabel}</span>
                          )
                          )
                        : <span>{heightLabel}</span>}
                      {hash && (
                        <>
                          {' '}
                          <code style={{ fontSize: '0.88em', color: '#555' }} title={hash}>
                            {hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash}
                          </code>
                        </>
                      )}
                      {txLabel ? <> · {txLabel}</> : null}
                      {net ? <span style={{ color: '#888' }}> · {net}</span> : null}
                      {this._renderPurgeButton(entry)}
                    </div>
                  );
                }

                if (entry.object && entry.object.type === 'Document') {
                  const ob = entry.object;
                  const mime = String(ob.mime || '').toLowerCase();
                  if (ob.bitcoinBlock === true || mime === 'application/x-fabric-bitcoin-block+json') {
                    return null;
                  }
                }

                const verb = entry.type || 'Activity';
                const objectType = entry.object && entry.object.type ? entry.object.type : 'Object';
                const objectName = entry.object && (entry.object.name || entry.object.id);
                const objectTypeLabel = String(objectType || 'Object').trim();
                const objectNameLabel = objectName != null && String(objectName).trim()
                  ? String(objectName).trim()
                  : '';
                const objectSummary = objectNameLabel
                  ? `${objectTypeLabel}: ${objectNameLabel}`
                  : objectTypeLabel;

                const objectId = entry.object && entry.object.id;
                let objectHref = null;
                if (objectType === 'Document' && objectId) {
                  objectHref = `/documents/${encodeURIComponent(objectId)}`;
                } else if (objectType === 'StorageContract' && objectId) {
                  objectHref = `/contracts/${encodeURIComponent(objectId)}`;
                }

                let targetHref = null;
                if (typeof target === 'string' && target && !isLikelyBip32ExtendedKey(target)) {
                  if (peerDetailNav) targetHref = `/peers/${encodeURIComponent(target)}`;
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
                          !isLikelyBip32ExtendedKey(actorId) && peerDetailNav
                            ? (
                              <Link
                                to={`/peers/${encodeURIComponent(actorId)}`}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                              >
                                <strong>@{actorId}</strong>
                              </Link>
                              )
                            : <strong title={!peerDetailNav && !isLikelyBip32ExtendedKey(actorId) ? 'Peers detail requires hub admin token in this browser' : 'BIP32 extended key — not a TCP peer route'}>@{actorId}</strong>
                        )
                      : <strong>@{actorId}</strong>}{' '}
                    {verb}{' '}
                    {objectHref
                      ? (
                        <Link
                          to={objectHref}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <strong>{objectSummary}</strong>
                        </Link>
                        )
                      : <strong>{objectSummary}</strong>}
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
                    {this._renderPurgeButton(entry)}
                  </div>
                );
              })}
            </div>
          )}
          {entries.length === 0 && streamPreset === 'notifications' && (
            <div style={{ color: '#888', fontSize: '0.9em', padding: '0.35em 0', lineHeight: 1.45 }}>
              No delegation signature requests in this feed yet.
              {uf.activities ? (
                <>
                  {' '}Wallet, Payjoin, and other short toasts are listed on the{' '}
                  <Link to="/activities">Activities</Link>
                  {' '}page (bell in the top bar).
                </>
              ) : (
                <> Enable “Activities” in Admin → Feature visibility to open the full feed and bell toasts.</>
              )}
              {' '}Open{' '}
              <Link to="/settings/security">Security &amp; delegation</Link>
              {' '}to list or revoke desktop signing sessions.
            </div>
          )}
          {entries.length === 0 && streamPreset !== 'notifications' && (
            <div style={{ color: '#888', fontSize: '0.9em', padding: '0.35em 0' }}>
              {entryTypeFilter === 'all'
                ? 'No activity yet. Chat, document events, and Bitcoin blocks show here when the hub and network are active.'
                : `No ${entryTypeFilter} activity matches this filter yet.`}
            </div>
          )}
        </div>
        <div style={{ marginTop: '0.5em' }}>
          {showChatChrome && (meshStatus || chatDebug) && (
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
          {showChatChrome && ((typeof this.props.onSubmitChat === 'function') || (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function')) && (
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
          {showChatChrome && !canSubmitChat &&
            ((typeof this.props.onSubmitChat === 'function') ||
              (this.props.bridge && this.props.bridge.current && typeof this.props.bridge.current.submitChatMessage === 'function')) && (
            <p style={{ marginTop: '0.35em', marginBottom: 0, fontSize: '0.85em', color: '#666' }}>
              <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> (or the top-bar <strong>Locked</strong> control) unlocks chat signing.
            </p>
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
