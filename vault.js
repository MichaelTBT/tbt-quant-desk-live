// Password lock for the hosted dashboard. The public site only holds encrypted data files:
// gzip(JSON), sealed with AES-256-GCM under a key derived from the password (PBKDF2-SHA256).
// File layout: "TBT1" (4 bytes) | salt (16) | iv (12) | ciphertext + tag.
// src/live/site.ts writes these files; this module (browser, and Node for tests) reads them.
export const MAGIC = 'TBT1';
export const ITERATIONS = 600_000;
const subtle = globalThis.crypto.subtle;

const header = (buf) => {
  const b = new Uint8Array(buf);
  if (b.length < 33 || new TextDecoder().decode(b.slice(0, 4)) !== MAGIC) throw new Error('Not a desk data file');
  return { salt: b.slice(4, 20), iv: b.slice(20, 32), body: b.slice(32) };
};
export const saltOf = (buf) => toB64(header(buf).salt);

export async function deriveKey(password, saltB64) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password.trim()), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

// Throws if the key is wrong (GCM authentication fails) or the file is damaged.
export async function open(key, buf) {
  const { iv, body } = header(buf);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

// Remember the derived key (never the password) so the phone unlocks without retyping.
export const exportKey = async (key) => toB64(new Uint8Array(await subtle.exportKey('raw', key)));
export const importKey = (b64) => subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['decrypt']);

function toB64(bytes) { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); }
function fromB64(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
