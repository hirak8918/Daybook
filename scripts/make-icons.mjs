/**
 * Generates the app icons and tray glyphs from the new Daybook SVG mark.
 *
 *   build/icon.ico          multi-resolution: 16, 24, 32, 48, 64, 128, 256
 *   build/icon.png          512px master
 *   electron/assets/tray-light.png   navy mark for a light Windows taskbar
 *   electron/assets/tray-dark.png    cream mark for a dark Windows taskbar
 *   src/assets/logo.png     1024px transparent PNG of the mark
 *
 * Sharp rasterises the bundled SVG, so the icon and the in-app mark can never
 * drift apart. The .ico stores PNG payloads, supported by every Windows version
 * Daybook targets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const logoFile = path.join(root, 'src', 'assets', 'logo.svg');
const logoSource = fs.readFileSync(logoFile, 'utf8');

const NAVY = '#001766';
const PAPER = '#F4EFE6';
const INK = '#161412';
const CREAM = '#F1EADF';

const markSvg = (color) => Buffer.from(logoSource.replace(/currentColor/g, color));

async function mark(size, color) {
  const { data, info } = await sharp(markSvg(color))
    .resize({ height: size, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function icon(size, { bare = false, color = NAVY } = {}) {
  const artwork = await mark(Math.round(size * (bare ? 0.82 : 0.64)), color);
  const left = Math.round((size - artwork.width) / 2);
  const top = Math.round((size - artwork.height) / 2);
  const base = bare
    ? sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
    : sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
            `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.17)}" fill="${PAPER}"/>` +
            `</svg>`,
        ),
      );
  return base.composite([{ input: artwork.data, left, top }]).png().toBuffer();
}

/** ICO with PNG payloads; Windows Vista and newer read all of them. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  const payloads = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
    payloads.push(image.png);
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

const buildDir = path.join(root, 'build');
const assetDir = path.join(root, 'electron', 'assets');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(assetDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map(async (size) => ({ size, png: await icon(size) })),
);

fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(images));
fs.writeFileSync(path.join(buildDir, 'icon.png'), await icon(512));
fs.writeFileSync(path.join(buildDir, 'icon-256.png'), await icon(256));
fs.writeFileSync(path.join(assetDir, 'icon-256.png'), await icon(256));

fs.writeFileSync(path.join(assetDir, 'tray-light.png'), await icon(32, { bare: true, color: INK }));
fs.writeFileSync(path.join(assetDir, 'tray-dark.png'), await icon(32, { bare: true, color: CREAM }));

// The requested PNG sibling of the SVG, at a useful size and transparent.
fs.writeFileSync(path.join(root, 'src', 'assets', 'logo.png'), await icon(1024, { bare: true, color: NAVY }));

console.log(`[icons] build/icon.ico (${sizes.join(', ')})`);
console.log('[icons] build/icon.png, build/icon-256.png');
console.log('[icons] electron/assets/tray-light.png, tray-dark.png');
console.log('[icons] src/assets/logo.png (1024px transparent)');
