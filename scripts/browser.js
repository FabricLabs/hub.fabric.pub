if (!window) throw new Error('Not running in browser.  Exiting.');

// Dependencies
import * as React from 'react';
import { createRoot } from 'react-dom/client';

// Components
import Hub from '../components/hub';

// Settings
const settings = {
  currency: 'BTC'
};

// Main Process Definition
async function main (input = {}) {
  const container = document.getElementById('fabric-container');
  const root = createRoot(container);

  root.render(<Hub state={input} />);

  return {
    react: { root }
  }
}

// Run Main Process
main(settings).catch((exception) => {
  console.error('[FABRIC:HUB] Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:HUB] Main Process Output:', output);
});
