// Générateur d'icônes de l'extension — PNG déterministes, ZÉRO dépendance (zlib natif).
// Design : carré aux coins arrondis, fond accent MIP (#f89101), trois barres
// blanches croissantes (métriques / monitoring). Tailles Chrome : 16/32/48/128.
// Reproductible : mêmes octets à chaque exécution (pas de bruit de diff binaire).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const ACCENT = [0xf8, 0x91, 0x01]; // #f89101
const WHITE = [0xff, 0xff, 0xff];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Composite alpha (src sur dst), les deux [r,g,b] avec alpha src 0..1.
function over(dst, src, a) {
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
  ];
}

function renderPng(size) {
  const px = (x, y) => (y * size * 4 + x * 4);
  const buf = new Uint8Array(size * size * 4); // RGBA, transparent par défaut

  const radius = size * 0.22; // coins arrondis
  const inCorner = (x, y) => {
    // distance au centre du cercle de coin le plus proche ; renvoie alpha du fond
    const cx = x < radius ? radius : x > size - radius ? size - radius : x;
    const cy = y < radius ? radius : y > size - radius ? size - radius : y;
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= radius - 1) return 1;
    if (d >= radius) return 0;
    return radius - d; // anti-alias 1px
  };

  // barres (bar chart) : 3 barres croissantes, blanches
  const barW = size * 0.16;
  const gap = size * 0.1;
  const groupW = barW * 3 + gap * 2;
  const x0 = (size - groupW) / 2;
  const baseY = size * 0.74; // bas des barres
  const heights = [size * 0.24, size * 0.36, size * 0.5];
  const bars = heights.map((h, i) => ({
    x1: x0 + i * (barW + gap),
    x2: x0 + i * (barW + gap) + barW,
    y1: baseY - h,
    y2: baseY,
  }));
  const inBar = (x, y) =>
    bars.some((b) => x + 0.5 >= b.x1 && x + 0.5 <= b.x2 && y + 0.5 >= b.y1 && y + 0.5 <= b.y2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bgA = inCorner(x, y);
      if (bgA <= 0) continue;
      let rgb = ACCENT;
      if (inBar(x, y)) rgb = over(ACCENT, WHITE, 1);
      const i = px(x, y);
      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
      buf[i + 3] = Math.round(bgA * 255);
    }
  }

  // scanlines avec filtre 0 (None) en tête de chaque ligne
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x++) raw[y * (size * 4 + 1) + 1 + x] = buf[y * size * 4 + x];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) {
  const png = renderPng(size);
  writeFileSync(new URL(`./icon-${size}.png`, import.meta.url), png);
  console.log(`icon-${size}.png — ${png.length} o`);
}
