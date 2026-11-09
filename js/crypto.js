// Encryption for your data (standard Web Crypto, built into the browser).
//
// How it works:
//  - Your data is locked with a random 256-bit "data key" (AES-GCM).
//  - That data key is itself locked three ways, so any one of them can open it:
//      1. your passcode      (stretched with PBKDF2, 600,000 rounds)
//      2. your recovery key  (a long random code you save somewhere safe)
//      3. Face ID            (a secret released by the phone's passkey after Face ID)
//  - The passcode and recovery key are never stored anywhere.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PASS_ITERATIONS = 600_000;
export const RECOVERY_ITERATIONS = 100_000; // the recovery key is already long and random

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function aesKey(raw, usages = ['encrypt', 'decrypt']) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

async function pbkdf2Key(secret, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function hkdfKey(secretBytes, info) {
  const base = await subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(key, bytes) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function open(key, box) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return new Uint8Array(pt);
}

// ---------- Data ----------
export async function encryptData(dataKey, obj) {
  return seal(await aesKey(dataKey), enc.encode(JSON.stringify(obj)));
}

export async function decryptData(dataKey, box) {
  return JSON.parse(dec.decode(await open(await aesKey(dataKey), box)));
}

// ---------- Locking the data key ----------
export async function wrapWithSecret(dataKey, secret, iterations) {
  const salt = randomBytes(16);
  const box = await seal(await pbkdf2Key(secret, salt, iterations), dataKey);
  return { salt: toB64(salt), iter: iterations, ...box };
}

// Throws if the secret is wrong (AES-GCM refuses to open).
export async function unwrapWithSecret(wrapped, secret) {
  return open(await pbkdf2Key(secret, fromB64(wrapped.salt), wrapped.iter), wrapped);
}

export async function wrapWithBytes(dataKey, secretBytes) {
  return seal(await hkdfKey(secretBytes, 'my-budget face id'), dataKey);
}

export async function unwrapWithBytes(wrapped, secretBytes) {
  return open(await hkdfKey(secretBytes, 'my-budget face id'), wrapped);
}

// ---------- Passcode ----------
export function validPasscode(p) {
  return typeof p === 'string' && /^\d{6,12}$/.test(p);
}

// ---------- Recovery key ----------
// 160 random bits written as 32 easy-to-read characters: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U

export function newRecoveryKey() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join('-');
}

// Accepts the key typed loosely: lower case, spaces, missing dashes, O for 0, I/L for 1.
export function normalizeRecoveryKey(input) {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-Z]{32}$/.test(s) || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return s.match(/.{4}/g).join('-');
}

// ---------- A complete locked "vault" ----------
export async function createVault(state, passcode, recoveryKey, { passIter = PASS_ITERATIONS, recIter = RECOVERY_ITERATIONS } = {}) {
  if (!validPasscode(passcode)) throw new Error('Passcode must be 6 to 12 digits');
  const dataKey = randomBytes(32);
  return {
    dataKey,
    vault: {
      v: 1,
      passLen: passcode.length,
      pass: await wrapWithSecret(dataKey, passcode, passIter),
      rec: await wrapWithSecret(dataKey, normalizeRecoveryKey(recoveryKey), recIter),
      bio: null,
      data: await encryptData(dataKey, state),
    },
  };
}

// Try a passcode or recovery key against a vault. Returns the data key or null.
export async function openVault(vault, secret) {
  const rk = normalizeRecoveryKey(secret);
  try {
    if (rk && vault.rec) return await unwrapWithSecret(vault.rec, rk);
    if (validPasscode(secret) && vault.pass) return await unwrapWithSecret(vault.pass, secret);
  } catch {
    return null;
  }
  return null;
}
