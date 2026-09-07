'use strict';

/**
 * Ordered Hub UI screenshot manifest for `scripts/capture-user-flows.js`.
 * Tiers: `ui` (always) | `l1` (HUB_SCREENSHOTS_L1=1).
 */

/** @typedef {'ui'|'l1'} ShotTier */
/** @typedef {'document-exchange'|'p2p'|'features'} ShotFlow */

/**
 * @typedef {Object} ShotDef
 * @property {string} id Stable filename stem (no extension)
 * @property {ShotFlow} flow
 * @property {ShotTier} tier
 * @property {string} title Gallery heading
 * @property {string} description One-line caption
 * @property {string} [path] Initial route (before action)
 * @property {string} [waitTestId] data-testid to wait for
 * @property {string} [waitText] Body text to wait for
 * @property {boolean} [fullPage] Default true for list pages
 * @property {string} action Key handled by the capture script
 */

/** @type {ShotDef[]} */
const SHOTS = [
  // —— Document Exchange ——
  {
    id: '01-documents-empty',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Documents list',
    description: 'Hub document catalog before creating a file.',
    path: '/documents',
    waitTestId: 'hub-nav-documents',
    waitText: 'Documents',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '02-document-create',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Create document',
    description: 'Create Document form for a named text blob.',
    path: '/documents',
    waitText: 'Create Document',
    fullPage: false,
    action: 'document-create-form'
  },
  {
    id: '03-document-published',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Published document row',
    description: 'List row after CreateDocument + PublishDocument (priced).',
    path: '/documents',
    waitText: 'Published',
    fullPage: true,
    action: 'document-published-list'
  },
  {
    id: '04-document-view',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Document detail',
    description: 'Document view with publish / claim chrome.',
    path: '/documents',
    waitText: 'Document',
    fullPage: true,
    action: 'document-view'
  },
  {
    id: '05-market-strip',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Document market strip',
    description: 'Inventory / market hints on the Documents page when present.',
    path: '/documents',
    waitText: 'Documents',
    fullPage: true,
    action: 'document-market'
  },
  {
    id: '06-peer-inventory',
    flow: 'document-exchange',
    tier: 'ui',
    title: 'Peer inventory panel',
    description: 'Peer detail inventory section (HTLC panel when quotes exist).',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: true,
    action: 'peer-inventory'
  },
  {
    id: '07-htlc-fund',
    flow: 'document-exchange',
    tier: 'l1',
    title: 'Inventory HTLC fund',
    description: 'P2TR HTLC quote with BIP21 URI / Pay Now (L1).',
    path: '/peers',
    waitTestId: 'peer-inventory-htlc',
    fullPage: false,
    action: 'htlc-fund'
  },
  {
    id: '08-htlc-confirm',
    flow: 'document-exchange',
    tier: 'l1',
    title: 'Inventory HTLC confirm',
    description: 'Confirm funded HTLC / unlock delivery state (L1).',
    path: '/peers',
    waitTestId: 'peer-inventory-htlc',
    fullPage: false,
    action: 'htlc-confirm'
  },

  // —— Fabric P2P ——
  {
    id: '01-peers-list',
    flow: 'p2p',
    tier: 'ui',
    title: 'Peers list',
    description: 'Fabric Peer roster and peering chrome.',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '02-add-peer',
    flow: 'p2p',
    tier: 'ui',
    title: 'Add peer modal',
    description: 'Dial a Fabric host:port peer.',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: false,
    action: 'add-peer-modal'
  },
  {
    id: '03-peer-detail',
    flow: 'p2p',
    tier: 'ui',
    title: 'Peer detail',
    description: 'Inspect a single peer (chat, inventory, federation).',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: true,
    action: 'peer-detail'
  },
  {
    id: '04-peer-chat',
    flow: 'p2p',
    tier: 'ui',
    title: 'Peer chat',
    description: 'Direct peer chat pane when a peer row is open.',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: true,
    action: 'peer-chat'
  },
  {
    id: '05-webrtc-discover',
    flow: 'p2p',
    tier: 'ui',
    title: 'WebRTC discover',
    description: 'Browser mesh signaling / Discover peers controls.',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    waitText: 'WebRTC',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '06-topology',
    flow: 'p2p',
    tier: 'ui',
    title: 'Peer topology',
    description: 'Topology / gossip view on the Peers page when rendered.',
    path: '/peers',
    waitTestId: 'hub-peers-page',
    fullPage: true,
    action: 'peers-topology'
  },

  // —— Other features ——
  {
    id: '01-home',
    flow: 'features',
    tier: 'ui',
    title: 'Home',
    description: 'Hub client home / identity entry.',
    path: '/',
    waitTestId: 'hub-client-home',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '02-features',
    flow: 'features',
    tier: 'ui',
    title: 'Features',
    description: 'In-app Features tour and shortcuts.',
    path: '/features',
    waitText: 'Features',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '03-downloads',
    flow: 'features',
    tier: 'ui',
    title: 'Downloads',
    description: 'Installer / FileBrowser catalog.',
    path: '/downloads',
    waitTestId: 'hub-downloads-page',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '04-activities',
    flow: 'features',
    tier: 'ui',
    title: 'Activities',
    description: 'Activity stream.',
    path: '/activities',
    waitText: 'Activit',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '05-notifications',
    flow: 'features',
    tier: 'ui',
    title: 'Notifications',
    description: 'Notifications history.',
    path: '/notifications',
    waitText: 'Notification',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '06-bitcoin',
    flow: 'features',
    tier: 'ui',
    title: 'Bitcoin dashboard',
    description: 'Bitcoin service home (regtest / operator tooling when enabled).',
    path: '/services/bitcoin',
    waitText: 'Bitcoin',
    fullPage: true,
    action: 'goto-bitcoin-flags'
  },
  {
    id: '07-payjoin',
    flow: 'features',
    tier: 'ui',
    title: 'Payjoin',
    description: 'Payjoin deposit / payments board chrome.',
    path: '/services/bitcoin/payments',
    waitText: 'Pay',
    fullPage: true,
    action: 'goto-bitcoin-flags'
  },
  {
    id: '07b-payjoin-l1',
    flow: 'features',
    tier: 'l1',
    title: 'Payjoin (L1 live)',
    description: 'Payjoin board with live sessions when Bitcoin is available.',
    path: '/services/bitcoin/payments',
    waitTestId: 'hub-payjoin-board',
    fullPage: true,
    action: 'payjoin-l1'
  },
  {
    id: '08-crowdfunds',
    flow: 'features',
    tier: 'ui',
    title: 'Crowdfunds',
    description: 'Crowdfund campaigns page.',
    path: '/services/bitcoin/crowdfunds',
    waitText: 'Crowdfund',
    fullPage: true,
    action: 'goto-bitcoin-flags'
  },
  {
    id: '08b-crowdfunds-l1',
    flow: 'features',
    tier: 'l1',
    title: 'Crowdfunds (L1 live)',
    description: 'Crowdfund page with Bitcoin vault tooling when L1 is up.',
    path: '/services/bitcoin/crowdfunds',
    waitTestId: 'hub-crowdfund-page',
    fullPage: true,
    action: 'crowdfund-l1'
  },
  {
    id: '09-contracts',
    flow: 'features',
    tier: 'ui',
    title: 'Contracts',
    description: 'Execution / storage contracts list.',
    path: '/contracts',
    waitText: 'Contract',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '10-sidechains',
    flow: 'features',
    tier: 'ui',
    title: 'Sidechains',
    description: 'Sidechain / Beacon-related operator surface.',
    path: '/sidechains',
    waitText: 'Sidechain',
    fullPage: true,
    action: 'goto-sidechain-flags'
  },
  {
    id: '11-beacon-federation',
    flow: 'features',
    tier: 'ui',
    title: 'Beacon Federation',
    description: 'Admin Beacon Federation settings.',
    path: '/settings/admin/beacon-federation',
    waitText: 'Beacon',
    fullPage: true,
    action: 'goto-sidechain-flags'
  },
  {
    id: '12-settings',
    flow: 'features',
    tier: 'ui',
    title: 'Settings',
    description: 'Settings home.',
    path: '/settings',
    waitTestId: 'hub-settings-home',
    fullPage: true,
    action: 'goto'
  },
  {
    id: '13-security',
    flow: 'features',
    tier: 'ui',
    title: 'Security',
    description: 'Settings → Security (sessions / keys).',
    path: '/settings/security',
    waitText: 'Security',
    fullPage: true,
    action: 'goto'
  }
];

const FLOW_META = {
  'document-exchange': {
    heading: '1. Document Exchange',
    intro: 'Create, publish, list, and peer-inventory paths for Hub document exchange. L1 inventory HTLC fund/confirm shots require `npm run screenshots:l1` (bitcoind).'
  },
  p2p: {
    heading: '2. Fabric Peer-to-Peer network',
    intro: 'Peers list, add-peer, detail, chat, WebRTC discover, and topology.'
  },
  features: {
    heading: '3. Other features',
    intro: 'Home, Features, Downloads, activity/notifications, Bitcoin stack, contracts, sidechain/Beacon, and settings.'
  }
};

const BITCOIN_FLAGS = {
  bitcoin: true,
  sidechain: true,
  bitcoinPayments: true,
  bitcoinLightning: true,
  bitcoinResources: true,
  bitcoinCrowdfund: true,
  bitcoinExplorer: true,
  peers: true
};

/**
 * @param {boolean} includeL1
 * @returns {ShotDef[]}
 */
function shotsForRun (includeL1) {
  return SHOTS.filter((s) => s.tier === 'ui' || (includeL1 && s.tier === 'l1'));
}

/**
 * @param {ShotDef[]} shots
 * @param {Map<string, object>} resultsByKey map of `flow/id` → capture result
 * @param {object} meta
 * @returns {string}
 */
function renderUserFlowsMarkdown (shots, resultsByKey, meta = {}) {
  const capturedAt = meta.capturedAt || new Date().toISOString();
  const includeL1 = !!meta.includeL1;
  const lines = [];
  lines.push('# Hub UI user flows');
  lines.push('');
  lines.push('Reproducible screenshot gallery for Document Exchange, Fabric P2P, and other Hub surfaces.');
  lines.push('');
  lines.push('## Regenerate');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run puppeteer:install-chrome   # once');
  lines.push('npm run screenshots                # UI tier');
  lines.push('npm run screenshots:l1             # UI + L1 (needs bitcoind)');
  lines.push('```');
  lines.push('');
  lines.push(`Last capture: \`${capturedAt}\` · L1 tier ${includeL1 ? 'included' : 'not run (see L1 rows below)'}.`);
  lines.push('');
  lines.push('<!-- BEGIN GENERATED GALLERY -->');
  lines.push('');

  for (const flow of ['document-exchange', 'p2p', 'features']) {
    const fm = FLOW_META[flow];
    lines.push(`## ${fm.heading}`);
    lines.push('');
    lines.push(fm.intro);
    lines.push('');
    const flowShots = SHOTS.filter((s) => s.flow === flow);
    for (const shot of flowShots) {
      const key = `${shot.flow}/${shot.id}`;
      const result = resultsByKey.get(key);
      const rel = `../assets/screenshots/${shot.flow}/${shot.id}.png`;
      lines.push(`### ${shot.title}`);
      lines.push('');
      lines.push(`${shot.description}`);
      lines.push('');
      lines.push(`- **id:** \`${shot.id}\``);
      lines.push(`- **tier:** \`${shot.tier}\``);
      if (result && result.status === 'ok') {
        lines.push(`- **status:** captured`);
        lines.push('');
        lines.push(`![${shot.title}](${rel})`);
      } else if (shot.tier === 'l1' && !includeL1) {
        lines.push('- **status:** skipped — run `npm run screenshots:l1` to refresh');
      } else if (result && result.status === 'skipped') {
        lines.push(`- **status:** skipped — ${result.reason || 'unavailable'}`);
        if (result.hadPartial && result.status !== 'ok') {
          /* keep */
        }
      } else if (result && result.status === 'error') {
        lines.push(`- **status:** error — ${result.reason || 'capture failed'}`);
      } else {
        lines.push('- **status:** not captured yet');
      }
      lines.push('');
    }
  }

  lines.push('<!-- END GENERATED GALLERY -->');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  SHOTS,
  FLOW_META,
  BITCOIN_FLAGS,
  shotsForRun,
  renderUserFlowsMarkdown
};
