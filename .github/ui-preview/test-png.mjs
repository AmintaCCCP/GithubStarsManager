/* Tests for the PNG structural validator in publish.mjs. Builds minimal PNGs
 * from scratch so it needs no fixtures. Run: node test-png.mjs */
import { deflateSync } from 'node:zlib';
import { isWellFormedPng } from './publish.mjs';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};
/** Minimal valid RGBA 1x1 PNG. */
const buildPng = ({ width = 1, height = 1, colorType = 6, bitDepth = 8 } = {}) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const raw = Buffer.alloc(height * (1 + width * 4), 0xff);
  for (let y = 0; y < height; y += 1) raw[y * (1 + width * 4)] = 0; // filter: none
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

let failures = 0;
const check = (name, actual, expected) => {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const good = buildPng();
check('minimal valid PNG', isWellFormedPng(good), true);
check('grayscale 1-bit variant', isWellFormedPng(buildPng({ colorType: 0, bitDepth: 1 })), true);
check('signature only rejected', isWellFormedPng(PNG_MAGIC), false);
check('signature + garbage rejected', isWellFormedPng(Buffer.concat([PNG_MAGIC, Buffer.alloc(4096, 0xde)])), false);
check('truncated rejected', isWellFormedPng(good.subarray(0, Math.floor(good.length / 2))), false);
check('trailing bytes rejected', isWellFormedPng(Buffer.concat([good, Buffer.from([0x00])])), false);

const badCrc = Buffer.from(good);
badCrc[8 + 8 + 13 + 4] ^= 0xff; // IHDR CRC byte
check('corrupted CRC rejected', isWellFormedPng(badCrc), false);

const zeroWidth = Buffer.from(good);
zeroWidth[19] = 0; // IHDR width low byte: 1 -> 0
check('zero width rejected', isWellFormedPng(zeroWidth), false);

const badColorType = buildPng();
badColorType[8 + 8 + 9] = 5; // colorType 5 is not a valid PNG color type
check('invalid color type rejected (CRC now stale)', isWellFormedPng(badColorType), false);

const twoIhdr = Buffer.concat([chunk('IHDR', Buffer.alloc(13)), good.subarray(8)]);
check('duplicate IHDR rejected', isWellFormedPng(twoIhdr), false);

process.exit(failures ? 1 : 0);
