// Ledger: meals saved on this phone, who owes who across them, who should pay next and what you've spent.
// History lives in js/history.js (not the shared session), so every render reads it fresh.
import { demoMode } from '../ai/client.js';
import { addSampleMeals } from '../fixtures/history.js';
import { deleteMeals, listMeals, updateMeal } from '../history.js';
import { balances, monthly, netBalance, pending, reminderText, settlePatch, stats, whoPaysNext } from '../lib/ledger.js';
import { paypalLink, venmoLink } from '../lib/payLinks.js';
import { store } from '../store.js';
import { COLORS, cls, delegate, demoBadge, esc, initials, money, patch, sheet, toast } from '../ui.js';

let months = 3;
let screen = null;

const meId = () => store.me.id;
const meals = () => listMeals().sort((a, b) => (b.at || 0) - (a.at || 0));
const nameOf = (id, name) => (id === meId() ? 'You' : name || 'Someone');
const date = (at) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const small = 'min-h-[36px] px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all';

// History entries carry no colour, so give each person a steady one from their id.
const tint = (id) => COLORS[[...String(id)].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
const avatar = (id, name) => `<span class="w-7 h-7 rounded-xl ${tint(id).soft} ${tint(id).text} flex items-center justify-center text-[10px] font-bold shrink-0" aria-hidden="true">${id === meId() ? 'ME' : initials(name)}</span>`;

// A balance spans meals; `all` is newest first, so its currency is the newest meal's.
const mealsOf = (b, all) => all.filter((m) => b.meals.includes(m.id));
const placesOf = (b, all) => [...new Set(mealsOf(b, all).map((m) => m.restaurant).filter(Boolean))];
const currencyOf = (b, all) => mealsOf(b, all)[0]?.currency || 'CAD';
const toCents = (dollars) => Math.round(Math.abs(dollars) * 100);

// The group's current meal also shows on the Split tab, so paid changes go to every phone there too.
function syncPaid(mealId, memberIds, paid) {
  if (!mealId || mealId !== store.state?.receipt?.summary?.id) return;
  for (const memberId of memberIds) store.dispatch({ type: 'receipt/markPaid', memberId, paid });
}

function balanceCard(list, net) {
  const owed = list.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0);
  const owe = list.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0);
  const line = !list.length ? "You're all settled up." : net > 0 ? 'Friends owe you overall.' : net < 0 ? 'You owe a little overall.' : 'It all evens out.';
  return `<div class="bg-gradient-to-br from-terracotta-600 via-amberWarm-600 to-terracotta-700 rounded-3xl p-4 text-white shadow-xl flex flex-col gap-3">
    <div class="flex justify-between items-center">
      <span class="text-[10px] font-bold uppercase tracking-wider text-amber-200 flex items-center gap-1"><i class="fa-solid fa-scale-balanced"></i> Your balance</span>
      <span class="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-bold">Saved on this phone</span>
    </div>
    <div>
      <h2 class="font-display font-extrabold text-2xl tracking-tight">${net > 0 ? '+' : ''}${money(net)}</h2>
      <p class="text-[10px] text-orange-100">${line}</p>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div class="rounded-xl bg-white/15 border border-white/20 p-2"><p class="text-[9px] text-orange-100">Owed to you</p><p class="font-display font-bold text-sm">${money(owed)}</p></div>
      <div class="rounded-xl bg-black/20 border border-white/20 p-2"><p class="text-[9px] text-orange-100">You owe</p><p class="font-display font-bold text-sm">${money(owe)}</p></div>
    </div>
  </div>`;
}

function payButtons(b, all) {
  const amount = Math.abs(b.amount);
  const note = `Split: ${placesOf(b, all).join(', ') || 'dinner'}`;
  const link = (href, icon, label) => `<a href="${esc(href)}" target="_blank" rel="noopener" class="${small} bg-espresso text-white" aria-label="Pay ${esc(b.name)} ${money(amount)} with ${label}"><i class="${icon}"></i> ${label}</a>`;
  const paypal = paypalLink(b.pay.paypal, toCents(amount), currencyOf(b, all));
  const venmo = venmoLink(b.pay.venmo, toCents(amount), note);
  const out = [];
  if (paypal) out.push(link(paypal, 'fa-brands fa-paypal', 'PayPal'));
  if (venmo) out.push(link(venmo, 'fa-solid fa-mobile-screen-button', 'Venmo'));
  if (b.pay.email) out.push(`<button data-click="interac" data-email="${esc(b.pay.email)}" data-amount="${amount}" class="${small} bg-espresso text-white" aria-label="Copy ${esc(b.name)}'s Interac email"><i class="fa-solid fa-building-columns"></i> Interac</button>`);
  if (out.length) return out.join('');
  return `<p class="text-[9px] text-gray-500 w-full">${esc(b.name)} hasn't added PayPal, Venmo or Interac. Pay them your usual way, then mark it settled.</p>`;
}

function balancesCard(list, all) {
  const rows = list.map((b) => {
    const owesMe = b.amount > 0;
    return `<div class="p-2.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">${avatar(b.personId, b.name)}
          <div class="min-w-0">
            <p class="text-xs text-espresso truncate">${owesMe ? `<b>${esc(b.name)}</b> owes you` : `You owe <b>${esc(b.name)}</b>`}</p>
            <p class="${cls.sub}">From ${plural(b.meals.length, 'meal')}</p>
          </div>
        </div>
        <span class="font-display font-extrabold text-sm ${owesMe ? 'text-sage-600' : 'text-terracotta-600'}">${money(Math.abs(b.amount))}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${owesMe ? `<button data-click="remind" data-person="${esc(b.personId)}" class="${small} bg-espresso text-white" aria-label="Remind ${esc(b.name)} they owe you ${money(b.amount)}"><i class="fa-solid fa-bell"></i> Remind</button>` : payButtons(b, all)}
        <button data-click="settle" data-person="${esc(b.personId)}" class="${small} bg-white border border-gray-200 text-espresso"><i class="fa-solid fa-check"></i> Mark settled</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="${cls.card}">
    <div class="flex items-center justify-between border-b border-gray-100 pb-2">
      <h3 class="${cls.title}">Who owes who</h3><span class="${cls.sub}">Netted across meals</span>
    </div>
    ${rows || `<p class="text-[10px] text-gray-500"><i class="fa-solid fa-circle-check text-sage-500"></i> Nobody owes anybody. Nice.</p>`}
  </div>`;
}

function nextCard(all) {
  const n = whoPaysNext(all);
  const [title, line] = !n
    ? ['Everyone is even', 'Nobody is behind, so anyone can grab the next bill.']
    : n.personId === meId()
      ? ["It's your turn to pay", `You've paid ${money(-n.gap)} less than you've eaten.`]
      : [`${n.name}'s turn to pay`, `They've paid ${money(-n.gap)} less than they've eaten.`];
  return `<div class="bg-white rounded-3xl p-3.5 border border-orange-100 shadow-sm flex items-center gap-3">
    <div class="w-9 h-9 rounded-2xl bg-amberWarm-100 text-amberWarm-600 flex items-center justify-center text-sm shrink-0"><i class="fa-solid fa-hand-holding-dollar"></i></div>
    <div class="min-w-0">
      <p class="${cls.label}">Who pays next</p>
      <h3 class="${cls.title}">${esc(title)}</h3>
      <p class="${cls.sub}">${line} Based on the meals saved on this phone.</p>
    </div>
  </div>`;
}

function statTiles(all) {
  const s = stats(all, meId());
  const tile = (label, value, sub, tone = 'text-espresso') => `<div class="bg-white p-3 rounded-2xl border border-orange-100 shadow-sm flex flex-col gap-0.5 min-w-0">
    <span class="text-[9px] font-bold uppercase text-gray-400">${label}</span>
    <span class="font-display font-extrabold text-base ${tone}">${value}</span>
    <span class="text-[8px] text-gray-500 font-bold">${sub}</span></div>`;
  return `<div class="grid grid-cols-3 gap-2">
    ${tile('Meals', s.meals, `avg ${money(s.avgPerMeal)} each`)}
    ${tile('You spent', money(s.spent), 'your shares')}
    ${s.saved < 0
      ? tile('Over plan', money(-s.saved), `${s.underBudget} under budget`, 'text-terracotta-600')
      : tile('Saved vs plan', money(s.saved), `${s.underBudget} under budget`, 'text-sage-600')}
  </div>`;
}

function chart(all) {
  const data = monthly(all, meId(), months, Date.now());
  const max = Math.max(1, ...data.map((d) => d.total));
  const bar = months === 12 ? 'w-1.5' : 'w-2.5';
  const bars = data.map((d) => {
    const label = `${d.label} ${d.key.slice(0, 4)}: your share ${money(d.mine)}, whole bills ${money(d.total)}`;
    return `<div role="img" aria-label="${label}" title="${label}" class="flex-1 flex flex-col items-center h-full justify-end gap-1 min-w-0">
      <div class="w-full flex items-end justify-center gap-0.5 h-full">
        <div style="height:${(d.mine / max) * 100}%" class="${bar} rounded-t-md bg-terracotta-500"></div>
        <div style="height:${(d.total / max) * 100}%" class="${bar} rounded-t-md bg-sage-300 opacity-60"></div>
      </div>
      <span class="text-[8px] font-bold text-gray-400" aria-hidden="true">${d.label}</span>
    </div>`;
  }).join('');
  const tf = [3, 6, 12].map((n) => `<button data-click="range" data-months="${n}" aria-pressed="${n === months}"
    class="px-2.5 py-1 rounded-lg font-bold ${n === months ? 'bg-white text-espresso shadow-xs' : 'text-gray-500'}">${n}M</button>`).join('');
  return `<div class="${cls.card}">
    <div class="flex items-center justify-between border-b border-gray-100 pb-2">
      <div><h3 class="${cls.title}">Dining spend</h3><p class="${cls.sub}">This month: ${money(data[data.length - 1].mine)} your share</p></div>
      <div class="flex bg-gray-100 p-0.5 rounded-xl text-[9px]" role="group" aria-label="Time range">${tf}</div>
    </div>
    <div class="h-32 w-full pt-2 flex items-end ${months === 12 ? 'gap-1' : 'gap-3'} px-2 border-b border-gray-100">${bars}</div>
    <div class="flex items-center justify-center gap-4 text-[9px] font-bold text-gray-500">
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-xs bg-terracotta-500"></span> Your share</span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-xs bg-sage-300"></span> Whole bill</span>
    </div>
  </div>`;
}

function planLine(meal) {
  if (meal.planned == null) return '';
  const diff = meal.total - meal.planned;
  return diff <= 0
    ? `<span class="text-sage-600 font-bold">Plan ${money(meal.planned)} • ${money(-diff)} under</span>`
    : `<span class="text-terracotta-600 font-bold">Plan ${money(meal.planned)} • ${money(diff)} over</span>`;
}

function mealCard(meal) {
  const mine = meal.members?.[meId()]?.share;
  const n = pending(meal);
  const people = Object.keys(meal.members || {}).length;
  const payer = meal.payerId ? ` • ${esc(nameOf(meal.payerId, meal.payerName))} paid` : '';
  return `<button data-click="meal" data-id="${esc(meal.id)}" class="w-full text-left bg-white rounded-2xl p-3 border border-orange-100 shadow-sm flex flex-col gap-1.5 active:scale-98 transition-all">
    <span class="w-full flex items-start justify-between gap-2">
      <span class="min-w-0">
        <span class="block font-display font-bold text-xs text-espresso truncate">${esc(meal.restaurant || 'Meal')}</span>
        <span class="block text-[9px] text-gray-400">${date(meal.at)} • ${people} ${people === 1 ? 'person' : 'people'}${payer}</span>
      </span>
      <span class="font-display font-extrabold text-xs text-terracotta-600">${money(meal.total)}</span>
    </span>
    <span class="flex items-center gap-1.5 flex-wrap text-[9px]">
      ${mine != null ? `<span class="text-gray-500">Your share <b class="text-espresso">${money(mine)}</b></span>` : ''}
      <span class="${cls.pill} ${n ? 'bg-amberWarm-100 text-amberWarm-800' : 'bg-sage-100 text-sage-800'}">${n ? `${n} pending` : 'Settled'}</span>
      ${planLine(meal)} ${demoBadge(meal.demo)}
    </span>
  </button>`;
}

function historyList(all) {
  const demo = all.some((m) => m.demo);
  return `<div class="flex flex-col gap-2.5">
    <div class="flex items-center justify-between">
      <div><h2 class="font-display font-bold text-sm text-espresso">Past meals</h2><p class="${cls.sub}">Tap a meal to see shares and mark people paid</p></div>
      ${demo ? `<button data-click="removeSamples" class="${small} bg-gray-100 text-espresso">Remove samples</button>`
        : demoMode() ? `<button data-click="loadSamples" class="${small} bg-gray-100 text-espresso">Load sample meals</button>` : ''}
    </div>
    ${all.map(mealCard).join('')}
  </div>`;
}

function empty() {
  return `<div class="${cls.card} items-center text-center py-8">
    <div class="w-12 h-12 rounded-2xl bg-terracotta-100 text-terracotta-600 flex items-center justify-center text-lg"><i class="fa-solid fa-book-open"></i></div>
    <div>
      <h3 class="${cls.title}">Your ledger</h3>
      <p class="text-[10px] text-gray-500 mt-1">No meals yet. Finish a split and it shows up here.</p>
    </div>
    ${demoMode() ? `<button data-click="loadSamples" class="${cls.btnGhost}"><i class="fa-solid split-logo"></i> Load sample meals</button>` : ''}
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
    <div class="flex flex-col gap-1.5">${rows}</div>
    <div class="flex flex-col gap-1 text-xs border-t border-gray-100 pt-2">
      <div class="flex justify-between"><span class="text-gray-500">Total bill</span><b class="text-espresso">${money(meal.total)}</b></div>
      ${meal.planned != null ? `<div class="flex justify-between text-[10px]"><span class="text-gray-500">Planned</span>${planLine(meal)}</div>` : ''}
    </div>
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
    await navigator.clipboard.writeText(text);
    toast('Reminder copied', `Paste it to ${b.name} in a text or chat.`);
  } catch {
    toast("Couldn't copy", text, 'info');
  }
}

export function mount(root) {
  screen = root;
  delegate(root, {
    range: (el) => { months = Number(el.dataset.months); render(root, store.state); },
    meal: (el) => openMeal(el.dataset.id),
    settle: (el) => {
      const all = meals();
      const b = balances(all, meId()).find((x) => x.personId === el.dataset.person);
      if (!b || !confirm(`Mark everything with ${b.name} as settled?`)) return;
      for (const m of all) {
        const p = b.meals.includes(m.id) && settlePatch(m, meId(), b.personId);
        if (!p) continue;
        updateMeal(m.id, p);
        syncPaid(m.id, Object.keys(p.members).filter((k) => p.members[k].paid && !m.members[k].paid), true);
      }
      toast('Settled up', `You and ${b.name} are square.`);
      render(root, store.state);
    },
    interac: (el) => {
      const { email, amount } = el.dataset;
      navigator.clipboard.writeText(email)
        .then(() => toast('Email copied', `Send ${money(amount)} by Interac e-Transfer in your bank app.`))
        .catch(() => toast('Interac e-Transfer', `Send ${money(amount)} to ${email}`, 'info'));
    },
    remind: (el) => remind(el.dataset.person),
    loadSamples: () => {
      addSampleMeals(meId(), Date.now());
      toast('Sample meals added', 'Remove them any time from Past meals.', 'info');
      render(root, store.state);
    },
    removeSamples: () => {
      if (!confirm('Remove the sample meals from your ledger?')) return;
      deleteMeals(listMeals().filter((m) => m.demo).map((m) => m.id));
      render(root, store.state);
    },
  });
}

export function render(root) {
  const all = meals();
  if (!all.length) return patch(root, empty());
  const list = balances(all, meId());
  patch(root, [
    balanceCard(list, netBalance(all, meId())),
    balancesCard(list, all),
    nextCard(all),
    statTiles(all),
    chart(all),
    historyList(all),
  ].join(''));
}
