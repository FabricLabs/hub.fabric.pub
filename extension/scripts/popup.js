'use strict';

// Fabric Hub extension popup: same `HubInterface` + Redux as the main site.
// Identity uses the same mechanism as the web app: `localStorage` (`fabric.identity.local`)
// for the encrypted payload and `sessionStorage` (`fabric.identity.unlocked`) for the
// unlocked key in this popup session.

const React = require('react');
const ReactDOM = require('react-dom/client');
const { Provider, connect } = require('react-redux');

const HubInterface = require('../../components/HubInterface');
const store = require('../../stores/redux');
const actions = require('../../actions');

const mapStateToProps = (state) => ({
  bridge: state.bridge,
  contracts: state.contracts,
  documents: state.documents,
  search: state.search
});

const ConnectedUI = connect(mapStateToProps, actions)(HubInterface);
const { logCrashReportHint } = require('../../functions/fabricReportHint');
const { safeIdentityErr } = require('../../functions/fabricSafeLog');

function main () {
  window.addEventListener('error', (event) => {
    const err = event && event.error ? event.error : event;
    console.error('[FABRIC:EXT]', 'window.error:', safeIdentityErr(err));
    if (event && event.error instanceof Error) {
      logCrashReportHint('[FABRIC:EXT]');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason != null ? event.reason : event;
    console.error('[FABRIC:EXT]', 'unhandledrejection:', safeIdentityErr(reason));
    logCrashReportHint('[FABRIC:EXT]');
  });

  const target = document.getElementById('application-target');
  if (!target) {
    console.error('[FABRIC:EXT]', 'Missing #application-target');
    return;
  }
  const root = ReactDOM.createRoot(target);
  root.render(
    <Provider store={store}>
      <ConnectedUI />
    </Provider>
  );
}

main();
