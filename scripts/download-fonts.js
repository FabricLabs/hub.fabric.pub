'use strict';

/**
 * Fetch Fabric theme Arvo latin woff2 files from Google Fonts (static gstatic URLs).
 * Run after cloning or if Arvo woff2 are missing under either:
 * - `libraries/semantic/src/themes/fabric/assets/fonts/` (Semantic source)
 * - `assets/themes/fabric/assets/fonts/` (paths served by the Hub for `/themes/…`)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const fontDir = path.join(__dirname, '..', 'libraries', 'semantic', 'src', 'themes', 'fabric', 'assets', 'fonts');
/** Hub static root — `semantic*.css` references `/themes/fabric/assets/fonts/*.woff2`. */
const assetsFontDir = path.join(__dirname, '..', 'assets', 'themes', 'fabric', 'assets', 'fonts');

/** v23 latin woff2 from https://fonts.googleapis.com/css2?family=Arvo (Chrome UA) */
const ARVO_WOFF2 = [
  ['arvo-normal-400.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbD2oWUg0MKqScQ7Q.woff2'],
  ['arvo-normal-700.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbM2oWUg0MKoZw1-LPK8w.woff2'],
  ['arvo-italic-400.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbN2oWUg0MKqSIg75Tv.woff2'],
  ['arvo-italic-700.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbO2oWUg0MKqSIoVLH68dr_.woff2']
];

function downloadFile (url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' } }, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(filepath, () => {});
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function downloadFonts () {
  fs.mkdirSync(fontDir, { recursive: true });
  fs.mkdirSync(assetsFontDir, { recursive: true });
  for (const [filename, url] of ARVO_WOFF2) {
    const filepath = path.join(fontDir, filename);
    process.stdout.write(`Downloading ${filename}... `);
    try {
      await downloadFile(url, filepath);
      const destAssets = path.join(assetsFontDir, filename);
      fs.copyFileSync(filepath, destAssets);
      console.log('ok → libraries/…/fonts + assets/themes/…/fonts');
    } catch (err) {
      console.error(err.message || err);
    }
  }
}

downloadFonts().catch(console.error);
