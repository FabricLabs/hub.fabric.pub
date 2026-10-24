'use strict';

const assert = require('assert');
const { resolvePayjoinPublicOrigin, joinOriginPath } = require('../functions/payjoinPublicOrigin');
const PayjoinService = require('../services/payjoin');
const { PayjoinAsyncMailbox, sha256Hex, normalizeBlob } = require('../functions/payjoinAsyncMailbox');
const { buildFabricPayjoinProtocolProfile, RECEIVER_MODES } = require('../functions/payjoinFabricProtocol');

describe('payjoinPublicOrigin', () => {
  it('prefers FABRIC_HUB_PUBLIC_ORIGIN', () => {
    const o = resolvePayjoinPublicOrigin({
      env: { FABRIC_HUB_PUBLIC_ORIGIN: 'https://hub.example:8443/' },
      hostname: 'localhost',
      port: 8080
    });
    assert.strictEqual(o, 'https://hub.example:8443');
  });

  it('builds from hostname + port', () => {
    const o = resolvePayjoinPublicOrigin({
      env: {},
      hostname: '127.0.0.1',
      port: 8080
    });
    assert.strictEqual(o, 'http://127.0.0.1:8080');
  });

  it('joinOriginPath concatenates', () => {
    assert.strictEqual(
      joinOriginPath('http://localhost:8080', '/services/payjoin/sessions/x/proposals'),
      'http://localhost:8080/services/payjoin/sessions/x/proposals'
    );
  });
});

describe('PayjoinService BIP78 absolute pj=', () => {
  it('emits absolute proposalURL and proposalPath when publicOrigin is set', async () => {
    const svc = new PayjoinService({
      network: 'regtest',
      publicOrigin: 'http://127.0.0.1:18080',
      endpointBasePath: '/services/payjoin',
      receiverContribution: false
    });
    const session = await svc.createDepositSession({
      address: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amountSats: 25000,
      label: 'test'
    });
    assert.ok(session.proposalPath.startsWith('/services/payjoin/sessions/'));
    assert.ok(session.proposalPath.endsWith('/proposals'));
    assert.strictEqual(session.proposalURL, `http://127.0.0.1:18080${session.proposalPath}`);
    assert.ok(session.bip21Uri.includes('pj='));
    assert.ok(session.bip21Uri.includes(encodeURIComponent(session.proposalURL)));
    assert.ok(/^https?:\/\//i.test(decodeURIComponent(session.bip21Uri.match(/pj=([^&]+)/)[1])));
  });

  it('submitProposal returns the original on the JSON path and a BIP78 error when the Hub does not contribute', async () => {
    const svc = new PayjoinService({
      network: 'regtest',
      publicOrigin: 'http://127.0.0.1:18080',
      receiverContribution: false
    });
    const session = await svc.createDepositSession({
      address: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amountSats: 1000
    });
    const demo = 'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const result = await svc.submitProposal(session.id, { psbt: demo, receiverContribution: false });
    assert.strictEqual(result.bip78Psbt, demo);
    assert.strictEqual(result.proposal.psbt, demo);
    assert.strictEqual(result.bip78Error.errorCode, 'unavailable');
  });
});

describe('payjoinAsyncMailbox', () => {
  it('normalizeBlob decodes base64 PSBT (not UTF-8 of the base64 text)', () => {
    const psbtB64 = 'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const buf = normalizeBlob(psbtB64);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 4);
    assert.notStrictEqual(buf.toString('utf8'), psbtB64);
    assert.ok(buf.equals(Buffer.from(psbtB64, 'base64')));
    assert.strictEqual(sha256Hex(buf), sha256Hex(Buffer.from(psbtB64, 'base64')));
  });

  it('enqueue is idempotent by content hash; markDelivered is sidecar', () => {
    const box = new PayjoinAsyncMailbox({ defaultTtlMs: 60000 });
    const mb = box.createMailbox({});
    const blob = Buffer.from('cHNidP8Bopaque-psbt', 'utf8');
    const a = box.enqueue(mb.id, blob, { role: 'payer_reply' });
    const b = box.enqueue(mb.id, blob, { role: 'payer_reply' });
    assert.strictEqual(a.accepted, true);
    assert.strictEqual(a.duplicate, false);
    assert.strictEqual(b.duplicate, true);
    assert.strictEqual(a.entry.contentHash, sha256Hex(blob));

    const pending = box.pendingFor(mb.id);
    assert.strictEqual(pending.entries.length, 1);
    assert.ok(pending.entries[0].blobBase64);

    const delivered = box.markDelivered(mb.id, a.entry.contentHash, 'peer-a');
    assert.strictEqual(delivered.ok, true);
    assert.ok(String(delivered.note).includes('not Payjoin settlement'));

    const after = box.pendingFor(mb.id);
    assert.strictEqual(after.entries.length, 0);
  });

  it('first-wins claim holds until TTL', () => {
    const box = new PayjoinAsyncMailbox({ defaultTtlMs: 60000, claimTtlMs: 60000 });
    const mb = box.createMailbox({});
    const blob = Buffer.from('payjoin-claim-test');
    const enq = box.enqueue(mb.id, blob, { role: 'payer_reply' });
    const c1 = box.claim(mb.id, enq.entry.contentHash, 'alice');
    assert.strictEqual(c1.ok, true);
    assert.throws(() => box.claim(mb.id, enq.entry.contentHash, 'bob'), /already claimed/);
    const c1b = box.claim(mb.id, enq.entry.contentHash, 'alice');
    assert.strictEqual(c1b.duplicate, true);
  });
});

describe('payjoinFabricProtocol BIP78/BIP77 profile', () => {
  it('advertises BIP78 active and experimental BIP77 mailbox by default', () => {
    const p = buildFabricPayjoinProtocolProfile({
      endpointBasePath: '/services/payjoin',
      receiverContribution: true,
      publicOrigin: 'http://127.0.0.1:8080',
      bip77MailboxExperimental: true
    });
    assert.ok(p.receiver.activeModes.includes(RECEIVER_MODES.BIP78_HTTP_PSBT));
    assert.ok(p.receiver.activeModes.includes(RECEIVER_MODES.BIP77_ASYNC_MAILBOX));
    assert.ok(p.receiver.httpProposal.acceptedContentTypes.includes('text/plain'));
    assert.ok(p.receiver.httpProposal.acceptedContentTypes.includes('application/json'));
    assert.strictEqual(p.receiver.httpProposal.absolutePjRequired, true);
    assert.strictEqual(p.receiver.asyncMailbox.status, 'experimental');
    assert.ok(p.receiver.roadmapModes.some((m) => m.id === 'bip77_directory_ohttp_hpke'));
  });
});

describe('Hub BIP78 text/plain proposal HTTP handler', () => {
  const Hub = require('../services/hub');
  const DEMO_PSBT = 'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  function mockRes () {
    const out = {
      statusCode: 200,
      headers: {},
      body: null,
      status (code) { this.statusCode = code; return this; },
      setHeader (k, v) { this.headers[String(k).toLowerCase()] = v; },
      send (body) { this.body = body; return this; },
      json (body) { this.body = body; return this; }
    };
    return out;
  }

  it('text/plain POST returns text/plain payjoin PSBT, passes BIP78 params, and defers contribution to the service default', async () => {
    const hub = Object.create(Hub.prototype);
    const calls = [];
    const svc = {
      async submitProposal (sessionId, input) {
        calls.push({ sessionId, input });
        return {
          bip78Psbt: 'cHNidP8Bpayjoined',
          proposal: { id: 'p1', psbt: 'cHNidP8Bpayjoined' }
        };
      },
      extractProposalTxid () { return null; }
    };
    hub._getPayjoinService = () => svc;
    hub._mergePersistedTxLabel = () => {};
    hub.http = {
      jsonOrShell (_req, _res, run) { return Promise.resolve().then(run); }
    };

    const req = {
      headers: { 'content-type': 'text/plain', accept: 'text/plain' },
      params: { sessionId: 'sess-bip78' },
      query: { v: '1', additionalfeeoutputindex: '1', maxadditionalfeecontribution: '200' },
      body: DEMO_PSBT
    };
    const res = mockRes();
    await hub._handlePayjoinProposalSubmitRequest(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(String(res.headers['content-type']).includes('text/plain'));
    assert.strictEqual(res.body, 'cHNidP8Bpayjoined');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sessionId, 'sess-bip78');
    assert.strictEqual(calls[0].input.psbt, DEMO_PSBT);
    assert.strictEqual(calls[0].input.receiverContribution, undefined,
      'BIP78 wire must not force the contribution off; service default applies');
    assert.strictEqual(calls[0].input.bip78Params.additionalFeeOutputIndex, 1);
    assert.strictEqual(calls[0].input.bip78Params.maxAdditionalFeeContribution, 200);
  });

  it('text/plain POST answers a BIP78 JSON error when the Hub declines', async () => {
    const hub = Object.create(Hub.prototype);
    hub._getPayjoinService = () => ({
      async submitProposal () {
        return {
          bip78Psbt: DEMO_PSBT,
          bip78Error: { errorCode: 'not-enough-money', message: 'Hub wallet has no confirmed coin to contribute' },
          proposal: { id: 'p', psbt: DEMO_PSBT }
        };
      },
      extractProposalTxid () { return null; }
    });
    hub._mergePersistedTxLabel = () => {};
    const res = mockRes();
    await hub._handlePayjoinProposalSubmitRequest({
      headers: { 'content-type': 'text/plain' },
      params: { sessionId: 's' },
      body: DEMO_PSBT
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.errorCode, 'not-enough-money');

    const res2 = mockRes();
    await hub._handlePayjoinProposalSubmitRequest({
      headers: { 'content-type': 'text/plain' },
      params: { sessionId: 's' },
      query: { v: '2' },
      body: DEMO_PSBT
    }, res2);
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(res2.body.errorCode, 'version-unsupported');
  });

  it('BIP78 text/plain with receiver contribution on records the contribution on the proposal', async () => {
    const svc = new PayjoinService({
      network: 'regtest',
      publicOrigin: 'http://127.0.0.1:18080',
      autoAcpBoost: true
    });
    let autoTried = false;
    svc._applyContribution = async (session, proposal) => {
      autoTried = true;
      proposal.payjoinPsbt = `${proposal.psbt}-payjoin`;
      proposal.receiverContribution = { ok: true, contributedOutpoint: 'deadbeef:0', contributedValueSats: 1000 };
      return proposal.receiverContribution;
    };

    const session = await svc.createDepositSession({
      address: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amountSats: 1000
    });

    const hub = Object.create(Hub.prototype);
    hub._getPayjoinService = () => svc;
    hub._mergePersistedTxLabel = () => {};
    hub.http = {
      jsonOrShell (_req, _res, run) { return Promise.resolve().then(run); }
    };

    const req = {
      headers: { 'content-type': 'text/plain' },
      params: { sessionId: session.id },
      body: DEMO_PSBT
    };
    const res = mockRes();
    await hub._handlePayjoinProposalSubmitRequest(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(String(res.headers['content-type']).includes('text/plain'));
    assert.strictEqual(autoTried, true, 'legacy autoAcpBoost setting still turns the contribution on');
    assert.strictEqual(res.body, `${DEMO_PSBT}-payjoin`);
  });

  it('JSON proposal path can still disable the contribution explicitly (legacy autoAcpBoost flag)', async () => {
    const hub = Object.create(Hub.prototype);
    const calls = [];
    hub._getPayjoinService = () => ({
      async submitProposal (sessionId, input) {
        calls.push(input);
        return { proposal: { id: 'p', psbt: DEMO_PSBT }, bip78Psbt: DEMO_PSBT };
      },
      extractProposalTxid () { return null; }
    });
    hub._mergePersistedTxLabel = () => {};
    hub.http = {
      jsonOrShell (_req, _res, run) { return Promise.resolve().then(run); }
    };

    const req = {
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      params: { sessionId: 'sess-json' },
      body: { psbt: DEMO_PSBT, autoAcpBoost: false }
    };
    const res = mockRes();
    await hub._handlePayjoinProposalSubmitRequest(req, res);
    assert.strictEqual(calls[0].receiverContribution, false);
    assert.strictEqual(res.body.bip78Psbt, DEMO_PSBT);
  });
});
