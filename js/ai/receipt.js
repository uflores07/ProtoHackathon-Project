// Receipt photo -> line items, tax, tip, service charge, discounts. (Person 1 tunes the prompt.)
import { RECEIPT } from '../fixtures/receipt.js';
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

const PROMPT = `Read this restaurant receipt and return what it says as JSON.

- items: one entry per line the customer was charged for. Fold modifiers and add-ons
  (like "+ extra cheese 2.00") into the item above them. qty is the printed quantity (1 if none).
  lineTotal is what that line costs in total (quantity already included, after any discount printed on that line).
- Items marked comp, comped, void or 100% off get lineTotal 0.
- subtotal: the printed subtotal before tax. If none is printed, add up the lineTotals.
- discount: bill-level discounts, coupons and promos as one positive number (0 if none). Don't repeat per-line discounts.
- tax: all taxes added together (GST, PST, HST, VAT, sales tax).
- serviceCharge: an automatic gratuity or service charge printed on the bill (0 if none).
- tip: a tip that is printed or handwritten on this receipt (0 if none; most receipts are printed before the tip).
- total: the final total printed on the receipt.
- currency: ISO code such as CAD or USD, from the address or symbols.
- notes: anything you had to guess or couldn't read, in one short sentence. Empty string if all clear.
- If the photo is not a receipt, return no items and say so in notes.`;

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
  const r = {
    restaurant: raw.restaurant, items,
    subtotal: round2(raw.subtotal), discount: round2(Math.abs(raw.discount)), tax: round2(raw.tax),
    serviceCharge: round2(raw.serviceCharge), tip: round2(raw.tip), total: round2(raw.total),
    currency: raw.currency || 'CAD', notes: raw.notes || '', demo: demoMode(),
  };
  return { ...r, warnings: receiptWarnings(r) };
}
