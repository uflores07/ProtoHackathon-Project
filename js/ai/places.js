// Restaurant search on the live web. (Person 3 tunes the prompts.)
// Two Gemini calls: the first searches the live web with Google Search grounding, the second
// turns what it found into structured results. Ranking against everyone's limits happens in js/lib/rankPlaces.js.
import { DIETS } from '../reducer.js';
import { PLACES } from '../fixtures/places.js';
import { ask, askJson, demo, demoMode, round2 } from './client.js';

const PLACE = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'address', 'cuisine', 'priceLevel', 'estCostPerPerson', 'distanceKm', 'dietOptions', 'rating', 'why', 'sourceUrl'],
  properties: {
    name: { type: 'string' },
    address: { type: 'string' },
    cuisine: { type: 'string' },
    priceLevel: { type: 'integer', enum: [1, 2, 3, 4] },
    estCostPerPerson: { type: 'number' },
    distanceKm: { type: 'number' },
    dietOptions: { type: 'array', items: { type: 'string', enum: DIETS } },
    rating: { type: 'number' },
    why: { type: 'string' },
    sourceUrl: { type: 'string' },
  },
};

const RESULTS = { type: 'object', additionalProperties: false, required: ['places'], properties: { places: { type: 'array', items: PLACE } } };

const FIELDS = `For each place give: name; street address; main cuisine in one or two words; priceLevel 1-4;
estCostPerPerson, a typical main plus a drink before tax and tip in local currency, from menus or reviews you found;
distanceKm from the centre of the area; dietOptions you have evidence for (menu labels, the restaurant's site, reviews);
rating out of 5 (0 if unknown); why, one short sentence on why it suits this group; sourceUrl, the page you used.
Only include places that are open for business now. Give the source page's link for each place if you have it.`;

const describe = (m) => {
  const diet = m.diet?.length ? m.diet.join(', ').replaceAll('_', ' ') : 'no dietary needs';
  return `- ${m.name}: up to $${m.budget} each, likes ${m.cuisine || 'anything'}, will go up to ${m.distanceKm} km, ${diet}`;
};

const groupPrompt = (area, members) => `A group of friends wants to eat out together near ${area}.

${members.map(describe).join('\n')}

Search the web for 8 to 10 restaurants in or near ${area} that this group could enjoy together.
Cover the cuisines people asked for, and favour places that can feed everyone's dietary needs.

${FIELDS}`;

const similarPrompt = (area, history) => `Someone wants new restaurants near ${area} that are like places they enjoyed before:

${history.map((h) => `- ${h.restaurant}${h.cuisine ? ` (${h.cuisine})` : ''}${h.perPerson ? `, about $${Math.round(h.perPerson)} per person` : ''}`).join('\n')}

Search the web for 6 restaurants near ${area} that are similar in cuisine, price and style, but not on that list.

${FIELDS}`;

const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address}`)}`;

const tidy = (places, isDemo) => places.map((p, i) => ({
  ...p, id: `p${i + 1}`, estCostPerPerson: round2(p.estCostPerPerson), distanceKm: round2(p.distanceKm),
  mapsUrl: mapsUrl(p), demo: isDemo,
}));

// mode 'group': members is the session's member list. mode 'similar': history is [{ restaurant, cuisine, perPerson }].
export async function findPlaces({ area, members = [], history = [], mode = 'group' }) {
  if (demoMode()) {
    const been = new Set(history.map((h) => h.restaurant));
    return tidy(await demo(mode === 'similar' ? PLACES.filter((p) => !been.has(p.name)) : PLACES, 1800), true);
  }
  const content = mode === 'similar' ? similarPrompt(area, history) : groupPrompt(area, members);
  // 1. Search the web (Google Search grounding).
  const found = await ask({ parts: [{ text: content }], tools: [{ googleSearch: {} }] });
  const links = found.sources.length
    ? `\n\nPages the search used:\n${found.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`
    : '';
  // 2. Turn the findings into the place list. Only places the notes support, nothing invented.
  const out = await askJson({
    schema: RESULTS,
    parts: [{ text: `Here are restaurant search notes for a group near ${area}. Turn every restaurant in them into the JSON list.
Use only facts in the notes; if something is unknown use 0 for numbers or an empty string. For sourceUrl use the
matching page from the list below if there is one, otherwise an empty string. Don't add places that aren't in the notes.

${FIELDS.replace(/ Give the source page's link.*$/, '')}

NOTES:
${found.text}${links}` }],
  });
  return tidy(out.places ?? [], false);
}
