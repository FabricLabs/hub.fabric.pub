'use strict';

const React = require('react');
const {
  Dropdown,
  Header
} = require('semantic-ui-react');

const {
  plaintextMasterFromStored
} = require('../../functions/fabricHubLocalIdentity');
const { readStorageJSON } = require('../../functions/fabricBrowserState');

/** Highest Fabric BIP44 account index shown in Hub quick-switch UI (still one HD wallet). */
const MAX_VISIBLE_ACCOUNT_INDEX = 24;

/**
 * Dropdown to switch the Fabric-protocol account index (same mnemonics HD tree, new id/xpub/signing subtree).
 *
 * Disabled when encrypted identity is locked (master not decryptable locally without password interaction).
 *
 * @param {object} props
 * @param {object|null} props.localIdentity
 * @param {function(number):void} props.onFabricAccountChange
 */
function FabricIdentityAccountControls (props) {
  const local = props.localIdentity || null;
  const onChange = props && typeof props.onFabricAccountChange === 'function'
    ? props.onFabricAccountChange
    : null;
  const modeOk = !!(local && local.fabricIdentityMode === 'account');
  let stored = null;
  try {
    stored = typeof window !== 'undefined' ? readStorageJSON('fabric.identity.local', null) : null;
  } catch (e) {
    stored = null;
  }
  const diskMaster = !!(stored && plaintextMasterFromStored(stored));
  const memMaster = !!(local && String(local.masterXprv || '').trim());
  const role = stored && stored.fabricHdRole != null ? String(stored.fabricHdRole) : '';
  const switchBlocked = role === 'accountNode' || role === 'watchAccount';

  /** Need HD master to pivot account index; account-node or watch-only identities cannot switch. */
  const canSwitch =
    modeOk &&
    (diskMaster || memMaster) &&
    !switchBlocked;

  const idxRaw = local && local.fabricAccountIndex != null ? local.fabricAccountIndex : 0;
  const idx = Math.max(0, Math.min(MAX_VISIBLE_ACCOUNT_INDEX, Math.floor(Number(idxRaw)) || 0));

  if (!modeOk || !onChange) return null;

  const options = [];
  for (let i = 0; i <= MAX_VISIBLE_ACCOUNT_INDEX; i++) {
    options.push({ key: `fab-acct-${i}`, text: `Account ${i}`, value: i });
  }

  return (
    <>
      <Header as="label" htmlFor="fabric-hub-fabric-account-select" style={{ marginRight: '0.5em', marginBottom: 0 }}>
        Fabric account
      </Header>
      <Dropdown
        id="fabric-hub-fabric-account-select"
        selection
        compact
        value={idx}
        options={options}
        disabled={!canSwitch}
        title={
          !canSwitch
            ? 'Unlock your identity (master key) first to switch Fabric accounts.'
            : 'Fabric BIP44 account index — same mnemonic, distinct protocol signing subtree (Hub default is account 0).'
        }
        onChange={(e, d) => {
          const v = d && (d.value != null ? Number(d.value) : NaN);
          if (!Number.isFinite(v) || v < 0) return;
          onChange(Math.floor(v));
        }}
      />
    </>
  );
}

module.exports = FabricIdentityAccountControls;
