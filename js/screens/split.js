// Fair Split (Person 1): snap the receipt, everyone taps what they ate, and tax, tip,
// service charges and discounts follow each dish. Then the payer collects by e-Transfer, PayPal or Venmo.
// The maths is in js/lib/fairSplit.js (cents in, cents out); this file only draws it.
import { listMeals, updateMeal } from '../history.js';
import { budgetCheck, computeShares, explainShare, prefillClaims } from '../lib/fairSplit.js';
import { paypalLink, requestAllText, requestText, venmoLink } from '../lib/payLinks.js';
import { go } from '../router.js';
import { onScanned, openScanner } from '../scanner.js';
import { store } from '../store.js';
import { cls, color, delegate, demoBadge, esc, initials, money, patch, sheet, toast, uid } from '../ui.js';

const TIPS = [0, 15, 18, 20];
const $c = (c) => money(c / 100);
const toDollars = (c) => Math.round(c) / 100;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const parseMoney = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const shares = (s) => computeShares(s.receipt, Object.keys(s.members));

// Me first, then in the order people joined.
const people = (s) => Object.values(s.members)
  .sort((a, b) => (b.id === store.me.id) - (a.id === store.me.id) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

const chip = (m) => `<span class="w-6 h-6 shrink-0 rounded-full ${color(m).solid} text-white text-[9px] font-bold flex items-center justify-center" title="${esc(m.name)}">${initials(m.name)}</span>`;
const you = (m) => (m.id === store.me.id ? ' (you)' : '');
const smallBtn = 'px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all flex items-center justify-center gap-1 disabled:opacity-40 disabled:pointer-events-none';
const field = (id, label, value, attrs = '') => `
  <div><label for="${id}" class="${cls.label}">${label}</label>
  <input id="${id}" value="${esc(value)}" class="${cls.input}" ${attrs}></div>`;
const moneyAttrs = 'type="number" inputmode="decimal" step="0.01"';

export function mount(root) {
  onScanned('receipt', async (r) => {
    const s = store.state;
    if (!s) return;
    await store.dispatch({
      type: 'receipt/set',
      receipt: {
        ...r,
        payerId: store.me.id,
        // A service charge is already the tip, so nobody double-tips by default.
        tipPct: r.serviceCharge > 0 ? 0 : s.plan.settings.tipPct,
        claims: prefillClaims(r.items, Object.values(s.live.items)),
      },
    });
    go('split');
  });
  store.subscribe(keepLedgerPaid);

  // Handler names must not clash with app.js's body-level ones (tab, scan, people, settings).
  delegate(root, {
    scanReceipt: () => openScanner('receipt'),
    manual: () => {
      const s = store.state;
      store.dispatch({ type: 'receipt/set', receipt: { restaurant: s.plan.restaurant?.name ?? '', items: [], payerId: store.me.id, tipPct: s.plan.settings.tipPct, claims: {} } });
    },
    mine: (b) => store.dispatch({ type: 'receipt/claim', itemId: b.dataset.id, memberId: store.me.id }),
    splitItem: (b) => splitSheet(b.dataset.id),
    editItem: (b) => itemSheet(b.dataset.id),
    addItem: () => itemSheet(null),
    editBill: () => billSheet(),
    dismissNotes: () => store.dispatch({ type: 'receipt/update', patch: { warnings: [], notes: '' } }),
    tipPct: (b) => store.dispatch({ type: 'receipt/update', patch: { tipPct: Number(b.dataset.pct), tip: 0 } }),
    tipCustom: (input) => {
      const tip = parseMoney(input.value);
      // $0 means no tip at all; an emptied box goes back to the % buttons.
      store.dispatch({ type: 'receipt/update', patch: tip !== null && tip <= 0 ? { tip: 0, tipPct: 0 } : { tip: tip ?? 0 } });
    },
    payer: (b) => store.dispatch({ type: 'receipt/update', patch: { payerId: b.dataset.id } }),
    request: (b) => requestPay(b.dataset.id),
    requestAll: () => requestAll(),
    markPaid: (b) => store.dispatch({ type: 'receipt/markPaid', memberId: b.dataset.id, paid: b.dataset.paid === '1' }),
    copy: (b) => copy(b.dataset.text, b.dataset.done),
    finish: () => finish(),
    newMeal: () => {
      if (!confirm('Start a new meal with the same group? This clears the receipt for everyone. It stays in your ledger.')) return;
      store.dispatch({ type: 'session/newMeal' });
    },
  });
}

export function render(root, s) {
  const r = s.receipt;
  if (!r) return patch(root, emptyView(s));
  const split = shares(s);
  const cards = r.finalizedAt
    ? [finishedCard(s, split), paymentsCard(s, split), peopleCard(s, split), budgetCard(s)]
    : [receiptCard(s, split), tipCard(s, split), peopleCard(s, split), budgetCard(s), paymentsCard(s, split), finishBar(s, split)];
  patch(root, cards.join(''));
}

function emptyView(s) {
  const live = Object.keys(s.live.items).length;
  return `
    <div class="bg-gradient-to-br from-terracotta-500 via-terracotta-600 to-amberWarm-600 rounded-3xl p-3.5 text-white shadow-lg flex flex-col gap-2 relative overflow-hidden">
      <span class="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[9px] font-bold uppercase tracking-wider text-orange-100">
        <i class="fa-solid fa-scale-balanced"></i> Fair Split
      </span>
      <h2 class="font-display font-bold text-base">Snap the receipt</h2>
      <p class="text-[10px] text-orange-100/90 leading-relaxed">Everyone taps what they ate. Tax and tip follow each dish, so nobody pays tax on someone else's steak.</p>
      ${live ? `<p class="text-[10px] text-orange-100/90"><i class="fa-solid fa-wand-magic-sparkles"></i> ${plural(live, 'item')} from the live tab will fill in who had what.</p>` : ''}
      <button data-click="scanReceipt" class="w-full py-2.5 bg-white text-terracotta-600 font-bold rounded-2xl shadow-sm text-xs flex items-center justify-center gap-1.5 hover:bg-orange-50 active:scale-98 transition-all">
        <i class="fa-solid fa-camera text-terracotta-500 text-xs"></i><span>Scan the receipt</span>
      </button>
      <button data-click="manual" class="text-[10px] text-white/80 font-bold py-1">Or type the bill in by hand</button>
    </div>`;
}

function receiptCard(s, split) {
  const r = s.receipt;
  const amIn = !!s.members[store.me.id];
  const open = split.unclaimed.filter((u) => u.itemId).length;
  return `
    <div class="${cls.card}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap"><h3 class="${cls.title}">${esc(r.restaurant || 'Your receipt')}</h3>${demoBadge(r.demo)}</div>
          <p class="${cls.sub}">${plural(r.items.length, 'item')} • Tax & tip split by what you ate</p>
        </div>
        <div class="flex gap-1 shrink-0">
          <button data-click="editBill" class="text-[9px] bg-gray-100 text-espresso font-bold px-2.5 py-1.5 rounded-xl">Fix totals</button>
          <button data-click="scanReceipt" class="text-[9px] bg-orange-100 text-terracotta-600 font-bold px-2.5 py-1.5 rounded-xl">Re-scan</button>
        </div>
      </div>
      ${notesBox(r)}
      <div class="flex flex-col gap-1.5">
        ${r.items.map((it) => itemRow(s, it, amIn)).join('') || '<p class="text-[10px] text-gray-400 text-center py-2">No items yet. Add what was on the bill.</p>'}
      </div>
      <button data-click="addItem" class="${cls.btnGhost}"><i class="fa-solid fa-plus"></i> Add an item</button>
      ${open ? `<div class="p-2.5 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-bold flex items-center gap-2" role="status">
          <i class="fa-solid fa-hand-pointer"></i> ${plural(open, 'item')} still unclaimed. Tap Mine or Split on each one.</div>`
        : r.items.length ? `<div class="p-2.5 rounded-2xl bg-sage-50 text-sage-800 text-[10px] font-bold flex items-center gap-2"><i class="fa-solid fa-circle-check text-sage-500"></i> Every item has an owner.</div>` : ''}
    </div>`;
}

function notesBox(r) {
  const notes = [...r.warnings, r.notes].filter(Boolean);
  if (!notes.length) return '';
  return `
    <div class="p-2.5 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] leading-snug flex gap-2">
      <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
      <div class="flex-1 flex flex-col gap-0.5">
        <p class="font-bold">Check the scan</p>
        ${notes.map((n) => `<p>${esc(n)}</p>`).join('')}
        <p>Tap an item to fix it, or Fix totals for tax and fees.</p>
      </div>
      <button data-click="dismissNotes" class="self-start p-1 text-amberWarm-800" aria-label="Dismiss these notes"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function itemRow(s, it, amIn) {
  const claims = s.receipt.claims[it.id] ?? {};
  const who = people(s).filter((m) => claims[m.id]);
  const mine = !!claims[store.me.id];
  const needsOwner = !who.length && it.price !== 0;
  return `
    <div class="p-2 rounded-2xl border ${needsOwner ? 'bg-amberWarm-100/40 border-amberWarm-100' : 'bg-gray-50 border-gray-100'} flex flex-col gap-1.5 text-xs">
      <div class="flex items-start justify-between gap-2">
        <button data-click="editItem" data-id="${esc(it.id)}" class="text-left min-w-0 flex items-start gap-1.5" aria-label="Edit ${esc(it.name)}">
          <span class="font-bold text-espresso break-words">${esc(it.name)}${it.qty > 1 ? ` <span class="text-gray-400 font-semibold">×${esc(it.qty)}</span>` : ''}</span>
          <i class="fa-solid fa-pen text-[8px] text-gray-300 mt-1"></i>
        </button>
        <span class="font-display font-bold shrink-0 ${it.price < 0 ? 'text-sage-600' : 'text-espresso'}">${money(it.price)}</span>
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1 min-w-0 flex-wrap">
          ${who.length ? who.map(chip).join('') : `<span class="text-[9px] font-bold ${needsOwner ? 'text-amberWarm-600' : 'text-gray-400'}">${needsOwner ? 'Nobody yet' : 'Free'}</span>`}
          ${who.length > 1 ? `<span class="text-[9px] text-gray-400 font-semibold ml-0.5">${money(it.price / who.length)} each</span>` : ''}
        </div>
        <div class="flex gap-1 shrink-0">
          ${amIn ? `<button data-click="mine" data-id="${esc(it.id)}" aria-pressed="${mine}" class="${smallBtn} ${mine ? 'bg-terracotta-500 text-white' : 'bg-white border border-gray-200 text-espresso'}">
            ${mine ? '<i class="fa-solid fa-check"></i> ' : ''}Mine</button>` : ''}
          <button data-click="splitItem" data-id="${esc(it.id)}" class="${smallBtn} bg-white border border-gray-200 text-espresso" aria-label="Split ${esc(it.name)} between people">
            <i class="fa-solid fa-user-group"></i> Split</button>
        </div>
      </div>
    </div>`;
}

function tipCard(s, split) {
  const r = s.receipt;
  const custom = r.tip > 0;
  const tipBtn = (p) => {
    const on = !custom && r.tipPct === p;
    return `<button data-click="tipPct" data-pct="${p}" aria-pressed="${on}" class="py-2 rounded-xl text-[10px] font-bold ${on ? 'bg-terracotta-500 text-white' : 'bg-gray-100 text-espresso'}">${p}%</button>`;
  };
  const payerBtn = (m) => {
    const on = r.payerId === m.id;
    return `<button data-click="payer" data-id="${esc(m.id)}" aria-pressed="${on}" class="flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border text-[10px] font-bold ${on ? 'border-terracotta-400 bg-terracotta-50 text-terracotta-700' : 'border-gray-200 bg-white text-espresso'}">
      ${chip(m)} ${esc(m.name)}${you(m)}</button>`;
  };
  return `
    <div class="${cls.card}">
      <div class="flex items-center justify-between">
        <h3 class="${cls.title}">Tip${custom ? '' : ` (${esc(r.tipPct)}%)`}</h3>
        <span class="font-display font-bold text-xs text-espresso">${$c(split.totals.tip)}</span>
      </div>
      ${r.serviceCharge > 0 ? `<p class="p-2 rounded-2xl bg-sky-50 text-sky-800 text-[10px] font-semibold leading-snug"><i class="fa-solid fa-circle-info"></i>
        Service charge (${money(r.serviceCharge)}) already on the bill, so no extra tip by default.</p>` : ''}
      <div class="grid grid-cols-4 gap-1.5">${TIPS.map(tipBtn).join('')}</div>
      <div class="flex items-center gap-2">
        <label for="tipCustom" class="text-[10px] font-semibold text-gray-500 shrink-0">Or an amount ($)</label>
        <input id="tipCustom" data-change="tipCustom" ${moneyAttrs} min="0" value="${custom ? esc(r.tip) : ''}" placeholder="0.00" class="${cls.input} ${custom ? 'border-terracotta-400 bg-terracotta-50' : ''}">
      </div>
      <p class="${cls.sub}">Tip is on the food before tax and discounts, and everyone tips on what they had.</p>
      <div class="border-t border-gray-100 pt-2.5 flex flex-col gap-1.5">
        <h3 class="${cls.title}">Who paid the bill?</h3>
        <div class="flex flex-wrap gap-1.5">${people(s).map(payerBtn).join('')}</div>
      </div>
    </div>`;
}

function personBox(s, m, p, totals) {
  const mine = m.id === store.me.id;
  const lines = [['Food', p.food], ['Discount', p.discount], ['Tax', p.tax], ['Service', p.service], ['Tip', p.tip]].filter(([, v]) => v);
  const how = explainShare(p, totals, mine ? null : m.name);
  return `
    <div class="p-2.5 rounded-2xl border flex flex-col gap-1 ${mine ? 'border-terracotta-300 bg-terracotta-50/60' : 'border-gray-100 bg-gray-50'}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          ${chip(m)}<span class="font-bold text-xs text-espresso truncate">${esc(m.name)}</span>
          ${mine ? `<span class="${cls.pill} bg-terracotta-500 text-white">Your share</span>` : ''}
          ${s.receipt.payerId === m.id ? `<span class="${cls.pill} bg-espresso text-white">Paid the bill</span>` : ''}
        </div>
        <span class="font-display font-extrabold text-sm text-espresso">${$c(p.total)}</span>
      </div>
      ${p.items.length ? p.items.map((i) => `
        <div class="flex justify-between gap-2 text-[10px] text-gray-500">
          <span class="truncate">${esc(i.name)}${i.split > 1 ? ` <span class="text-gray-400">(1/${i.split})</span>` : ''}</span><span class="shrink-0">${$c(i.amount)}</span>
        </div>`).join('') : `<p class="text-[10px] text-gray-400">Hasn't claimed anything yet</p>`}
      ${lines.length ? `<p class="text-[9px] text-gray-400 pt-0.5">${lines.map(([k, v]) => `${k} ${$c(v)}`).join(' • ')}</p>` : ''}
      ${how ? `<p class="text-[9px] text-gray-500 leading-snug"><i class="fa-solid fa-circle-info text-gray-300"></i> ${esc(how)}</p>` : ''}
    </div>`;
}

function peopleCard(s, split) {
  const left = split.unclaimed.reduce((a, u) => a + u.amount, 0);
  return `
    <div class="${cls.card}">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h3 class="${cls.title}">Who owes what</h3>
          <p class="${cls.sub}">Each dish carries its own share of tax and tip</p>
        </div>
        <span class="text-[10px] font-bold text-gray-500 shrink-0">Bill ${$c(split.totals.total)}</span>
      </div>
      ${people(s).map((m) => personBox(s, m, split.people[m.id], split.totals)).join('')}
      ${left ? `<div class="${cls.row}"><span class="font-bold text-amberWarm-600">Not claimed yet</span><span class="font-display font-bold text-amberWarm-600">${$c(left)}</span></div>` : ''}
    </div>`;
}

function budgetCard(s) {
  const b = budgetCheck(s.receipt, s.plan);
  if (b.planned == null) return '';
  const pushes = [...b.unplanned.map((u) => [`${u.name} (not in the plan)`, u.amount]), ['Tax', b.tax], ['Service charge', b.service], ['Tip', b.tip]].filter(([, v]) => v);
  return `
    <div class="${cls.card}">
      <div class="bg-gray-50 p-2.5 rounded-2xl border border-gray-100 flex flex-col gap-1.5">
        <span class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Budget vs reality</span>
        <div class="flex justify-between text-xs"><span class="text-gray-500">Planned budget</span><span class="font-bold text-espresso">${$c(b.planned)}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-500">Actual total</span><span class="font-bold text-terracotta-600">${$c(b.actual)}</span></div>
        <div class="flex justify-between gap-2 text-xs font-bold pt-1 border-t border-gray-200 ${b.over ? 'text-terracotta-600' : 'text-sage-600'}">
          <span>Difference</span>
          <span>${b.over ? `Went ${$c(b.diff)} over budget` : b.diff === 0 ? 'Right on budget' : `Came in ${$c(-b.diff)} under budget!`}</span>
        </div>
        ${b.over && pushes.length ? `
          <span class="text-[9px] font-bold text-gray-400 uppercase tracking-wider pt-1">What pushed it over</span>
          ${pushes.map(([k, v]) => `<div class="flex justify-between gap-2 text-[10px] text-gray-500"><span class="truncate">${esc(k)}</span><span class="shrink-0">${$c(v)}</span></div>`).join('')}` : ''}
      </div>
    </div>`;
}

function paymentsCard(s, split) {
  const payer = s.members[s.receipt.payerId];
  if (!payer) {
    return `<div class="${cls.card}"><h3 class="${cls.title}">Payments</h3><p class="${cls.sub}">Pick who paid the bill to see who pays them back.</p></div>`;
  }
  return payer.id === store.me.id ? collectCard(s, split, payer) : oweCard(s, split, payer);
}

// Amounts can still change until every item is claimed, so paying up waits for that.
const settled = (s, split) => split.allClaimed || !!s.receipt.finalizedAt;
const waitNote = `<p class="text-[10px] text-gray-500 leading-snug">Once every item is claimed, you can request payments and mark who's paid.</p>`;

const hasWay = (pay) => !!(pay?.email || pay?.paypal || pay?.venmo);
const payNote = (r) => `${r.restaurant || 'Dinner'} (Split)`;
// The payer's ways to get paid, for a request message. amount null leaves it out of the links.
const payWays = (pay, r, amount) => ({
  email: pay?.email, paypalUrl: paypalLink(pay?.paypal, amount, r.currency), venmoUrl: venmoLink(pay?.venmo, amount, payNote(r)),
});

// People who still owe the payer, with what they owe (cents).
const stillOwing = (s, split) => people(s)
  .filter((m) => m.id !== s.receipt.payerId && split.people[m.id].total > 0 && !s.receipt.paid[m.id]);

function collectCard(s, split, payer) {
  const owing = people(s).filter((m) => m.id !== payer.id && split.people[m.id].total > 0);
  // A coupon bigger than what someone had leaves them a negative share: the payer owes them that back.
  const owedBack = people(s).filter((m) => m.id !== payer.id && split.people[m.id].total < 0);
  const left = stillOwing(s, split);
  const due = left.reduce((a, m) => a + split.people[m.id].total, 0);
  const backRow = (m) => `
    <div class="${cls.row}">
      <div class="flex items-center gap-1.5 min-w-0">${chip(m)}
        <p class="font-bold text-espresso break-words min-w-0">${s.receipt.paid[m.id] ? `You paid ${esc(m.name)} back` : `You owe ${esc(m.name)} ${$c(-split.people[m.id].total)} back`}</p>
      </div>
    </div>`;
  const row = (m) => {
    const paid = !!s.receipt.paid[m.id];
    return `
      <div class="p-2 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col gap-1.5 text-xs">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">${chip(m)}
            <div class="min-w-0"><p class="font-bold text-espresso truncate">${esc(m.name)}</p>
            <p class="text-[9px] font-semibold ${paid ? 'text-sage-600' : 'text-gray-400'}">${paid ? 'Paid you back' : 'Not paid yet'}</p></div>
          </div>
          <span class="font-display font-bold ${paid ? 'text-sage-600' : 'text-terracotta-600'}">${$c(split.people[m.id].total)}</span>
        </div>
        ${ready ? `<div class="grid grid-cols-2 gap-1.5">
          <button data-click="request" data-id="${esc(m.id)}" class="${smallBtn} bg-espresso text-white" ${paid ? 'disabled' : ''}><i class="fa-solid fa-paper-plane"></i> Request</button>
          <button data-click="markPaid" data-id="${esc(m.id)}" data-paid="${paid ? '' : '1'}" aria-pressed="${paid}" class="${smallBtn} ${paid ? 'bg-sage-100 text-sage-800' : 'bg-white border border-gray-200 text-espresso'}">
            ${paid ? '<i class="fa-solid fa-check"></i> Paid (undo)' : 'Mark paid'}</button>
        </div>` : ''}
      </div>`;
  };
  const ready = settled(s, split);
  return `
    <div class="${cls.card}">
      <div class="flex items-start justify-between gap-2">
        <div>
          <span class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Collect from your group</span>
          <p class="text-xs text-espresso font-bold">${due ? `You're owed ${$c(due)}` : owing.length ? 'Everyone has paid you back' : 'Nobody owes you anything yet'}</p>
        </div>
        ${ready && left.length > 1 ? `<button data-click="requestAll" class="${smallBtn} bg-espresso text-white shrink-0"><i class="fa-solid fa-paper-plane"></i> Request all</button>` : ''}
      </div>
      ${ready ? '' : waitNote}
      ${hasWay(payer.pay) ? '' : `<p class="p-2 rounded-2xl bg-amberWarm-100 text-amberWarm-800 text-[10px] font-semibold leading-snug">
        Add your e-Transfer email, PayPal or Venmo in <button data-click="settings" class="underline font-bold">Settings</button> so friends can pay you back in one tap.</p>`}
      ${owing.map(row).join('')}
      ${owedBack.map(backRow).join('')}
    </div>`;
}

function oweCard(s, split, payer) {
  const me = s.members[store.me.id];
  if (!me) return '';
  const owe = split.people[me.id].total;
  const paid = !!s.receipt.paid[me.id];
  if (owe < 0) {
    return `<div class="${cls.card}"><h3 class="${cls.title}">Payments</h3>
      <p class="text-xs font-bold text-sage-600">${paid ? `${esc(payer.name)} paid you back` : `${esc(payer.name)} owes you ${$c(-owe)}`}</p>
      <p class="${cls.sub}">Your discounts came to more than what you had.</p></div>`;
  }
  if (owe === 0) {
    return `<div class="${cls.card}"><h3 class="${cls.title}">Payments</h3><p class="${cls.sub}">${s.receipt.finalizedAt ? "You don't owe anything for this one." : `Claim what you had to see what you owe ${esc(payer.name)}.`}</p></div>`;
  }
  const pay = payer.pay ?? {};
  const link = (href, icon, label) => `<a href="${esc(href)}" target="_blank" rel="noopener" class="py-2 rounded-xl bg-white text-terracotta-600 font-bold text-xs shadow-xs active:scale-98 transition-all flex items-center justify-center gap-1.5"><i class="${icon}"></i> ${label}</a>`;
  const ways = [
    pay.paypal ? link(paypalLink(pay.paypal, owe, s.receipt.currency), 'fa-brands fa-paypal', 'PayPal') : '',
    pay.venmo ? link(venmoLink(pay.venmo, owe, payNote(s.receipt)), 'fa-solid fa-mobile-screen-button', 'Venmo <span class="text-[9px] font-semibold text-gray-400">(US only)</span>') : '',
  ].filter(Boolean);
  return `
    <div class="p-3.5 rounded-3xl bg-gradient-to-r from-terracotta-500 to-amberWarm-600 text-white shadow-sm flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-bold text-xs flex items-center gap-1.5"><i class="fa-solid fa-hand-holding-dollar text-amber-200"></i> Pay ${esc(payer.name)} back</span>
        <span class="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-bold">${paid ? 'Paid' : 'Your share'}</span>
      </div>
      <p class="font-display font-extrabold text-xl leading-tight">${paid ? `You've paid ${esc(payer.name)} back` : `You owe ${esc(payer.name)} ${$c(owe)}`}</p>
      ${paid ? `<button data-click="markPaid" data-id="${esc(me.id)}" data-paid="" class="${smallBtn} bg-white/20 text-white"><i class="fa-solid fa-rotate-left"></i> Not yet? Undo</button>` : !settled(s, split)
        ? `<p class="text-[10px] text-orange-100 leading-snug">This can still change until every item is claimed.</p>` : `
        ${ways.length ? `<div class="grid ${ways.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5">${ways.join('')}</div>` : ''}
        ${pay.email ? `
          <div class="p-2 rounded-2xl bg-black/15 flex flex-col gap-1.5">
            <p class="text-[10px] text-orange-100 leading-snug"><i class="fa-solid fa-building-columns"></i> Interac e-Transfer to <b class="break-all">${esc(pay.email)}</b> from your bank app</p>
            <div class="grid grid-cols-2 gap-1.5">
              <button data-click="copy" data-text="${esc(pay.email)}" data-done="Email copied" class="${smallBtn} bg-white/20 text-white"><i class="fa-regular fa-copy"></i> Copy email</button>
              <button data-click="copy" data-text="${toDollars(owe).toFixed(2)}" data-done="Amount copied" class="${smallBtn} bg-white/20 text-white"><i class="fa-regular fa-copy"></i> Copy ${$c(owe)}</button>
            </div>
          </div>` : ''}
        ${hasWay(pay) ? '' : `<p class="text-[10px] text-orange-100 leading-snug">${payer.guest
          ? `Pay ${esc(payer.name)} back in cash or with your bank app.`
          : `${esc(payer.name)} hasn't added a way to get paid yet. Ask them to add one in Settings.`}</p>`}
        <button data-click="markPaid" data-id="${esc(me.id)}" data-paid="1" class="${smallBtn} bg-white/20 text-white"><i class="fa-solid fa-check"></i> I've paid ${esc(payer.name)}</button>`}
    </div>`;
}

function finishBar(s, split) {
  const r = s.receipt;
  const open = split.unclaimed.length;
  const why = !r.items.length ? 'Add the items on the bill first.'
    : open ? `Claim the last ${plural(open, 'item')} to finish.`
      : !s.members[r.payerId] ? 'Pick who paid the bill to finish.' : '';
  return `
    <div class="flex flex-col gap-1">
      <button data-click="finish" ${why ? 'disabled' : ''} class="${cls.btnDark} disabled:opacity-50"><i class="fa-solid fa-flag-checkered"></i> Finish & save to ledger</button>
      <p class="text-[9px] text-gray-400 text-center">${why || "Saves everyone's share to the ledger. You can still mark payments after."}</p>
    </div>`;
}

function finishedCard(s, split) {
  const sum = s.receipt.summary ?? {};
  const mine = split.people[store.me.id]?.total;
  return `
    <div class="bg-gradient-to-br from-espresso via-terracotta-900 to-amberWarm-600 rounded-3xl p-3.5 text-white shadow-md flex flex-col gap-2">
      <span class="text-[9px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Meal saved to the ledger</span>
      <h2 class="font-display font-extrabold text-base leading-snug">${esc(sum.restaurant || 'Your meal')}: ${money(sum.total ?? toDollars(split.totals.total))}</h2>
      <p class="text-[10px] text-orange-100/90 leading-relaxed">${mine ? `Your share was ${$c(mine)}. ` : ''}Settle up below, then start the next meal.</p>
      <button data-click="newMeal" class="w-full py-2.5 bg-white text-terracotta-600 font-bold rounded-2xl shadow-sm text-xs flex items-center justify-center gap-1.5 active:scale-98 transition-all">
        <i class="fa-solid fa-rotate"></i> New meal</button>
    </div>`;
}

// --- Sheets ---

// Stays open while people tap, and redraws when another phone changes the same item.
function splitSheet(itemId) {
  let unsub = () => {};
  const { el, close } = sheet({ title: 'Who had this?', subtitle: 'Tap everyone who shared it', icon: 'fa-user-group', body: '', onClose: () => unsub() });
  const draw = (s) => {
    const it = s?.receipt?.items.find((x) => x.id === itemId);
    if (!it || s.receipt.finalizedAt) return close();
    const claims = s.receipt.claims[itemId] ?? {};
    const n = people(s).filter((m) => claims[m.id]).length;
    el.innerHTML = `
      <div class="${cls.row}"><span class="font-bold text-espresso">${esc(it.name)}</span>
        <span class="font-display font-bold text-espresso">${money(it.price)}${n > 1 ? ` <span class="text-[9px] text-gray-400">${money(it.price / n)} each</span>` : ''}</span></div>
      <div class="flex flex-col gap-1.5">${people(s).map((m) => `
        <button data-click="toggle" data-id="${esc(m.id)}" aria-pressed="${!!claims[m.id]}" class="flex items-center justify-between p-2.5 rounded-2xl border text-xs font-bold text-espresso ${claims[m.id] ? 'border-terracotta-300 bg-terracotta-50' : 'border-gray-100 bg-gray-50'}">
          <span class="flex items-center gap-2">${chip(m)} ${esc(m.name)}${you(m)}</span>
          <i class="fa-solid ${claims[m.id] ? 'fa-circle-check text-terracotta-500' : 'fa-circle text-gray-200'}"></i>
        </button>`).join('')}</div>
      <div class="grid grid-cols-2 gap-2">
        <button data-click="all" class="${cls.btnGhost}"><i class="fa-solid fa-users"></i> Everyone</button>
        <button data-click="none" class="${cls.btnGhost}"><i class="fa-solid fa-eraser"></i> Clear</button>
      </div>
      <button data-click="done" class="${cls.btn}">Done</button>`;
  };
  unsub = store.subscribe(draw);
  draw(store.state);
  delegate(el, {
    toggle: (b) => store.dispatch({ type: 'receipt/claim', itemId, memberId: b.dataset.id }),
    all: () => store.dispatch({ type: 'receipt/setClaims', itemId, memberIds: Object.keys(store.state.members) }),
    none: () => store.dispatch({ type: 'receipt/setClaims', itemId, memberIds: [] }),
    done: close,
  });
}

function itemSheet(itemId) {
  const it = itemId ? store.state.receipt?.items.find((x) => x.id === itemId) : null;
  if (itemId && !it) return;
  const { el, close } = sheet({
    title: it ? 'Fix this item' : 'Add an item',
    subtitle: it ? 'Change what the scan got wrong' : 'Something the scan missed',
    icon: it ? 'fa-pen' : 'fa-plus',
    body: `
      <form data-submit="save" class="flex flex-col gap-2.5">
        ${field('itemName', 'Name', it?.name ?? '', 'required maxlength="60" placeholder="e.g. Garlic Bread"')}
        ${field('itemPrice', 'Price for the whole line ($)', it?.price ?? '', `required ${moneyAttrs} placeholder="0.00"`)}
        <p class="${cls.sub}">Use a minus sign for a discount line. Put 0 for something that was free.</p>
        <button class="${cls.btn}"><i class="fa-solid fa-check"></i> ${it ? 'Save' : 'Add item'}</button>
        ${it ? `<button type="button" data-click="remove" class="${cls.btnGhost} text-terracotta-600"><i class="fa-solid fa-trash"></i> Remove this item</button>` : ''}
      </form>`,
  });
  delegate(el, {
    save: () => {
      const name = el.querySelector('#itemName').value.trim();
      const price = parseMoney(el.querySelector('#itemPrice').value);
      if (!name || price == null) return toast('Check the item', 'It needs a name and a price.', 'warn');
      store.dispatch(it
        ? { type: 'receipt/editItem', itemId, patch: { name, price } }
        : { type: 'receipt/addItem', item: { id: uid(), name, qty: 1, price } });
      close();
    },
    remove: () => {
      store.dispatch({ type: 'receipt/removeItem', itemId });
      close();
    },
  });
  if (!it) el.querySelector('#itemName').focus();
}

function billSheet() {
  const r = store.state.receipt;
  if (!r) return;
  const { el, close } = sheet({
    title: 'Fix the totals',
    subtitle: 'Tax, fees and discounts from the bill',
    icon: 'fa-receipt',
    body: `
      <form data-submit="save" class="flex flex-col gap-2.5">
        ${field('billName', 'Restaurant', r.restaurant, 'maxlength="60"')}
        <div class="grid grid-cols-3 gap-2">
          ${field('billTax', 'Tax ($)', r.tax, `${moneyAttrs} min="0"`)}
          ${field('billService', 'Service ($)', r.serviceCharge, `${moneyAttrs} min="0"`)}
          ${field('billDiscount', 'Discount ($)', r.discount, `${moneyAttrs} min="0"`)}
        </div>
        <p class="${cls.sub}">Service is an automatic gratuity printed on the bill. Discount is a coupon or promo off the whole bill.</p>
        <button class="${cls.btn}"><i class="fa-solid fa-check"></i> Save</button>
      </form>`,
  });
  delegate(el, {
    save: () => {
      const val = (id) => Math.max(0, parseMoney(el.querySelector(id).value) ?? 0);
      const serviceCharge = val('#billService');
      // A new service charge is already the tip, so nobody double-tips (same as a scan).
      const noTip = serviceCharge > 0 && !(store.state.receipt?.serviceCharge > 0) ? { tipPct: 0, tip: 0 } : {};
      store.dispatch({ type: 'receipt/update', patch: {
        restaurant: el.querySelector('#billName').value.trim(),
        tax: val('#billTax'), serviceCharge, discount: val('#billDiscount'), ...noTip,
      } });
      close();
    },
  });
}

// --- Money actions ---

async function copy(text, done, msg = text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done || 'Copied', msg);
  } catch {
    toast("Couldn't copy", text, 'info');
  }
}

// Share sheet on phones; copies the message where there isn't one (most laptops).
async function share(text, toWhom) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copy(text, 'Request copied', `Paste it to ${toWhom} in a text or chat.`);
}

function requestPay(id) {
  const s = store.state;
  const m = s?.members[id];
  if (!m || !s.receipt) return;
  const p = shares(s).people[id];
  if (p.total <= 0) return;
  const payer = s.members[s.receipt.payerId];
  share(requestText({
    fromName: payer?.name || store.me.name, toName: m.name, amount: p.total,
    restaurant: s.receipt.restaurant, items: p.items.map((i) => i.name), ...payWays(payer?.pay, s.receipt, p.total),
  }), m.name);
}

// One message to the group chat: everyone who still owes, and how to pay.
function requestAll() {
  const s = store.state;
  const payer = s?.members[s.receipt?.payerId];
  if (!payer) return;
  const split = shares(s);
  const owing = stillOwing(s, split).map((m) => ({ name: m.name, amount: split.people[m.id].total }));
  if (!owing.length) return;
  share(requestAllText({ fromName: payer.name, restaurant: s.receipt.restaurant, owing, ...payWays(payer.pay, s.receipt, null) }), 'your group');
}

function finish() {
  const s = store.state;
  const r = s?.receipt;
  if (!r) return;
  const split = shares(s);
  const payer = s.members[r.payerId];
  if (!split.allClaimed || !payer || !r.items.length) return;
  if (!confirm("Finish the split? Everyone's share is saved to the ledger and the items lock.")) return;
  const members = {};
  for (const m of Object.values(s.members)) {
    const share = split.people[m.id].total;
    if (!share && m.id !== payer.id) continue;
    members[m.id] = {
      name: m.name, share: toDollars(share), paid: m.id === payer.id || !!r.paid[m.id],
      pay: { email: m.pay?.email ?? '', paypal: m.pay?.paypal ?? '', venmo: m.pay?.venmo ?? '' },
    };
  }
  const planned = budgetCheck(r, s.plan).planned;
  store.dispatch({
    type: 'receipt/finalize',
    summary: {
      id: `${s.id}-${r.scannedAt}`, at: Date.now(),
      restaurant: r.restaurant || s.plan.restaurant?.name || '', cuisine: s.plan.restaurant?.cuisine || '', area: s.area || '',
      currency: r.currency || 'CAD', total: toDollars(split.totals.total), planned: planned == null ? null : toDollars(planned),
      payerId: payer.id, payerName: payer.name, members,
    },
  });
}

// Most people pay back after "Finish", so this phone's saved meal follows the receipt's paid marks.
// Only marks that changed since the last sync are copied (meal.syncedPaid), so a change made in the
// Ledger while another group is open, or for someone who has left the group, isn't undone.
// The Ledger sends its changes for this meal through receipt/markPaid, so the two agree.
function keepLedgerPaid(s) {
  const r = s?.receipt;
  const meal = r?.finalizedAt && r.summary?.id && listMeals().find((m) => m.id === r.summary.id);
  if (!meal) return;
  const last = meal.syncedPaid;
  const members = { ...meal.members };
  let changed = false;
  for (const [mid, m] of Object.entries(members)) {
    const now = !!r.paid[mid];
    if (mid === meal.payerId || !s.members[mid] || (last && !!last[mid] === now) || !!m.paid === now) continue;
    members[mid] = { ...m, paid: now };
    changed = true;
  }
  if (changed || JSON.stringify(last) !== JSON.stringify(r.paid)) updateMeal(meal.id, { members, syncedPaid: { ...r.paid } });
}
