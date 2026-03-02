#!/usr/bin/env node
/**
 * Generates public/og-image.png (1200×630) using only Node.js built-ins.
 * Run: node scripts/generate-og-image.js
 *
 * Output: a gradient background (brand blue → dark slate) with a 📍-style
 * red pin centred in the frame (solid red, no inner circle).
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const W = 1200;
const H = 630;

// ── CRC-32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf    = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── Raw pixel buffer ─────────────────────────────────────────────────────────
// Layout: for each row, 1 filter byte (0) + W×3 RGB bytes
const raw = Buffer.alloc(H * (1 + W * 3));

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const offset = y * (1 + W * 3) + 1 + x * 3;
  raw[offset]     = r;
  raw[offset + 1] = g;
  raw[offset + 2] = b;
}

// ── Background: vertical gradient blue → dark slate ──────────────────────────
const [topR, topG, topB] = [0x1e, 0x3a, 0x8a]; // #1e3a8a  deep blue
const [botR, botG, botB] = [0x0f, 0x17, 0x2a]; // #0f172a  dark slate

for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(topR + (botR - topR) * t);
  const g = Math.round(topG + (botG - topG) * t);
  const b = Math.round(topB + (botB - topB) * t);
  const rowStart = y * (1 + W * 3);
  raw[rowStart] = 0; // PNG filter: none
  for (let x = 0; x < W; x++) {
    raw[rowStart + 1 + x * 3]     = r;
    raw[rowStart + 1 + x * 3 + 1] = g;
    raw[rowStart + 1 + x * 3 + 2] = b;
  }
}

// ── 📍-style teardrop pin ────────────────────────────────────────────────────
// iOS red: #FF3B30. Solid fill — no inner circle, matching the 📍 emoji look.
// Pin head: circle with radius R centred slightly above the image midpoint.
// Pin tail: narrows sharply to a point below the circle.
const PIN_CX = W / 2;          // horizontal center
const PIN_CY = H / 2 - 60;     // slightly above image center
const PIN_R  = 110;             // head radius (px)
const TIP_Y  = PIN_CY + PIN_R + 160; // sharp tip below the circle

const [pinR, pinG, pinB] = [0xFF, 0x3B, 0x30]; // #FF3B30  iOS red (📍 color)

const yMin = Math.max(0, PIN_CY - PIN_R);
const yMax = Math.min(H - 1, TIP_Y);

for (let y = yMin; y <= yMax; y++) {
  const dy = y - PIN_CY;

  // Circle region — standard circle equation
  const inCircle = dy * dy <= PIN_R * PIN_R;

  // Tail region: tapers from PIN_R width at PIN_CY to 0 at TIP_Y (quadratic curve
  // for a sharper, more emoji-accurate point rather than a blunt triangle)
  const tailProgress = y > PIN_CY && y <= TIP_Y
    ? (1 - (y - PIN_CY) / (TIP_Y - PIN_CY))
    : 0;
  const tailHalf = PIN_R * tailProgress * tailProgress;

  let xLeft, xRight;
  if (inCircle) {
    const span = Math.sqrt(PIN_R * PIN_R - dy * dy);
    xLeft  = Math.round(PIN_CX - span);
    xRight = Math.round(PIN_CX + span);
    if (y > PIN_CY) {
      xLeft  = Math.min(xLeft,  Math.round(PIN_CX - tailHalf));
      xRight = Math.max(xRight, Math.round(PIN_CX + tailHalf));
    }
  } else if (tailHalf > 0) {
    xLeft  = Math.round(PIN_CX - tailHalf);
    xRight = Math.round(PIN_CX + tailHalf);
  } else {
    continue;
  }

  for (let x = xLeft; x <= xRight; x++) {
    setPixel(x, y, pinR, pinG, pinB);
  }
}

// Small bright highlight in the upper-left of the pin head (gives 📍 depth)
const HI_CX = Math.round(PIN_CX - PIN_R * 0.28);
const HI_CY = Math.round(PIN_CY - PIN_R * 0.28);
const HI_R  = Math.round(PIN_R * 0.20);
for (let dy = -HI_R; dy <= HI_R; dy++) {
  for (let dx = -HI_R; dx <= HI_R; dx++) {
    if (dx * dx + dy * dy <= HI_R * HI_R) {
      // Soft white highlight — blend 60% white over the red
      setPixel(HI_CX + dx, HI_CY + dy, 0xFF, 0x8A, 0x85);
    }
  }
}

// ── Encode PNG ───────────────────────────────────────────────────────────────
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8]  = 8; // bit depth
ihdr[9]  = 2; // colour type: RGB
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace method

const compressed = deflateSync(raw, { level: 6 });

const png = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = join(__dirname, '..', 'public', 'og-image.png');
writeFileSync(outPath, png);
console.log(`✓  Generated ${outPath}  (${W}×${H} px, ${(png.length / 1024).toFixed(1)} KB)`);
