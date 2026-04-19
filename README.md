# chikoshay.com — 3D portfolio

Shay Chikotay — Creative Engineer. Single-page 3D portfolio with a WebGL background, filterable project grid, YouTube modal, and an AI review feature.

Stack: plain HTML + CSS + ES modules. Three.js from a CDN via import map. **No build step.** Content lives in `data/*.json` files so you can edit or regenerate it without touching HTML.

---

## Zero-touch migration from the existing chikoshay.com

If your current site is still live, you can pull everything off it automatically — projects, descriptions, YouTube IDs, news, manifesto, hero copy, uploaded images — and have it all appear on the new site. One command:

```bash
npm install
npm run migrate
```

That runs `migrate.js`, which:

1. Opens the live `https://chikoshay.com` in a headless Chrome.
2. Captures every JSON response the site fetches (its real API).
3. Waits for the project database and news feed to finish loading.
4. Scrapes the rendered DOM for projects, news, hero, and manifesto — in **both English and Hebrew**.
5. Downloads every referenced image into `assets/projects/` and rewrites URLs to local paths.
6. Writes `data/projects.json`, `data/news.json`, `data/content.json`, plus a `data/_raw-api.json` snapshot of everything the site's own API returned (so nothing is lost even if the scraper's heuristics miss a field).

Then:

```bash
git add .
git commit -m "Migrate live content"
git push
```

Vercel redeploys automatically. All your projects, videos, images, links, and hero/manifesto copy are live under the new design. **No manual editing required.**

If your source site ever lives at a different URL (e.g. `https://old.chikoshay.com`), pass it in:

```bash
MIGRATE_SOURCE=https://old.chikoshay.com npm run migrate
```

### If the scraper gets blocked

If the live host has bot protection (Cloudflare challenge, etc.), run the same script locally from a machine that's logged in, or run it once from a Vercel Preview build. Either way, the output is just a batch of JSON + image files you commit; nothing about the new site needs to reach the old one at runtime.

---

## Run the migration from the cloud (no terminal required)

There's a GitHub Action bundled at `.github/workflows/migrate.yml`. Once the repo is on GitHub, you can trigger migration with a button click — no local Node, no local install. Vercel auto-redeploys the moment the action finishes, because it commits the scraped data back to `main`.

### One-time setup

1. **Push the repo to GitHub** (see the "Deploy to Vercel" section below for the `git init` / `git push` commands).
2. On GitHub, open your repo → **Settings → Actions → General**.
3. Under **Workflow permissions**, pick **"Read and write permissions"** and save. (This lets the action commit the scraped JSON + images back to the repo. The workflow also declares `permissions: contents: write` as a belt-and-braces measure.)

### Triggering a migration

1. Open your repo on GitHub → **Actions** tab.
2. In the left sidebar, click **"Migrate content from live site"**.
3. Click **"Run workflow"** (top-right).
4. Leave the source URL as `https://chikoshay.com` (or override it if you want to scrape a different source), then click the green **Run workflow** button.
5. Watch the run. It takes ~2–4 minutes: installing Chromium, scraping, downloading images, committing.
6. When it finishes green, you'll see a new commit on `main` titled `chore(migrate): sync content from …`. Vercel picks this up automatically and redeploys. Your live site now has the migrated content.

### Optional: nightly auto-sync

Uncomment the `schedule:` block at the top of `.github/workflows/migrate.yml` to have it run itself every night at 03:00 UTC:

```yaml
schedule:
  - cron: '0 3 * * *'
```

On days nothing changed in the source, the action exits without committing, so you won't get noisy "no-op" deploys.

### Why not run the migration directly inside Vercel's build?

You *can* — set Vercel's Build Command to `npm run migrate`. The downsides: Puppeteer + Chromium is ~170 MB added to every build, builds go from seconds to minutes, every deploy re-scrapes the old site even when nothing changed, and any flakiness on the old host turns into a failed production deploy. The GitHub Action above keeps scraping and deploying decoupled: migration is a git commit event, deploys are the normal Vercel reaction to git commits.

---

## Run locally

```bash
npx serve .
```

Opens on `http://localhost:3000`. The site reads `data/projects.json` etc. via `fetch()`, so the local server is required (opening `index.html` directly from the file system won't load the data).

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
3. On "Configure Project":
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** *(leave empty)*
   - **Output Directory:** *(leave empty)*
   - **Install Command:** *(leave empty)*
4. Click **Deploy**.

Vercel serves `index.html` from the root. Every `git push` to `main` redeploys.

### 3. Point chikoshay.com at Vercel

In your Vercel project:

1. **Settings → Domains → Add** `chikoshay.com` and `www.chikoshay.com`.
2. At your registrar, set the DNS records Vercel shows:
   - Apex (`chikoshay.com`): `A` → `76.76.21.21`
   - WWW: `CNAME` → `cname.vercel-dns.com`
3. SSL is issued automatically. Lower TTL to 300s a day ahead of the switch so propagation is near-instant.

**Important:** Only flip DNS *after* you've run `npm run migrate` and confirmed the Vercel preview URL shows your real content. Until then the old site stays live and untouched.

---

## How the content files work

```
chikoshay-site/
├── index.html                ← the site
├── migrate.js                ← one-shot scraper
├── package.json
├── vercel.json
├── data/
│   ├── projects.json         ← array of projects
│   ├── news.json             ← array of news items
│   ├── content.json          ← hero + manifesto + socials (EN + HE)
│   └── _raw-api.json         ← untouched dump of the old site's API (reference)
└── assets/
    └── projects/             ← downloaded project images
```

`index.html` fetches all three JSON files on page load. If any file is empty or missing, the hardcoded placeholders in the HTML stay in place — so the site always works.

### Shape of `projects.json`

```json
[
  {
    "id": "p-1",
    "title": "The Unskippable Hero",
    "category": "As Seen on TV",
    "description": "A 30-second film built around a single uncomfortable truth.",
    "image": "assets/projects/abc123.jpg",
    "videoId": "dQw4w9WgXcQ",
    "href": ""
  }
]
```

Rules:

- If `videoId` is set, the tile shows a ▶ badge and clicking opens the YouTube player in the modal.
- If `image` is set, the tile uses it as a cover. Otherwise, for video-only projects, the YouTube thumbnail is used automatically.
- If neither is set, the tile falls back to a gradient.
- `category` is free text; the filter maps it to TV / Digital / Outdoor / Print / Radio by keyword.

### Shape of `news.json`

```json
[
  { "id": "n-1", "date": "June 2024", "title": "…", "link": "https://…", "image": "", "content": "" }
]
```

### Shape of `content.json`

```json
{
  "hero":      { "en": { "subtitle": "…", "title": "…", "description": "…" }, "he": { … } },
  "manifesto": { "en": { "title": "…", "intro": "…", "content": "…" },       "he": { … } },
  "socials":   { "linkedin": "…", "instagram": "…", "facebook": "…", "email": "hello@chikoshay.com" }
}
```

---

## Wiring a real AI Review endpoint (optional)

The "✨ AI Review" button in the project modal works offline by default using a small local critic. To use Claude instead, create `api/review.js` at the repo root:

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

Then in Vercel: **Settings → Environment Variables → Add** `ANTHROPIC_API_KEY`, and at the bottom of `index.html` add `window.AI_REVIEW_ENDPOINT = "/api/review";`. The frontend falls back to the local critic if the endpoint errors, so nothing breaks if it's down.

---

## License

All rights reserved. No animals were harmed in the making of this site.
