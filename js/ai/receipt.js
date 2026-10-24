// Receipt photo -> line items, tax, tip, service charge, discounts. (Person 1 tunes the prompt.)
import { RECEIPT } from '../fixtures/receipt.js';
import { fillUnitemized } from '../lib/receiptFill.js';
import { askJson, demo, demoMode, imageBlock, round2 } from './client.js';

const num = { type: 'number' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['restaurant', 'items', 'subtotal', 'discount', 'tax', 'serviceCharge', 'tip', 'total', 'currency', 'notes'],
  properties: {
    restaurant: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'lineTotal'],
        properties: { name: { type: 'string' }, qty: num, lineTotal: num },
      },
    },
    subtotal: num, discount: num, tax: num, serviceCharge: num, tip: num, total: num,
    currency: { type: 'string' },
    notes: { type: 'string' },
  },
};

const PROMPT = `Read this receipt or bill and return what it says as JSON. It can be from anywhere: a restaurant, cafe,
bar, fast food place, grocery store, takeout or a delivery app screenshot, a card machine or debit slip, or a
handwritten bill, in any language. The photo may be faded, crumpled, angled, blurry, very long or partly cut off.
Always do your best: read what is there, and say what you guessed or couldn't read in notes.

- restaurant: the store or business name. For a delivery app, the restaurant the food came from. Empty string if none shows.
- items: one entry per line the customer was charged for, every line from top to bottom (don't stop early on long receipts).
  Fold modifiers, add-ons and deposits (like "+ extra cheese 2.00" or "bottle deposit 0.10") into the item above them.
  qty is the printed quantity (1 if none). lineTotal is what that line costs in total (quantity already included,
  after any discount printed on that line): "2 @ 4.50" is qty 2, lineTotal 9.00; "0.82 kg @ 3.99/kg 3.27" is qty 1, lineTotal 3.27.
  name is in English so the group can read it: translate other languages, but keep dish names as they are (Pad Thai,
  Tiramisu), and spell out obvious abbreviations (CHKN BRGR is Chicken Burger).
- Only list lines you can actually see. Never make up items or turn the total into an item: a card slip or a bill that
  shows only a total has items [] (the app puts the rest on its own "Not itemized" line).
- Items marked comp, comped, void or 100% off get lineTotal 0.
- Payment lines (cash, card, gift card, change, balance due) are not items or discounts.
- subtotal: the printed subtotal before tax. If none is printed, add up the lineTotals (0 if there are no items).
- discount: bill-level discounts, coupons and promos as one positive number (0 if none). Don't repeat per-line discounts.
- tax: all taxes added on top of the prices (GST, PST, HST, VAT, sales tax). If the prices already include the tax
  ("incl. VAT", "MwSt. enthalten", "TVA incluse"), put 0 and say so in notes.
- serviceCharge: an automatic gratuity or service charge, plus fees on the whole order (delivery, service, bag or
  small-order fees), added together (0 if none).
- tip: a tip that is printed or handwritten on this receipt (0 if none; most receipts are printed before the tip).
  A table of suggested tip amounts is not a tip.
- total: the final amount charged. With a written-in tip, the total including it (add them up if no new total is written).
  Not the cash handed over or the change.
- Numbers: many countries use a comma for decimals (12,50 is 12.50 and 1.234,50 is 1234.50). A separator followed by
  exactly 3 digits is usually thousands (¥1,200 is 1200).
- currency: ISO code such as CAD, USD, EUR, GBP or JPY, from the symbols, language or address.
- notes: anything you had to guess or couldn't read, in one short sentence. Empty string if all clear.
- Only if the photo is clearly not a receipt or bill (a menu, a person, a room): items [], every amount 0, and say
  what it is in notes.`;

// Checks a person can act on: "these numbers don't add up, look again".
export function receiptWarnings(r) {
  const warnings = [];
  const lines = round2(r.items.reduce((sum, it) => sum + it.price, 0));
  if (Math.abs(lines - r.subtotal) > 0.05) warnings.push(`Items add up to $${lines.toFixed(2)} but the subtotal says $${r.subtotal.toFixed(2)}.`);
  const expected = round2(r.subtotal - r.discount + r.tax + r.serviceCharge + r.tip);
  if (r.total && Math.abs(expected - r.total) > 0.05) warnings.push(`Subtotal, tax and charges come to $${expected.toFixed(2)} but the total says $${r.total.toFixed(2)}.`);
  return warnings;
}

// Returns a receipt ready for { type: 'receipt/set', receipt }.
export async function scanReceipt(photo) {
  const raw = demoMode()
    ? await demo(RECEIPT)
    : await askJson({ schema: SCHEMA, parts: [imageBlock(photo), { text: PROMPT }] });
  const items = raw.items.map((it, i) => ({ id: `r${i + 1}`, name: it.name.trim(), qty: it.qty || 1, price: round2(it.lineTotal) }));
  // Filled before the checks, so the Not itemized line doesn't trip "items add up to".
  const r = fillUnitemized({
    restaurant: raw.restaurant, items,
    subtotal: round2(raw.subtotal), discount: round2(Math.abs(raw.discount)), tax: round2(raw.tax),
    serviceCharge: round2(raw.serviceCharge), tip: round2(raw.tip), total: round2(raw.total),
    currency: raw.currency || 'CAD', notes: raw.notes || '', demo: demoMode(),
  });
  if (!r.items.length && ![r.subtotal, r.discount, r.tax, r.serviceCharge, r.tip, r.total].some((v) => v > 0)) {
    throw new Error("Couldn't find any prices in this photo. Try again with the whole receipt in the frame.");
  }
  return { ...r, warnings: receiptWarnings(r) };
}
