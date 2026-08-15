// Reading and shaping the assistant's stored configuration. Lives in lib so
// that both the settings endpoint and the chat endpoint can use it without
// one function importing the other.

import { getStore } from '@netlify/blobs';
import { unseal } from './secret.mjs';
import { PROVIDERS } from './providers.mjs';

const KEY = 'assistant';
const store = () => getStore('hepf-brochure-settings');

export const record = async () => (await store().get(KEY, { type: 'json' })) || null;
export const save = async (rec) => store().setJSON(KEY, rec);

/** The full config including the decrypted key. Never send this to a browser. */
export async function resolved() {
  const rec = await record();
  if (!rec || !rec.key) return null;
  return {
    provider: rec.provider,
    model: rec.model || PROVIDERS[rec.provider]?.fallback,
    key: unseal(rec.key),
  };
}

/** What the browser is allowed to know. */
export function publicView(rec) {
  return {
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, models: v.models }]),
    ),
    provider: rec?.provider || 'anthropic',
    model: rec?.model || PROVIDERS.anthropic.fallback,
    hasKey: Boolean(rec?.key),
    keyHint: rec?.keyHint || '',
    setBy: rec?.setBy || null,
    setAt: rec?.setAt || null,
  };
}
