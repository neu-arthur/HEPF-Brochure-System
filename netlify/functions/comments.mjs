// HEPF brochure — comment store
// Netlify Function (v2) backed by Netlify Blobs. No database, no API keys,
// no third-party account. Deployed automatically with the site.
//
// GET  /api/comments            -> { pins: [...] }
// POST /api/comments  { action: 'add' | 'reply' | 'resolve' | 'delete', ... }

import { getStore } from '@netlify/blobs';

const KEY = 'threads';
const HEAD = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const clean = (s, max) => String(s ?? '').slice(0, max).trim();

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: HEAD });

  const store = getStore('hepf-brochure-comments');
  let data = (await store.get(KEY, { type: 'json' })) || { pins: [], seq: 0 };
  if (!Array.isArray(data.pins)) data = { pins: [], seq: 0 };

  if (req.method === 'GET') {
    return new Response(JSON.stringify(data), { headers: HEAD });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: HEAD });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: HEAD }); }

  const author = clean(body.author, 60) || 'Anonymous';
  const at = new Date().toISOString();
  const find = (id) => data.pins.find((p) => p.id === id);

  switch (body.action) {
    case 'add': {
      const text = clean(body.text, 4000);
      if (!text) return new Response(JSON.stringify({ error: 'empty comment' }), { status: 400, headers: HEAD });
      data.seq = (data.seq || 0) + 1;
      data.pins.push({
        id: 'p' + data.seq,
        page: Math.max(0, parseInt(body.page, 10) || 0),
        x: clamp(body.x),
        y: clamp(body.y),
        resolved: false,
        createdAt: at,
        thread: [{ author, text, at }],
      });
      break;
    }
    case 'reply': {
      const pin = find(body.id);
      const text = clean(body.text, 4000);
      if (!pin || !text) break;
      pin.thread.push({ author, text, at });
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
      return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: HEAD });
  }

  await store.setJSON(KEY, data);
  return new Response(JSON.stringify(data), { headers: HEAD });
};

export const config = { path: '/api/comments' };
