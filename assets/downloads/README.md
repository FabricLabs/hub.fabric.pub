# Hub downloads

Build-generated desktop installers **and** the Fabric Passport store zip for the public **`/downloads`** FileBrowser.

`npm run build` writes **`index.json`** from whatever is already in this folder (often empty).
`npm run build:desktop` / `npm run build:installers` copy electron-builder artifacts from `dist/` into platform folders (`mac/`, `win/`, `linux/`) and regenerate the index. The **`extension/`** folder is preserved across that wipe so Passport zips are not deleted when desktop installers refresh.

Passport store zip (`fabric-passport-v*.zip`):

```bash
# From @fabric/passport (sibling ../fabric-browser-extension):
npm run package
npm run sync:hub-downloads

# Or from this Hub tree:
npm run sync:passport-downloads
```

Lands at **`/downloads/extension/fabric-passport-v…zip`**. Playnet Documents publish (Hub inventory) is separate: from Passport run `npm run publish:builds` / `npm run playnet:publish`.

Installer and extension blobs are gitignored. Do not commit `.dmg` / `.exe` / `.AppImage` / `.deb` / Passport `.zip` here.
