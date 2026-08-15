// HEPF brochure — assistant settings.
//
// GET  /api/settings                         -> providers, current choice, whether a key is set
// POST /api/settings { credential, provider, model, key?, clearKey? }
// POST /api/settings { credential, action:'test' }
//
// The key is encrypted at rest and never leaves this function. All the browser
// is ever told is the last four characters and who set it.

import { identify, json } from './lib/identity.mjs';
import { seal, hint } from './lib/secret.mjs';
import { PROVIDERS, call } from './lib/providers.mjs';
import { record, save, resolved, publicView } from './lib/config.mjs';

export default async (req) => {
  if (req.method === 'GET') return json(publicView(await record()));
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error }, who.status);

  if (body.action === 'test') {
    const cfg = await resolved();
    if (!cfg) return json({ error: 'no API key set yet' }, 400);
    try {
      const r = await call(cfg, {
        system: 'You are a connection test. Reply with the single word: ready',
        messages: [{ role: 'user', content: 'ready?' }],
        maxTokens: 16,
      });
      return json({ ok: true, reply: (r.text || '').trim().slice(0, 40), usage: r.usage });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  const rec = (await record()) || {};
  const provider = String(body.provider || rec.provider || 'anthropic');
  if (!PROVIDERS[provider]) return json({ error: 'unknown provider' }, 400);

  const next = {
    provider,
    model: String(body.model || '').trim() || PROVIDERS[provider].fallback,
    key: rec.key || '',
    keyHint: rec.keyHint || '',
    setBy: rec.setBy || null,
    setAt: rec.setAt || null,
  };

  // An empty key field means "keep the one you have", never "clear it".
  const raw = typeof body.key === 'string' ? body.key.trim() : '';
  if (raw) {
    if (raw.length < 16) return json({ error: 'that does not look like an API key' }, 400);
    next.key = seal(raw);
    next.keyHint = hint(raw);
    next.setBy = who.name;
    next.setAt = new Date().toISOString();
  }
  if (body.clearKey === true) {
    next.key = ''; next.keyHint = ''; next.setBy = null; next.setAt = null;
  }

  await save(next);
  return json(publicView(next));
};

export const config = { path: '/api/settings' };
