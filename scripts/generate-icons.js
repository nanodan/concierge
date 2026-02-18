const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create icon SVG
function createIconSvg(size, maskable = false) {
  const radius = maskable ? 0 : Math.floor(size * 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="#E8963A"/>
    <text x="${size/2}" y="${size * 0.66}" font-size="${size * 0.55}" font-family="system-ui,sans-serif" font-weight="600" text-anchor="middle" fill="white">C</text>
  </svg>`;
}

async function generateIcons() {
  const sizes = [192, 512];
  
  for (const size of sizes) {
    // Regular icon
    await sharp(Buffer.from(createIconSvg(size, false)))
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon-${size}.png`));
    console.log(`Created icon-${size}.png`);
    
    // Maskable icon (no rounded corners, full bleed)
    if (size === 512) {
      await sharp(Buffer.from(createIconSvg(size, true)))
        .resize(size, size)
        .png()
        .toFile(path.join(iconsDir, `icon-maskable-${size}.png`));
      console.log(`Created icon-maskable-${size}.png`);
    }
  }
  
  console.log('Done! Icons generated in public/icons/');
}

generateIcons().catch(console.error);
