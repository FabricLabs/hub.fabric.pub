'use strict';

const React = require('react');
const {
  Dropdown,
  Header
} = require('semantic-ui-react');

const {
  STORAGE_KEY,
  ACCOUNT_NETWORKS,
  isAccountVault,
  cachedAccounts
} = require('../../functions/hubAccountVault');
const { readStorageJSON } = require('../../functions/fabricBrowserState');
const t = require('../../locales/en');

const copy = t.identity.accountControls;

/** Highest account index offered in the quick switcher (any index derives). */
const MAX_VISIBLE_ACCOUNT_INDEX = 24;

/**
 * Account + network switcher for the browser's sealed identity. Each pair
 * derives its own identity, wallet, and cosigner keys from the one seed.
 * Unlocked, any pair can be chosen; locked, only pairs used before (their
 * public keys are cached in the vault).
 *
 * @param {object} props
 * @param {object|null} props.localIdentity
 * @param {function(number, string):void} props.onFabricAccountChange `(account, network)`
 */
function FabricIdentityAccountControls (props) {
  const local = props.localIdentity || null;
  const onChange = props && typeof props.onFabricAccountChange === 'function'
    ? props.onFabricAccountChange
    : null;
  if (!local || local.fabricIdentityMode !== 'account' || !onChange) return null;

  let vault = null;
  try {
    vault = typeof window !== 'undefined' ? readStorageJSON(STORAGE_KEY, null) : null;
  } catch (e) {
    vault = null;
  }
  const unlocked = !!(local.masterXprv && String(local.masterXprv).trim());
  const cached = isAccountVault(vault) ? cachedAccounts(vault) : [];
  if (!unlocked && !cached.length) return null;

  const account = Math.max(0, Math.floor(Number(local.fabricAccountIndex)) || 0);
  const network = local.network || 'regtest';
  const isCached = (a, n) => cached.some((c) => c.account === a && c.network === n);

  const accountOptions = [];
  const maxAccount = Math.max(MAX_VISIBLE_ACCOUNT_INDEX, account, ...cached.map((c) => c.account));
  for (let i = 0; i <= maxAccount; i++) {
    const usable = unlocked || isCached(i, network);
    if (!usable && i !== account) continue;
    accountOptions.push({ key: `fab-acct-${i}`, text: copy.option(i), value: i });
  }
  const networkOptions = ACCOUNT_NETWORKS
    .filter((n) => unlocked || n === network || isCached(account, n))
    .map((n) => ({ key: `fab-net-${n}`, text: copy.networks[n] || n, value: n }));

  const title = unlocked ? copy.title : copy.blockedLocked;

  return (
    <>
      <Header as="label" htmlFor="fabric-hub-fabric-account-select" style={{ marginRight: '0.5em', marginBottom: 0 }}>
        {copy.label}
      </Header>
      <Dropdown
        id="fabric-hub-fabric-account-select"
        selection
        compact
        value={account}
        options={accountOptions}
        disabled={accountOptions.length < 2}
        title={title}
        onChange={(e, d) => {
          const v = d && (d.value != null ? Number(d.value) : NaN);
          if (!Number.isFinite(v) || v < 0 || v === account) return;
          onChange(Math.floor(v), network);
        }}
      />
      <Header as="label" htmlFor="fabric-hub-fabric-network-select" style={{ margin: '0 0.5em', marginBottom: 0 }}>
        {copy.networkLabel}
      </Header>
      <Dropdown
        id="fabric-hub-fabric-network-select"
        selection
        compact
        value={network}
        options={networkOptions}
        disabled={networkOptions.length < 2}
        title={title}
        onChange={(e, d) => {
          const v = d && d.value != null ? String(d.value) : '';
          if (!v || v === network) return;
          onChange(account, v);
        }}
      />
    </>
  );
}

module.exports = FabricIdentityAccountControls;
