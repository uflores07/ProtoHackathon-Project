// Ledger: what everyone owes you and what you owe, meal by meal, settling up (and undoing it), and past meals.
// History lives in js/history.js (not the shared session), so every render reads it fresh.
import { demoMode } from '../ai/client.js';
import { addSampleMeals } from '../fixtures/history.js';
import { deleteMeals, listMeals, updateMeal } from '../history.js';
import { balances, pending, reminderText, settled, settlePatch } from '../lib/ledger.js';
import { paypalLink } from '../lib/payLinks.js';
import { store } from '../store.js';
import { COLORS, cls, delegate, demoBadge, esc, initials, money, patch, sheet, toast } from '../ui.js';

let screen = null;
const open = new Set(); // expanded person rows, as "owe:<id>" or "done:<id>"
let selecting = false; // Past meals checkboxes on
const picked = new Set();

const meId = () => store.me.id;
const meals = () => listMeals().sort((a, b) => (b.at || 0) - (a.at || 0));
const nameOf = (id, name) => (id === meId() ? 'You' : name || 'Someone');
const date = (at) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const small = 'min-h-[36px] px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all';
const toCents = (dollars) => Math.round(Math.abs(dollars) * 100);
// No clipboard API off https (a phone on the dev server's LAN address), so fail into the catch.
const copy = (text) => (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')));
const directions = (meal) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([meal.restaurant, meal.area].filter(Boolean).join(' '))}`;

// History entries carry no colour, so give each person a steady one from their id.
const tint = (id) => COLORS[[...String(id)].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
const avatar = (id, name) => `<span class="w-8 h-8 rounded-xl ${tint(id).soft} ${tint(id).text} flex items-center justify-center text-[10px] font-bold shrink-0" aria-hidden="true">${id === meId() ? 'ME' : initials(name)}</span>`;

// A balance spans meals; `all` is newest first, so its currency is the newest meal's.
const mealsOf = (b, all) => all.filter((m) => b.meals.includes(m.id));
const placesOf = (b, all) => [...new Set(mealsOf(b, all).map((m) => m.restaurant).filter(Boolean))];
const currencyOf = (b, all) => mealsOf(b, all)[0]?.currency || 'CAD';

// The group's current meal also shows on the Split tab, so paid changes go to every phone there too.
function syncPaid(mealId, memberIds, paid) {
  if (!mealId || mealId !== store.state?.receipt?.summary?.id) return;
  for (const memberId of memberIds) store.dispatch({ type: 'receipt/markPaid', memberId, paid });
}

// Marks the debt between me and personId in each of these meals paid (or not paid again).
function setPaidWith(personId, mealIds, paid) {
  const at = Date.now();
  for (const m of meals()) {
    const p = mealIds.includes(m.id) && settlePatch(m, meId(), personId, paid, at);
    if (!p) continue;
    updateMeal(m.id, p);
    syncPaid(m.id, Object.keys(p.members).filter((k) => !!p.members[k].paid !== !!m.members[k].paid), paid);
  }
}

function summaryCard(list) {
  const owed = list.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0);
  const owe = list.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0);
  const box = (label, value) => `<div class="min-w-0">
    <p class="text-[10px] font-bold uppercase tracking-wider text-amber-200">${label}</p>
    <p class="font-display font-extrabold text-3xl tracking-tight truncate">${money(value)}</p>
  </div>`;
  return `<div class="bg-gradient-to-br from-terracotta-600 via-amberWarm-600 to-terracotta-700 rounded-3xl p-4 text-white shadow-xl flex flex-col gap-2">
    <div class="grid grid-cols-2 gap-3">${box('Owed to you', owed)}${box('You owe', owe)}</div>
    <p class="text-[10px] text-orange-100">${list.length ? 'Tap a name to see the meals behind it.' : '<i class="fa-solid fa-circle-check"></i> You\'re all settled up.'}</p>
  </div>`;
}

// Each meal behind a row. Amounts read the row's way round, so a meal that goes the other way shows a minus.
function breakdown(b) {
  const sign = b.amount < 0 ? -1 : 1;
  return `<ul class="flex flex-col gap-1 border-t border-gray-100 pt-2">${b.items.map((i) => `<li>
    <button data-click="meal" data-id="${esc(i.mealId)}" class="w-full min-h-[36px] flex items-center justify-between gap-2 text-left text-[11px]">
      <span class="min-w-0 truncate"><b class="text-espresso">${esc(i.restaurant)}</b> <span class="text-gray-500">${date(i.at)}</span></span>
      <b class="shrink-0 text-espresso">${money(sign * i.amount)}</b>
    </button></li>`).join('')}</ul>`;
}

function payButtons(b, all) {
  const amount = Math.abs(b.amount);
  const paypal = paypalLink(b.pay.paypal, toCents(amount), currencyOf(b, all));
  const out = [];
  if (b.pay.email) out.push(`<button data-click="interac" data-email="${esc(b.pay.email)}" data-amount="${amount}" class="${small} bg-espresso text-white" aria-label="Copy ${esc(b.name)}'s Interac e-Transfer email"><i class="fa-solid fa-building-columns"></i> e-Transfer</button>`);
  if (paypal) out.push(`<a href="${esc(paypal)}" target="_blank" rel="noopener" class="${small} bg-espresso text-white" aria-label="Pay ${esc(b.name)} ${money(amount)} with PayPal"><i class="fa-brands fa-paypal"></i> PayPal</a>`);
  return out.join('') || `<p class="text-[10px] text-gray-500 w-full">${esc(b.name)} hasn't added e-Transfer or PayPal. Pay them your usual way, then mark it settled.</p>`;
}

// One person in "Who owes you" / "You owe" (kind "owe") or "Settled" (kind "done").
function personRow(b, kind, all) {
  const key = `${kind}:${b.personId}`;
  const isOpen = open.has(key);
  const owesMe = b.amount > 0;
  const tone = kind === 'done' ? 'text-espresso' : owesMe ? 'text-sage-600' : 'text-terracotta-600';
  const sub = kind === 'owe' ? plural(b.meals.length, 'meal')
    : `${owesMe ? 'Paid you back' : b.amount < 0 ? 'You paid them back' : 'All square'} • ${date(b.at)}`;
  const undo = `<button data-click="undo" data-person="${esc(b.personId)}" class="${small} bg-white border border-gray-200 text-espresso shrink-0" aria-label="Undo: mark ${esc(b.name)}'s ${plural(b.meals.length, 'meal')} not paid"><i class="fa-solid fa-rotate-left"></i> Undo</button>`;
  const actions = kind === 'done' ? '' : `<div class="flex flex-wrap gap-1.5">
    ${owesMe ? `<button data-click="remind" data-person="${esc(b.personId)}" class="${small} bg-gray-100 text-espresso" aria-label="Remind ${esc(b.name)} they owe you ${money(b.amount)}"><i class="fa-solid fa-bell"></i> Remind</button>` : payButtons(b, all)}
    <button data-click="settle" data-person="${esc(b.personId)}" class="${small} bg-sage-100 text-sage-800"><i class="fa-solid fa-check"></i> Mark settled</button>
  </div>`;
  return `<div class="p-2.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <button data-click="expand" data-key="${esc(key)}" aria-expanded="${isOpen}" class="flex-1 min-w-0 min-h-[40px] flex items-center justify-between gap-2 text-left">
        <span class="flex items-center gap-2 min-w-0">${avatar(b.personId, b.name)}
          <span class="min-w-0"><span class="block text-xs font-bold text-espresso truncate">${esc(b.name)}</span><span class="block ${cls.sub}">${sub}</span></span>
        </span>
        <span class="flex items-center gap-2 shrink-0">
          <span class="font-display font-extrabold text-base ${tone}">${money(Math.abs(b.amount))}</span>
          <i class="fa-solid fa-chevron-${isOpen ? 'up' : 'down'} text-[10px] text-gray-400" aria-hidden="true"></i>
        </span>
      </button>
      ${kind === 'done' ? undo : ''}
    </div>
    ${isOpen ? breakdown(b) + actions : ''}
  </div>`;
}

function peopleCard(title, sub, list, kind, all) {
  if (!list.length) return '';
  return `<div class="${cls.card}">
    <div><h3 class="${cls.title}">${title}</h3>${sub ? `<p class="${cls.sub}">${sub}</p>` : ''}</div>
    ${list.map((b) => personRow(b, kind, all)).join('')}
  </div>`;
}

function mealRow(meal) {
  const mine = meal.members?.[meId()]?.share;
  const n = pending(meal);
  const inner = `<span class="flex-1 min-w-0">
      <span class="block font-display font-bold text-xs text-espresso truncate">${esc(meal.restaurant || 'Meal')}</span>
      <span class="flex items-center gap-1.5 flex-wrap text-[10px] text-gray-500">${date(meal.at)}
        ${n ? `<span class="${cls.pill} bg-amberWarm-100 text-amberWarm-800">${n} unpaid</span>` : ''} ${demoBadge(meal.demo)}</span>
    </span>
    <span class="text-right shrink-0">
      <span class="block font-display font-extrabold text-xs text-espresso">${money(meal.total)}</span>
      ${mine != null ? `<span class="block text-[10px] text-gray-500">You ${money(mine)}</span>` : ''}
    </span>`;
  const box = 'w-full bg-white rounded-2xl p-3 border border-orange-100 shadow-sm flex items-center gap-3 text-left';
  if (!selecting) return `<button data-click="meal" data-id="${esc(meal.id)}" class="${box} active:scale-98 transition-all">${inner}</button>`;
  return `<label class="${box}">
    <input type="checkbox" data-change="pick" data-key="pick:${esc(meal.id)}" value="${esc(meal.id)}" ${picked.has(meal.id) ? 'checked' : ''}
      class="w-5 h-5 accent-terracotta-500 shrink-0" aria-label="Select ${esc(meal.restaurant || 'meal')}, ${date(meal.at)}">${inner}
  </label>`;
}

function historyList(all) {
  const demo = all.some((m) => m.demo);
  const extra = selecting ? ''
    : demo ? `<button data-click="removeSamples" class="${small} bg-gray-100 text-espresso">Remove samples</button>`
      : demoMode() ? `<button data-click="loadSamples" class="${small} bg-gray-100 text-espresso">Load sample meals</button>` : '';
  return `<div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h2 class="font-display font-bold text-sm text-espresso">Past meals</h2>
      <div class="flex items-center gap-1.5">${extra}
        <button data-click="select" class="${small} ${selecting ? 'bg-espresso text-white' : 'bg-gray-100 text-espresso'}" aria-pressed="${selecting}">${selecting ? 'Done' : 'Select'}</button>
      </div>
    </div>
    ${selecting ? `<button data-click="deletePicked" class="${cls.btn}" ${picked.size ? '' : 'disabled'}><i class="fa-solid fa-trash"></i> Delete ${plural(picked.size, 'meal')}</button>` : ''}
    ${all.map(mealRow).join('')}
  </div>`;
}

function empty() {
  return `<div class="${cls.card} items-center text-center py-8">
    <div class="w-12 h-12 rounded-2xl bg-terracotta-100 text-terracotta-600 flex items-center justify-center text-lg"><i class="fa-solid fa-book-open"></i></div>
    <div>
      <h3 class="${cls.title}">Your ledger</h3>
      <p class="text-[10px] text-gray-500 mt-1">No meals yet. Finish a split and it shows up here.</p>
    </div>
    ${demoMode() ? `<button data-click="loadSamples" class="${small} bg-gray-100 text-espresso">Load sample meals</button>` : ''}
  </div>`;
}

function mealBody(meal) {
  const rows = Object.entries(meal.members || {}).map(([id, m]) => {
    const name = nameOf(id, m.name);
    const right = id === meal.payerId
      ? `<span class="${cls.pill} bg-terracotta-100 text-terracotta-700">Paid the bill</span>`
      : `<button data-click="paid" data-member="${esc(id)}" aria-pressed="${!!m.paid}" aria-label="${esc(name)} paid back"
          class="${small} ${m.paid ? 'bg-sage-100 text-sage-800' : 'bg-amberWarm-100 text-amberWarm-800'}">
          <i class="fa-solid ${m.paid ? 'fa-circle-check' : 'fa-clock'}"></i> ${m.paid ? 'Paid back' : 'Not yet'}</button>`;
    return `<div class="${cls.row}">
      <div class="flex items-center gap-2 min-w-0">${avatar(id, m.name)}
        <div class="min-w-0"><p class="font-bold text-espresso truncate">${esc(name)}</p><p class="${cls.sub}">Share ${money(m.share)}</p></div>
      </div>${right}
    </div>`;
  }).join('');
  return `${demoBadge(meal.demo)}
    <p class="${cls.sub}">Tap Paid back or Not yet to change it.</p>
    <div class="flex flex-col gap-1.5">${rows}</div>
    <div class="flex justify-between text-xs border-t border-gray-100 pt-2"><span class="text-gray-500">Total bill</span><b class="text-espresso">${money(meal.total)}</b></div>
    ${meal.restaurant ? `<a href="${esc(directions(meal))}" target="_blank" rel="noopener" class="${cls.btnGhost}"><i class="fa-solid fa-diamond-turn-right"></i> Directions</a>` : ''}
    <button data-click="remove" class="${cls.btnGhost} text-terracotta-600"><i class="fa-solid fa-trash"></i> Delete this meal</button>`;
}

function openMeal(id) {
  const find = () => listMeals().find((m) => m.id === id);
  const meal = find();
  if (!meal) return;
  const { el, close } = sheet({
    title: meal.restaurant || 'Meal',
    subtitle: [date(meal.at), meal.cuisine, meal.area].filter(Boolean).join(' • '),
    icon: 'fa-receipt',
    body: mealBody(meal),
  });
  delegate(el, {
    paid: (btn) => {
      const m = find();
      const who = m?.members?.[btn.dataset.member];
      if (!who) return;
      updateMeal(id, { members: { ...m.members, [btn.dataset.member]: { ...who, paid: !who.paid } } });
      syncPaid(id, [btn.dataset.member], !who.paid);
      el.innerHTML = mealBody(find());
      render(screen, store.state);
    },
    remove: () => {
      if (!confirm(`Delete ${meal.restaurant || 'this meal'} from your ledger? This only removes it from this phone.`)) return;
      deleteMeals([id]);
      picked.delete(id);
      close();
      render(screen, store.state);
      toast('Meal deleted', 'It is gone from this phone.', 'info');
    },
  });
}

// Share sheet on phones; copies the message where there isn't one (most laptops).
async function remind(personId) {
  const all = meals();
  const b = balances(all, meId()).find((x) => x.personId === personId);
  if (!b || b.amount <= 0) return;
  const text = reminderText({ name: b.name, amountCents: toCents(b.amount), places: placesOf(b, all), currency: currencyOf(b, all), pay: store.me.pay });
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await copy(text);
    toast('Reminder copied', `Paste it to ${b.name} in a text or chat.`);
  } catch {
    toast("Couldn't copy", text, 'info');
  }
}

export function mount(root) {
  screen = root;
  const rerender = () => render(root, store.state);
  delegate(root, {
    expand: (el) => {
      const k = el.dataset.key;
      if (!open.delete(k)) open.add(k);
      rerender();
    },
    meal: (el) => openMeal(el.dataset.id),
    settle: (el) => {
      const b = balances(meals(), meId()).find((x) => x.personId === el.dataset.person);
      if (!b) return;
      setPaidWith(b.personId, b.meals, true);
      open.delete(`owe:${b.personId}`);
      toast('Settled up', `${b.name} moved to Settled. Tap Undo there if it was a mistake.`);
      rerender();
    },
    undo: (el) => {
      const b = settled(meals(), meId()).find((x) => x.personId === el.dataset.person);
      if (!b) return;
      setPaidWith(b.personId, b.meals, false);
      open.delete(`done:${b.personId}`);
      toast('Not settled', `${plural(b.meals.length, 'meal')} with ${b.name} marked not paid again.`, 'info');
      rerender();
    },
    interac: (el) => {
      const { email, amount } = el.dataset;
      copy(email)
        .then(() => toast('Email copied', `Send ${money(amount)} by Interac e-Transfer in your bank app.`))
        .catch(() => toast('Interac e-Transfer', `Send ${money(amount)} to ${email}`, 'info'));
    },
    remind: (el) => remind(el.dataset.person),
    select: () => {
      selecting = !selecting;
      picked.clear();
      rerender();
    },
    pick: (el) => {
      if (el.checked) picked.add(el.value);
      else picked.delete(el.value);
      rerender();
    },
    deletePicked: () => {
      const ids = [...picked];
      if (!ids.length || !confirm(`Delete ${plural(ids.length, 'meal')} from your ledger? This only removes them from this phone.`)) return;
      deleteMeals(ids);
      picked.clear();
      selecting = false;
      toast('Meals deleted', `${plural(ids.length, 'meal')} gone from this phone.`, 'info');
      rerender();
    },
    loadSamples: () => {
      addSampleMeals(meId(), Date.now());
      toast('Sample meals added', 'Remove them any time from Past meals.', 'info');
      rerender();
    },
    removeSamples: () => {
      if (!confirm('Remove the sample meals from your ledger?')) return;
      deleteMeals(listMeals().filter((m) => m.demo).map((m) => m.id));
      rerender();
    },
  });
}

export function render(root) {
  const all = meals();
  if (!all.length) {
    selecting = false;
    picked.clear();
    return patch(root, empty());
  }
  const list = balances(all, meId());
  patch(root, [
    summaryCard(list),
    peopleCard('Who owes you', '', list.filter((b) => b.amount > 0), 'owe', all),
    peopleCard('You owe', '', list.filter((b) => b.amount < 0), 'owe', all),
    peopleCard('Settled', 'Your latest settle-up with each person. Marked by mistake? Tap Undo.', settled(all, meId()), 'done', all),
    historyList(all),
  ].join(''));
}
