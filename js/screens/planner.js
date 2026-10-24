// Person 2: the Order Planner (a budget-fitting order from a menu photo) and the Live Tab at the table.
import { bestValue, buildOrder, HUNGER, liveTotals, swap, totals } from '../lib/orderPlan.js';
import { DIETS } from '../reducer.js';
import { go } from '../router.js';
import { onScanned, openScanner } from '../scanner.js';
import { store } from '../store.js';
import { cls, color, delegate, demoBadge, esc, money, patch, toast, uid } from '../ui.js';

let view = 'plan'; // 'plan' | 'live'
let avoid = []; // dishes swapped away from, so tapping swap again moves on to a new dish
const drafts = {}; // half-typed inputs, so a sync from another phone doesn't wipe them

const ICON = { appetizer: 'fa-bowl-food', main: 'split-logo', side: 'fa-bread-slice', dessert: 'fa-ice-cream', drink: 'fa-glass-water', other: 'fa-plate-wheat' };
const HUNGER_LABEL = { light: 'Light', normal: 'Normal', starving: 'Starving' };
const TIP_CHOICES = [15, 18, 20, 25];
const dietName = (d) => d.replace(/_/g, ' ');
const firstName = (name) => esc((name || 'Guest').trim().split(/\s+/)[0]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const round1 = (n) => Math.round(n * 10) / 10;

// Same order on every phone, so individual-mode dishes go to the same people everywhere.
const people = (s) => Object.values(s.members).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id));
const diets = (s) => Object.fromEntries(Object.values(s.members).map((m) => [m.id, m.diet]));
const plan = (s, settings = s.plan.settings) => buildOrder(s.plan.menu, settings, people(s).map((m) => m.id), diets(s));

async function setOrder(order) {
  avoid = [];
  await store.dispatch({ type: 'plan/setOrder', order });
}

// Read the state after the dispatch, so two quick changes (budget, then headcount) both count.
// Exported so the Group tab's "Lock winner" replans too when it changes the group size.
export async function setSettings(change) {
  await store.dispatch({ type: 'plan/setSettings', patch: change });
  const s = store.state;
  if (s.plan.menu.length) await setOrder(plan(s, { ...s.plan.settings, ...change }).order);
}

export function mount(root) {
  onScanned('menu', async (data) => {
    if (!store.state) return;
    await store.dispatch({ type: 'plan/setMenu', restaurant: data.restaurant, menu: data.menu, demo: data.demo });
    await setOrder(plan(store.state).order);
    view = 'plan';
    go('planner');
  });

  const rerender = () => store.state && render(root, store.state);
  // A number box: dispatches on change, or puts the old value back if it isn't a valid number.
  const numberField = (el, key, min, max) => {
    delete drafts[el.id];
    const v = Math.round(Number(el.value) * 100) / 100;
    if (el.value === '' || !(v >= min && v <= max)) {
      toast('Check that number', `Use something from ${min} to ${max}.`, 'warn');
      return rerender();
    }
    setSettings({ [key]: v });
  };

  delegate(root, {
    view: (el) => { view = el.dataset.view; rerender(); },
    scanMenu: () => openScanner('menu'),
    scanReceipt: () => openScanner('receipt'),
    draft: (el) => { drafts[el.id] = el.value; },
    headcount: (el) => {
      const n = store.state.plan.settings.headcount + Number(el.dataset.delta);
      if (n >= 1 && n <= 30) setSettings({ headcount: n });
    },
    groupSize: () => setSettings({ headcount: Object.keys(store.state.members).length }),
    budget: (el) => numberField(el, 'budget', 1, 100000),
    tax: (el) => numberField(el, 'taxPct', 0, 30),
    mode: (el) => setSettings({ mode: el.dataset.mode }),
    hunger: (el) => setSettings({ hunger: el.value }),
    tip: (el) => setSettings({ tipPct: Number(el.dataset.pct) }),
    tipCustom: (el) => numberField(el, 'tipPct', 0, 100),
    diet: (el) => {
      const diet = store.state.plan.settings.diet;
      const d = el.dataset.diet;
      setSettings({ diet: diet.includes(d) ? diet.filter((x) => x !== d) : [...diet, d] });
    },
    dessert: () => setSettings({ dessert: !store.state.plan.settings.dessert }),
    replan: () => setOrder(plan(store.state).order),
    swap: (el) => {
      const { menu, order, settings } = store.state.plan;
      const res = swap(order, menu, el.dataset.id, settings, avoid, diets(store.state));
      const old = menu.find((m) => m.id === el.dataset.id);
      if (!res) return toast('Nothing to swap in', `No other ${old?.category || 'dish'} fits your diet filters.`, 'info');
      avoid = [...avoid, el.dataset.id];
      store.dispatch({ type: 'plan/setOrder', order: res.order });
      toast('Swapped', `${res.swappedIn.name} instead of ${old?.name || 'that dish'}.`);
    },
    lock: () => lockPlan(rerender),
    claim: (el) => store.dispatch({ type: 'live/claim', id: el.dataset.id, memberId: el.dataset.member }),
    removeLive: (el) => store.dispatch({ type: 'live/remove', id: el.dataset.id }),
    addLive: (form) => {
      const name = form.querySelector('#liveName').value.trim();
      const price = Math.round(Number(form.querySelector('#livePrice').value) * 100) / 100;
      if (!name) return toast('Name the item', 'e.g. Extra fries', 'warn');
      if (!(price > 0 && price < 10000)) return toast('Add a price', 'What it costs, e.g. 6.50', 'warn');
      delete drafts.liveName;
      delete drafts.livePrice;
      store.dispatch({ type: 'live/add', item: { id: uid(), name: name.slice(0, 60), price, qty: 1 } });
    },
  });
}

async function lockPlan(rerender) {
  const s = store.state;
  const { menu, order, settings } = s.plan;
  if (Object.keys(s.live.items).length && !confirm('Replace what is on the live tab with this plan?')) return;
  const byId = new Map(menu.map((m) => [m.id, m]));
  const everyone = Object.fromEntries(Object.keys(s.members).map((id) => [id, true]));
  // Individual plates start claimed by their person; a family spread starts shared by everyone.
  // The index prefix keeps the plan's order, since synced keys come back sorted.
  const items = order.filter((e) => byId.has(e.itemId)).map((e, i) => {
    const it = byId.get(e.itemId);
    const claims = settings.mode === 'individual' ? (e.forMemberId ? { [e.forMemberId]: true } : {}) : everyone;
    return { id: `${String(i).padStart(2, '0')}${uid(6)}`, name: it.name, price: it.price, qty: e.qty, claims };
  });
  view = 'live';
  await store.dispatch({ type: 'live/setItems', items });
  rerender();
  toast('Live tab started', 'Tap who is having each dish as it arrives.');
}

export function render(root, state) {
  const tabBtn = (id, icon, label) => `
    <button data-click="view" data-view="${id}" aria-pressed="${view === id}" class="flex-1 py-2 rounded-xl text-xs font-bold transition-all ${view === id ? 'bg-terracotta-500 text-white shadow-sm' : 'text-gray-500 hover:text-espresso'}">
      <i class="fa-solid ${icon} mr-1"></i> ${label}
    </button>`;
  patch(root, `
    <div class="flex p-1 bg-white/90 backdrop-blur-md rounded-2xl border border-orange-100 shadow-sm">
      ${tabBtn('plan', 'fa-wand-magic-sparkles', 'Order Planner')}
      ${tabBtn('live', 'split-logo', 'Live Tab')}
    </div>
    ${view === 'live' ? liveView(state) : planView(state)}`);
}

// ---------- Order planner ----------

function planView(s) {
  return `<div class="flex flex-col gap-3">${hero(s.plan.restaurant)}${settingsCard(s)}${s.plan.menu.length ? recommendation(s) : noMenu()}</div>`;
}

function hero(r) {
  const map = safeUrl(r?.mapsUrl);
  return `
    <div class="bg-gradient-to-br from-terracotta-500 via-terracotta-600 to-amberWarm-600 rounded-3xl p-3.5 text-white shadow-lg flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-[9px] font-bold uppercase tracking-wider text-orange-100">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Split AI Pre-Planner
          </span>
          <h2 class="font-display font-bold text-base mt-0.5">Plan Before You Order</h2>
        </div>
        <span class="shrink-0 text-[9px] bg-black/20 px-2 py-0.5 rounded-lg text-orange-100 font-mono">Tax+Tip Included</span>
      </div>
      ${r?.name ? `<p class="text-[11px] font-bold flex items-center gap-1.5 min-w-0">
          <i class="fa-solid fa-location-dot text-orange-100"></i><span class="truncate">${esc(r.name)}${r.cuisine ? ` <span class="font-normal text-orange-100">· ${esc(r.cuisine)}</span>` : ''}</span>
          ${map ? `<a href="${esc(map)}" target="_blank" rel="noopener" class="shrink-0 text-[9px] underline text-orange-100">Map</a>` : ''}
        </p>` : ''}
      <p class="text-[10px] text-orange-100/90 leading-relaxed">${r?.name
        ? 'Snap their menu and Split picks the most food for your budget, with tax and tip already counted.'
        : 'Pick a place in the Group tab, or just snap a menu. Split picks the most food for your budget, with tax and tip already counted.'}</p>
      <button data-click="scanMenu" class="w-full py-2.5 bg-white text-terracotta-600 font-bold rounded-2xl shadow-sm text-xs flex items-center justify-center gap-1.5 hover:bg-orange-50 active:scale-98 transition-all">
        <i class="fa-solid fa-camera text-terracotta-500 text-xs"></i><span>Scan Restaurant Menu Photo</span>
      </button>
    </div>`;
}

function settingsCard(s) {
  const st = s.plan.settings;
  const group = Object.keys(s.members).length;
  const stepBtn = (delta, label) => `<button data-click="headcount" data-delta="${delta}" aria-label="${label}" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-espresso font-bold flex items-center justify-center active:scale-95 text-xs">${delta < 0 ? '−' : '+'}</button>`;
  const modeBtn = (mode, icon, label) => `<button data-click="mode" data-mode="${mode}" aria-pressed="${st.mode === mode}" class="py-1.5 rounded-xl text-[10px] font-bold transition-all ${st.mode === mode ? 'bg-white text-terracotta-600 shadow-xs' : 'text-gray-500 hover:text-espresso'}"><i class="fa-solid ${icon} mr-1"></i> ${label}</button>`;
  // Diets people set in the Group tab that the filter doesn't cover yet.
  const missing = DIETS.filter((d) => !st.diet.includes(d))
    .map((d) => [d, people(s).filter((m) => m.diet.includes(d)).map((m) => firstName(m.name)).join(', ')])
    .filter(([, who]) => who);
  const select = 'w-full bg-gray-50 border border-gray-200 rounded-xl p-1.5 h-8 text-[10px] font-semibold text-gray-700 focus:outline-none focus:border-terracotta-300';
  const presetTip = TIP_CHOICES.includes(Number(st.tipPct));
  const tipBtn = (t) => {
    const on = Number(st.tipPct) === t;
    return `<button data-click="tip" data-pct="${t}" aria-pressed="${on}" class="flex-1 h-8 rounded-xl text-[10px] font-bold transition-all ${on ? 'bg-terracotta-500 text-white' : 'bg-gray-100 text-gray-500 hover:text-espresso'}">${t}%</button>`;
  };
  return `
    <div class="${cls.card}">
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-gray-50 p-2 rounded-2xl border border-gray-100">
          <span class="${cls.label}">Headcount</span>
          <div class="flex items-center justify-between">
            ${stepBtn(-1, 'One fewer person')}
            <span class="font-display font-extrabold text-sm text-espresso" aria-live="polite">${esc(st.headcount)}</span>
            ${stepBtn(1, 'One more person')}
          </div>
          ${group && group !== st.headcount ? `<button data-click="groupSize" class="mt-1 text-[9px] font-bold text-terracotta-600 underline">Use group size (${group})</button>` : ''}
        </div>
        <div class="bg-gray-50 p-2 rounded-2xl border border-gray-100">
          <label for="planBudget" class="${cls.label}">Total budget</label>
          <div class="flex items-center h-8">
            <span class="text-gray-400 font-bold text-xs mr-1">$</span>
            <input id="planBudget" type="number" inputmode="decimal" min="1" step="5" value="${esc(drafts.planBudget ?? st.budget)}" data-change="budget" data-input="draft"
              class="w-full bg-transparent font-display font-extrabold text-sm text-espresso focus:outline-none">
          </div>
          <p class="text-[9px] text-gray-400">${money(st.budget / st.headcount)} per person</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-1.5 p-1 bg-gray-100 rounded-2xl">
        ${modeBtn('family', 'fa-bowl-food', 'Family Spread')}
        ${modeBtn('individual', 'fa-user', 'Individual')}
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label for="planHunger" class="${cls.label}">Hunger</label>
          <select id="planHunger" data-change="hunger" class="${select}">
            ${Object.keys(HUNGER).map((h) => `<option value="${h}" ${st.hunger === h ? 'selected' : ''}>${HUNGER_LABEL[h]}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="planTax" class="${cls.label}">Tax %</label>
          <input id="planTax" type="number" inputmode="decimal" min="0" max="30" step="0.5" value="${esc(drafts.planTax ?? st.taxPct)}" data-change="tax" data-input="draft" class="${select}">
        </div>
      </div>
      <div>
        <span class="${cls.label}">Tip</span>
        <div class="flex items-center gap-1.5">
          ${TIP_CHOICES.map(tipBtn).join('')}
          <div class="w-20 shrink-0">
            <input id="planTip" type="number" inputmode="decimal" min="0" max="100" step="any" value="${esc(drafts.planTip ?? (presetTip ? '' : st.tipPct))}" data-change="tipCustom" data-input="draft" placeholder="Other %" aria-label="Your own tip percent" class="${select} ${presetTip ? '' : 'border-terracotta-400'}">
          </div>
        </div>
      </div>
      <div>
        <span class="${cls.label}">Diet (every dish must match)</span>
        <div class="flex flex-wrap gap-1.5">
          ${DIETS.map((d) => {
            const on = st.diet.includes(d);
            return `<button data-click="diet" data-diet="${d}" aria-pressed="${on}" class="px-2.5 py-1.5 rounded-full text-[10px] font-bold capitalize transition-all ${on ? 'bg-sage-500 text-white' : 'bg-gray-100 text-gray-500 hover:text-espresso'}">${on ? '<i class="fa-solid fa-check mr-0.5"></i>' : ''}${dietName(d)}</button>`;
          }).join('')}
        </div>
        ${missing.length ? `
          <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span class="text-[9px] font-bold text-gray-500">Your group:</span>
            ${missing.map(([d, who]) => `<button data-click="diet" data-diet="${d}" aria-label="Add ${dietName(d)} to the filter (${who})" class="px-2 py-1 rounded-full text-[10px] font-bold bg-sage-100 text-sage-800 hover:bg-sage-500 hover:text-white transition-all"><i class="fa-solid fa-plus text-[8px] mr-0.5"></i>${dietName(d)} (${who})</button>`).join('')}
          </div>
          <p class="${cls.sub} mt-1">In Family mode a filter applies to every dish. Individual plates already follow each person's own diet.</p>` : ''}
      </div>
      <button data-click="dessert" aria-pressed="${st.dessert === true}" class="self-start px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-all ${st.dessert === true ? 'bg-sage-500 text-white' : 'bg-gray-100 text-gray-500 hover:text-espresso'}"><i class="fa-solid ${st.dessert === true ? 'fa-check' : 'fa-ice-cream'} mr-0.5"></i> Add dessert</button>
    </div>`;
}

function noMenu() {
  return `
    <div class="${cls.card} items-center text-center py-5">
      <div class="w-10 h-10 rounded-2xl bg-orange-100 text-terracotta-500 flex items-center justify-center"><i class="fa-solid fa-book-open"></i></div>
      <div>
        <h4 class="${cls.title}">No menu yet</h4>
        <p class="text-[10px] text-gray-500 leading-snug mt-1">Take a photo of the menu, or a screenshot of it online. Split reads every dish and price, then plans an order that fits.</p>
      </div>
      <button data-click="scanMenu" class="${cls.btn}"><i class="fa-solid fa-camera"></i> Scan the menu</button>
      <p class="${cls.sub}">Already ordering? Skip ahead to the <button data-click="view" data-view="live" class="underline font-bold text-terracotta-600">Live Tab</button>.</p>
    </div>`;
}

function recommendation(s) {
  const { menu, order, settings, demo, restaurant } = s.plan;
  const t = totals(order, menu, settings);
  const byId = new Map(menu.map((m) => [m.id, m]));
  const best = bestValue(menu, settings.diet);
  const names = Object.fromEntries(people(s).map((m) => [m.id, m.name]));
  // One row per dish; in individual mode the row lists who it's for.
  const rows = [];
  for (const e of order) {
    const it = byId.get(e.itemId);
    if (!it) continue;
    let row = rows.find((r) => r.it === it);
    if (!row) rows.push((row = { it, qty: 0, who: [] }));
    row.qty += e.qty;
    if (e.forMemberId && names[e.forMemberId]) row.who.push(names[e.forMemberId]);
  }
  const over = Math.round((t.total - settings.budget) * 100) / 100;
  const need = round1(settings.headcount * (HUNGER[settings.hunger] ?? 1));
  const empty = !rows.length && plan(s);
  // Individual plates: say who the menu can't feed instead of quietly leaving them out.
  const missed = settings.mode === 'individual' && s.plan.menu.length ? (plan(s).unfed ?? []) : [];
  const missedNote = missed.map((u) => {
    const who = s.members[u.forMemberId]?.name || 'One person';
    const diet = u.diet.length ? ` (${u.diet.map((d) => d.replace(/_/g, ' ')).join(' + ')})` : '';
    return `${esc(who)}${esc(diet)}`;
  });
  const line = (label, value, strong = false) => `<div class="flex justify-between ${strong ? 'items-center pt-1.5 border-t border-orange-200/60 font-display font-extrabold text-xs text-espresso' : 'text-gray-600'}"><span>${esc(label)}</span><span class="${strong ? 'text-terracotta-600 text-sm' : 'font-bold text-espresso'}">${value}</span></div>`;

  return `
    <div class="${cls.card} gap-2.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h4 class="${cls.title} truncate">${esc(restaurant?.name || 'Your menu')}</h4>
          <p class="${cls.sub} flex items-center gap-1.5">Recommended order ${demoBadge(demo)}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${rows.length ? (over > 0
            ? `<span class="${cls.pill} bg-terracotta-100 text-terracotta-700">+${money(over)} over</span>`
            : missed.length ? `<span class="${cls.pill} bg-amberWarm-100 text-amberWarm-800">Someone's left out</span>`
              : `<span class="${cls.pill} bg-sage-100 text-sage-800">✨ Under budget</span>`) : ''}
          <button data-click="replan" aria-label="Plan the order again" class="w-8 h-8 rounded-xl text-gray-400 hover:text-terracotta-500 text-xs"><i class="fa-solid fa-rotate"></i></button>
        </div>
      </div>
      ${empty ? (empty.order.length
        ? `<button data-click="replan" class="${cls.btnGhost}"><i class="fa-solid fa-wand-magic-sparkles"></i> Plan my order</button>`
        : `<div class="p-2.5 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-semibold leading-snug"><i class="fa-solid fa-circle-info"></i> ${esc(empty.reason)}</div>`) : ''}
      ${missedNote.length ? `<div class="p-2.5 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-semibold leading-snug">
        <i class="fa-solid fa-triangle-exclamation"></i> Nothing on this menu fits ${missedNote.join(', ')} within ${money(settings.budget / settings.headcount)} each.
        Try a bigger budget, fewer diet filters, or a different place.</div>` : ''}
      ${rows.length ? `
        <div class="flex flex-col gap-1.5">${rows.map((r) => dishRow(r, best)).join('')}</div>
        <p class="${cls.sub}">Picked for the most food per dollar. Tap <i class="fa-solid fa-shuffle"></i> to swap a dish for a similar one.</p>
        <div class="bg-orange-50/60 p-2.5 rounded-2xl border border-orange-100 flex flex-col gap-1 text-[10px]">
          ${line('Portions', `${t.servings} <span class="font-normal text-gray-400">(need ${need})</span>`)}
          ${line('Subtotal', money(t.subtotal))}
          ${line(`Tax (${settings.taxPct}%)`, money(t.tax))}
          ${line(`Tip (${settings.tipPct}%)`, money(t.tip))}
          ${line('Projected total', money(t.total), true)}
          ${line(`Per person (${settings.headcount})`, money(t.perPerson))}
        </div>
        <button data-click="lock" class="${cls.btn}"><span>Lock plan &amp; start live tab</span><i class="fa-solid fa-arrow-right text-[10px]"></i></button>` : ''}
    </div>`;
}

function dishRow({ it, qty, who }, best) {
  const feeds = round1((Number(it.serves) || 1) * qty);
  return `
    <div class="flex items-center justify-between gap-2 p-2 rounded-2xl bg-gray-50 border border-gray-100">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 shrink-0 rounded-lg bg-orange-100 text-terracotta-600 flex items-center justify-center text-[10px]"><i class="fa-solid ${ICON[it.category] || ICON.other}"></i></div>
        <div class="min-w-0">
          <p class="font-bold text-xs text-espresso truncate">${qty > 1 ? `${qty}× ` : ''}${esc(it.name)}</p>
          <p class="text-[9px] text-gray-400 flex flex-wrap items-center gap-x-1.5">
            <span>${it.category === 'drink' ? 'serves' : 'feeds'} ${feeds}</span>
            ${who.length ? `<span class="truncate">for ${who.map(firstName).join(', ')}</span>` : ''}
            ${best.has(it.id) ? `<span class="${cls.pill} bg-sage-100 text-sage-800"><i class="fa-solid fa-star text-[8px]"></i> Best value</span>` : ''}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <span class="font-display font-bold text-xs text-espresso">${money(it.price * qty)}</span>
        <button data-click="swap" data-id="${esc(it.id)}" aria-label="Swap ${esc(it.name)} for something similar" class="w-8 h-8 rounded-xl text-gray-400 hover:text-terracotta-500 text-xs"><i class="fa-solid fa-shuffle"></i></button>
      </div>
    </div>`;
}

// ---------- Live tab ----------

function liveView(s) {
  const items = Object.values(s.live.items).sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0) || a.id.localeCompare(b.id));
  const crew = people(s);
  const settings = s.plan.settings;
  const lt = liveTotals(items, settings);
  const over = Math.round((lt.total - settings.budget) * 100) / 100;

  return `
    <div class="${cls.card}">
      <div class="flex items-center justify-between border-b border-gray-100 pb-2">
        <div>
          <h3 class="${cls.title}">Live Table Session</h3>
          <p class="${cls.sub}">Tap who is having each dish. Anyone can tap for anyone.</p>
        </div>
        <span class="flex h-2 w-2 relative" aria-hidden="true">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sage-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-sage-500"></span>
        </span>
      </div>
      ${crew.length ? '' : `<p class="p-2 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-semibold">Add your group in the Group tab, then tap who is having what.</p>`}
      <div class="flex flex-col gap-2">
        ${items.length ? items.map((it) => liveRow(it, crew)).join('') : `<p class="text-[10px] text-gray-500 text-center py-2">Nothing on the tab yet. Lock a plan, or add what you order below.</p>`}
      </div>
      <form data-submit="addLive" class="flex gap-1.5 items-end">
        <div class="flex-1 min-w-0">
          <label for="liveName" class="${cls.label}">Add an item</label>
          <input id="liveName" data-input="draft" value="${esc(drafts.liveName ?? '')}" maxlength="60" placeholder="e.g. Extra fries" autocomplete="off" class="${cls.input}">
        </div>
        <div class="w-20 shrink-0">
          <label for="livePrice" class="${cls.label}">Price $</label>
          <input id="livePrice" data-input="draft" value="${esc(drafts.livePrice ?? '')}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" class="${cls.input}">
        </div>
        <button class="shrink-0 h-[34px] px-3 rounded-xl bg-espresso text-white font-bold text-xs flex items-center gap-1"><i class="fa-solid fa-plus text-[10px]"></i> Add</button>
      </form>
      <div class="bg-gray-50 rounded-2xl p-2.5 border border-gray-100 flex flex-col gap-2">
        <span class="text-[9px] font-bold text-gray-400 uppercase">Live running totals <span class="normal-case font-semibold">(with est. tax + tip)</span></span>
        ${crew.length ? `<div class="grid grid-cols-4 gap-1 text-center">${crew.map((m) => `
          <div class="bg-white p-1.5 rounded-xl border border-gray-100 min-w-0">
            <p class="text-[8px] font-bold text-gray-500 truncate">${firstName(m.name)}</p>
            <p class="font-display font-extrabold text-[11px] ${color(m).text}">${money(lt.perMember[m.id] || 0)}</p>
          </div>`).join('')}</div>` : ''}
        ${lt.unclaimed > 0 ? `<p class="text-[9px] font-bold text-amberWarm-600"><i class="fa-solid fa-hand-pointer"></i> ${money(lt.unclaimed)} not claimed yet</p>` : ''}
        <div class="flex justify-between items-center pt-1 border-t border-gray-200 text-xs">
          <span class="font-bold text-gray-600">Table total</span>
          <span class="font-display font-extrabold text-terracotta-600">${money(lt.total)}</span>
        </div>
        <div class="flex justify-between items-center text-[10px]">
          <span class="text-gray-500">Budget ${money(settings.budget)}</span>
          ${over > 0
            ? `<span class="${cls.pill} bg-terracotta-100 text-terracotta-700">+${money(over)} over</span>`
            : `<span class="${cls.pill} bg-sage-100 text-sage-800">${money(-over)} left</span>`}
        </div>
      </div>
      <button data-click="scanReceipt" class="w-full py-2.5 rounded-2xl bg-amberWarm-500 hover:bg-amberWarm-600 text-white font-bold text-xs shadow-xs active:scale-98 transition-all flex items-center justify-center gap-1.5">
        <i class="fa-solid fa-receipt"></i><span>Meal finished: scan receipt to split</span>
      </button>
    </div>`;
}

function liveRow(it, crew) {
  const who = Object.keys(it.claims).filter((id) => crew.some((m) => m.id === id)).length;
  const line = (Number(it.price) || 0) * (it.qty || 1);
  return `
    <div class="p-2 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col gap-1.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="font-bold text-xs text-espresso">${it.qty > 1 ? `${esc(it.qty)}× ` : ''}${esc(it.name)}</p>
          <p class="text-[9px] text-terracotta-600 font-bold">${money(line)}${who > 1 ? ` <span class="text-gray-400 font-semibold">· ${money(line / who)} each</span>` : who ? '' : ' <span class="text-gray-400 font-semibold">· tap who is having it</span>'}</p>
        </div>
        <button data-click="removeLive" data-id="${esc(it.id)}" aria-label="Remove ${esc(it.name)}" class="w-8 h-8 shrink-0 rounded-xl text-gray-300 hover:text-terracotta-500 text-xs"><i class="fa-solid fa-trash-can"></i></button>
      </div>
      ${crew.length ? `<div class="flex flex-wrap gap-1.5">${crew.map((m) => {
        const on = !!it.claims[m.id];
        const c = color(m);
        return `<button data-click="claim" data-id="${esc(it.id)}" data-member="${esc(m.id)}" aria-pressed="${on}" aria-label="${esc(m.name)} is having ${esc(it.name)}"
          class="h-8 px-2.5 max-w-[6rem] truncate rounded-full text-[10px] font-bold transition-all active:scale-95 ${on ? `${c.solid} text-white shadow-xs` : `${c.soft} ${c.text}`}">${on ? '<i class="fa-solid fa-check text-[8px] mr-0.5"></i>' : ''}${firstName(m.name)}</button>`;
      }).join('')}</div>` : ''}
    </div>`;
}
