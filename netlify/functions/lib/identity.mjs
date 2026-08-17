// Shared Google identity check.
//
// The browser never decides who it is. It hands over the ID token Google
// issued, we verify that token against Google's own published keys, and the
// email inside the verified payload is the only name that gets stored.
//
// The allow list lives in Blobs so it can be edited from the app. The
// ALLOWED_EMAILS environment variable seeds it and is the fallback if the
// blob has never been written — changing the variable means a redeploy,
// changing the blob does not.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const clean = (list) => list
  .map((e) => String(e).trim().toLowerCase())
  .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

export const SEEDED = clean((process.env.ALLOWED_EMAILS ||
  'andrewe97@gmail.com,arthurehren@gmail.com').split(','));

const store = () => getStore('hepf-brochure-access');

export async function allowList() {
  try {
    const rec = await store().get('allow', { type: 'json' });
    const list = clean(Array.isArray(rec?.emails) ? rec.emails : []);
    if (list.length) return list;
  } catch {}
  return SEEDED;
}

export async function setAllowList(emails, by) {
  const list = [...new Set(clean(emails))];
  if (!list.length) throw new Error('the list cannot be empty');
  await store().setJSON('allow', { emails: list, updatedBy: by, updatedAt: new Date().toISOString() });
  return list;
}

export const HEAD = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEAD });

/* ---------- our own session token ----------

   A Google ID token expires an hour after Google issued it — and the gate
   keeps the token in sessionStorage, so a refresh can open the app with a
   token that is already half spent. When it died mid-afternoon the only
   recovery was Google's One Tap prompt, which Safari frequently swallows,
   and every save from then on failed. So /api/app swaps the verified Google
   token for a session of our own: same JWT shape (the client reads the
   payload for the name chip), HMAC-signed with PAYLOAD_KEY, twelve hours
   long, and the allow list is still consulted on every request, so removing
   someone locks them out immediately. */

const SESSION_TTL = 12 * 60 * 60;

const sessionSecret = () => {
  const hex = String(process.env.PAYLOAD_KEY || '').trim();
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
};
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (key, data) => createHmac('sha256', key).update(data).digest('base64url');

export function mintSession(who) {
  const key = sessionSecret();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'hepf-session' }));
  const payload = b64u(JSON.stringify({
    email: who.email, name: who.name, picture: who.picture,
    iat: now, exp: now + SESSION_TTL,
  }));
  return `${header}.${payload}.${sign(key, `${header}.${payload}`)}`;
}

/* Only claims a token that names itself hepf-session; a Google ID token
   (typ JWT) returns null here and takes the Google path below. */
function readSession(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  let header;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { return null; }
  if (header?.typ !== 'hepf-session') return null;

  const key = sessionSecret();
  if (!key) return { error: 'PAYLOAD_KEY is not set on this site', status: 500 };
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign(key, `${parts[0]}.${parts[1]}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: 'sign-in could not be verified', status: 401 };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { return { error: 'sign-in could not be verified', status: 401 }; }
  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    return { error: 'sign-in expired', expired: true, status: 401 };
  }
  return { payload };
}

/** Returns { email, name, picture } or { error, status }. */
export async function identify(credential) {
  if (!CLIENT_ID) return { error: 'GOOGLE_CLIENT_ID is not set on this site', status: 500 };
  if (!credential || typeof credential !== 'string') return { error: 'not signed in', status: 401 };

  const session = readSession(credential);
  if (session) {
    if (session.error) return session;
    const email = String(session.payload.email || '').toLowerCase();
    const allowed = await allowList();
    if (!allowed.includes(email)) {
      return { error: `${email} is not on the access list for this site`, status: 403 };
    }
    return { email, name: session.payload.name || email, picture: session.payload.picture || '' };
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: CLIENT_ID,
    }));
  } catch (e) {
    /* An expired token is not a broken one — the browser can get another
       without anyone signing in again — so say which it is. */
    const expired = String(e && e.code) === 'ERR_JWT_EXPIRED'
      || /exp/i.test(String(e && e.message));
    return { error: expired ? 'sign-in expired' : 'sign-in could not be verified',
             expired, status: 401 };
  }

  const email = String(payload.email || '').toLowerCase();
  if (!payload.email_verified) return { error: 'email not verified with Google', status: 403 };

  const allowed = await allowList();
  if (!allowed.includes(email)) {
    return { error: `${email} is not on the access list for this site`, status: 403 };
  }

  return { email, name: payload.name || email, picture: payload.picture || '' };
}
