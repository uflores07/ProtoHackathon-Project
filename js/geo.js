// Place-name suggestions for the Area box, from Open-Meteo's free geocoder (no key, CORS is open).
const API = 'https://geocoding-api.open-meteo.com/v1/search';

// Resolves to [{ label, name, region, country }], biggest places first. Never throws:
// short queries, network errors and aborted requests all give [].
export async function suggestPlaces(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`${API}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`, { signal });
    if (!res.ok) return [];
    const { results } = await res.json();
    const seen = new Set();
    return (Array.isArray(results) ? results : [])
      .sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0))
      .map((r) => {
        const [name, region, country] = [r.name, r.admin1, r.country].map((v) => (v == null ? '' : String(v).trim()));
        // Skip empty or repeated parts, so Singapore reads "Singapore", not "Singapore, Singapore".
        const label = [name, region, country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
        return { label, name, region, country };
      })
      .filter((p) => p.name && !seen.has(p.label) && seen.add(p.label));
  } catch {
    return [];
  }
}
