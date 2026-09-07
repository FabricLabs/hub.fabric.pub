'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pkg = require('../package.json');
const {
  argvRequestsHidden,
  desktopShellStatePath,
  electronLoginItemSettings,
  linuxAutostartDesktopFile,
  linuxAutostartPath,
  macosLaunchAgentPlist,
  readDesktopShellState,
  resolveOpenAtLogin,
  shouldStartHidden,
  syncLinuxAutostart,
  writeDesktopShellState,
  HIDDEN_FLAG,
  LINUX_AUTOSTART_ID
} = require('../functions/desktopOpenAtLogin');

describe('desktop open-at-login', function () {
  it('defaults on for packaged installs and off for npm run desktop', function () {
    assert.strictEqual(resolveOpenAtLogin({ isPackaged: true }), true);
    assert.strictEqual(resolveOpenAtLogin({ isPackaged: false }), false);
  });

  it('lets FABRIC_OPEN_AT_LOGIN win over persist and packaged default', function () {
    assert.strictEqual(resolveOpenAtLogin({
      env: { FABRIC_OPEN_AT_LOGIN: '0' },
      persisted: true,
      isPackaged: true
    }), false);
    assert.strictEqual(resolveOpenAtLogin({
      env: { FABRIC_OPEN_AT_LOGIN: '1' },
      persisted: false,
      isPackaged: false
    }), true);
  });

  it('honors persisted tray choice', function () {
    assert.strictEqual(resolveOpenAtLogin({
      persisted: false,
      isPackaged: true
    }), false);
  });

  it('treats --hidden and --startup as login launches', function () {
    assert.strictEqual(argvRequestsHidden(['electron', 'scripts/desktop.js', '--hidden']), true);
    assert.strictEqual(shouldStartHidden({ wasOpenedAtLogin: true }), true);
    assert.strictEqual(shouldStartHidden({ argv: ['--startup'] }), true);
    assert.strictEqual(shouldStartHidden({ argv: ['scripts/desktop.js'] }), false);
  });

  it('omits path on macOS login items so the .app bundle is registered', function () {
    const mac = electronLoginItemSettings({
      openAtLogin: true,
      platform: 'darwin',
      execPath: '/Applications/Fabric Hub.app/Contents/MacOS/FabricHub'
    });
    assert.strictEqual(mac.openAtLogin, true);
    assert.strictEqual(mac.openAsHidden, true);
    assert.deepStrictEqual(mac.args, [HIDDEN_FLAG]);
    assert.strictEqual(mac.path, undefined);

    const win = electronLoginItemSettings({
      openAtLogin: true,
      platform: 'win32',
      execPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\Fabric Hub\\FabricHub.exe'
    });
    assert.ok(win.path.includes('FabricHub.exe'));
  });

  it('writes and removes an XDG autostart desktop file', function () {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-autostart-'));
    const execPath = '/opt/Fabric Hub/FabricHub';
    const filePath = linuxAutostartPath(home);
    const on = syncLinuxAutostart({
      enabled: true,
      homeDir: home,
      execPath,
      iconPath: '/opt/Fabric Hub/icon.png'
    });
    assert.strictEqual(on.path, filePath);
    const body = fs.readFileSync(filePath, 'utf8');
    assert.ok(body.includes('X-GNOME-Autostart-enabled=true'));
    assert.ok(body.includes('--hidden'));
    assert.ok(body.includes('"/opt/Fabric Hub/FabricHub"'));
    syncLinuxAutostart({ enabled: false, homeDir: home, execPath });
    assert.strictEqual(fs.existsSync(filePath), false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('persists tray Run at startup in desktop-shell.json', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-shell-'));
    const filePath = desktopShellStatePath(dir);
    assert.deepStrictEqual(readDesktopShellState(filePath), {});
    writeDesktopShellState(filePath, { openAtLogin: true });
    assert.strictEqual(readDesktopShellState(filePath).openAtLogin, true);
    writeDesktopShellState(filePath, { openAtLogin: false });
    assert.strictEqual(readDesktopShellState(filePath).openAtLogin, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renders a LaunchAgent that starts Hub hidden', function () {
    const plist = macosLaunchAgentPlist({
      execPath: '/Applications/Fabric Hub.app/Contents/MacOS/FabricHub'
    });
    assert.ok(plist.includes('<string>pub.fabric.hub</string>'));
    assert.ok(plist.includes(HIDDEN_FLAG));
  });

  it('ships OS startup scripts as extraResources', function () {
    const extra = pkg.build.extraResources || [];
    const startup = extra.find((e) => e && e.from === 'scripts/startup' && e.to === 'startup');
    assert.ok(startup, 'build.extraResources must copy scripts/startup → startup');
    const root = path.join(__dirname, '..', 'scripts', 'startup');
    assert.ok(fs.existsSync(path.join(root, 'macos', 'FabricHub.command')));
    assert.ok(fs.existsSync(path.join(root, 'macos', 'com.pub.fabric.hub.plist')));
    assert.ok(fs.existsSync(path.join(root, 'windows', 'FabricHub-startup.cmd')));
    assert.ok(fs.existsSync(path.join(root, 'windows', 'FabricHub-startup.vbs')));
    assert.ok(fs.existsSync(path.join(root, 'linux', 'fabrichub-startup.sh')));
    assert.ok(fs.existsSync(path.join(root, 'linux', LINUX_AUTOSTART_ID)));
    const cmd = fs.readFileSync(path.join(root, 'windows', 'FabricHub-startup.cmd'), 'utf8');
    const sh = fs.readFileSync(path.join(root, 'linux', 'fabrichub-startup.sh'), 'utf8');
    const command = fs.readFileSync(path.join(root, 'macos', 'FabricHub.command'), 'utf8');
    assert.ok(cmd.includes('--hidden'));
    assert.ok(sh.includes('--hidden'));
    assert.ok(command.includes('--hidden'));
  });

  it('quotes desktop Exec paths that contain spaces', function () {
    const body = linuxAutostartDesktopFile({
      execPath: '/opt/Fabric Hub/FabricHub',
      args: [HIDDEN_FLAG]
    });
    assert.ok(body.includes('Exec="/opt/Fabric Hub/FabricHub" --hidden'));
  });
});
