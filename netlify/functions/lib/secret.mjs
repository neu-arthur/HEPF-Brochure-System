// Small AES-256-GCM helper, keyed off the same PAYLOAD_KEY the brochure is
// sealed with. Used for the provider API key, which must survive in Blobs
// without ever being readable from a blob dump.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const hex = (process.env.PAYLOAD_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('PAYLOAD_KEY is not set on this site');
  return Buffer.from(hex, 'hex');
}

export function seal(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function unseal(blob) {
  const raw = Buffer.from(String(blob), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** Last four characters, for showing which key is loaded without showing it. */
export const hint = (k) => 'ending ' + String(k).slice(-4);
