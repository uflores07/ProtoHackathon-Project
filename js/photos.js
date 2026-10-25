// Food photos from Wikimedia Commons for the Group tab's top matches. Free, no key, and the API
// allows browser requests with origin=*. Results are cached per query; any failure gives [].
const API = 'https://commons.wikimedia.org/w/api.php';
const cache = new Map(); // query -> Promise of thumbnail URLs

async function search(q) {
  try {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '10',
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '320', format: 'json', origin: '*',
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) return [];
    const pages = Object.values((await res.json())?.query?.pages ?? {});
    return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => p.imageinfo?.[0])
      // Photos only (no SVG diagrams or PDFs), and only https links since they go into <img src>.
      .filter((i) => i && /^image\/(jpeg|png)$/.test(i.mime) && /^https:\/\//.test(i.thumburl ?? ''))
      .map((i) => i.thumburl);
  } catch {
    return [];
  }
}

export async function foodPhotos(query, count = 3) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  if (!cache.has(q)) cache.set(q, search(q));
  return (await cache.get(q)).slice(0, count);
}
