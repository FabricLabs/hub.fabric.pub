'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const ActivityStream = require('../components/ActivityStream');

function createMockBridgeRef (globalState = {}) {
  return {
    current: {
      getGlobalState: () => globalState,
      getPeerDisplayName: (id) => id || 'unknown',
      hasUnlockedIdentity: () => true,
      submitChatMessage: () => {},
      webrtcMeshStatus: null,
      webrtcChatDebugStatus: null
    }
  };
}

function renderActivityStream (props = {}) {
  const bridgeRef = props.bridgeRef || createMockBridgeRef();
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      React.createElement(ActivityStream, { ...props, bridgeRef })
    )
  );
}

describe('ActivityStream', function () {
  it('renders without crashing', function () {
    const html = renderActivityStream();
    assert.ok(html.includes('activity-stream') || html.includes('fabric-activity-stream'));
  });

  it('shows Activity stream header when includeHeader is true', function () {
    const html = renderActivityStream({ includeHeader: true });
    assert.ok(html.includes('<h3>Activity stream</h3>'));
  });

  it('hides header when includeHeader is false', function () {
    const html = renderActivityStream({ includeHeader: false });
    assert.ok(!html.includes('<h3>Activity stream</h3>'));
  });

  it('renders scroll container with max-height', function () {
    const html = renderActivityStream();
    assert.ok(html.includes('40vh') || html.includes('maxHeight'));
  });

  it('limits displayed entries to 10 when using api activities fallback', function () {
    const activities = [];
    for (let i = 0; i < 25; i++) {
      activities.push({
        type: 'P2P_CHAT_MESSAGE',
        object: { content: `message ${i}`, created: `2026-01-0${(i % 9) + 1}T00:00:00.000Z` },
        actor: { id: `peer-${i}` }
      });
    }
    const html = renderActivityStream({ api: { resource: { activities } } });
    const messageCount = (html.match(/message \d+/g) || []).length;
    assert.ok(messageCount <= 10, `expected at most 10 messages, got ${messageCount}`);
  });

  it('shows load-more hint when more than 10 entries exist', function () {
    const activities = [];
    for (let i = 0; i < 15; i++) {
      activities.push({
        type: 'P2P_CHAT_MESSAGE',
        object: { content: `msg ${i}`, created: `2026-01-0${(i % 9) + 1}T00:00:00.000Z` },
        actor: { id: `peer-${i}` }
      });
    }
    const html = renderActivityStream({ api: { resource: { activities } } });
    assert.ok(html.includes('Scroll up for 5 older messages'), 'should show load-more hint');
  });

  it('renders chat messages with actor and content', function () {
    const activities = [{
      type: 'P2P_CHAT_MESSAGE',
      object: { content: 'hello world', created: '2026-01-01T00:00:00.000Z' },
      actor: { id: 'peer-a' }
    }];
    const html = renderActivityStream({ api: { resource: { activities } } });
    assert.ok(html.includes('hello world'));
    assert.ok(html.includes('peer-a') || html.includes('@'));
  });

  it('renders activity entries for non-chat types', function () {
    const activities = [{
      type: 'Create',
      object: { type: 'Document', name: 'test.pdf', id: 'doc-1', created: '2026-01-01T00:00:00.000Z' },
      actor: { id: 'peer-a' }
    }];
    const html = renderActivityStream({ api: { resource: { activities } } });
    assert.ok(html.includes('Create') || html.includes('Document'));
    assert.ok(html.includes('test.pdf') || html.includes('doc-1'));
  });

  it('entryTypeFilter chat hides non-chat entries', function () {
    const activities = [
      {
        type: 'P2P_CHAT_MESSAGE',
        object: { content: 'only-chat', created: '2026-01-01T00:00:00.000Z' },
        actor: { id: 'peer-chat' }
      },
      {
        type: 'Create',
        object: { type: 'Document', name: 'hide-me.pdf', id: 'doc-x', created: '2026-01-02T00:00:00.000Z' },
        actor: { id: 'peer-doc' }
      }
    ];
    const html = renderActivityStream({
      api: { resource: { activities } },
      entryTypeFilter: 'chat'
    });
    assert.ok(html.includes('only-chat'));
    assert.ok(html.includes('peer-chat') || html.includes('@'));
    assert.ok(!html.includes('hide-me.pdf'));
  });

  it('gives the chat field a label that matches its accessible name', function () {
    const html = renderActivityStream();
    assert.ok(html.includes('<label for="fabric-chat-compose-input"'), 'visually hidden label points at the input');
    assert.ok(/<input[^>]*id="fabric-chat-compose-input"[^>]*aria-label="Message"/.test(html) ||
      /<input[^>]*aria-label="Message"[^>]*id="fabric-chat-compose-input"/.test(html), 'input carries a matching aria-label');
  });

  function lockedBridge () {
    const ref = createMockBridgeRef();
    ref.current.hasUnlockedIdentity = () => false;
    return ref;
  }

  it('tells a password-locked identity to unlock', function () {
    const html = renderActivityStream({ bridgeRef: lockedBridge(), identity: { id: 'abc', passwordProtected: true } });
    assert.ok(html.includes('Your identity is locked. Unlock it with your password to chat.'));
  });

  it('tells a watch-only identity to import the full key, not to unlock', function () {
    const html = renderActivityStream({ bridgeRef: lockedBridge(), identity: { xpub: 'xpub-test' } });
    assert.ok(html.includes('Watch-only identities cannot chat.'));
    assert.ok(!html.includes('Unlock it with your password'));
  });

  it('tells a visitor with no identity to log in', function () {
    const html = renderActivityStream({ bridgeRef: lockedBridge() });
    assert.ok(html.includes('Log in with a Fabric identity to chat.'));
  });
});
