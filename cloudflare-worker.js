// Cloudflare Worker that lets the GitHub Pages app use Gemini without the key ever reaching a phone.
// It does the same job as server.js's /api/gemini route, but online.
//
// Setup (once):
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> "Hello World" worker -> Deploy.
//   2. Edit code, replace everything with this file, Deploy.
//   3. Worker -> Settings -> Variables and Secrets -> Add -> type Secret, name GEMINI_API_KEY, value = the key.
//   4. Put the worker's URL (https://<name>.<you>.workers.dev) in AI_PROXY in js/config.js and push.
//
// shortcut: the Origin check stops other websites from using the key, but not someone calling it
// with curl. Fine for a hackathon; add sign-in or rate limits before a real launch.

const ALLOWED_ORIGINS = ['https://uflores07.github.io', 'http://localhost:8080'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const send = (status, text) => new Response(text, { status, headers: { ...cors, 'Content-Type': 'text/plain' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ALLOWED_ORIGINS.includes(origin)) return send(403, 'Not allowed');
    if (!env.GEMINI_API_KEY) return send(404, 'No GEMINI_API_KEY secret set');

    const ai = new URL(req.url).pathname.match(/^\/api\/gemini(?:\/(gemini-[\w.-]+))?$/);
    if (!ai) return send(404, 'Not found');
    if (req.method === 'GET') return send(200, 'ready');
    if (req.method !== 'POST' || !ai[1]) return send(405, 'Use POST /api/gemini/<model>');

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ai[1]}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: req.body,
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
