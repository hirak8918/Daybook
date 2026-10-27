/**
 * Generates the app icons from code — no native image dependency, no binary
 * blobs checked in by hand.
 *
 *   build/icon.ico          multi-resolution: 16, 24, 32, 48, 64, 128, 256
 *   build/icon.png          512px master
 *   electron/assets/tray-light.png   ink mark for a light Windows taskbar
 *   electron/assets/tray-dark.png    cream mark for a dark Windows taskbar
 *
 * The mark: a printed page with four column rules, the second one vermilion —
 * legible at 16px, unmistakably editorial.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PAPER = [244, 239, 230, 255];
const INK = [22, 20, 18, 255];
const VERMILION = [229, 57, 31, 255];
const CLEAR = [0, 0, 0, 0];

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder (truecolour + alpha, filter 0)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO supports BMP (DIB) or PNG payloads. Small sizes use DIB for maximum
 *  shell compatibility; 256px uses PNG (the Windows convention). */
function bmpPayload(width, height, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(width * height * 4, 20);
  header.writeInt32LE(2835, 24);
  header.writeInt32LE(2835, 28);

  const xor = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = ((height - 1 - y) * width + x) * 4;
      const di = (y * width + x) * 4;
      xor[di] = rgba[si + 2];
      xor[di + 1] = rgba[si + 1];
      xor[di + 2] = rgba[si];
      xor[di + 3] = rgba[si + 3];
    }
  }

  const maskRow = Math.ceil(width / 32) * 4;
  const and = Buffer.alloc(maskRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[((height - 1 - y) * width + x) * 4 + 3];
      if (a < 128) and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  const payloads = [];
  for (const img of images) {
    const payload = img.size >= 256 ? img.png : bmpPayload(img.size, img.size, img.rgba);
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size;
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(payload.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += payload.length;
    entries.push(entry);
    payloads.push(payload);
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

/* ------------------------------------------------------------------ *
 * Rasteriser
 * ------------------------------------------------------------------ */

/** Rounded-rect coverage test in unit space. */
function insideRoundRect(x, y, radius) {
  const r = radius;
  if (x >= r && x <= 1 - r) return y >= 0 && y <= 1;
  if (y >= r && y <= 1 - r) return x >= 0 && x <= 1;
  const cx = x < r ? r : 1 - r;
  const cy = y < r ? r : 1 - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** The mark itself, in normalised space. */
function sampleMark(x, y, { bare, size }) {
  const bars =
    size <= 24
      ? [
          { y: 0.30, w: 0.56, h: 0.12, color: INK },
          { y: 0.48, w: 0.36, h: 0.12, color: VERMILION },
          { y: 0.66, w: 0.48, h: 0.12, color: INK },
        ]
      : [
          { y: 0.255, w: 0.56, h: 0.078, color: INK },
          { y: 0.40, w: 0.34, h: 0.078, color: VERMILION },
          { y: 0.545, w: 0.48, h: 0.078, color: INK },
          { y: 0.69, w: 0.22, h: 0.078, color: INK },
        ];
  for (const bar of bars) {
    if (x >= 0.22 && x <= 0.22 + bar.w && y >= bar.y && y <= bar.y + bar.h) return bar.color;
  }
  if (bare) return CLEAR;
  return PAPER;
}

function render(size, { bare = false, glyph = INK, glyphAccent = VERMILION, radius = 0.17 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 supersampling
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          let color;
          if (!insideRoundRect(u, v, radius)) color = CLEAR;
          else color = sampleMark(u, v, { bare, size });
          if (color === INK && bare) color = glyph;
          if (color === VERMILION && bare) color = glyphAccent;
          if (color === PAPER && bare) color = CLEAR;
          r += color[0] * (color[3] / 255);
          g += color[1] * (color[3] / 255);
          b += color[2] * (color[3] / 255);
          a += color[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const di = (py * size + px) * 4;
      if (alpha <= 0) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = rgba[di + 3] = 0;
      } else {
        // un-premultiply for correct colours on the anti-aliased edge
        const scale = (a / 255) || 1;
        rgba[di] = Math.min(255, Math.round(r / scale));
        rgba[di + 1] = Math.min(255, Math.round(g / scale));
        rgba[di + 2] = Math.min(255, Math.round(b / scale));
        rgba[di + 3] = Math.round(alpha);
      }
    }
  }
  return rgba;
}

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */

const buildDir = path.join(root, 'build');
const assetDir = path.join(root, 'electron', 'assets');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(assetDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, rgba: render(size), png: Buffer.alloc(0) }));
for (const img of images) img.png = encodePNG(img.size, img.size, img.rgba);

fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(images));
fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePNG(512, 512, render(512)));
fs.writeFileSync(path.join(buildDir, 'icon-256.png'), encodePNG(256, 256, render(256)));

// Tray glyphs: transparent background so they sit on any taskbar colour.
const trayLight = render(32, { bare: true, glyph: INK, glyphAccent: VERMILION, radius: 0.12 });
const trayDark = render(32, { bare: true, glyph: [246, 241, 232, 255], glyphAccent: VERMILION, radius: 0.12 });
fs.writeFileSync(path.join(assetDir, 'tray-light.png'), encodePNG(32, 32, trayLight));
fs.writeFileSync(path.join(assetDir, 'tray-dark.png'), encodePNG(32, 32, trayDark));
// Runtime copy (copied again into dist-electron/assets by the build script) —
// used for the window icon and as the toast notification icon on Windows.
fs.writeFileSync(path.join(assetDir, 'icon-256.png'), encodePNG(256, 256, render(256)));

console.log(`[icons] build/icon.ico (${sizes.join(', ')})`);
console.log('[icons] build/icon.png, build/icon-256.png');
console.log('[icons] electron/assets/tray-light.png, tray-dark.png');
