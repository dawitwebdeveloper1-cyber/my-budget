// Keeps your encrypted data on this device and holds the unlock key in memory only while unlocked.
import {
  createVault, openVault, encryptData, decryptData, wrapWithSecret, wrapWithBytes, unwrapWithBytes,
  newRecoveryKey, randomBytes, toB64, fromB64, PASS_ITERATIONS, RECOVERY_ITERATIONS, validPasscode,
} from './crypto.js';

const VAULT_KEY = 'mybudget.vault';
const PLAIN_KEY = 'mybudget.v1';

let dataKey = null; // only in memory, only while unlocked
let chain = Promise.resolve();

export function readVault() {
  try {
    const v = JSON.parse(localStorage.getItem(VAULT_KEY));
    return v && v.v === 1 && v.pass && v.rec && v.data ? v : null;
  } catch {
    return null;
  }
}

function writeVault(v) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
}

export const hasVault = () => readVault() !== null;
export const isUnlocked = () => dataKey !== null;
export const passLength = () => readVault()?.passLen ?? 6;

// ---------- Set up ----------
export async function setupVault(state, passcode, recoveryKey) {
  const made = await createVault(state, passcode, recoveryKey);
  writeVault(made.vault);
  localStorage.removeItem(PLAIN_KEY); // the unencrypted copy is removed
  dataKey = made.dataKey;
}

// ---------- Saving ----------
export function saveEncrypted(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  chain = chain.then(async () => {
    if (!dataKey) return;
    const data = await encryptData(dataKey, snapshot);
    const v = readVault();
    if (!v) return;
    v.data = data;
    writeVault(v);
  });
  return chain;
}

export function flush() {
  return chain;
}

// ---------- Unlocking (with a growing wait after repeated wrong tries) ----------
export function waitSeconds() {
  const v = readVault();
  if (!v?.until) return 0;
  return Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
}

function recordFailure() {
  const v = readVault();
  v.fails = (v.fails ?? 0) + 1;
  if (v.fails >= 5) v.until = Date.now() + Math.min(3600, 30 * 2 ** (v.fails - 5)) * 1000;
  writeVault(v);
}

function clearFailures() {
  const v = readVault();
  if (v.fails || v.until) { delete v.fails; delete v.until; writeVault(v); }
}

async function finishUnlock(dk) {
  const v = readVault();
  const state = await decryptData(dk, v.data);
  dataKey = dk;
  clearFailures();
  return state;
}

// secret = passcode or recovery key. Returns { ok, state } or { ok: false, wait }.
export async function unlock(secret) {
  if (waitSeconds() > 0) return { ok: false, wait: waitSeconds() };
  const dk = await openVault(readVault(), secret);
  if (!dk) { recordFailure(); return { ok: false, wait: waitSeconds() }; }
  try {
    return { ok: true, state: await finishUnlock(dk) };
  } catch {
    return { ok: false, damaged: true };
  }
}

export async function checkPasscode(passcode) {
  const v = readVault();
  return !!(v && validPasscode(passcode) && (await openVault({ pass: v.pass }, passcode)));
}

export function lock() {
  dataKey = null;
}

// ---------- Changing secrets (while unlocked) ----------
export async function changePasscode(passcode) {
  if (!dataKey || !validPasscode(passcode)) throw new Error('Not unlocked');
  const pass = await wrapWithSecret(dataKey, passcode, PASS_ITERATIONS);
  const v = readVault();
  v.pass = pass;
  v.passLen = passcode.length;
  writeVault(v);
}

export async function replaceRecoveryKey() {
  if (!dataKey) throw new Error('Not unlocked');
  const key = newRecoveryKey();
  return {
    key,
    save: async () => {
      const rec = await wrapWithSecret(dataKey, key, RECOVERY_ITERATIONS);
      const v = readVault();
      v.rec = rec;
      writeVault(v);
    },
  };
}

// ---------- Backups ----------
export function backupParts() {
  return { vault: readVault(), dataKey };
}

// Use an encrypted backup's passcode and recovery key on a device that has none yet.
export async function adoptBackup(backup, dk, state) {
  writeVault({ v: 1, passLen: backup.passLen ?? 6, pass: backup.pass, rec: backup.rec, bio: null, data: await encryptData(dk, state) });
  localStorage.removeItem(PLAIN_KEY);
  dataKey = dk;
}

// ---------- Face ID (passkey with the PRF extension) ----------
export function bioEnabled() {
  return !!readVault()?.bio;
}

export function bioAvailable() {
  return typeof window !== 'undefined' && window.isSecureContext && !!window.PublicKeyCredential;
}

async function prfFromPasskey(credId, salt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = assertion?.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error('unsupported');
  return new Uint8Array(out);
}

// Creates a Face ID passkey for this app and locks a copy of the data key with it.
export async function enableBio() {
  if (!dataKey) return { ok: false, error: 'Unlock first.' };
  if (!bioAvailable()) return { ok: false, error: "Face ID unlock isn't available here. Your passcode still works." };
  try {
    const salt = randomBytes(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'My Budget', id: location.hostname },
        user: { id: randomBytes(16), name: 'My Budget', displayName: 'My Budget' },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const ext = cred.getClientExtensionResults?.() ?? {};
    if (!ext.prf?.enabled) return { ok: false, error: "This phone can't use Face ID for encrypted apps yet (it needs iOS 18 or newer). Your passcode still works." };
    const credId = new Uint8Array(cred.rawId);
    const prf = ext.prf.results?.first ? new Uint8Array(ext.prf.results.first) : await prfFromPasskey(credId, salt);
    const wrapped = await wrapWithBytes(dataKey, prf);
    const v = readVault();
    v.bio = { credId: toB64(credId), salt: toB64(salt), ...wrapped };
    writeVault(v);
    return { ok: true };
  } catch (e) {
    if (e?.name === 'NotAllowedError') return { ok: false, error: 'Face ID was cancelled.' };
    return { ok: false, error: "Face ID couldn't be set up on this device. Your passcode still works." };
  }
}

export function disableBio() {
  const v = readVault();
  if (v) { v.bio = null; writeVault(v); }
}

export async function unlockBio() {
  const v = readVault();
  if (!v?.bio) return { ok: false };
  if (waitSeconds() > 0) return { ok: false, wait: waitSeconds() };
  try {
    const prf = await prfFromPasskey(fromB64(v.bio.credId), fromB64(v.bio.salt));
    const dk = await unwrapWithBytes(v.bio, prf);
    return { ok: true, state: await finishUnlock(dk) };
  } catch {
    return { ok: false };
  }
}
