// # Browser
// This file runs in the browser, and is responsible for rendering the UI.

// ## Overview
'use strict';

// Dependencies
const React = require('react');
const ReactDOM = require('react-dom/client');
const { Provider, connect } = require('react-redux');

// Fabric Components
// const FabricChatBar = require('@fabric/http/components/FabricChatBar');

// Functions
const toRelativeTime = require('../functions/toRelativeTime');
const { logCrashReportHint } = require('../functions/fabricReportHint');
const { safeIdentityErr } = require('../functions/fabricSafeLog');

// Components (toast styles bundled here — HubInterface is also loaded in Node for SSR/build)
require('react-toastify/dist/ReactToastify.css');
const HubInterface = require('../components/HubInterface');

// Settings
const settings = {
  currency: 'BTC'
};

// Redux
const store = require('../stores/redux');
const actions = require('../actions');

// ## Main Process
async function main (input = {}) {
  console.log('[FABRIC:HUB] main() executing...');

  // Surface errors even if UI catches them.
  window.addEventListener('error', (event) => {
    const err = event && event.error ? event.error : event;
    console.error('[FABRIC:HUB]', 'window.error:', safeIdentityErr(err));
    if (event && event.error instanceof Error) {
      logCrashReportHint('[FABRIC:HUB]');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason != null ? event.reason : event;
    console.error('[FABRIC:HUB]', 'unhandledrejection:', safeIdentityErr(reason));
    logCrashReportHint('[FABRIC:HUB]');
  });

  // ### Custom HTML Elements
  // customElements.define('fabric-chat-bar', FabricChatBar);

  // ### Event Listeners
  window.addEventListener('load', async () => {
    console.debug('[HUB]', 'Window loaded!');
    // TODO: restore fabric-chat-bar
    // TODO: consider localforage
    // TODO: consider schema from Knex / MySQL
    // TODO: consider GraphQL to pass schema
    // const chatbar = document.createElement('fabric-chat-bar');
    // chatbar.style = 'position: absolute; bottom: 1em;';
    // document.body.append(chatbar);
  });

  // ### React Application
  // #### Connect Actions (Redux)
  // TODO: migrate this to `functions/mapStateToProps.js`?
  const mapStateToProps = (state) => {
    return {
      bridge: state.bridge,
      contracts: state.contracts,
      documents: state.documents,
      search: state.search
    }
  };

  console.debug('[HUB]', 'Connecting UI...');
  const connector = connect(mapStateToProps, actions);
  const ConnectedUI = connector(HubInterface);

  // ### DOM Attachment
  // Render
  // TODO: render to `fabric-application-target`?
  const container = document.getElementById('application-target');
  if (!container) {
    console.error('[FABRIC:HUB] Missing #application-target — index.html shell is wrong or not from this hub build.');
    const fallback = document.createElement('div');
    fallback.setAttribute('style', 'padding:1.5rem;font-family:system-ui,sans-serif;max-width:36rem');
    fallback.innerHTML =
      '<h1 style="font-size:1.1rem">Fabric Hub UI did not load</h1>' +
      '<p>The page is missing <code>#application-target</code>. Run <code>npm run build:browser</code> and open the hub URL served from <code>assets/index.html</code> (Electron uses <code>http://127.0.0.1:&lt;port&gt;/</code>).</p>';
    document.body.appendChild(fallback);
    return {};
  }
  const root = ReactDOM.createRoot(container);

  console.debug('[HUB]', 'Rendering UI...');
  root.render(
    <Provider store={store}>
      <ConnectedUI />
    </Provider>
  );

  // Updates (1s) — use textContent for defense in depth (avoids innerHTML XSS)
  setInterval(() => {
    document.querySelectorAll('abbr.relative-time').forEach((el) => {
      el.textContent = toRelativeTime(el.getAttribute('title'));
    });
  }, 1000); // 1 second

  // Return
  return {
    // react: { root }
  }
}

// Run Main Process
main(settings).catch((exception) => {
  console.error('[FABRIC:HUB] Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:HUB] Main Process Output:', output);
});
