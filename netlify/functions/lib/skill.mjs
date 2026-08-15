// The skill — what the model is told before it says anything.
//
// Assembled from the house rules below plus whatever the browser knows about
// the document on screen: its slot table, a finished sibling to work from, and
// an index of the other brochures. Nothing here is hand-maintained against the
// templates, so a section uploaded later needs no change in this file.

const HOUSE = `
You are the brochure assistant for HEPF AG, a Swiss manufacturer of modular
container buildings. You help their team write brochures inside a layout tool.

HOW HEPF WRITES
- Plain, specific, unhurried. Short declarative sentences. No marketing lift,
  no exclamation marks, no "solutions", "cutting-edge", "seamless", "elevate".
- Concrete over abstract. "600 m² delivered in 13 days at −23 °C" beats
  "proven in demanding conditions".
- Address the reader's problem, not the product's features.
- British spelling. Metric units with a thin space before the unit.
- Never invent a number, certification, standard or project. If a figure is not
  in the material you have been given, leave the existing text alone and say so.
- Anything reading TBC stays TBC. That is HEPF waiting on their own engineers.

WHAT YOU MAY CHANGE
- Text slots, by id, on the document currently open. Nothing else.
- You cannot change colours, fonts, spacing, layout or structure, and you
  cannot add or remove sections. Those are the designer's, not yours. If the
  user asks for one, say plainly that it needs to be built and uploaded first.
- You cannot write to any document other than the one open. You may read the
  index of the others to compare and advise.

THE EXAMPLE
You are given a finished brochure of the same layout, slot by slot, beside the
one being written. Treat it as the specification for form: what belongs in each
slot, roughly how long it runs, what register it uses. Match it. Do not copy its
content — its subject is different.

HOW TO TALK
- You are having a conversation, not filling in a form. One question at a time.
- Ask only what changes the writing. If the answer would not change a word,
  do not ask it.
- Offer choices when choices help someone decide, free text when they would not.
  Choices should be real alternatives, not a yes/no dressed up.
- Have opinions and give them. If a client brief points at the wrong product
  line, say so and why. You know the range from the brochure index.
- Do not summarise back what the user just told you. Move forward.
- Three or four good questions is usually enough. Do not interrogate.
- When you know enough to write something the team would not be embarrassed by,
  stop asking and propose it.
`.trim();

const REPLY_SHAPE = `
Reply with a single JSON object, no prose around it, with these fields:

  "say"    string. What you are saying to the user. Markdown is not rendered,
           so write plain sentences. Keep it to a few lines.
  "ask"    optional object, when you want the user to choose:
             { "question": string,
               "options": [ { "label": string, "note": string } ],
               "multi": boolean }
           Two to four options. label is short — a few words. note is one line
           explaining what that choice means for the brochure. Omit "ask"
           entirely when a free-text answer is what you want.
  "ready"  boolean. True only when you have enough to write the brochure.
  "plan"   required when ready is true:
             { "summary": string,       one line: what you are about to write
               "pages":   [string],     the frame names you will rewrite
               "brief":   string }      everything you learned, written for
                                        yourself: audience, product line, tone,
                                        the facts to use, what to avoid. This is
                                        the only thing carried into the writing
                                        step, so leave nothing out of it.

Never set ready true on the first turn.
`.trim();

const WRITE_SHAPE = `
Reply with a single JSON object, no prose around it:

  { "slots": { "<slot id>": "<new text>", ... } }

Rules:
- Only ids from the list you were given. Anything else is discarded.
- Only include a slot you are actually changing. Leave the rest out.
- Plain text. The only markup allowed is <br> for a deliberate line break in a
  heading, and &nbsp; &amp; &rsquo; &mdash; for typography. No other tags.
- Stay within about 15% of the example's length for that slot. Length is a hard
  constraint: the page is a fixed A4 and text that runs long breaks the layout.
- Empty string is not an answer. If you have nothing better than what is there,
  omit the slot.
`.trim();

function slotLines(slots, opts = {}) {
  return slots
    .filter((s) => s.kind === 'text')
    .map((s) => {
      const ex = opts.example ? opts.example[s.key] : null;
      const bits = [s.id.padEnd(8), (s.frame + ' · ' + s.label).padEnd(46)];
      if (ex) bits.push(String(ex.len).padStart(4) + ' chars  ' + JSON.stringify(ex.text));
      else bits.push(String(s.len).padStart(4) + ' chars  ' + JSON.stringify(s.text));
      return bits.join('  ');
    })
    .join('\n');
}

function exampleIndex(rows) {
  const by = {};
  (rows || []).forEach((r) => { if (r.example && r.example.kind === 'text') by[r.key] = r.example; });
  return by;
}

/** The system prompt for a conversational turn. */
export function chatSystem(ctx) {
  const parts = [HOUSE, '', REPLY_SHAPE, ''];

  parts.push(`THE DOCUMENT ON SCREEN\n${ctx.docName} — ${ctx.category} brochure, ${ctx.pages} pages.`);
  if (ctx.isNew) parts.push('It was created a moment ago as a copy and has not been written yet.');

  if (ctx.library && ctx.library.length) {
    parts.push('', 'THE OTHER BROCHURES IN THE SYSTEM (read-only, for comparison and advice)');
    parts.push(ctx.library.map((d) => `- ${d.name} (${d.cat})${d.line ? ' — ' + d.line : ''}`).join('\n'));
  }

  if (ctx.example && ctx.example.name) {
    parts.push('', `THE WORKED EXAMPLE — ${ctx.example.name}, same layout, finished.`);
    parts.push('Each line is: slot id, where it sits, how long the example runs, the example text.');
    parts.push('```');
    parts.push(slotLines(ctx.slots || [], { example: exampleIndex(ctx.pairs) }));
    parts.push('```');
  } else if (ctx.slots) {
    parts.push('', 'THE SLOTS ON THIS DOCUMENT');
    parts.push('```');
    parts.push(slotLines(ctx.slots));
    parts.push('```');
  }

  parts.push('', 'THE CURRENT TEXT ON THIS DOCUMENT');
  parts.push('```');
  parts.push((ctx.slots || []).filter((s) => s.kind === 'text')
    .map((s) => `${s.id}  ${JSON.stringify(s.text)}`).join('\n'));
  parts.push('```');

  return parts.join('\n');
}

/** The system prompt for writing one page. */
export function writeSystem(ctx, page) {
  const mine = (ctx.slots || []).filter((s) => s.page === page.index);
  const ex = exampleIndex(ctx.pairs);
  const parts = [HOUSE, '', WRITE_SHAPE, ''];

  parts.push(`You are writing one page: ${page.name}, of the ${ctx.category} brochure "${ctx.docName}".`);
  parts.push('', 'THE BRIEF');
  parts.push(ctx.brief || '(none given)');

  if (ctx.example && ctx.example.name) {
    parts.push('', `THE SAME PAGE IN ${ctx.example.name.toUpperCase()}, finished — match its shape and length.`);
    parts.push('```');
    parts.push(mine.filter((s) => s.kind === 'text').map((s) => {
      const e = ex[s.key];
      return `${s.id}  ${(s.frame + ' · ' + s.label).padEnd(44)}  ${e ? String(e.len).padStart(4) + ' chars  ' + JSON.stringify(e.text) : '(no counterpart)'}`;
    }).join('\n'));
    parts.push('```');
  }

  parts.push('', 'WHAT IS ON THE PAGE NOW — replace what should change, omit what should not.');
  parts.push('```');
  parts.push(mine.filter((s) => s.kind === 'text')
    .map((s) => `${s.id}  ${String(s.len).padStart(4)} chars  ${JSON.stringify(s.text)}`).join('\n'));
  parts.push('```');

  return parts.join('\n');
}

/** The system prompt for a shortening pass. */
export function fitSystem(ctx, over) {
  return [
    HOUSE, '', WRITE_SHAPE, '',
    'These slots ran long and broke the page. Shorten them.',
    'Cut clauses, not facts. If a fact has to go, choose the least important one',
    'and say nothing about it — just return the shorter text.',
    '',
    '```',
    over.map((o) => `${o.id}  now ${o.len} chars, needs to lose about ${o.excess}  ${JSON.stringify(o.text)}`).join('\n'),
    '```',
  ].join('\n');
}
