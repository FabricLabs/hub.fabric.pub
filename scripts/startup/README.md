# Fabric Hub — OS startup scripts

Installers copy this tree to `resources/startup/` (next to `app.asar`). The
desktop **tray → Run at startup** option is the supported path for
unsophisticated users: it registers an OS login item (macOS / Windows) or an
XDG autostart file (Linux) so Bitcoin Core, the Fabric peer, and Lightning
come up with the user session. Login launches use `--hidden` (window stays in
the tray; Hub still runs).

These scripts are the same launchers, for operators who wire Task Scheduler,
LaunchAgents, or systemd --user themselves.

| OS | Script | Typical job |
|----|--------|-------------|
| macOS | `macos/FabricHub.command` | Double-click or `open`; LaunchAgent sample `com.pub.fabric.hub.plist` |
| Windows | `windows/FabricHub-startup.cmd` | Startup folder / Task Scheduler. `FabricHub-startup.vbs` hides the console |
| Linux | `linux/fabrichub-startup.sh` | XDG autostart / systemd --user. Sample `pub.fabric.hub.desktop` |

Do not enable login items from `npm run desktop` (dev) unless
`FABRIC_OPEN_AT_LOGIN=1`. Packaged builds default **on**; the tray can turn
them off. Preference: `desktop-shell.json` under Electron userData.
