#!/usr/bin/env node
// Pipeworks gift-link tool. Runs on YOUR computer only. Node 18+, no dependencies.
//
//   node tools/gift-sign.mjs keygen                 make your key pair (private key stays OUTSIDE the repo)
//   node tools/gift-sign.mjs make --message "Happy birthday!" --code ABCD-123456-EFGH \
//        --url https://www.amazon.com/gc/redeem --name Sam --expires 2027-06-30 --qr sam.svg
//   node tools/gift-sign.mjs verify "<gift url>" [--passphrase "..."]
//
// The passphrase is asked for interactively if you don't pass --passphrase (keeps it out of shell history).
// See CLAUDE.md "Gift links" for the design. The PRIVATE KEY must never be committed or shared.

import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const subtle = crypto.subtle;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(HERE, '..', 'index.html');
const DEFAULT_KEY = path.join(os.homedir(), '.pipeworks', 'gift-private.jwk');
const DEFAULT_BASE = 'https://bbarcio.github.io/bpipeworks/';
const VERSION = 1;
const KDF_ITER = 300000;              // must match GIFT_KDF_ITER in index.html
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// ---------- small helpers ----------
const die = msg => { console.error('\n  ' + msg + '\n'); process.exit(1); };
const b64url = u8 => Buffer.from(u8).toString('base64url');
const unb64url = s => new Uint8Array(Buffer.from(s, 'base64url'));
// Must match giftNormalize() in index.html
const normalize = s => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a); }));
}
function insideGitRepo(p) {
  let d = path.dirname(path.resolve(p));
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
const pubOnly = jwk => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
function readPrivateKey(file) {
  if (!fs.existsSync(file)) die(`No private key at ${file}. Run "keygen" first, or pass --key <file>.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// Read GIFT_PUBLIC_KEY / GIFT_ALLOWED_HOSTS from index.html (if this script sits in the repo)
function fromIndexHtml() {
  try {
    const src = fs.readFileSync(INDEX_HTML, 'utf8');
    const k = src.match(/const GIFT_PUBLIC_KEY = (\{[^;]*\}|null);/);
    const h = src.match(/const GIFT_ALLOWED_HOSTS = (\[[^\]]*\]);/);
    return { publicKey: k && k[1] !== 'null' ? JSON.parse(k[1]) : null,
             hosts: h ? JSON.parse(h[1].replace(/'/g, '"')) : null };
  } catch (e) { return { publicKey: null, hosts: null }; }
}
function parseExpiry(s) {
  if (!s) return Math.floor(Date.now() / 1000) + 365 * 86400;      // default: one year
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) die('--expires must look like 2027-06-30');
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59) / 1000;
  if (t < Date.now() / 1000) die('That expiry date is in the past.');
  return t;
}

// ---------- gift blob ----------
// ver(1) | exp(4, unix seconds, big-endian) | salt(16) | iv(12) | AES-GCM ciphertext+tag | ECDSA sig(64, raw r||s)
async function makeBlob(privJwk, payload, passphrase, exp) {
  const head = new Uint8Array(5);
  head[0] = VERSION; new DataView(head.buffer).setUint32(1, exp);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey('raw', new TextEncoder().encode(normalize(passphrase)), 'PBKDF2', false, ['deriveKey']);
  const aes = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KDF_ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, aes,
    new TextEncoder().encode(JSON.stringify(payload))));
  const body = new Uint8Array([...head, ...salt, ...iv, ...ct]);
  const key = await subtle.importKey('jwk', privJwk, ECDSA, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign(SIGN, key, body));
  return new Uint8Array([...body, ...sig]);
}
async function checkBlob(blob, pubJwk, passphrase) {
  if (blob.length < 1 + 4 + 16 + 12 + 16 + 64 || blob[0] !== VERSION) return { ok: false, why: 'not a v1 gift' };
  const body = blob.subarray(0, blob.length - 64), sig = blob.subarray(blob.length - 64);
  const key = await subtle.importKey('jwk', pubJwk, ECDSA, false, ['verify']);
  if (!await subtle.verify(SIGN, key, sig, body)) return { ok: false, why: 'BAD SIGNATURE (not signed by this key, or altered)' };
  const exp = new DataView(blob.buffer, blob.byteOffset + 1, 4).getUint32(0);
  const res = { ok: true, exp, expired: Date.now() / 1000 > exp };
  if (passphrase !== undefined) {
    try {
      const base = await subtle.importKey('raw', new TextEncoder().encode(normalize(passphrase)), 'PBKDF2', false, ['deriveKey']);
      const aes = await subtle.deriveKey({ name: 'PBKDF2', salt: body.subarray(5, 21), iterations: KDF_ITER, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(21, 33), additionalData: body.subarray(0, 5) },
        aes, body.subarray(33));
      res.payload = JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { res.payload = null; }
  }
  return res;
}

// ---------- QR code encoder (byte mode), after Project Nayuki's public-domain-style reference design ----------
const ECC_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const bit = (x, i) => ((x >>> i) & 1) !== 0;
function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}
function qrEncode(bytes, ecl = 'M') {
  let ver = 1;
  for (; ver <= 40; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, ecl) * 8) break;
  }
  if (ver > 40) throw new Error('too much data for a QR code');
  // bit stream
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, ecl) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // error correction + interleave
  const nb = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
  const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]); });
  // matrix
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
    }
  const align = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    align.push(6);
    for (let p = size - 7; align.length < n; p -= step) align.splice(1, 0, p);
  }
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const d = (ECL_BITS[ecl] << 3) | mask;
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, bit(b, i)); setF(c, a, bit(b, i)); }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && i < codewords.length * 8) { mod[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const line = get => {                                // runs of 5+ and finder-like patterns along one line
      let run = 0, prev = null;
      const s = []; for (let k = 0; k < size; k++) s.push(get(k));
      for (let k = 0; k < size; k++) {
        if (s[k] === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = s[k]; }
      }
      const pat = [true, false, true, true, true, false, true];
      for (let k = -4; k + 7 + 4 <= size + 4; k++) {
        if (!pat.every((v, q) => s[k + 4 + q] === v)) continue;
        const lightBefore = [0, 1, 2, 3].every(q => !s[k + q]), lightAfter = [0, 1, 2, 3].every(q => !s[k + 11 + q]);
        if (lightBefore || lightAfter) p += 40;
      }
    };
    for (let y = 0; y < size; y++) line(x => mod[y][x]);
    for (let x = 0; x < size; x++) line(y => mod[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    for (const row of mod) for (const c of row) if (c) dark++;
    const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty(); if (p < bestP) { bestP = p; best = m; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return { size, ver, ecl, modules: mod };
}
function qrSvg(qr, caption) {
  const q = 4, n = qr.size + q * 2, capH = caption ? 6 : 0;
  let d = '';
  qr.modules.forEach((row, y) => row.forEach((c, x) => { if (c) d += `M${x + q},${y + q}h1v1h-1z`; }));
  const cap = caption ? `<text x="${n / 2}" y="${n + 3}" font-family="sans-serif" font-size="2.6" text-anchor="middle">${
    caption.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]))}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n + capH}" width="${n * 8}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n + capH}" fill="#fff"/><path d="${d}" fill="#000"/>${cap}</svg>\n`;
}
function qrTerminal(qr) {                            // two rows per text line, with a quiet zone
  const q = 2, get = (x, y) => x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.modules[y][x];
  const lines = [];
  for (let y = -q; y < qr.size + q; y += 2) {
    let s = '';
    for (let x = -q; x < qr.size + q; x++) {
      const a = get(x, y), b = get(x, y + 1);       // dark = black, printed on a light terminal background
      s += a && b ? ' ' : a ? '▄' : b ? '▀' : '█';
    }
    lines.push(s);
  }
  return lines.join('\n');
}

// ---------- commands ----------
async function keygen(args) {
  const file = path.resolve(args.out || DEFAULT_KEY);
  const repo = insideGitRepo(file);
  if (repo && !args['i-know']) die(`Refusing to write the private key inside a git repo (${repo}).\n  Pick a path outside it, e.g. the default ${DEFAULT_KEY}`);
  if (fs.existsSync(file) && !args.force) die(`${file} already exists. Making a new key makes every QR you've printed invalid.\n  Use --force if you really mean it.`);
  const kp = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const priv = await subtle.exportKey('jwk', kp.privateKey), pub = pubOnly(await subtle.exportKey('jwk', kp.publicKey));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(priv) + '\n', { mode: 0o600 });
  console.log(`\nPrivate key saved to ${file} (only you can read it).`);
  console.log('Keep it secret, back it up somewhere safe, and NEVER commit it.\n');
  console.log('Paste this line into index.html, replacing "const GIFT_PUBLIC_KEY = null;" (the public key is safe to publish):\n');
  console.log(`const GIFT_PUBLIC_KEY = ${JSON.stringify(pub)};\n`);
}

async function make(args) {
  const priv = readPrivateKey(path.resolve(args.key || DEFAULT_KEY));
  if (typeof args.message !== 'string' || !args.message.trim()) die('--message "..." is required.');
  if (typeof args.code !== 'string' && typeof args.url !== 'string') die('Give a --code (gift card claim code), a --url (claim link), or both.');
  const payload = { m: args.message.trim() };
  if (typeof args.name === 'string') payload.n = args.name.trim();
  if (typeof args.code === 'string') payload.c = args.code.trim();
  if (typeof args.url === 'string') {
    let u; try { u = new URL(args.url); } catch (e) { die('--url is not a valid link.'); }
    if (u.protocol !== 'https:') die('--url must start with https://');
    const { hosts } = fromIndexHtml();
    if (hosts && !hosts.includes(u.hostname))
      console.warn(`\n  WARNING: ${u.hostname} is not in GIFT_ALLOWED_HOSTS ${JSON.stringify(hosts)} in index.html.\n  The game will NOT show the Redeem button for it unless you add it there.`);
    payload.u = u.href;
  }
  let pass = typeof args.passphrase === 'string' ? args.passphrase : await ask('Passphrase for this gift (tell the recipient separately): ');
  if (!normalize(pass)) die('The passphrase cannot be empty.');
  if (normalize(pass).length < 8 || !normalize(pass).includes(' '))
    console.warn('\n  Tip: a short or single-word passphrase is easier to guess. Two or three words is better ("biscuit loves tuna").');
  const exp = parseExpiry(args.expires);
  const blob = await makeBlob(priv, payload, pass, exp);
  let base = typeof args.base === 'string' ? args.base : DEFAULT_BASE;
  const url = base.replace(/#.*$/, '') + '#g=' + b64url(blob);
  // self-check: verify + decrypt what we just made
  const chk = await checkBlob(blob, pubOnly(priv), pass);
  if (!chk.ok || !chk.payload) die('Self-check failed. Nothing was produced.');
  const { publicKey } = fromIndexHtml();
  if (!publicKey) console.warn('\n  Note: index.html has no GIFT_PUBLIC_KEY yet, so the live game will ignore this link until you add it.');
  else if (publicKey.x !== priv.x || publicKey.y !== priv.y) console.warn('\n  WARNING: this key does NOT match GIFT_PUBLIC_KEY in index.html. The game will ignore this link.');
  const qr = qrEncode(new TextEncoder().encode(url), 'M');
  console.log(`\nGift for ${payload.n || '(no name)'}  expires ${new Date(exp * 1000).toISOString().slice(0, 10)}`);
  console.log(`URL (${url.length} chars, QR version ${qr.ver}, ${qr.size}x${qr.size} modules):\n\n${url}\n`);
  if (qr.ver > 15) console.warn(`  The QR is dense (version ${qr.ver}). Shorten the message, or print it at least 4 cm wide.\n`);
  if (args.qr) {
    const file = path.resolve(typeof args.qr === 'string' ? args.qr : 'gift.svg');
    fs.writeFileSync(file, qrSvg(qr, args.caption === undefined ? (payload.n ? `For ${payload.n}` : '') : String(args.caption)));
    console.log(`QR saved to ${file} (print at least 3 cm wide; scan-test it before you hand it over).`);
  }
  if (args.show) console.log('\n' + qrTerminal(qr) + '\n');
  console.log('Remember: give the passphrase separately, never on the same card as the QR.\n');
}

async function verify(args) {
  const url = args._[1];
  if (!url) die('Usage: verify "<gift url>" [--passphrase "..."] [--key private.jwk]');
  const m = /[#&]g=([A-Za-z0-9_-]+)/.exec(url);
  if (!m) die('That URL has no #g= gift in it.');
  let pub = fromIndexHtml().publicKey, src = 'index.html';
  if (args.key || !pub) { pub = pubOnly(readPrivateKey(path.resolve(args.key || DEFAULT_KEY))); src = 'your private key file'; }
  const res = await checkBlob(unb64url(m[1]), pub, typeof args.passphrase === 'string' ? args.passphrase : undefined);
  if (!res.ok) die(`INVALID: ${res.why} (checked against ${src}).`);
  console.log(`\nSignature OK (checked against ${src}). Expires ${new Date(res.exp * 1000).toISOString().slice(0, 10)}${res.expired ? '  ** EXPIRED **' : ''}.`);
  if ('payload' in res) console.log(res.payload ? 'Passphrase OK. Contents:\n' + JSON.stringify(res.payload, null, 2) : 'Passphrase is WRONG for this gift.');
  console.log('');
}

export { qrEncode, makeBlob, checkBlob, normalize };   // for tests
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = parseArgs(isMain ? process.argv.slice(2) : ['--imported']);
const cmd = isMain ? args._[0] : 'imported';
const run = { keygen, make, verify, imported: async () => {} }[cmd];
if (!run) {
  console.log(`
Pipeworks gift links

  node tools/gift-sign.mjs keygen [--out file]
      Make your signing key pair. Private key goes to ${DEFAULT_KEY} (outside the repo).

  node tools/gift-sign.mjs make --message "..." [--name Sam] [--code CLAIM-CODE] [--url https://...]
      [--expires YYYY-MM-DD] [--passphrase "..."] [--qr file.svg] [--show] [--base URL] [--key file]
      Make one recipient's gift link (and QR). Asks for the passphrase if you leave it out.

  node tools/gift-sign.mjs verify "<url>" [--passphrase "..."]
      Check a gift link before you print it.
`);
  process.exit(cmd ? 1 : 0);
}
run(args).catch(e => die(e.stack || String(e)));
