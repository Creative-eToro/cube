# chikoshay.com — 3D portfolio

Shay Chikotay — Creative Engineer. Single-page 3D portfolio with a WebGL background, filterable project grid, YouTube modal, and an AI review feature.

Stack: plain HTML + CSS + ES modules. Three.js loaded from jsDelivr via an import map. **No build step required.**

---

## Run locally

Any static server works. The simplest option, with Node installed:

```bash
npx serve .
```

Then open `http://localhost:3000`.

Or with Python:

```bash
python3 -m http.server 3000
```

---

## Deploy to Vercel (via GitHub)

### 1. Create a GitHub repo

From this folder:

```bash
git init
git add .
git commit -m "Initial commit: 3D portfolio"
git branch -M main
git remote add origin https://github.com/<your-username>/chikoshay.git
git push -u origin main
```

### 2. Import into Vercel

1. Go to <https://vercel.com/new>.
2. Pick the `chikoshay` repo.
3. On the "Configure Project" screen:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** *(leave empty)*
   - **Output Directory:** *(leave empty)*
   - **Install Command:** *(leave empty)*
4. Click **Deploy**.

Vercel auto-detects this as a static site and serves `index.html` from the root. Every `git push` to `main` redeploys automatically.

### 3. Point chikoshay.com at Vercel

In your Vercel project:

1. **Settings → Domains → Add** `chikoshay.com` (and `www.chikoshay.com`).
2. Vercel will show you DNS records to configure at your registrar:
   - **Apex (`chikoshay.com`):** `A` record → `76.76.21.21`
   - **WWW (`www.chikoshay.com`):** `CNAME` → `cname.vercel-dns.com`
3. Save at your registrar. SSL is issued automatically (usually within minutes).

---

## Wiring a real AI Review endpoint (optional)

The "✨ AI Review" button works offline out of the box using a small local critic that adapts to each project's title, category, and description.

If you want to use a real LLM (Claude, GPT-4, etc.) instead:

1. Deploy a small API that accepts:

   ```json
   POST /api/review
   { "title": "...", "category": "...", "description": "..." }
   ```

   and returns:

   ```json
   { "review": "..." }
   ```

2. In `index.html`, right before the closing `</script>` tag of the main module, add:

   ```js
   window.AI_REVIEW_ENDPOINT = "https://your-api.vercel.app/api/review";
   ```

The frontend automatically falls back to the local critic if the endpoint errors or is unreachable, so nothing breaks if the API is down.

### Quickest path: Vercel Serverless Function with Anthropic

Create a folder `api/` at the project root with `api/review.js`:

```js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { title, category, description } = req.body || {};

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Write a short, witty, opinionated creative review (3–4 sentences) of this advertising project.\n\nTitle: ${title}\nCategory: ${category}\nDescription: ${description}\n\nReturn only the review prose.`
      }]
    })
  });

  const data = await r.json();
  const review = data?.content?.[0]?.text ?? '';
  res.status(200).json({ review });
}
```

Then in Vercel: **Settings → Environment Variables → Add** `ANTHROPIC_API_KEY`, and set `window.AI_REVIEW_ENDPOINT = "/api/review"` in `index.html`.

---

## Editing content

All copy, project tiles, and links live directly in `index.html`:

- **Hero & manifesto** — search for `id="home"` and `id="manifesto"`.
- **Projects** — search for `class="tile` in the Work section. Each tile has:
  - `data-title`, `data-label`, `data-desc`
  - `data-video` (YouTube video ID, e.g. `dQw4w9WgXcQ`) — omit for image/gradient tiles
- **News** — search for `class="news-item"`.
- **Socials / email** — search for `hello@chikoshay.com` and the social links below it.

---

## License

All rights reserved. No animals were harmed in the making of this site.
