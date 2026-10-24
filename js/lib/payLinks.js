// Payment requests and "pay me" links. Pure, so Node tests can import it.
// Amounts come in as integer cents (what fairSplit.js returns).

const dollars = (c) => (Math.round(Number(c) || 0) / 100).toFixed(2);
const enc = encodeURIComponent;

// People paste "@name", "paypal.me/name" or the whole link; keep just the name.
const handleOf = (h, site) => String(h ?? '').trim()
  .replace(new RegExp(`^(https?://)?(www\\.)?${site}/(u/)?`, 'i'), '')
  .replace(/^@/, '').replace(/[/?#].*$/, '');

// How to pay the sender back, whichever they set. Links go last in their sentence so no full stop sticks to them.
const ways = ({ email, paypalUrl, venmoUrl }) => [
  email ? `You can e-Transfer me at ${email}.` : '',
  paypalUrl ? `PayPal: ${paypalUrl}` : '',
  venmoUrl ? `Venmo: ${venmoUrl}` : '',
];
const thanks = (fromName) => (fromName ? `Thanks! - ${fromName} (via Split)` : 'Thanks! (via Split)');

// A friendly message for the share sheet or a text.
export function requestText({ fromName, toName, amount, restaurant, items = [], email, paypalUrl, venmoUrl }) {
  const list = items.slice(0, 4).join(', ') + (items.length > 4 ? ` and ${items.length - 4} more` : '');
  return [
    `Hi${toName ? ` ${toName}` : ''}! Your share ${restaurant ? `at ${restaurant}` : 'of the bill'} is $${dollars(amount)}`
      + `${list ? ` (${list})` : ''}, tax and tip included.`,
    ...ways({ email, paypalUrl, venmoUrl }),
    thanks(fromName),
  ].filter(Boolean).join(' ');
}

// One message for the whole group: everyone who still owes, and how much. owing = [{ name, amount }].
export function requestAllText({ fromName, restaurant, owing = [], email, paypalUrl, venmoUrl }) {
  return [
    `Hi all! Here's what everyone owes for ${restaurant || 'the bill'}, tax and tip included: `
      + `${owing.map((o) => `${o.name} $${dollars(o.amount)}`).join(', ')}.`,
    ...ways({ email, paypalUrl, venmoUrl }),
    thanks(fromName),
  ].filter(Boolean).join(' ');
}

// https://paypal.me/<handle>/<amount><CUR>, or '' with no handle.
// amount null leaves it out (a message to several people), and PayPal asks how much.
export function paypalLink(handle, amount, currency = 'CAD') {
  const h = handleOf(handle, 'paypal\\.me');
  if (!h) return '';
  return `https://paypal.me/${enc(h)}${amount == null ? '' : `/${enc(dollars(amount))}${enc(String(currency || 'CAD').toUpperCase())}`}`;
}

// Venmo's pay link (US accounts only), or '' with no handle. amount null leaves it out.
export function venmoLink(handle, amount, note = '') {
  const h = handleOf(handle, 'venmo\\.com');
  return h ? `https://venmo.com/?txn=pay&recipients=${enc(h)}${amount == null ? '' : `&amount=${enc(dollars(amount))}`}&note=${enc(note)}` : '';
}
