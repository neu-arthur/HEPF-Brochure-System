// HEPF brochure — the assistant.
//
// POST /api/chat { credential, doc, action, ... }
//
//   action 'thread'  -> the stored conversation for a document
//   action 'clear'   -> forget it
//   action 'say'     -> a conversational turn; returns { say, ask, ready, plan }
//   action 'write'   -> one page of copy; returns { slots }
//   action 'fit'     -> shorten the slots that broke the page
//
// Threads live server-side so the conversation is the same one Andrew sees.

import { getStore } from '@netlify/blobs';
import { identify, json } from './lib/identity.mjs';
import { resolved } from './lib/config.mjs';
import { call, parseJson } from './lib/providers.mjs';
import { chatSystem, writeSystem, fitSystem } from './lib/skill.mjs';

const MAX_TURNS = 40;
const threads = () => getStore('hepf-brochure-threads');
const tkey = (doc) => 'doc-' + String(doc || 'basic').replace(/[^a-z0-9-]/gi, '_');

const readThread = async (doc) => (await threads().get(tkey(doc), { type: 'json' })) || { messages: [], usage: { in: 0, out: 0 } };
const writeThread = async (doc, t) => threads().setJSON(tkey(doc), t);

/** What the model is allowed to see of the conversation. */
const forModel = (messages) => messages
  .filter((m) => m.role === 'user' || m.role === 'assistant')
  .slice(-MAX_TURNS)
  .map((m) => ({ role: m.role, content: m.content }));

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const who = await identify(body.credential);
  if (who.error) return json({ error: who.error }, who.status);

  const doc = String(body.doc || 'basic');

  if (body.action === 'thread') return json(await readThread(doc));
  if (body.action === 'clear') {
    await writeThread(doc, { messages: [], usage: { in: 0, out: 0 } });
    return json({ messages: [], usage: { in: 0, out: 0 } });
  }

  const cfg = await resolved();
  if (!cfg) return json({ error: 'No API key set. Open settings in the assistant panel.' }, 400);

  const ctx = body.context || {};

  /* ---------- writing one page ---------- */
  if (body.action === 'write' || body.action === 'fit') {
    const system = body.action === 'write'
      ? writeSystem(ctx, body.page || { index: 0, name: 'Page 1' })
      : fitSystem(ctx, body.over || []);
    let r;
    try {
      r = await call(cfg, {
        system,
        messages: [{ role: 'user', content: body.action === 'write'
          ? 'Write this page.' : 'Shorten these.' }],
        maxTokens: 3000,
        json: true,
      });
    } catch (e) { return json({ error: String(e.message || e) }, 502); }

    const out = parseJson(r.text);
    if (!out || typeof out.slots !== 'object') {
      return json({ error: 'the model did not return usable copy for this page' }, 502);
    }
    return json({ slots: out.slots, usage: r.usage });
  }

  /* ---------- a conversational turn ---------- */
  if (body.action !== 'say') return json({ error: 'unknown action' }, 400);

  const said = String(body.message || '').trim();
  if (!said) return json({ error: 'nothing to say' }, 400);

  const thread = await readThread(doc);
  thread.messages.push({ role: 'user', content: said, by: who.name, at: new Date().toISOString() });

  let r;
  try {
    r = await call(cfg, {
      system: chatSystem(ctx),
      messages: forModel(thread.messages),
      maxTokens: 1500,
      json: true,
    });
  } catch (e) {
    // The user's message is kept — losing what someone typed because the
    // provider hiccuped is worse than a thread with an unanswered turn.
    await writeThread(doc, thread);
    return json({ error: String(e.message || e) }, 502);
  }

  const out = parseJson(r.text) || { say: String(r.text || '').trim() };
  const reply = {
    role: 'assistant',
    content: JSON.stringify({
      say: String(out.say || '').trim() || 'Sorry — I lost my thread there. Say that again?',
      ask: out.ask && out.ask.question ? {
        question: String(out.ask.question),
        options: (out.ask.options || []).slice(0, 4).map((o) => ({
          label: String(o.label || '').slice(0, 60),
          note: String(o.note || '').slice(0, 160),
        })).filter((o) => o.label),
        multi: !!out.ask.multi,
      } : null,
      ready: !!out.ready && thread.messages.length > 1,
      plan: out.ready && out.plan ? {
        summary: String(out.plan.summary || ''),
        pages: (out.plan.pages || []).map(String),
        brief: String(out.plan.brief || ''),
      } : null,
    }),
    at: new Date().toISOString(),
  };
  thread.messages.push(reply);
  thread.usage = {
    in: (thread.usage?.in || 0) + (r.usage?.in || 0),
    out: (thread.usage?.out || 0) + (r.usage?.out || 0),
  };
  await writeThread(doc, thread);

  return json({ reply: JSON.parse(reply.content), usage: thread.usage });
};

export const config = { path: '/api/chat' };
