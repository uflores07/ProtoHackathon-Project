// Local dev server: serves the app and passes AI calls to Gemini with the key from .env,
// so the key never reaches the browser. GitHub Pages can't run this, so the hosted app
// still uses the key pasted in Settings (or demo mode).
//   npm start  ->  http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env: demo mode */ }
const KEY = process.env.GEMINI_API_KEY?.trim() || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

async function gemini(req, res, model) {
  if (!KEY) return send(res, 404, 'No GEMINI_API_KEY in .env');
  if (req.method === 'GET') return send(res, 200, 'ready');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: Buffer.concat(chunks),
    });
    res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(Buffer.from(await r.arrayBuffer()));
  } catch {
    send(res, 502, JSON.stringify({ error: { message: 'Could not reach Gemini.' } }));
  }
}

async function file(res, pathname) {
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  // Never serve .env, .git or anything else outside the app.
  if (!path.startsWith(ROOT) || path.slice(ROOT.length).split(sep).some((p) => p.startsWith('.'))) return send(res, 404, 'Not found');
  try {
    const target = pathname.endsWith('/') ? join(path, 'index.html') : path;
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

const send = (res, status, text) => res.writeHead(status, { 'Content-Type': 'text/plain' }).end(text);

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const ai = pathname.match(/^\/api\/gemini(?:\/([\w.-]+))?$/);
  return ai ? gemini(req, res, ai[1]) : file(res, pathname);
}).listen(PORT, () => {
  console.log(`Split running at http://localhost:${PORT}`);
  console.log(KEY ? 'Gemini: using GEMINI_API_KEY from .env' : 'Gemini: no key in .env, demo mode (or paste a key in Settings)');
});
