#!/usr/bin/env node
/**
 * One-shot migration from the live chikoshay.com into this static repo.
 *
 * What it does:
 *   1. Opens the live site in a headless Chrome via Puppeteer.
 *   2. Captures every JSON response the page fetches (the site's actual API),
 *      so even if DOM scraping misses something, you still get the raw data.
 *   3. Waits for the "LOADING DATABASE..." / "LOADING NEWS..." to resolve,
 *      then scrapes the rendered DOM for projects, news, hero, manifesto.
 *   4. Toggles EN ↔ HE and scrapes both languages.
 *   5. Downloads every referenced image into ./assets/projects/ and rewrites
 *      URLs to local paths.
 *   6. Writes:
 *        data/projects.json
 *        data/news.json
 *        data/content.json
 *        data/_raw-api.json        (everything the site's own API returned)
 *        data/_migration-log.json  (debug info)
 *
 * Usage:
 *   npm install
 *   npm run migrate
 *
 * Then:
 *   git add . && git commit -m "Migrate live content" && git push
 *   (Vercel auto-deploys.)
 */

import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.MIGRATE_SOURCE || 'https://chikoshay.com';

const DATA_DIR   = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets', 'projects');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ensureDirs() {
  await fs.mkdir(DATA_DIR,   { recursive: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

function hashUrl(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
}

function extForUrl(url) {
  try {
    const clean = new URL(url).pathname.toLowerCase();
    const m = clean.match(/\.(jpg|jpeg|png|gif|webp|avif|svg)$/);
    if (m) return '.' + m[1].replace('jpeg', 'jpg');
  } catch {}
  return '.jpg';
}

async function downloadImage(url) {
  try {
    if (!url || url.startsWith('data:')) return null;
    const filename = hashUrl(url) + extForUrl(url);
    const dest = path.join(ASSETS_DIR, filename);
    // Skip if already downloaded
    try { await fs.access(dest); return `assets/projects/${filename}`; } catch {}
    const r = await fetch(url);
    if (!r.ok) { console.warn(`  ✗ ${r.status} ${url}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(dest, buf);
    console.log(`  ✓ ${url.slice(0, 80)}${url.length>80?'…':''}  →  ${filename}`);
    return `assets/projects/${filename}`;
  } catch (err) {
    console.warn(`  ✗ ${url}: ${err.message}`);
    return null;
  }
}

function extractVideoId(str) {
  if (!str) return '';
  const m = String(str).match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // bare 11-char ID?
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
  return '';
}

/**
 * Scrape the rendered DOM after the site has loaded its data.
 * Uses broad selectors so it works even if the HTML class names differ
 * slightly from what we guessed. Everything gets normalized afterwards.
 */
async function scrapeDom(page) {
  return page.evaluate(() => {
    const txt = (el) => (el?.textContent || '').trim();
    const firstMatch = (root, selectors) => {
      for (const s of selectors) { const el = root.querySelector(s); if (el) return el; }
      return null;
    };

    // ----- Projects -----
    const projectRoots = [
      '[class*="project"]', '[data-project]', '.work-item', '.work .item',
      'article', '.grid-item', '[class*="tile"]'
    ];
    const seen = new Set();
    const projects = [];
    projectRoots.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        // Skip obvious non-project nodes (modals, admin forms)
        if (el.closest('form, [class*="modal"], [class*="admin"], nav, header')) return;
        const title = txt(firstMatch(el, ['h3','h2','.title','[class*="title"]','[class*="name"]']));
        if (!title || title.length > 140) return;
        const key = title + '|' + (el.querySelector('img')?.src || '');
        if (seen.has(key)) return;
        seen.add(key);

        const cat   = txt(firstMatch(el, ['.category','.cat','[class*="category"]','[class*="label"]','.sublabel']));
        const desc  = txt(firstMatch(el, ['.description','[class*="desc"]','p']));
        const img   = el.querySelector('img')?.src || '';
        const html  = el.innerHTML;
        const href  = el.querySelector('a')?.getAttribute('href') || '';
        const videoId =
          (html.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1] ||
          el.getAttribute('data-video') ||
          el.getAttribute('data-youtube') ||
          '';

        projects.push({ title, category: cat, description: desc, image: img, videoId, href, rawHtml: html.slice(0, 600) });
      });
    });

    // ----- News -----
    const news = [];
    const newsContainers = document.querySelectorAll('[class*="news"], [id*="news"], section');
    const newsSeen = new Set();
    newsContainers.forEach(container => {
      container.querySelectorAll('article, [class*="item"], li, .post').forEach(el => {
        const title = txt(firstMatch(el, ['h3','h2','.title','[class*="title"]']));
        if (!title || title.length > 180) return;
        if (newsSeen.has(title)) return;
        newsSeen.add(title);
        const date  = txt(firstMatch(el, ['.date','[class*="date"]','time']));
        const link  = el.querySelector('a')?.href || '';
        const img   = el.querySelector('img')?.src || '';
        const body  = txt(firstMatch(el, ['.summary','.content','[class*="content"]','p']));
        if (title && (date || link || body)) {
          news.push({ title, date, link, image: img, content: body });
        }
      });
    });

    // ----- Hero -----
    const hero = (() => {
      const heroRoot = document.querySelector('[class*="hero"], [id*="hero"], header, section');
      const title    = txt(document.querySelector('h1'));
      const subtitle = txt(firstMatch(document, ['[class*="subtitle"]','[class*="eyebrow"]','h2']));
      const desc     = txt(heroRoot?.querySelector('p'));
      return { title, subtitle, description: desc };
    })();

    // ----- Manifesto -----
    const manifesto = (() => {
      const root = document.querySelector('[id*="manifesto"], [class*="manifesto"]');
      if (!root) return { title: '', intro: '', content: '' };
      const title = txt(root.querySelector('h2,h3'));
      const ps = [...root.querySelectorAll('p')].map(p => txt(p)).filter(Boolean);
      return { title, intro: ps[0] || '', content: ps.slice(1).join('\n\n') };
    })();

    // ----- Socials -----
    const socials = {};
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href;
      if (/linkedin\.com/.test(h))  socials.linkedin  ??= h;
      if (/instagram\.com/.test(h)) socials.instagram ??= h;
      if (/facebook\.com/.test(h))  socials.facebook  ??= h;
      if (/^mailto:/.test(h))       socials.email     ??= h.replace('mailto:','');
    });

    return { projects, news, hero, manifesto, socials };
  });
}

async function toggleLang(page, lang) {
  // Try a few common patterns for the EN/HE toggle on the live site
  await page.evaluate((target) => {
    const candidates = [...document.querySelectorAll('a, button, span, div')]
      .filter(el => (el.textContent || '').trim().toUpperCase() === target);
    if (candidates[0]) candidates[0].click();
  }, lang);
  await sleep(1500);
}

async function main() {
  console.log(`→ Migrating from ${SOURCE}`);
  await ensureDirs();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Capture every JSON/text response the page makes — this is the raw data
  const apiResponses = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.startsWith('data:') || url === SOURCE || url === SOURCE + '/') return;
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (!ct.includes('json') && !ct.includes('text')) return;
    if (/\.(js|css|html|woff|woff2|ttf|otf)(\?|$)/.test(url)) return;
    try {
      const body = await res.text();
      if (body.length > 2_000_000) return;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      apiResponses.push({ url, status: res.status(), parsed: parsed ?? null, raw: parsed ? null : body.slice(0, 4000) });
    } catch {}
  });

  console.log('→ Loading page…');
  await page.goto(SOURCE, { waitUntil: 'networkidle2', timeout: 90000 });

  // Give the SPA extra time to finish hydrating, just in case
  console.log('→ Waiting for database to settle…');
  await sleep(8000);

  // Scrape EN
  console.log('→ Scraping English…');
  const en = await scrapeDom(page);

  // Try Hebrew
  console.log('→ Scraping Hebrew…');
  let he = { projects: [], news: [], hero: {}, manifesto: {}, socials: {} };
  try {
    await toggleLang(page, 'HE');
    await sleep(2500);
    he = await scrapeDom(page);
    await toggleLang(page, 'EN');
  } catch (err) {
    console.warn('  (Hebrew scrape failed — continuing with EN only):', err.message);
  }

  await browser.close();

  console.log(`→ Downloading ${en.projects.length} project images + ${en.news.length} news images…`);

  // Download & rewrite images
  for (const p of en.projects) {
    if (p.image) p.imageLocal = await downloadImage(p.image);
    p.videoId = extractVideoId(p.videoId || p.href || p.rawHtml || '');
    delete p.rawHtml;
  }
  for (const n of en.news) {
    if (n.image) n.imageLocal = await downloadImage(n.image);
  }

  // Build the final normalized files the site reads from
  const projects = en.projects
    .filter(p => p.title)
    .map((p, i) => ({
      id: `p-${i + 1}`,
      title: p.title,
      category: p.category || 'Work',
      description: p.description || '',
      image: p.imageLocal || p.image || '',
      videoId: p.videoId || '',
      href: p.href || ''
    }));

  const news = en.news
    .filter(n => n.title)
    .map((n, i) => ({
      id: `n-${i + 1}`,
      date: n.date || '',
      title: n.title,
      link: n.link || '',
      image: n.imageLocal || n.image || '',
      content: n.content || ''
    }));

  const content = {
    hero: {
      en: en.hero,
      he: he.hero || {}
    },
    manifesto: {
      en: en.manifesto,
      he: he.manifesto || {}
    },
    socials: en.socials
  };

  await fs.writeFile(path.join(DATA_DIR, 'projects.json'), JSON.stringify(projects, null, 2));
  await fs.writeFile(path.join(DATA_DIR, 'news.json'),     JSON.stringify(news,     null, 2));
  await fs.writeFile(path.join(DATA_DIR, 'content.json'),  JSON.stringify(content,  null, 2));
  await fs.writeFile(path.join(DATA_DIR, '_raw-api.json'), JSON.stringify(apiResponses, null, 2));
  await fs.writeFile(path.join(DATA_DIR, '_migration-log.json'), JSON.stringify({
    source: SOURCE,
    ranAt: new Date().toISOString(),
    counts: {
      projects: projects.length,
      news: news.length,
      apiResponses: apiResponses.length,
      imagesDownloaded: (await fs.readdir(ASSETS_DIR)).length
    }
  }, null, 2));

  console.log('');
  console.log(`✓ Projects:  ${projects.length}   → data/projects.json`);
  console.log(`✓ News:      ${news.length}       → data/news.json`);
  console.log(`✓ Hero/Manifesto (EN+HE)           → data/content.json`);
  console.log(`✓ Raw API responses: ${apiResponses.length}  → data/_raw-api.json`);
  console.log('');
  console.log('Next:  git add . && git commit -m "Migrate live content" && git push');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
