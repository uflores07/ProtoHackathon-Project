// What the AI returns for a receipt, used in demo mode (no API key). Same shape as js/ai/receipt.js SCHEMA.
// Printed before the tip, like most Canadian receipts. It's the demo plan's order (4 people, $80)
// so the live tab fills in who had what, plus one unplanned salad and a comped dessert.
export const RECEIPT = {
  restaurant: 'Trattoria Bella',
  items: [
    { name: 'Margherita Pizza', qty: 1, lineTotal: 18.0 },
    { name: 'Diavola Pizza', qty: 1, lineTotal: 21.0 },
    { name: 'Garlic Bread', qty: 1, lineTotal: 7.0 },
    { name: 'Lemonade Pitcher', qty: 1, lineTotal: 14.0 },
    { name: 'Caesar Salad', qty: 1, lineTotal: 14.0 },
    { name: 'Tiramisu (comp)', qty: 1, lineTotal: 0 },
  ],
  subtotal: 74.0,
  discount: 0,
  tax: 3.7,
  serviceCharge: 0,
  tip: 0,
  total: 77.7,
  currency: 'CAD',
  notes: '',
};
