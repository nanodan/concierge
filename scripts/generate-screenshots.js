const sharp = require('sharp');
const path = require('path');

const iconsDir = path.join(__dirname, '../public/icons');

// Create a simple screenshot placeholder
function createScreenshotSvg(width, height, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#1F1A16"/>
    <rect x="20" y="20" width="${width-40}" height="60" rx="8" fill="#2a2420"/>
    <circle cx="60" cy="50" r="20" fill="#E8963A"/>
    <text x="${width/2}" y="${height/2}" font-size="32" font-family="system-ui,sans-serif" text-anchor="middle" fill="#888">Concierge</text>
    <text x="${width/2}" y="${height/2 + 40}" font-size="18" font-family="system-ui,sans-serif" text-anchor="middle" fill="#666">${label}</text>
  </svg>`;
}

async function generateScreenshots() {
  // Narrow (mobile) screenshot - form_factor not set or "narrow"
  await sharp(Buffer.from(createScreenshotSvg(1080, 1920, 'AI Assistant')))
    .resize(1080, 1920)
    .png()
    .toFile(path.join(iconsDir, 'screenshot-narrow.png'));
  console.log('Created screenshot-narrow.png (1080x1920)');

  // Wide (desktop) screenshot
  await sharp(Buffer.from(createScreenshotSvg(1920, 1080, 'AI Assistant')))
    .resize(1920, 1080)
    .png()
    .toFile(path.join(iconsDir, 'screenshot-wide.png'));
  console.log('Created screenshot-wide.png (1920x1080)');

  console.log('Done!');
}

generateScreenshots().catch(console.error);
