// The shared session: one object every phone in the group sees.
// Every change goes through reduce(state, action). It runs on the phone that tapped
// the button (inside a Firebase transaction when syncing), so keep it pure:
// no Date.now(), no Math.random(). store.dispatch() stamps `action.at` for you,
// and ids come in on the action.
//
// Shape (after normalize):
// {
//   id, name, area, createdAt, version,
//   members: { [memberId]: { id, name, color, guest, budget, cuisine, distanceKm, diet: [], pay: { email, paypal, venmo }, joinedAt } },
//   finder:  { places: [Place], votes: { [memberId]: placeId }, winnerId, demo, searchedAt },
//   plan:    { restaurant: { name, address, mapsUrl, cuisine } | null, menu: [MenuItem], settings, order: [{ itemId, qty, forMemberId }], demo },
//   live:    { items: { [liveId]: { id, name, price, qty, claims: { [memberId]: true }, addedAt } } },
//   receipt: null | { restaurant, items: [{ id, name, qty, price }], subtotal, discount, tax, serviceCharge, tip, tipPct,
//                     total, currency, notes, warnings: [], demo, scannedAt, evenSplit,
//                     claims: { [itemId]: { [memberId]: true } }, payerId, paid: { [memberId]: true }, finalizedAt, summary },
// }
// Place    = { id, name, address, cuisine, priceLevel, estCostPerPerson, distanceKm, dietOptions: [], rating, why, mapsUrl, sourceUrl }
// MenuItem = { id, name, price, category, serves, tags: [], description }
// receipt item `price` is the line total (qty already multiplied in).

export const DIETS = ['vegetarian', 'vegan', 'halal', 'gluten_free', 'nut_free', 'dairy_free'];
export const DEFAULT_SETTINGS = { headcount: 4, budget: 80, tipPct: 18, taxPct: 5, mode: 'family', hunger: 'normal', diet: [] };

// Firebase drops empty arrays/objects and can hand arrays back as objects.
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Any phone can write the session, so numbers and names are forced back to the right type.
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
const str = (v, fallback = '') => (v == null ? fallback : String(v));

export function initialState(code, at) {
  return normalize({ id: code, name: 'Our crew', createdAt: at });
}

export function normalize(raw) {
  const s = obj(raw);
  const members = {};
  for (const [id, m] of Object.entries(obj(s.members))) {
    members[id] = {
      guest: false, ...m, id, name: str(m.name, 'Guest'), color: Math.abs(Math.trunc(num(m.color, 0))),
      budget: num(m.budget, 30), cuisine: str(m.cuisine, 'Any'), distanceKm: num(m.distanceKm, 5),
      diet: arr(m.diet), pay: { ...obj(m.pay) },
    };
  }
  const f = obj(s.finder);
  const p = obj(s.plan);
  const liveItems = {};
  for (const [id, it] of Object.entries(obj(obj(s.live).items))) liveItems[id] = { qty: 1, ...it, id, claims: { ...obj(it.claims) } };
  return {
    id: s.id ?? '', name: s.name ?? 'Our crew', area: s.area ?? '', createdAt: s.createdAt ?? 0, version: s.version ?? 0,
    members,
    finder: {
      places: arr(f.places).map((pl) => ({ ...pl, dietOptions: arr(pl.dietOptions) })),
      votes: { ...obj(f.votes) }, winnerId: f.winnerId ?? null, demo: !!f.demo, searchedAt: f.searchedAt ?? null,
    },
    plan: {
      restaurant: p.restaurant ?? null,
      menu: arr(p.menu).map((m) => ({ ...m, tags: arr(m.tags) })),
      settings: normalizeSettings(obj(p.settings)),
      order: arr(p.order), demo: !!p.demo,
    },
    live: { items: liveItems },
    receipt: s.receipt ? normalizeReceipt(s.receipt) : null,
  };
}

function normalizeSettings(st) {
  const d = DEFAULT_SETTINGS;
  return {
    ...d, ...st,
    headcount: Math.max(1, Math.round(num(st.headcount, d.headcount))),
    budget: Math.max(0, num(st.budget, d.budget)),
    tipPct: Math.max(0, num(st.tipPct, d.tipPct)),
    taxPct: Math.max(0, num(st.taxPct, d.taxPct)),
    mode: st.mode === 'individual' ? 'individual' : 'family',
    hunger: ['light', 'normal', 'starving'].includes(st.hunger) ? st.hunger : d.hunger,
    dessert: st.dessert === true,
    diet: arr(st.diet),
  };
}

function normalizeReceipt(r) {
  const claims = {};
  for (const [itemId, who] of Object.entries(obj(r.claims))) claims[itemId] = { ...obj(who) };
  // No tip unless the receipt printed one (tip) or someone adds one: the bill is what was paid.
  return {
    restaurant: '', subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, tip: 0, tipPct: 0,
    total: 0, currency: 'CAD', notes: '', demo: false, scannedAt: null, payerId: null, finalizedAt: null, summary: null,
    ...r, items: arr(r.items), warnings: arr(r.warnings), claims, paid: { ...obj(r.paid) }, evenSplit: r.evenSplit === true,
  };
}

function toggle(map, key) {
  if (map[key]) delete map[key];
  else map[key] = true;
}

const emptyFinder = () => normalize({}).finder;
const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// "Paid" means paid the amount shown at the time. If the bill changes before Finish, everyone's
// share may change, so payments have to be marked again.
const MONEY_FIELDS = ['items', 'evenSplit', 'subtotal', 'discount', 'tax', 'serviceCharge', 'tip', 'tipPct', 'total', 'payerId'];
function billChanged(s) {
  if (s.receipt && !s.receipt.finalizedAt) s.receipt.paid = {};
}

const handlers = {
  // --- Session (Person 4) ---
  'session/rename': (s, a) => { s.name = a.name; },
  'session/setArea': (s, a) => { s.area = a.area; },
  // Start the next meal with the same group: keeps members and plan settings.
  'session/newMeal': (s) => {
    s.finder = emptyFinder();
    s.plan = { ...normalize({}).plan, settings: s.plan.settings };
    s.live = { items: {} };
    s.receipt = null;
  },

  // --- Members (Person 4 + Person 3) ---
  'member/join': (s, a) => {
    const old = s.members[a.member.id];
    s.members[a.member.id] = {
      color: Object.keys(s.members).length % 8, ...old, ...a.member,
      id: a.member.id, joinedAt: old?.joinedAt ?? a.at,
    };
    // A new person changes everyone's even share, so old "paid" marks no longer match.
    if (!old && s.receipt?.evenSplit) billChanged(s);
  },
  'member/update': (s, a) => { if (s.members[a.id]) Object.assign(s.members[a.id], a.patch); },
  'member/remove': (s, a) => {
    delete s.members[a.id];
    delete s.finder.votes[a.id];
    for (const it of Object.values(s.live.items)) delete it.claims[a.id];
    if (s.receipt) {
      for (const who of Object.values(s.receipt.claims)) delete who[a.id];
      delete s.receipt.paid[a.id];
      if (s.receipt.payerId === a.id) s.receipt.payerId = null;
      billChanged(s);
    }
  },

  // --- Group finder (Person 3) ---
  'finder/setPlaces': (s, a) => {
    s.finder = { ...s.finder, places: a.places, demo: !!a.demo, votes: {}, winnerId: null, searchedAt: a.at };
  },
  // Tapping the place you already voted for takes the vote back.
  'finder/vote': (s, a) => {
    if (s.finder.votes[a.memberId] === a.placeId) delete s.finder.votes[a.memberId];
    else s.finder.votes[a.memberId] = a.placeId;
  },
  // Locking a different place than the menu that was scanned clears that menu, so the planner
  // never shows one restaurant's dishes under another's name.
  'finder/lock': (s, a) => {
    const p = s.finder.places.find((x) => x.id === a.placeId);
    if (!p) return;
    if (s.plan.menu.length && !sameName(s.plan.restaurant?.name, p.name)) {
      s.plan.menu = [];
      s.plan.order = [];
      s.plan.demo = false;
    }
    s.finder.winnerId = p.id;
    s.plan.restaurant = { name: p.name, address: p.address ?? '', mapsUrl: p.mapsUrl ?? '', cuisine: p.cuisine ?? '' };
  },

  // --- Order planner + live tab (Person 2) ---
  'plan/setRestaurant': (s, a) => { s.plan.restaurant = a.restaurant; },
  // A menu for a different restaurant than the one locked in replaces it whole, so the
  // name, address, map link and cuisine always belong to the same place.
  'plan/setMenu': (s, a) => {
    s.plan.menu = a.menu;
    s.plan.demo = !!a.demo;
    s.plan.order = [];
    if (a.restaurant && !sameName(s.plan.restaurant?.name, a.restaurant)) {
      s.plan.restaurant = { name: a.restaurant, address: '', mapsUrl: '', cuisine: '' };
      s.finder.winnerId = null;
    }
  },
  'plan/setSettings': (s, a) => { Object.assign(s.plan.settings, a.patch); },
  'plan/setOrder': (s, a) => { s.plan.order = a.order; },
  'live/setItems': (s, a) => {
    s.live.items = Object.fromEntries(a.items.map((it) => [it.id, { qty: 1, claims: {}, addedAt: a.at, ...it }]));
  },
  'live/add': (s, a) => { s.live.items[a.item.id] = { qty: 1, claims: {}, ...a.item, addedAt: a.at }; },
  'live/remove': (s, a) => { delete s.live.items[a.id]; },
  'live/claim': (s, a) => { const it = s.live.items[a.id]; if (it) toggle(it.claims, a.memberId); },

  // --- Fair split (Person 1) ---
  'receipt/set': (s, a) => {
    s.receipt = normalizeReceipt({ ...a.receipt, scannedAt: a.at, finalizedAt: null, summary: null, paid: {} });
  },
  'receipt/update': (s, a) => {
    if (!s.receipt) return;
    Object.assign(s.receipt, a.patch);
    if (Object.keys(a.patch).some((k) => MONEY_FIELDS.includes(k))) billChanged(s);
  },
  'receipt/addItem': (s, a) => {
    if (!s.receipt) return;
    s.receipt.items.push(a.item);
    billChanged(s);
  },
  'receipt/editItem': (s, a) => {
    const it = s.receipt?.items.find((x) => x.id === a.itemId);
    if (!it) return;
    Object.assign(it, a.patch);
    billChanged(s);
  },
  'receipt/removeItem': (s, a) => {
    if (!s.receipt) return;
    s.receipt.items = s.receipt.items.filter((x) => x.id !== a.itemId);
    delete s.receipt.claims[a.itemId];
    billChanged(s);
  },
  // Toggle one person on one item. Two phones tapping at once both land (atomic per tap).
  'receipt/claim': (s, a) => {
    if (!s.receipt) return;
    toggle((s.receipt.claims[a.itemId] ??= {}), a.memberId);
    billChanged(s);
  },
  // Set the exact people on an item ("everyone", "just me", or clear with []).
  'receipt/setClaims': (s, a) => {
    if (!s.receipt) return;
    s.receipt.claims[a.itemId] = Object.fromEntries(a.memberIds.map((id) => [id, true]));
    billChanged(s);
  },
  'receipt/markPaid': (s, a) => {
    if (!s.receipt) return;
    if (a.paid) s.receipt.paid[a.memberId] = true;
    else delete s.receipt.paid[a.memberId];
  },
  // summary is built by the phone that taps "Finish" and saved to every phone's history.
  'receipt/finalize': (s, a) => {
    if (!s.receipt) return;
    s.receipt.finalizedAt = a.at;
    s.receipt.summary = a.summary;
  },
};

export function reduce(state, action) {
  const handler = handlers[action.type];
  if (!handler) throw new Error(`Unknown action: ${action.type}`);
  // A JSON copy instead of structuredClone, which older iPhone Safari (before iOS 15.4) doesn't have.
  const s = JSON.parse(JSON.stringify(normalize(state)));
  handler(s, action);
  s.version += 1;
  return s;
}
