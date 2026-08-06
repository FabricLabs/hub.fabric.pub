# Build resources (electron-builder)

Add **application icons** here so platform installers use Fabric branding instead of the default Electron icon:

| File | Platform |
|------|----------|
| `icon.icns` | macOS |
| `icon.ico` | Windows |
| `icon.png` | Linux (square, ≥512px) |

`package.json` sets `build.directories.buildResources` to this directory.
