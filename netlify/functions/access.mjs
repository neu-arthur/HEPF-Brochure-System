// HEPF brochure — who can get in.
//
// POST /api/access { credential, action: 'list' | 'add' | 'remove', email? }
//
// Anyone already on the list can change it. Two rules stop it locking itself:
// you cannot remove yourself, and the list can never be emptied.

import { identify, json, allowList, setAllowList } from './lib/identity.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error }, who.status);

  const current = await allowList();
  const me = who.email;

  if (body.action === 'list') return json({ emails: current, me: me });

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'that is not an email address' }, 400);

  let next;
  if (body.action === 'add') {
    if (current.includes(email)) return json({ emails: current, me: me });
    next = current.concat(email);
  } else if (body.action === 'remove') {
    if (email === me) return json({ error: 'you cannot remove your own access' }, 400);
    next = current.filter((e) => e !== email);
    if (!next.length) return json({ error: 'someone has to keep access' }, 400);
  } else {
    return json({ error: 'unknown action' }, 400);
  }

  try {
    const saved = await setAllowList(next, who.name);
    return json({ emails: saved, me: me });
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
};

export const config = { path: '/api/access' };
