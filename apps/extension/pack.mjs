import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Empaquette l'extension (déjà buildée par build.mjs) en un .zip installable,
// servi par la console (public/downloads/) pour la voie « poste individuel » :
// l'utilisateur télécharge, dézippe, charge « non empaquetée » — SANS passer par
// le Chrome Web Store (pas encore publié) ni par le doc GitHub. La structure du
// zip = un dossier d'extension prêt à charger (manifest à la racine, code sous
// vendor/, exactement comme référencé par manifest.json et popup.html).
//
// ZIP « fait main » (méthode STORE, sans compression) : ~90 Ko de fichiers, aucune
// dépendance à ajouter au monorepo. Correct = en-têtes locaux + répertoire central
// + CRC32 standard.

// Fichiers à empaqueter, avec leur CHEMIN DANS LE ZIP (doit matcher manifest.json).
const FILES = [
  { zip: "manifest.json", src: "manifest.json" },
  { zip: "popup.html", src: "popup.html" },
  { zip: "vendor/background.js", src: "vendor/background.js" },
  { zip: "vendor/popup.js", src: "vendor/popup.js" },
  { zip: "vendor/mip-rum.js", src: "vendor/mip-rum.js" },
  { zip: "icons/icon-16.png", src: "icons/icon-16.png" },
  { zip: "icons/icon-32.png", src: "icons/icon-32.png" },
  { zip: "icons/icon-48.png", src: "icons/icon-48.png" },
  { zip: "icons/icon-128.png", src: "icons/icon-128.png" },
];
const OUT = "../console/public/downloads/mip-rum-extension.zip";

// CRC32 (table standard IEEE 802.3, polynôme 0xEDB88320).
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

// Date DOS figée (2020-01-01 00:00:00) : zip reproductible, pas de bruit de diff
// binaire à chaque re-packaging. Format DOS : (an-1980)<<9 | mois<<5 | jour ; heure.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const chunks = [];
const central = [];
let offset = 0;

for (const f of FILES) {
  const data = readFileSync(new URL(f.src, import.meta.url));
  const name = Buffer.from(f.zip, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // signature en-tête local
  local.writeUInt16LE(20, 4); // version nécessaire
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // méthode : 0 = STORE
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); // taille compressée = brute (STORE)
  local.writeUInt32LE(data.length, 22); // taille brute
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra len
  chunks.push(local, name, data);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); // signature répertoire central
  cd.writeUInt16LE(20, 4); // version créatrice
  cd.writeUInt16LE(20, 6); // version nécessaire
  cd.writeUInt16LE(0, 8); // flags
  cd.writeUInt16LE(0, 10); // méthode
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt16LE(0, 30); // extra
  cd.writeUInt16LE(0, 32); // commentaire
  cd.writeUInt16LE(0, 34); // disque
  cd.writeUInt16LE(0, 36); // attrs internes
  cd.writeUInt32LE(0, 38); // attrs externes
  cd.writeUInt32LE(offset, 42); // offset en-tête local
  central.push(cd, name);

  offset += local.length + name.length + data.length;
}

const cdBuf = Buffer.concat(central);
const cdOffset = offset;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // End Of Central Directory
eocd.writeUInt16LE(0, 4); // n° disque
eocd.writeUInt16LE(0, 6); // disque du CD
eocd.writeUInt16LE(FILES.length, 8); // entrées sur ce disque
eocd.writeUInt16LE(FILES.length, 10); // total entrées
eocd.writeUInt32LE(cdBuf.length, 12); // taille CD
eocd.writeUInt32LE(cdOffset, 16); // offset CD
eocd.writeUInt16LE(0, 20); // commentaire

const zip = Buffer.concat([...chunks, cdBuf, eocd]);
mkdirSync(new URL("../console/public/downloads/", import.meta.url), { recursive: true });
writeFileSync(new URL(OUT, import.meta.url), zip);
console.log(`${OUT} — ${FILES.length} fichiers, ${(zip.length / 1024).toFixed(1)} Ko`);
