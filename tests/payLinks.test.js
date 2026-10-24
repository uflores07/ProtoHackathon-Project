import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paypalLink, requestAllText, requestText, venmoLink } from '../js/lib/payLinks.js';

test('request text reads like a friend wrote it', () => {
  const text = requestText({ fromName: 'Alex', toName: 'Sam', amount: 1965, restaurant: 'Trattoria Bella', items: ['Margherita Pizza', 'Lemonade'], email: 'alex@mail.com' });
  assert.equal(text, 'Hi Sam! Your share at Trattoria Bella is $19.65 (Margherita Pizza, Lemonade), tax and tip included. You can e-Transfer me at alex@mail.com. Thanks! - Alex (via Split)');
});

test('request text skips what it does not know and shortens long item lists', () => {
  const text = requestText({ amount: 500, items: ['A', 'B', 'C', 'D', 'E', 'F'] });
  assert.equal(text, 'Hi! Your share of the bill is $5.00 (A, B, C, D and 2 more), tax and tip included. Thanks! (via Split)');
});

test('request text adds the PayPal and Venmo links the payer set', () => {
  const text = requestText({
    fromName: 'Alex', toName: 'Sam', amount: 1965, restaurant: 'Trattoria Bella', items: ['Lemonade'], email: 'alex@mail.com',
    paypalUrl: paypalLink('alexr', 1965, 'CAD'), venmoUrl: venmoLink('alex-r', 1965, 'Trattoria Bella (Split)'),
  });
  assert.equal(text, 'Hi Sam! Your share at Trattoria Bella is $19.65 (Lemonade), tax and tip included. You can e-Transfer me at alex@mail.com.'
    + ' PayPal: https://paypal.me/alexr/19.65CAD Venmo: https://venmo.com/?txn=pay&recipients=alex-r&amount=19.65&note=Trattoria%20Bella%20(Split)'
    + ' Thanks! - Alex (via Split)');
  assert.equal(requestText({ amount: 500, paypalUrl: paypalLink('alexr', 500), venmoUrl: venmoLink('', 500) }),
    'Hi! Your share of the bill is $5.00, tax and tip included. PayPal: https://paypal.me/alexr/5.00CAD Thanks! (via Split)');
});

test('request all lists everyone who still owes, with the pay links but no amount in them', () => {
  const text = requestAllText({
    fromName: 'Alex', restaurant: 'Trattoria Bella', owing: [{ name: 'Sam', amount: 1965 }, { name: 'Jo', amount: 2210 }],
    email: 'alex@mail.com', paypalUrl: paypalLink('alexr', null), venmoUrl: venmoLink('alex-r', null, 'Dinner (Split)'),
  });
  assert.equal(text, "Hi all! Here's what everyone owes for Trattoria Bella, tax and tip included: Sam $19.65, Jo $22.10."
    + ' You can e-Transfer me at alex@mail.com. PayPal: https://paypal.me/alexr Venmo: https://venmo.com/?txn=pay&recipients=alex-r&note=Dinner%20(Split)'
    + ' Thanks! - Alex (via Split)');
  assert.equal(requestAllText({ owing: [{ name: 'Sam', amount: 500 }] }), "Hi all! Here's what everyone owes for the bill, tax and tip included: Sam $5.00. Thanks! (via Split)");
});

test('PayPal.me link with amount and currency', () => {
  assert.equal(paypalLink('alexr', 1965, 'cad'), 'https://paypal.me/alexr/19.65CAD');
  assert.equal(paypalLink('@alexr', 500), 'https://paypal.me/alexr/5.00CAD');
  assert.equal(paypalLink('https://www.paypal.me/alexr/', 100, 'USD'), 'https://paypal.me/alexr/1.00USD');
  assert.equal(paypalLink('a b', 100, 'USD'), 'https://paypal.me/a%20b/1.00USD');
  assert.equal(paypalLink('', 100), '');
});

test('Venmo link encodes the note and strips @', () => {
  assert.equal(venmoLink('@sam-m', 1870, 'Trattoria Bella & co'),
    'https://venmo.com/?txn=pay&recipients=sam-m&amount=18.70&note=Trattoria%20Bella%20%26%20co');
  assert.equal(venmoLink('venmo.com/u/sam-m', 100), 'https://venmo.com/?txn=pay&recipients=sam-m&amount=1.00&note=');
  assert.equal(venmoLink(' ', 100), '');
});
