// One shape in, one shape out, three providers behind it.
//
//   call(cfg, { system, messages, maxTokens, json })  ->  { text, usage }
//
// messages is [{ role:'user'|'assistant', content:string }]. Nothing here
// streams: the assistant makes one request per page rather than one request
// for the whole brochure, which gives progressive fill without the fragility
// of parsing a half-written token stream.

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    fallback: 'claude-sonnet-4-5',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    fallback: 'gpt-5-mini',
  },
  google: {
    label: 'Google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    fallback: 'gemini-2.5-flash',
  },
};

const timeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

async function post(url, headers, body, ms = 120000) {
  const t = timeout(ms);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: t.signal,
    });
  } catch (e) {
    t.done();
    throw new Error(e.name === 'AbortError' ? 'the model took too long to answer' : 'could not reach the provider');
  }
  t.done();
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) {
    const msg = data?.error?.message || data?.error?.status || data?.message || text.slice(0, 200);
    throw new Error(`${r.status} from the provider — ${msg}`);
  }
  return data;
}

export async function call(cfg, { system, messages, maxTokens = 2000, json = false }) {
  const model = cfg.model || PROVIDERS[cfg.provider]?.fallback;
  if (!model) throw new Error('no model configured');

  if (cfg.provider === 'anthropic') {
    const d = await post('https://api.anthropic.com/v1/messages', {
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
    }, {
      model,
      max_tokens: maxTokens,
      system: json ? system + '\n\nReply with a single JSON object and nothing else. No prose, no code fences.' : system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return {
      text: (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
      usage: { in: d.usage?.input_tokens || 0, out: d.usage?.output_tokens || 0 },
    };
  }

  if (cfg.provider === 'openai') {
    const d = await post('https://api.openai.com/v1/chat/completions', {
      authorization: 'Bearer ' + cfg.key,
    }, {
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    });
    return {
      text: d.choices?.[0]?.message?.content || '',
      usage: { in: d.usage?.prompt_tokens || 0, out: d.usage?.completion_tokens || 0 },
    };
  }

  if (cfg.provider === 'google') {
    const d = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.key)}`,
      {},
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      },
    );
    const c = d.candidates?.[0];
    return {
      text: (c?.content?.parts || []).map((p) => p.text || '').join(''),
      usage: { in: d.usageMetadata?.promptTokenCount || 0, out: d.usageMetadata?.candidatesTokenCount || 0 },
    };
  }

  throw new Error('unknown provider: ' + cfg.provider);
}

/** Models sometimes wrap JSON in prose or fences however firmly you ask. */
export function parseJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return null;
}
