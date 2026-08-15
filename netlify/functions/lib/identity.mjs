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

/** Returns { email, name, picture } or { error, status }. */
export async function identify(credential) {
  if (!CLIENT_ID) return { error: 'GOOGLE_CLIENT_ID is not set on this site', status: 500 };
  if (!credential || typeof credential !== 'string') return { error: 'not signed in', status: 401 };

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
