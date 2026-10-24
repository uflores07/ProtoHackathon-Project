// Some receipts don't list everything: a card slip shows only the total, a long receipt gets cut off.
// Whatever the totals say the food came to, minus the lines that were read, becomes one
// "Not itemized" line the group claims like any other item. Pure, so Node tests can import it.
import { cents } from './fairSplit.js';

// The food amount the receipt implies, in cents: the printed subtotal, else the total minus tax,
// fees and tip plus the discount. Never below 0.
const impliedFood = (r) => {
  if (cents(r.subtotal) > 0) return cents(r.subtotal);
  if (cents(r.total) <= 0) return 0;
  return Math.max(0, cents(r.total) - cents(r.tax) - cents(r.serviceCharge) - cents(r.tip) + Math.abs(cents(r.discount)));
};

// Returns a new receipt (dollars, like reducer.js) with the missing amount as its own line.
// Items that add up to more than the subtotal are left alone: receiptWarnings flags that.
export function fillUnitemized(receipt) {
  const r = { ...receipt, items: [...(receipt.items ?? [])] };
  const food = impliedFood(r);
  // No printed subtotal: use the implied one, so the "items add up to" check compares like with like.
  if (cents(r.subtotal) <= 0 && food > 0) r.subtotal = food / 100;
  const gap = food - r.items.reduce((sum, it) => sum + cents(it.price), 0);
  if (gap > 5) r.items.push({ id: 'r-unitemized', name: 'Not itemized', qty: 1, price: gap / 100, unitemized: true });
  return r;
}
