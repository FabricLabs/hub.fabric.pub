'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const fonts = [
  {
    name: 'Arvo',
    weights: ['400', '700'],
    styles: ['normal', 'italic'],
    formats: ['woff2', 'woff', 'ttf']
  }
];

const fontDir = path.join(__dirname, '..', 'libraries', 'semantic', 'src', 'themes', 'sensemaker', 'assets', 'fonts');

// Create font directory if it doesn't exist
if (!fs.existsSync(fontDir)) {
  fs.mkdirSync(fontDir, { recursive: true });
}

// Download a file from URL
function downloadFile (url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
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

// Download all font files
async function downloadFonts () {
  for (const font of fonts) {
    for (const weight of font.weights) {
      for (const style of font.styles) {
        for (const format of font.formats) {
          const styleParam = style === 'italic' ? '1' : '0';
          const url = `https://fonts.gstatic.com/s/arvo/v20/tDbD2oWUg0MKqScQ6A.${format}`;
          const filename = `${font.name.toLowerCase()}-${style}-${weight}.${format}`;
          const filepath = path.join(fontDir, filename);
          
          console.log(`Downloading ${filename}...`);
          try {
            await downloadFile(url, filepath);
            console.log(`Downloaded ${filename}`);
          } catch (err) {
            console.error(`Error downloading ${filename}:`, err);
          }
        }
      }
    }
  }
}

downloadFonts().catch(console.error); 