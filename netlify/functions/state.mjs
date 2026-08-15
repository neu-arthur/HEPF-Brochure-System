// HEPF brochure — shared saved state, gated by Google sign-in.
//
// GET  /api/state                     -> { clientId, configured, hasSave, savedAt, savedBy }
// POST /api/state { credential, action }
//        load                         -> the current state
//        save   { state, anchor?, label? }
//        history                      -> the list of anchored versions
//        revert { id }                -> makes an anchored version current
//
// The GET is deliberately anonymous: the sign-in card needs the client ID
// before anyone has signed in. It returns nothing about the document itself.
//
// Two kinds of write. Every save replaces the current state; only a save
// that says it is an anchor also keeps a copy. That is the whole of the
// history design — a hundred small edits leave one entry, and the entries
// that exist are the ones somebody would recognise.

import { getStore } from '@netlify/blobs';
import { identify, json, CLIENT_ID } from './lib/identity.mjs';

const KEY = 'shared';
const INDEX = 'history';
const KEEP = 24;          // anchors kept; the oldest are dropped with their copies

const snapKey = (id) => `snap/${id}`;

async function readIndex(store) {
  return (await store.get(INDEX, { type: 'json' })) || [];
}

export default async (req) => {
  const store = getStore('hepf-brochure-state');

  if (req.method === 'GET') {
    const meta = (await store.get(KEY, { type: 'json' })) || null;
    return json({
      clientId: CLIENT_ID,
      configured: Boolean(CLIENT_ID),
      hasSave: Boolean(meta),
      savedAt: meta?.savedAt || null,
      savedBy: meta?.savedBy || null,
    });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error, expired: Boolean(who.expired) }, who.status);

  if (body.action === 'load') {
    const saved = (await store.get(KEY, { type: 'json' })) || null;
    return json({ ok: true, email: who.email, state: saved?.state || null,
                  savedAt: saved?.savedAt || null, savedBy: saved?.savedBy || null });
  }

  if (body.action === 'history') {
    return json({ ok: true, history: await readIndex(store) });
  }

  if (body.action === 'revert') {
    if (!body.id) return json({ error: 'no version given' }, 400);
    const snap = await store.get(snapKey(body.id), { type: 'json' });
    if (!snap) return json({ error: 'that version is no longer kept' }, 404);

    /* Going back must be undoable. Whatever is current is anchored first,
       otherwise everything typed since the last anchor is gone the moment
       somebody presses Restore. */
    const current = (await store.get(KEY, { type: 'json' })) || null;
    if (current?.state) {
      const at0 = new Date().toISOString();
      const id0 = at0.replace(/[^0-9]/g, '') + '-b';
      await store.setJSON(snapKey(id0), { at: at0, by: who.name, state: current.state });
      const idx = await readIndex(store);
      await store.setJSON(INDEX,
        [{ id: id0, at: at0, by: who.name, label: 'Before restoring' }, ...idx].slice(0, KEEP));
    }

    const record = { savedAt: new Date().toISOString(), savedBy: who.name, state: snap.state };
    await store.setJSON(KEY, record);
    return json({ ok: true, state: snap.state, savedAt: record.savedAt, savedBy: record.savedBy });
  }

  if (body.action === 'save') {
    if (!body.state || typeof body.state !== 'object') return json({ error: 'no state supplied' }, 400);
    /* A payload that has lost its library is a bug upstream, not a save. */
    if (!body.state.library || typeof body.state.library !== 'object')
      return json({ error: 'the payload has no document list — refusing to overwrite' }, 400);

    /* Two people, one document. A tab that has been open all day holds a
       stale copy; letting it write would erase whatever happened in between.
       The client sends the save it started from and gets a 409 if that is no
       longer the current one. */
    const current = (await store.get(KEY, { type: 'json' })) || null;
    if (body.baseOn && current?.savedAt && current.savedAt !== body.baseOn) {
      return json({ error: 'someone else saved first', conflict: true,
                    savedAt: current.savedAt, savedBy: current.savedBy }, 409);
    }

    const at = new Date().toISOString();
    const record = { savedAt: at, savedBy: who.name, state: body.state };
    await store.setJSON(KEY, record);

    let history = await readIndex(store);
    if (body.anchor) {
      const id = at.replace(/[^0-9]/g, '') + '-' + Math.floor(Math.random() * 1e6);
      await store.setJSON(snapKey(id), { at, by: who.name, state: body.state });
      /* Re-read rather than reuse: two anchors in the same second would
         otherwise lose one entry and orphan its copy forever. */
      history = await readIndex(store);
      history = [{ id, at, by: who.name, label: String(body.label || 'Saved').slice(0, 80) }, ...history];
      for (const gone of history.slice(KEEP)) {
        try { await store.delete(snapKey(gone.id)); } catch {}
      }
      history = history.slice(0, KEEP);
      await store.setJSON(INDEX, history);
    }
    return json({ ok: true, savedAt: at, savedBy: who.name, anchored: Boolean(body.anchor), history });
  }

  return json({ error: 'unknown action' }, 400);
};

export const config = { path: '/api/state' };
