// Full-screen Settings: your profile, food preferences, how friends pay you back, theme, AI status,
// install help, data and about (the group and friends are on the Group tab and its gear). It sits at
// z-40 over the app, so the usual z-50 bottom sheets open on top of it for edits.
import { demoMode } from '../ai/client.js';
import { deleteMeals, listMeals } from '../history.js';
import { dietLabel } from '../lib/rankPlaces.js';
import { DIETS } from '../reducer.js';
import { store } from '../store.js';
import { getTheme, setTheme, THEMES } from '../theme.js';
import { $, cls, color, delegate, esc, initials, patch, sheet, toast } from '../ui.js';

// Same list as js/screens/group.js.
const CUISINES = ['Any', 'Italian', 'Mexican', 'Japanese', 'Chinese', 'Korean', 'Thai', 'Vietnamese', 'Indian',
  'Middle Eastern', 'Mediterranean', 'Greek', 'American', 'French'];
const PREFS = { budget: 30, cuisine: 'Any', distanceKm: 5, diet: [] };
const THEME_LOOK = { system: ['System', 'fa-circle-half-stroke'], light: ['Light', 'fa-sun'], dark: ['Dark', 'fa-moon'] };

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let body = null; // the open page's scrolling body, null when closed
let last = '';

// Re-render only when the page would change, so sync updates for other tabs don't replace buttons mid-tap.
function draw() {
  if (!body) return;
  const next = page();
  if (next !== last) patch(body, (last = next));
}

// ---- Building blocks (label, sub and value are HTML: esc() anything a person typed) ----

const section = (title, rows) => `
  <section class="flex flex-col gap-1.5">
    <h3 class="px-3 text-[9px] font-bold uppercase tracking-wider text-gray-400">${title}</h3>
    <div class="bg-white rounded-3xl border border-orange-100 shadow-sm overflow-hidden divide-y divide-gray-100">${rows.join('')}</div>
  </section>`;

const chip = (icon, tint) => `<span class="w-8 h-8 shrink-0 rounded-xl ${tint} flex items-center justify-center text-xs"><i class="${icon.startsWith('fa-brands') ? icon : `fa-solid ${icon}`}"></i></span>`;
const chevron = '<i class="fa-solid fa-chevron-right text-[10px] text-gray-300 shrink-0"></i>';

// A row with `click` is a button with a chevron; without, it just shows something.
function row({ icon, tint = 'bg-terracotta-100 text-terracotta-600', label, sub = '', value = '', click = '', attrs = '' }) {
  const inner = `${chip(icon, tint)}
    <span class="flex-1 min-w-0">
      <span class="block text-xs font-bold text-espresso">${label}</span>
      ${sub ? `<span class="block text-[10px] text-gray-500 leading-snug">${sub}</span>` : ''}
    </span>
    ${value ? `<span class="text-[10px] font-semibold text-gray-500 truncate max-w-[45%]">${value}</span>` : ''}`;
  const look = 'w-full min-h-[3.25rem] flex items-center gap-3 px-3.5 py-2.5 text-left';
  return click
    ? `<button type="button" data-click="${click}" ${attrs} class="${look} hover:bg-orange-50/60 active:bg-orange-50 transition-colors">${inner}${chevron}</button>`
    : `<div class="${look}">${inner}</div>`;
}

// People paste "paypal.me/name", the whole link or "@name"; PayPal.me names are just letters and numbers.
const paypalName = (v) => String(v ?? '').trim()
  .replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
const validPaypal = (name) => /^[A-Za-z0-9]{1,20}$/.test(name);
const paypalUrl = (name) => `https://paypal.me/${encodeURIComponent(name)}`;
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---- The page ----

function page() {
  const s = store.state;
  const me = store.me;
  const p = { ...PREFS, ...me.prefs };
  const pay = me.pay ?? {};
  const meals = listMeals().length;
  const theme = getTheme();
  const notSet = '<span class="text-gray-400">Not set</span>';

  const profile = `
    <button type="button" data-click="editName" class="bg-white rounded-3xl p-3.5 border border-orange-100 shadow-sm flex items-center gap-3 text-left active:scale-98 transition-all">
      <span class="w-12 h-12 shrink-0 rounded-2xl ${color(s?.members[me.id]).solid} text-white font-display font-extrabold text-base flex items-center justify-center">${initials(me.name)}</span>
      <span class="flex-1 min-w-0">
        <span class="block font-display font-bold text-sm text-espresso truncate">${esc(me.name || 'Add your name')}</span>
        <span class="block text-[10px] text-gray-500">Tap to change your name</span>
      </span>
      ${chevron}
    </button>`;

  const diet = p.diet.map((d) => capital(dietLabel(d))).join(', ');
  const food = row({
    icon: 'fa-utensils', label: 'Budget, cuisine, distance, diet', click: 'editPrefs',
    sub: esc(`$${p.budget} cap • ${p.cuisine} • ${p.distanceKm} km${diet ? ` • ${diet}` : ''}`),
  });

  const payRows = [
    row({
      icon: 'fa-building-columns', tint: 'bg-sky-100 text-sky-700', label: 'Interac e-Transfer',
      sub: 'Friends send your share to this email', value: pay.email ? esc(pay.email) : notSet, click: 'editEmail',
    }),
    row({
      icon: 'fa-brands fa-paypal', tint: 'bg-sky-100 text-sky-700', label: 'PayPal',
      sub: 'A PayPal button with their exact share', value: pay.paypal ? esc(`paypal.me/${paypalName(pay.paypal)}`) : notSet, click: 'editPaypal',
    }),
  ];

  const appearance = `<div class="p-2"><div class="grid grid-cols-3 gap-1 bg-gray-100 rounded-2xl p-1" role="group" aria-label="Theme">
    ${THEMES.map((t) => `<button type="button" data-click="theme" data-value="${t}" data-key="theme-${t}" aria-pressed="${t === theme}"
      class="h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${t === theme ? 'bg-white text-espresso shadow-sm' : 'text-gray-500'}">
      <i class="fa-solid ${THEME_LOOK[t][1]}"></i> ${THEME_LOOK[t][0]}</button>`).join('')}
  </div></div>`;

  const install = standalone()
    ? row({ icon: 'fa-circle-check', tint: 'bg-sage-100 text-sage-600', label: 'Installed on this phone' })
    : row({
      icon: 'fa-mobile-screen', tint: 'bg-amberWarm-100 text-amberWarm-600', label: 'Put Split on your home screen',
      sub: 'iPhone (Safari): Share <i class="fa-solid fa-arrow-up-from-bracket"></i>, then <b>Add to Home Screen</b>.<br>Android (Chrome): <b>⋮</b>, then <b>Install app</b>.',
    });

  return [
    profile,
    section('Food preferences', [food]),
    section('Getting paid back', payRows),
    section('Appearance', [appearance]),
    section('AI', [row({ icon: 'fa-wand-magic-sparkles', tint: 'bg-purple-100 text-purple-600', label: 'Reads menus and receipts', value: demoMode() ? 'Demo mode: sample data' : 'On' })]),
    section('Install', [install]),
    section('Data', [
      row({ icon: 'fa-clock-rotate-left', label: 'Clear meal history', value: plural(meals, 'meal'), click: 'clearHistory' }),
      row({ icon: 'fa-trash-can', label: '<span class="text-terracotta-600">Reset Split on this phone</span>', sub: 'Removes your name, friends, history and settings', click: 'reset' }),
    ]),
    section('About', [
      row({ icon: 'fa-receipt', label: 'Split', sub: 'Plan the order, split the bill fairly.', value: 'Version 1.0' }),
    ]),
  ].join('');
}

// ---- Edit sheets (they open on top of the page) ----

const field = (id, label, value, attrs = '') => `
  <div><label for="${id}" class="${cls.label}">${label}</label>
  <input id="${id}" value="${esc(value)}" class="${cls.input}" ${attrs}></div>`;

// Same chips as js/screens/group.js.
const dietChips = (diet = []) => `
  <fieldset><legend class="${cls.label}">Dietary needs</legend>
    <div class="flex flex-wrap gap-1.5">${DIETS.map((d) => `<label>
      <input type="checkbox" name="diet" value="${d}" class="peer sr-only" ${diet.includes(d) ? 'checked' : ''}>
      <span class="inline-block px-3 py-1.5 rounded-full text-[10px] font-bold capitalize bg-gray-100 text-espresso cursor-pointer peer-checked:bg-sage-500 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-sage-300">${dietLabel(d)}</span>
    </label>`).join('')}</div>
  </fieldset>`;
const readDiet = (el) => [...el.querySelectorAll('input[name="diet"]:checked')].map((i) => i.value);

const saveBtn = (text = 'Save') => `<button class="${cls.btn}"><i class="fa-solid fa-check"></i> ${text}</button>`;

function nameSheet() {
  const { el, close } = sheet({
    title: 'Your name', subtitle: 'Everyone in your group sees it', icon: 'fa-user',
    body: `<form data-submit="save" class="flex flex-col gap-2.5">
      ${field('setName', 'Your name', store.me.name, 'required maxlength="24" autocomplete="given-name" placeholder="e.g. Alex"')}
      ${saveBtn()}
    </form>`,
  });
  delegate(el, {
    save: async () => {
      const name = $('#setName', el).value.trim();
      if (!name) return;
      close();
      await store.saveMe({ name });
      draw();
    },
  });
  $('#setName', el).focus();
}

function prefsSheet() {
  const p = { ...PREFS, ...store.me.prefs };
  const cuisines = [...new Set([...CUISINES, p.cuisine || 'Any'])];
  const { el, close } = sheet({
    title: 'Food preferences', subtitle: 'Everyone in your group sees these', icon: 'fa-sliders',
    body: `<form data-submit="save" class="flex flex-col gap-2.5">
      <div class="grid grid-cols-2 gap-2">
        ${field('prefBudget', 'Budget cap ($/person)', p.budget, 'type="number" inputmode="decimal" min="1" step="any" required')}
        ${field('prefDistance', 'Max distance (km)', p.distanceKm, 'type="number" inputmode="decimal" min="0.1" step="any" required')}
      </div>
      <div><label for="prefCuisine" class="${cls.label}">Cuisine</label>
        <select id="prefCuisine" class="${cls.input}">${cuisines.map((c) => `<option value="${esc(c)}" ${c === (p.cuisine || 'Any') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      ${dietChips(p.diet)}
      ${saveBtn()}
    </form>`,
  });
  delegate(el, {
    save: async () => {
      close();
      await store.saveMe({ prefs: {
        budget: Number($('#prefBudget', el).value),
        cuisine: $('#prefCuisine', el).value,
        distanceKm: Number($('#prefDistance', el).value),
        diet: readDiet(el),
      } });
      draw();
    },
  });
}

function emailSheet() {
  const { el, close } = sheet({
    title: 'Interac e-Transfer', subtitle: 'Your group sees this when you pay the bill', icon: 'fa-building-columns',
    body: `<form data-submit="save" class="flex flex-col gap-2.5">
      ${field('payEmail', 'Email for e-Transfers', store.me.pay?.email, 'type="email" autocomplete="email" inputmode="email" placeholder="you@email.com"')}
      <p class="text-[10px] text-gray-500 leading-snug">Friends copy this and the amount, then send it from their bank app. Leave it empty to stop showing it.</p>
      ${saveBtn()}
    </form>`,
  });
  delegate(el, {
    save: async () => {
      const box = $('#payEmail', el);
      if (!box.reportValidity()) return;
      close();
      await store.saveMe({ pay: { email: box.value.trim() } });
      draw();
    },
  });
  $('#payEmail', el).focus();
}

function paypalSheet() {
  const saved = paypalName(store.me.pay?.paypal);
  const { el, close } = sheet({
    title: 'PayPal', subtitle: 'Get paid back in one tap', icon: 'fa-hand-holding-dollar',
    body: `<form data-submit="save" class="flex flex-col gap-2.5">
      <p class="text-[10px] text-gray-500 leading-snug">When you pay the bill, everyone who owes you gets a <b>PayPal</b> button with their exact share filled in.
        Paste your PayPal.me name or the whole link.</p>
      <div><label for="paypalName" class="${cls.label}">Your PayPal.me name</label>
        <div class="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl pl-3 focus-within:border-terracotta-300">
          <span class="text-xs font-semibold text-gray-400" aria-hidden="true">paypal.me/</span>
          <input id="paypalName" data-input="preview" value="${esc(saved)}" autocapitalize="off" autocorrect="off" spellcheck="false"
            class="flex-1 min-w-0 bg-transparent p-2 pl-0 text-xs font-semibold text-espresso focus:outline-none" placeholder="yourname">
        </div></div>
      <p id="paypalPreview" class="text-[10px] font-semibold leading-snug" aria-live="polite"></p>
      ${saveBtn()}
      <div class="grid grid-cols-2 gap-2">
        <a id="paypalTest" href="#" target="_blank" rel="noopener" class="${cls.btnGhost}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Test my link</a>
        <button type="button" data-click="removePaypal" class="${cls.btnGhost} text-terracotta-600" ${saved ? '' : 'disabled'}><i class="fa-solid fa-trash-can"></i> Remove</button>
      </div>
      <a href="https://www.paypal.com/paypalme/" target="_blank" rel="noopener" class="text-[10px] font-bold text-terracotta-600 underline text-center">Don't have one? Create your free PayPal.me link</a>
    </form>`,
  });
  const box = $('#paypalName', el);
  const note = $('#paypalPreview', el);
  const test = $('#paypalTest', el);
  // Live preview of the link friends will get, plus a test link that opens it.
  const preview = () => {
    const name = paypalName(box.value);
    const ok = validPaypal(name);
    note.className = `text-[10px] font-semibold leading-snug ${!name || ok ? 'text-gray-500' : 'text-terracotta-600'}`;
    note.textContent = !name ? 'No PayPal link yet.' : ok ? `Friends will pay you at paypal.me/${name}` : 'PayPal.me names only use letters and numbers (up to 20).';
    test.classList.toggle('opacity-40', !ok);
    test.classList.toggle('pointer-events-none', !ok);
    test.setAttribute('aria-disabled', String(!ok));
    test.href = ok ? paypalUrl(name) : '#';
    return { name, ok };
  };
  preview();
  delegate(el, {
    preview,
    save: async () => {
      const { name, ok } = preview();
      if (name && !ok) { box.focus(); return; }
      close();
      await store.saveMe({ pay: { paypal: name } });
      toast(name ? 'PayPal saved' : 'PayPal removed', name ? `paypal.me/${name}` : 'Friends will see your other ways to pay.');
      draw();
    },
    removePaypal: async () => {
      close();
      await store.saveMe({ pay: { paypal: '' } });
      toast('PayPal removed', 'Friends will see your other ways to pay.');
      draw();
    },
  });
  box.focus();
}

// ---- Open / close ----

// onClose runs after the page is gone.
export function openSettings({ onClose } = {}) {
  if (body) return;
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'absolute inset-0 z-40 bg-creamBg flex flex-col animate-fade-in';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Settings');
  wrap.innerHTML = `
    <header class="relative bg-gradient-to-r from-terracotta-600 via-amberWarm-600 to-terracotta-700 text-white shrink-0 shadow-md safe-top">
      <div class="px-3 py-2.5 flex items-center gap-2">
        <button type="button" data-click="back" class="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 border border-white/30 flex items-center justify-center transition-all active:scale-95" aria-label="Back">
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <h2 class="font-display font-extrabold text-base tracking-tight">Settings</h2>
      </div>
    </header>
    <div class="flex-1 overflow-y-auto no-scrollbar p-3.5 pb-12 flex flex-col gap-4"></div>`;
  $('#sheetRoot').appendChild(wrap);
  body = wrap.lastElementChild;
  last = '';

  const unsubscribe = store.subscribe(draw);
  let closed = false;
  const close = (viaButton) => {
    if (closed) return;
    closed = true;
    unsubscribe();
    removeEventListener('popstate', onPop);
    removeEventListener('keydown', onKey);
    removeEventListener('hashchange', onHash);
    while (wrap.nextElementSibling) wrap.nextElementSibling.remove(); // edit sheets opened on top
    wrap.remove();
    body = null;
    // Drop the entry pushed below (onPop is already gone), but only if it's still the current one.
    if (viaButton && history.state?.settings) history.back();
    opener?.focus?.();
    onClose?.();
  };
  const onPop = () => close(false);
  // Something switched tabs underneath: that means leaving Settings.
  const onHash = () => close(false);
  // Escape is for the page only when no sheet is open on top of it.
  const onKey = (e) => { if (e.key === 'Escape' && !wrap.nextElementSibling) close(true); };
  // An extra history entry, so the phone's back button closes Settings instead of leaving the app.
  history.pushState({ settings: true }, '');
  addEventListener('popstate', onPop);
  addEventListener('keydown', onKey);
  addEventListener('hashchange', onHash);

  delegate(wrap, {
    back: () => close(true),
    editName: nameSheet,
    editPrefs: prefsSheet,
    editEmail: emailSheet,
    editPaypal: paypalSheet,
    theme: (el) => { setTheme(el.dataset.value); draw(); },
    clearHistory: () => {
      const meals = listMeals();
      if (!meals.length) { toast('Nothing to clear', 'No meals are saved on this phone yet.', 'info'); return; }
      if (!confirm(`Delete ${plural(meals.length, 'meal')} from your history on this phone?`)) return;
      deleteMeals(meals.map((m) => m.id));
      toast('History cleared', 'Your ledger is empty now.');
      draw();
    },
    reset: () => {
      if (!confirm('Reset Split on this phone? Your name, friends, meal history and settings saved here will be deleted.')) return;
      Object.keys(localStorage).filter((k) => k.startsWith('split.')).forEach((k) => localStorage.removeItem(k));
      history.replaceState(null, ''); // so the phone's Back button works normally after the reload
      location.reload();
    },
  });

  // Drawn last, so Back and Escape already work even if a bad saved value breaks a row.
  draw();
  $('[data-click="back"]', wrap).focus();
}
