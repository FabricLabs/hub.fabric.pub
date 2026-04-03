'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment, List, Message } = require('semantic-ui-react');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const {
  REGTEST_EPOCH_INTERVAL_MINUTES,
  NON_REGTEST_CADENCE_LABEL,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
} = require('../functions/beaconFederationConstants');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

const BEACON_DESIGN_DOC_HREF = 'https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md';
const SIDECHAIN_INDEX_DOC_HREF = 'https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/SIDECHAIN_AND_EXECUTION_INDEX.md';

/**
 * Dedicated operator page: Beacon Federation "contract" — Fabric epochs, cooperative signing, L1 Taproot vault (design).
 */
function BeaconFederationHome () {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const hasAdminToken = !!readHubAdminTokenFromBrowser();
  const peersNav = !!(uf && uf.peers && hasAdminToken);

  return (
    <Segment style={{ maxWidth: 900, margin: '1em auto' }}>
      <Button as={Link} to="/settings/admin" basic size="small" style={{ marginBottom: '1em' }} aria-label="Back to admin">
        <Icon name="arrow left" aria-hidden="true" />
        Admin
      </Button>

      <Header as="h2" id="beacon-federation-heading">
        <Icon name="users" aria-hidden="true" />
        <Header.Content>Beacon Federation</Header.Content>
      </Header>

      <p style={{ color: '#555', maxWidth: '44rem', lineHeight: 1.5, marginBottom: '1em' }}>
        The <strong>Beacon Federation</strong> is the agreement among hub operators who run the same distributed program:
        they <strong>distribute Bitcoin blocks</strong> across the Fabric P2P mesh, <strong>evaluate each tip deterministically</strong> to the same
        canonical epoch payload, and attach a <strong>k-of-n Schnorr witness</strong> on the sealed <code>BEACON_EPOCH</code> Fabric message.
        On <strong>regtest</strong>, this hub emits an epoch on a <strong>~{REGTEST_EPOCH_INTERVAL_MINUTES}-minute</strong> timer by default; on
        <strong>mainnet, testnet, and signet</strong>, epochs align with <strong>{NON_REGTEST_CADENCE_LABEL}</strong>.
      </p>

      <Header as="h3">L1 binding, Fabric sealing, and reproducibility</Header>
      <p style={{ color: '#555', maxWidth: '44rem', lineHeight: 1.5, marginBottom: '0.5em' }}>
        <strong>What is anchored where:</strong> each <code>BEACON_EPOCH</code> payload names a concrete Bitcoin tip (<strong>height + block hash</strong>) and may carry an optional{' '}
        <code>sidechain: {'{'} clock, stateDigest {'}'}</code> binding to the logical sidechain head. The hub persists the ordered epoch chain on disk (<code>beacon/CHAIN</code>) with Merkle metadata for consistency checks.
        That is <strong>verifiable against your own bitcoind</strong> (or explorer) independently of Fabric peers.
      </p>
      <p style={{ color: '#555', maxWidth: '44rem', lineHeight: 1.5, marginBottom: '0.65em' }}>
        <strong>Reproducing federation approval:</strong> validator partial signatures target a <strong>canonical signing string</strong> derived from the epoch payload (see{' '}
        <code>DistributedExecution.signingStringForBeaconEpoch</code> in <code>@fabric/core</code>). With the same payload, manifest pubkeys, and threshold, anyone can re-run{' '}
        <code>verifyFederationWitnessOnMessage</code> to confirm a <strong>k-of-n Schnorr witness</strong> matches what the hub accepted. Public JSON for operators:{' '}
        <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">GET /services/distributed/manifest</a>
        {' · '}
        <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET /services/distributed/epoch</a>.
      </p>
      <Message warning size="small" style={{ marginBottom: '1em' }}>
        <Message.Header>Scope (avoid mixing guarantees)</Message.Header>
        <p style={{ margin: '0.35em 0 0' }}>
          <strong>Execution contracts</strong> use a separate deterministic <code>runCommitmentHex</code> over the opcode trace and optional L1 OP_RETURN anchoring — they do{' '}
          <strong>not</strong> consume federation witnesses. The <strong>Taproot federation vault</strong> is a separate L1 leg: deposit address and UTXO scan are on the Hub; co-signing spends stays with validators (PSBT).
        </p>
      </Message>

      <Header as="h3">On-chain federation vault (Taproot)</Header>
      <p style={{ color: '#555', maxWidth: '44rem', lineHeight: 1.5, marginBottom: '0.75em' }}>
        The L1 leg of the contract is a <strong>Taproot</strong> address controlled by the federation: anyone can <strong>fund</strong> it.
        The hub derives a deterministic <strong>k-of-n tapscript</strong> (sorted validator pubkeys, same list as the manifest) with a NUMS internal key — spend only via script path.
        <strong>Beacon operators</strong> use <code>PrepareFederationVaultWithdrawalPsbt</code> (admin token, <code>POST /services/rpc</code>) to build an <strong>unsigned</strong> PSBT from a funding tx; each validator signs with their key until threshold signatures exist, then broadcast.
        The <strong>default</strong> policy for incoming deposits is to treat them as <strong>mature after {DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS} confirmations</strong> (~one day on mainnet) before planning withdrawals — surfaced on{' '}
        <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">GET /services/distributed/vault/utxos</a>
        {' '}per UTXO (<code>maturedForWithdrawalPolicy</code>).
      </p>
      <Message info size="small">
        <Message.Header>Hub HTTP / RPC (live)</Message.Header>
        <p style={{ margin: '0.35em 0 0' }}>
          <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">GET /services/distributed/vault</a>
          {' — address, tapscript, policy · '}
          <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">GET /services/distributed/vault/utxos</a>
          {' — watch-only balance via '}
          <code>scantxoutset</code>
          {' · manifest includes a compact '}
          <code>federationVault</code>
          {' summary when validators are set. Fabric-side enforcement (epochs, sidechain patches) is unchanged.'}
        </p>
      </Message>

      <Header as="h3" style={{ marginTop: '1.25em' }}>This hub (live policy)</Header>
      <DistributedFederationPanel size="small" marginBottom="1em" />

      <Header as="h3">Operator checklist</Header>
      <List bulleted relaxed>
        <List.Item>Configure validator pubkeys and threshold under <Link to="/federations">Federations</Link> (or <Link to="/settings/federation">Settings → Distributed federation</Link>).</List.Item>
        <List.Item>Confirm epoch stream: <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET /services/distributed/epoch</a>; vault: <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">GET /services/distributed/vault</a> and <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">UTXOs</a>.</List.Item>
        <List.Item>Compare epoch block height/hash to L1 and spot-check witness bytes in CI using <code>@fabric/core</code> helpers (see design doc).</List.Item>
        <List.Item>
          Coordinate with peers:{' '}
          {peersNav ? <Link to="/peers">Peers</Link> : <span>Peers (paste hub admin token under Admin to open the list)</span>}
          {' '}and federation invites from peer detail (admin).
        </List.Item>
        <List.Item>
          Sidechain head and patches: <Link to="/sidechains">Sidechain &amp; demo</Link>;
          <>
            {' '}
            <Link to="/activities">Activity log</Link> shows <strong>Bitcoin blocks</strong> and hub log events; <Link to="/notifications">Notifications</Link> (bell) lists wallet and Payjoin toasts.
          </>
        </List.Item>
        <List.Item>
          Further reading:{' '}
          <a href={BEACON_DESIGN_DOC_HREF} target="_blank" rel="noopener noreferrer">Beacon + sidechain design &amp; roadmap</a>
          {' · '}
          <a href={SIDECHAIN_INDEX_DOC_HREF} target="_blank" rel="noopener noreferrer">Sidechain &amp; execution index</a>.
        </List.Item>
      </List>
    </Segment>
  );
}

module.exports = BeaconFederationHome;
