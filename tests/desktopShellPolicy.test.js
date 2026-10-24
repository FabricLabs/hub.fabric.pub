'use strict';

const assert = require('assert');
const {
  checkPayjoinTarget,
  hubOrigins,
  isHubAppUrl,
  isPermissionAllowed,
  isPrivateAddress,
  isSafeExternalUrl,
  isTrustedIpcFrame,
  navigationAction
} = require('../functions/desktopShellPolicy');

describe('functions/desktopShellPolicy', () => {
  describe('navigation', () => {
    it('hubOrigins lists 127.0.0.1 and localhost for the port', () => {
      assert.deepStrictEqual(hubOrigins(8080), ['http://127.0.0.1:8080', 'http://localhost:8080']);
    });

    it('isHubAppUrl matches only the Hub origin on that port', () => {
      assert.strictEqual(isHubAppUrl('http://127.0.0.1:8080/services/bitcoin', 8080), true);
      assert.strictEqual(isHubAppUrl('http://localhost:8080/', 8080), true);
      assert.strictEqual(isHubAppUrl('http://127.0.0.1:9090/', 8080), false);
      assert.strictEqual(isHubAppUrl('https://127.0.0.1:8080/', 8080), false);
      assert.strictEqual(isHubAppUrl('http://127.0.0.1.evil.com:8080/', 8080), false);
      assert.strictEqual(isHubAppUrl('not a url', 8080), false);
    });

    it('navigationAction keeps the Hub in-window and sends safe links out', () => {
      assert.strictEqual(navigationAction('http://127.0.0.1:8080/peers', 8080), 'allow');
      assert.strictEqual(navigationAction('https://github.com/FabricLabs/hub.fabric.pub/issues', 8080), 'external');
      assert.strictEqual(navigationAction('mailto:support@fabric.pub', 8080), 'external');
      assert.strictEqual(navigationAction('file:///etc/passwd', 8080), 'deny');
      assert.strictEqual(navigationAction('smb://host/share', 8080), 'deny');
      assert.strictEqual(navigationAction('javascript:alert(1)', 8080), 'deny');
    });

    it('isSafeExternalUrl allows only http, https, mailto', () => {
      assert.strictEqual(isSafeExternalUrl('https://fabric.pub'), true);
      assert.strictEqual(isSafeExternalUrl('http://example.com'), true);
      assert.strictEqual(isSafeExternalUrl('mailto:a@b.c'), true);
      assert.strictEqual(isSafeExternalUrl('file:///tmp/x'), false);
      assert.strictEqual(isSafeExternalUrl('ms-msdt:/id'), false);
      assert.strictEqual(isSafeExternalUrl(''), false);
    });
  });

  describe('IPC senders', () => {
    it('trusts the top-level Hub frame only', () => {
      assert.strictEqual(isTrustedIpcFrame({ url: 'http://127.0.0.1:8080/', parent: null }, 8080), true);
      assert.strictEqual(isTrustedIpcFrame({ url: 'http://127.0.0.1:8080/', parent: {} }, 8080), false);
      assert.strictEqual(isTrustedIpcFrame({ url: 'https://evil.example/', parent: null }, 8080), false);
      assert.strictEqual(isTrustedIpcFrame(null, 8080), false);
    });
  });

  describe('private addresses', () => {
    it('flags loopback, RFC1918, link-local, CGNAT, multicast, unspecified', () => {
      for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]']) {
        assert.strictEqual(isPrivateAddress(ip), true, ip);
      }
    });

    it('passes public addresses and hostnames through', () => {
      for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', 'example.com']) {
        assert.strictEqual(isPrivateAddress(ip), false, ip);
      }
    });
  });

  describe('checkPayjoinTarget', () => {
    it('accepts public https endpoints and asks for a resolved-address check', () => {
      const r = checkPayjoinTarget('https://pj.example.com/pj?v=1', { hubPort: 8080 });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.checkResolvedAddress, true);
    });

    it('accepts the desktop Hub origin itself', () => {
      const r = checkPayjoinTarget('http://127.0.0.1:8080/services/payjoin/sessions/abc/proposals', { hubPort: 8080 });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.checkResolvedAddress, false);
    });

    it('refuses plain http, private hosts, credentials, and other schemes', () => {
      assert.strictEqual(checkPayjoinTarget('http://pj.example.com/', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('https://192.168.1.10/pj', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('https://localhost:9000/pj', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('https://[::1]/pj', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('http://127.0.0.1:9999/', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('https://user:pw@pj.example.com/', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('file:///etc/passwd', { hubPort: 8080 }).ok, false);
      assert.strictEqual(checkPayjoinTarget('', { hubPort: 8080 }).ok, false);
    });

    it('allowPrivate opens LAN / regtest endpoints', () => {
      const r = checkPayjoinTarget('http://192.168.1.10:8080/pj', { hubPort: 8080, allowPrivate: true });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.checkResolvedAddress, false);
    });
  });

  describe('permissions', () => {
    it('allows clipboard write, fullscreen, notifications for the Hub only', () => {
      assert.strictEqual(isPermissionAllowed('clipboard-sanitized-write', 'http://127.0.0.1:8080/', 8080), true);
      assert.strictEqual(isPermissionAllowed('notifications', 'http://localhost:8080', 8080), true);
      assert.strictEqual(isPermissionAllowed('notifications', 'https://evil.example/', 8080), false);
    });

    it('denies everything else', () => {
      for (const p of ['media', 'geolocation', 'clipboard-read', 'midi', 'openExternal', 'hid', 'serial', 'usb', 'unknown']) {
        assert.strictEqual(isPermissionAllowed(p, 'http://127.0.0.1:8080/', 8080), false, p);
      }
    });
  });
});
