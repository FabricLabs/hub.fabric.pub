# Hub downloads

Build-generated desktop installers for the public **`/downloads`** FileBrowser.

`npm run build` writes **`index.json`** from whatever is already in this folder (often empty).
`npm run build:desktop` / `npm run build:installers` copy electron-builder artifacts from `dist/` into platform folders (`mac/`, `win/`, `linux/`) and regenerate the index.

Installer blobs are gitignored. Do not commit `.dmg` / `.exe` / `.AppImage` / `.deb` here.
