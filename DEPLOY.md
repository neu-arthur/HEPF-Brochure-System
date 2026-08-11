# HEPF brochure — deploying the review copy

## What's in here

```
index.html                     <- the review copy (you generate this, see below)
hepf-basic-line-brochure.html  <- the studio file. Your working copy, not deployed.
netlify/functions/comments.mjs <- stores the comments
netlify.toml                   <- Netlify config
package.json                   <- one dependency: @netlify/blobs
```

## One-time setup

1. Open `hepf-basic-line-brochure.html` in Chrome.
2. In the Brochure Studio panel, click **Export review copy**. It downloads `index.html`.
3. Put that `index.html` in this folder, next to `netlify.toml`.
4. Go to https://app.netlify.com/drop and drag this whole folder onto the page.

Netlify installs the dependency, deploys the function at `/api/comments`, and gives
you a URL. Send that URL to HEPF.

Nothing else to configure. Netlify Blobs is enabled by default, there are no API
keys, and the free tier covers this comfortably.

## Using the CLI instead

```bash
npm install
npx netlify deploy --prod
```

## Updating the brochure later

Re-export `index.html`, drop it in, redeploy. Comments are stored server-side and
are not part of the HTML, so they survive a redeploy.

## How reviewers use it

- Type a name in the Comments box, bottom right.
- **Add comment**, then click anywhere on a page to drop a pin.
- Click a pin to read the thread, reply, or **Resolve** it.
- Resolved pins are hidden until **Show resolved** is ticked.
- Comments never appear when printing to PDF.

## The status light

- **Shared** (green) — talking to the function. Everyone sees the same comments.
- **Local only** (grey) — no function reachable, e.g. the file was opened directly
  from disk instead of the deployed site. Comments still work but stay in that
  browser until you export.

If you see "Local only" on the deployed site, the function failed to deploy —
check the Functions tab in the Netlify dashboard.
