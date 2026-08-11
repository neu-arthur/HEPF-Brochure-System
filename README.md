# HEPF brochures

Fifteen brochures — Basic Line plus nine product lines and five industries —
in one canvas workspace, with pinned comments for review.

## Getting it live (once)

**1. Put this folder on GitHub**

```bash
cd hepf-brochure
git remote add origin https://github.com/<you>/hepf-brochures.git
git branch -M main
git push -u origin main
```

**2. Connect Netlify**

app.netlify.com → *Add new site* → *Import an existing project* → pick the repo.
Netlify reads `netlify.toml` and fills everything in:

| Setting | Value |
|---|---|
| Build command | `node build.mjs` |
| Publish directory | `.` |
| Functions directory | `netlify/functions` |

Deploy. You get a URL — send that to HEPF.

## Pushing an update

```bash
git add -A
git commit -m "what changed"
git push
```

Netlify rebuilds in about thirty seconds. That is the whole loop.

## What the build does

`build.mjs` takes `hepf-basic-line-brochure.html` — the master, with the
Brochure Studio panel in it — and strips the studio out into `index.html`.
Everything else stays: all fifteen documents, the canvas, and the comment layer.

**You never hand-export.** Commit the master, push, done. `index.html` is
gitignored because it is generated.

The build fails loudly if it cannot find a block to strip, or if a document,
the comment layer or the canvas has gone missing. A broken build is better
than a silently broken brochure going live.

## Two versions, two audiences

| | Where | Studio | Comments | Editable |
|---|---|---|---|---|
| `hepf-basic-line-brochure.html` | your machine | yes | yes | yes |
| `index.html` (deployed) | Netlify | no | yes | no |

Open the master locally to change colours, text and images. The deployed site
is for HEPF to read and comment on.

For a client-facing PDF, open the master and use **Export clean HTML**, then
print to PDF. That version has no studio and no comments.

## Comments

Stored server-side by `netlify/functions/comments.mjs` using Netlify Blobs.
No database, no API keys, nothing to configure.

Because they live on the server, **comments survive a redeploy**. Push a new
version of the brochure and the existing threads are still there.

The indicator in the comment box reads **Shared** when it is talking to the
function, **Local only** when it is not. Local only on the deployed site means
the function did not deploy — check the Functions tab in Netlify.

## Structure

```
hepf-basic-line-brochure.html   master — edit this
build.mjs                       strips the studio, writes index.html
netlify.toml                    build + headers config
package.json                    one dependency: @netlify/blobs
netlify/functions/comments.mjs  comment storage
```

## Adding a document

Fourteen of the fifteen are generated from a content model. Only Basic Line is
hand-written. To add one, add an entry to `DOCS` inside the `docs-script` block
of the master file and it appears in the switcher automatically — six pages,
already laid out.
