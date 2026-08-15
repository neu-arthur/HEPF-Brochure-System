// HEPF brochure — comment store
// Netlify Function (v2) backed by Netlify Blobs. No database, no API keys.
//
// GET  /api/comments            -> { pins: [...] }
// POST /api/comments  { credential, action: 'add' | 'reply' | 'resolve' | 'delete', ... }
//
// Authorship is never taken from the request body. Every write verifies the
// Google ID token and signs the message with the name inside it, so a comment
// cannot be posted under someone else's name.

import { getStore } from '@netlify/blobs';
import { identify, json } from './lib/identity.mjs';

const KEY = 'threads';

const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const clean = (s, max) => String(s ?? '').slice(0, max).trim();

export default async (req) => {
  const store = getStore('hepf-brochure-comments');
  let data = (await store.get(KEY, { type: 'json' })) || { pins: [], seq: 0 };
  if (!Array.isArray(data.pins)) data = { pins: [], seq: 0 };

  if (req.method === 'GET') return json(data);
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error }, who.status);

  const author = who.name;
  const at = new Date().toISOString();
  const find = (id) => data.pins.find((p) => p.id === id);

  switch (body.action) {
    case 'add': {
      const text = clean(body.text, 4000);
      if (!text) return json({ error: 'empty comment' }, 400);
      data.seq = (data.seq || 0) + 1;
      data.pins.push({
        id: 'p' + data.seq,
        doc: clean(body.doc, 40) || 'basic',
        page: Math.max(0, parseInt(body.page, 10) || 0),
        x: clamp(body.x),
        y: clamp(body.y),
        resolved: false,
        createdAt: at,
        thread: [{ author, email: who.email, text, at }],
      });
      break;
    }
    case 'reply': {
      const pin = find(body.id);
      const text = clean(body.text, 4000);
      if (!pin || !text) break;
      pin.thread.push({ author, email: who.email, text, at });
      break;
    }
    case 'resolve': {
      const pin = find(body.id);
      if (!pin) break;
      pin.resolved = !!body.resolved;
      pin.resolvedBy = pin.resolved ? author : null;
      pin.resolvedAt = pin.resolved ? at : null;
      break;
    }
    case 'delete': {
      data.pins = data.pins.filter((p) => p.id !== body.id);
      break;
    }
    default:
      return json({ error: 'unknown action' }, 400);
  }

  await store.setJSON(KEY, data);
  return json(data);
};

export const config = { path: '/api/comments' };
