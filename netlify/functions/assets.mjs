// HEPF brochure image assets.
//
// This is intentionally dormant until the R2 environment variables exist.
// When unconfigured the browser falls back to the existing compressed data URL
// save path, so production remains usable before Cloudflare is wired in.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { identify, json } from './lib/identity.mjs';

const MAX_SIZE = 20 * 1024 * 1024;
const EXPIRES = 300;
const IMAGE_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);
const REQUIRED_ENV = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
];

const value = (name) => String(process.env[name] || '').trim();
const configured = () => REQUIRED_ENV.every(value);

function safePart(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extension(type) {
  if (type === 'image/avif') return 'avif';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function objectKey(type, name) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = safePart(value('R2_PREFIX') || 'uploads');
  const base = safePart(String(name || '').replace(/\.[^.]+$/, '')) || 'image';
  const suffix = randomBytes(8).toString('hex');
  return `${prefix}/${yyyy}/${mm}/${Date.now()}-${suffix}-${base}.${extension(type)}`;
}

function awsEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodePath(path) {
  return path.split('/').map(awsEncode).join('/');
}

function hmac(key, data, enc) {
  return createHmac('sha256', key).update(data).digest(enc);
}

function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

function signingKey(secret, date) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request');
}

function amzDate(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function publicUrl(key) {
  return `${value('R2_PUBLIC_BASE_URL').replace(/\/+$/, '')}/${key.split('/').map(awsEncode).join('/')}`;
}

function presignedPutUrl(key, type) {
  const account = value('R2_ACCOUNT_ID');
  const accessKey = value('R2_ACCESS_KEY_ID');
  const secret = value('R2_SECRET_ACCESS_KEY');
  const bucket = value('R2_BUCKET');
  const host = `${account}.r2.cloudflarestorage.com`;
  const path = `/${awsEncode(bucket)}/${encodePath(key)}`;
  const stamp = amzDate(new Date());
  const date = stamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(EXPIRES),
    'X-Amz-SignedHeaders': 'content-type;host',
  };
  const query = Object.keys(params).sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(params[k])}`)
    .join('&');
  const canonicalHeaders = `content-type:${type}\nhost:${host}\n`;
  const canonicalRequest = [
    'PUT',
    path,
    query,
    canonicalHeaders,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    hash(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(secret, date), stringToSign, 'hex');
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error, expired: Boolean(who.expired) }, who.status);

  if (!configured()) return json({ ok: true, configured: false });

  const type = String(body.type || '').toLowerCase();
  const size = Number(body.size || 0);
  if (!IMAGE_TYPES.has(type)) return json({ error: 'unsupported image type' }, 415);
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'image size missing' }, 400);
  if (size > MAX_SIZE) return json({ error: 'image is still too large after compression' }, 413);

  const key = objectKey(type, body.name);
  return json({
    ok: true,
    configured: true,
    key,
    publicUrl: publicUrl(key),
    uploadUrl: presignedPutUrl(key, type),
    type,
    expiresIn: EXPIRES,
  });
};

export const config = { path: '/api/assets' };
