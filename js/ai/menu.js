// Menu photo -> dishes with price, category, portion size and diet tags. (Person 2 tunes the prompt.)
import { DIETS } from '../reducer.js';
import { MENU } from '../fixtures/menu.js';
import { askJson, demo, demoMode, imageBlock, round2 } from './client.js';

export const CATEGORIES = ['appetizer', 'main', 'side', 'dessert', 'drink', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['restaurant', 'currency', 'items'],
  properties: {
    restaurant: { type: 'string' },
    currency: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'category', 'serves', 'tags', 'description'],
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          category: { type: 'string', enum: CATEGORIES },
          serves: { type: 'number' },
          tags: { type: 'array', items: { type: 'string', enum: [...DIETS, 'spicy'] } },
          description: { type: 'string' },
        },
      },
    },
  },
};

const PROMPT = `Read this restaurant menu and list every dish and drink that has a price.

- price: one number. If a dish comes in sizes, list each size as its own item, e.g. "Margherita (12 in)".
- category: appetizer, main, side, dessert, drink or other.
- serves: how many people one order feeds. 1 for a single plate. Platters, large pizzas,
  family-style dishes and pitchers are often 2 to 4. Use the menu's wording ("for two", "shareable") and common sense.
- tags: only diets the menu states, or that are obvious from the dish (a cheese pizza is vegetarian).
  Leave out nut_free and gluten_free unless the menu says so; people rely on these for allergies.
- description: a few words from the menu, or an empty string.
- restaurant: the name on the menu, or an empty string.
- currency: ISO code such as CAD or USD.`;

// Returns { restaurant, menu } ready for { type: 'plan/setMenu', restaurant, menu, demo }.
export async function scanMenu(photo) {
  const raw = demoMode()
    ? await demo(MENU)
    : await askJson({ schema: SCHEMA, parts: [imageBlock(photo), { text: PROMPT }] });
  const menu = raw.items.map((it, i) => ({
    id: `m${i + 1}`, name: it.name.trim(), price: round2(it.price), category: it.category,
    serves: it.serves > 0 ? it.serves : 1, tags: it.tags, description: it.description,
  }));
  return { restaurant: raw.restaurant, currency: raw.currency || 'CAD', menu, demo: demoMode() };
}
