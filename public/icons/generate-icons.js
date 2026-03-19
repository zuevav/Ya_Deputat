// Generate simple PNG icons using canvas-like SVG approach
const fs = require('fs');

function createSvgIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#1a237e"/>
  <text x="50%" y="42%" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="bold" font-size="${size * 0.2}" fill="white">Я</text>
  <text x="50%" y="68%" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="bold" font-size="${size * 0.13}" fill="#ffab00">ДЕПУТАТ</text>
</svg>`;
}

fs.writeFileSync(__dirname + '/icon-192.svg', createSvgIcon(192));
fs.writeFileSync(__dirname + '/icon-512.svg', createSvgIcon(512));
console.log('SVG icons created');
