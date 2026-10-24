// Group Finder: everyone's preferences, the AI restaurant search, ranking, voting, and
// locking the winner into the planner. Ranking itself lives in js/lib/rankPlaces.js.
import { findPlaces } from '../ai/places.js';
import { suggestPlaces } from '../geo.js';
import { listMeals } from '../history.js';
import { dietLabel, rankPlaces, similarHistory, voteCounts, winner } from '../lib/rankPlaces.js';
import { DIETS } from '../reducer.js';
import { go } from '../router.js';
import { setSettings as setPlanSettings } from './planner.js';
import { store } from '../store.js';
import { $, cls, color, delegate, demoBadge, esc, initials, money, patch, sheet, toast, uid } from '../ui.js';

const CUISINES = ['Any', 'Italian', 'Mexican', 'Japanese', 'Chinese', 'Korean', 'Thai', 'Vietnamese', 'Indian',
  'Middle Eastern', 'Mediterranean', 'Greek', 'American', 'French'];
const GUEST = { name: '', budget: 30, cuisine: 'Any', distanceKm: 5, diet: [] };
const RANK = ['bg-terracotta-500', 'bg-amberWarm-500', 'bg-sage-500'];

// Tab-local UI state (not synced).
let rootEl = null;
let searching = false;
let similarBusy = false;
let similar = null; // { places, demo }: the "places like ones you've loved" search, this phone only
let votingAs = null; // member id this phone votes as: you, or a guest (guests have no phone)
const open = { more: false, over: false };
// Area box suggestions. Kept here and drawn by areaList(), so store re-renders keep the list.
let areaDraft = null; // half-typed area, so a sync from another phone doesn't wipe it
let areaHits = null; // suggestions for the typed text: null = list closed, [] = nothing matched
let areaHitsFor = ''; // the text those suggestions are for, to bold the matching part
let areaActive = -1; // option highlighted with the arrow keys
let lookTimer = 0;
let lookCtrl = null;

const rerender = () => store.state && render(rootEl, store.state);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Place data syncs from other phones, so only let through real web links.
const mapLink = (p) => (/^https?:\/\//i.test(p.mapsUrl ?? '')
  ? `<a href="${esc(p.mapsUrl)}" target="_blank" rel="noopener" class="text-terracotta-600 font-bold underline"><i class="fa-solid fa-location-dot"></i> Map</a>`
  : '');
const placeMeta = (p) => [esc(p.cuisine), p.distanceKm != null ? `${esc(p.distanceKm)} km away` : '', p.rating > 0 ? `★ ${esc(p.rating)}` : '', mapLink(p)]
  .filter(Boolean).join(' • ');
const byJoin = (a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
// Only you or a guest; anyone else with the app votes on their own phone.
const voter = (s) => (s.members[votingAs]?.guest ? votingAs : store.me.id);
const votersOf = (p, s) => Object.keys(s.finder.votes).filter((id) => s.finder.votes[id] === p.id && s.members[id]).map((id) => s.members[id]);
const happy = (row, s) => `${row.satisfied.length} of ${Object.keys(s.members).length} fully happy`;
const areaValue = () => ($('#groupArea', rootEl)?.value ?? store.state.area).trim();

function needArea() {
  toast('Where are you eating?', 'Type a city or area first.', 'info');
  $('#groupArea', rootEl)?.focus();
}

// --- Banner + area ---

// Bold the part of a suggestion that matches what was typed.
function boldMatch(label, q) {
  const m = q ? label.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) : null;
  if (!m) return esc(label);
  const end = m.index + m[0].length;
  return `${esc(label.slice(0, m.index))}<b class="font-extrabold text-terracotta-600">${esc(m[0])}</b>${esc(label.slice(end))}`;
}

const POP = 'absolute left-0 right-0 top-full mt-1 z-30 bg-white rounded-2xl border border-orange-100 shadow-lg';
const areaOpen = () => !!areaHits?.length;
const activeOpt = () => (areaActive >= 0 ? `groupAreaOpt${areaActive}` : '');

function areaList() {
  if (!areaHits) return '';
  if (!areaHits.length) return `<p role="status" class="${POP} px-3 py-2.5 text-[10px] text-gray-500">No places found, you can still use what you typed</p>`;
  return `<ul id="groupAreaList" role="listbox" aria-label="Matching places" class="${POP} p-1 flex flex-col">
    ${areaHits.map((p, i) => `<li id="groupAreaOpt${i}" role="option" aria-selected="${i === areaActive}" data-click="pickArea" data-pick="${i}"
      class="flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-espresso cursor-pointer ${i === areaActive ? 'bg-orange-50' : 'hover:bg-gray-50'}">
      <i class="fa-solid fa-location-dot text-[10px] text-terracotta-500" aria-hidden="true"></i><span class="truncate min-w-0">${boldMatch(p.label, areaHitsFor)}</span></li>`).join('')}
  </ul>`;
}

// Redraw just the list, not the screen, so the box being typed in is left alone.
function paintAreaList() {
  const box = $('#groupArea', rootEl);
  const pop = $('#groupAreaPop', rootEl);
  if (!box || !pop) return;
  pop.innerHTML = areaList();
  box.setAttribute('aria-expanded', areaOpen());
  if (activeOpt()) box.setAttribute('aria-activedescendant', activeOpt());
  else box.removeAttribute('aria-activedescendant');
}

// Close the list and drop any search still in flight.
function closeAreaList() {
  clearTimeout(lookTimer);
  lookCtrl?.abort();
  const wasOpen = areaHits != null;
  areaHits = null;
  areaActive = -1;
  if (wasOpen) paintAreaList();
}

function lookUpArea(q) {
  clearTimeout(lookTimer);
  lookCtrl?.abort();
  if (q.length < 2) return closeAreaList();
  if (areaActive >= 0) { areaActive = -1; paintAreaList(); } // the old highlight may not match any more
  lookTimer = setTimeout(async () => {
    const ctrl = (lookCtrl = new AbortController());
    const hits = await suggestPlaces(q, ctrl.signal);
    if (ctrl.signal.aborted || document.activeElement?.id !== 'groupArea') return;
    areaHits = hits.slice(0, 6);
    areaHitsFor = q;
    areaActive = -1;
    paintAreaList();
  }, 250);
}

const saveArea = (v) => { areaDraft = null; store.dispatch({ type: 'session/setArea', area: v.trim() }); };

function chooseArea(i) {
  const hit = areaHits?.[i];
  const box = $('#groupArea', rootEl);
  if (!hit || !box) return;
  box.value = hit.label;
  closeAreaList();
  saveArea(hit.label);
}

const banner = (s) => `
  <div class="bg-gradient-to-br from-espresso via-terracotta-900 to-amberWarm-600 rounded-3xl p-3.5 text-white shadow-md flex flex-col gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[9px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1"><i class="fa-solid fa-people-group"></i> Group Decision Engine</span>
      <span class="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-bold truncate max-w-[50%]">${esc(s.name)}</span>
    </div>
    <h2 class="font-display font-extrabold text-base leading-snug">Find a place that works for everyone</h2>
    <p class="text-[10px] text-orange-100/90 leading-relaxed">We check everyone's budget, cuisine, distance and diet, then rank the places that suit the most people. Anywhere over <b>anyone's</b> budget is left out.</p>
    <label for="groupArea" class="text-[9px] font-bold uppercase tracking-wider text-amber-300 pt-1">Area</label>
    <div class="relative">
      <input id="groupArea" data-change="setArea" data-input="typeArea" value="${esc(areaDraft ?? s.area)}" maxlength="60" autocomplete="off" placeholder="Search for a city or area"
        role="combobox" aria-autocomplete="list" aria-controls="groupAreaList" aria-expanded="${areaOpen()}" ${activeOpt() ? `aria-activedescendant="${activeOpt()}"` : ''}
        class="w-full bg-white/15 border border-white/25 rounded-xl p-2 text-xs font-semibold text-white placeholder:text-white/50 focus:outline-none focus:border-white/60">
      <div id="groupAreaPop">${areaList()}</div>
    </div>
  </div>`;

// --- Members ---

function chip(m) {
  const mine = m.id === store.me.id;
  const editable = mine || m.guest;
  const tag = editable ? 'button' : 'div';
  const badges = m.diet.map((d) => `<span class="text-[8px] bg-sage-100 text-sage-800 px-1.5 py-0.5 rounded-md font-bold capitalize">${esc(dietLabel(d))}</span>`).join('')
    + (m.guest ? '<span class="text-[8px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-md font-bold">Guest</span>' : '');
  return `<${tag} ${editable ? `type="button" data-click="edit" data-id="${esc(m.id)}"` : ''}
    class="text-left p-2 rounded-2xl border flex flex-col gap-0.5 min-w-0 ${mine ? 'bg-orange-50/70 border-orange-100' : 'bg-gray-50 border-gray-100'} ${editable ? 'active:scale-98 transition-all' : ''}">
    ${editable ? '<span class="sr-only">Edit</span>' : ''}
    <span class="flex items-center justify-between gap-1 w-full">
      <span class="font-bold text-[11px] text-espresso truncate">${esc(m.name)}${mine ? ' (You)' : ''}</span>
      <span class="text-[9px] font-extrabold ${color(m).text} shrink-0">$${esc(m.budget)} cap</span>
    </span>
    <span class="text-[8px] text-gray-500 flex items-center gap-1 w-full">${esc(m.cuisine || 'Any')} • ${esc(m.distanceKm)} km
      ${editable ? '<i class="fa-solid fa-pen text-[7px] text-gray-400 ml-auto" aria-hidden="true"></i>' : ''}</span>
    ${badges ? `<span class="flex flex-wrap gap-1">${badges}</span>` : ''}
  </${tag}>`;
}

function membersCard(s) {
  const list = Object.values(s.members).sort(byJoin);
  return `<div class="${cls.card}">
    <div class="border-b border-gray-100 pb-2">
      <h3 class="${cls.title}">Everyone's preferences (${list.length})</h3>
      <p class="${cls.sub}">Tap your card to change yours. Friends update theirs on their own phone.</p>
    </div>
    ${list.length ? `<div class="grid grid-cols-2 gap-2">${list.map(chip).join('')}</div>`
      : '<p class="text-[10px] text-gray-500">Nobody here yet. Add your name in Settings, then invite your group.</p>'}
    <button data-click="addGuest" class="${cls.btnGhost}"><i class="fa-solid fa-user-plus"></i> Add someone without the app</button>
  </div>`;
}

// One sheet for your own preferences, a guest's, or a new guest (m = null).
function editSheet(m) {
  const mine = m?.id === store.me.id;
  const p = m ?? GUEST;
  const cuisines = [...new Set([...CUISINES, p.cuisine || 'Any'])];
  const { el, close } = sheet({
    title: mine ? 'Your preferences' : m ? `${p.name}'s preferences` : 'Add someone without the app',
    subtitle: mine ? 'Everyone in the group sees these' : 'You fill these in for them',
    icon: mine ? 'fa-sliders' : 'fa-user-plus',
    body: `
      <form data-submit="save" class="flex flex-col gap-2.5">
        ${mine ? '' : `<div><label for="prefName" class="${cls.label}">Name</label>
          <input id="prefName" value="${esc(p.name)}" required maxlength="24" placeholder="e.g. Grandma" class="${cls.input}"></div>`}
        <div class="grid grid-cols-2 gap-2">
          <div><label for="prefBudget" class="${cls.label}">Budget cap ($/person)</label>
            <input id="prefBudget" type="number" inputmode="decimal" min="1" step="any" required value="${esc(p.budget)}" class="${cls.input}"></div>
          <div><label for="prefDistance" class="${cls.label}">Max distance (km)</label>
            <input id="prefDistance" type="number" inputmode="decimal" min="0.1" step="any" required value="${esc(p.distanceKm)}" class="${cls.input}"></div>
        </div>
        <div><label for="prefCuisine" class="${cls.label}">Cuisine</label>
          <select id="prefCuisine" class="${cls.input}">${cuisines.map((c) => `<option value="${esc(c)}" ${c === (p.cuisine || 'Any') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <fieldset><legend class="${cls.label}">Dietary needs</legend>
          <div class="flex flex-wrap gap-1.5">${DIETS.map((d) => `<label>
            <input type="checkbox" name="diet" value="${d}" class="peer sr-only" ${p.diet.includes(d) ? 'checked' : ''}>
            <span class="inline-block px-3 py-1.5 rounded-full text-[10px] font-bold capitalize bg-gray-100 text-espresso cursor-pointer peer-checked:bg-sage-500 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-sage-300">${dietLabel(d)}</span>
          </label>`).join('')}</div>
        </fieldset>
        <button class="${cls.btn}"><i class="fa-solid fa-check"></i> ${m ? 'Save' : 'Add to the group'}</button>
        ${m?.guest ? `<button type="button" data-click="remove" class="${cls.btnGhost} text-terracotta-600"><i class="fa-solid fa-user-minus"></i> Remove ${esc(p.name)}</button>` : ''}
      </form>`,
  });
  delegate(el, {
    save: () => {
      const prefs = {
        budget: Number($('#prefBudget', el).value),
        cuisine: $('#prefCuisine', el).value,
        distanceKm: Number($('#prefDistance', el).value),
        diet: [...el.querySelectorAll('input[name="diet"]:checked')].map((i) => i.value),
      };
      if (mine) {
        close();
        store.saveMe({ prefs });
        return;
      }
      const name = $('#prefName', el).value.trim();
      if (!name) { $('#prefName', el).focus(); return; }
      close();
      if (m) store.dispatch({ type: 'member/update', id: m.id, patch: { name, ...prefs } });
      else store.dispatch({ type: 'member/join', member: { id: uid(), name, guest: true, ...prefs } });
    },
    remove: () => {
      if (!confirm(`Remove ${p.name} from the group?`)) return;
      close();
      store.dispatch({ type: 'member/remove', id: m.id });
    },
  });
}

// --- Search + results ---

const findButton = () => `
  <button data-click="find" ${searching ? 'disabled' : ''} class="w-full py-3 rounded-2xl bg-gradient-to-r from-terracotta-500 to-amberWarm-500 text-white font-bold text-xs shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
    <i class="fa-solid ${searching ? 'fa-spinner fa-spin' : 'fa-magnifying-glass-location'}"></i>
    <span aria-live="polite">${searching ? 'Searching the web…' : 'Find places for everyone'}</span>
  </button>`;

const avatar = (m) => `<span role="img" aria-label="${esc(m.name)}" title="${esc(m.name)}"
  class="w-5 h-5 rounded-full ${color(m).solid} text-white text-[8px] font-bold ring-2 ring-white flex items-center justify-center">${initials(m.name)}</span>`;

const copyButton = (p, src) => `<button data-click="copy" data-id="${esc(p.id)}" data-src="${src}"
  class="px-2.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-espresso font-bold text-[10px] active:scale-95 transition-all shrink-0"><i class="fa-regular fa-copy"></i> Copy address</button>`;

function voteButton(p, s) {
  const on = s.finder.votes[voter(s)] === p.id;
  return `<button data-click="vote" data-id="${esc(p.id)}" aria-pressed="${on}"
    class="px-2.5 py-2 rounded-xl font-bold text-[10px] active:scale-95 transition-all shrink-0 ${on ? 'bg-terracotta-500 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-espresso'}">
    <i class="fa-${on ? 'solid' : 'regular'} fa-thumbs-up"></i> ${on ? 'Voted' : 'Vote'}</button>`;
}

function placeCard(row, i, s) {
  const p = row.place;
  const voters = votersOf(p, s);
  const pill = row.matchPct === 100 ? 'bg-sage-100 text-sage-800' : row.matchPct >= 50 ? 'bg-amberWarm-100 text-amberWarm-800' : 'bg-gray-100 text-gray-600';
  const reasons = Object.values(row.fails).flat();
  const diets = p.dietOptions.length ? p.dietOptions.map(dietLabel).join(' + ') : 'None listed';
  return `
    <div class="border ${i === 0 ? 'border-terracotta-200 bg-gradient-to-br from-white to-orange-50/40' : 'border-gray-200 bg-white'} rounded-2xl p-2.5 flex flex-col gap-1.5 shadow-xs">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-5 h-5 rounded-full ${RANK[i]} text-white font-extrabold text-[10px] flex items-center justify-center shrink-0">${i + 1}</span>
          <div class="min-w-0">
            <h4 class="font-display font-bold text-xs text-espresso truncate">${esc(p.name)}</h4>
            <p class="text-[9px] text-gray-500">${placeMeta(p)}</p>
          </div>
        </div>
        <div class="flex flex-col items-end gap-0.5 shrink-0">
          <span class="${pill} text-[8px] font-extrabold px-1.5 py-0.5 rounded-full">${row.matchPct}% match</span>
          <span class="text-[8px] text-gray-500">${happy(row, s)}</span>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-1 text-[9px] text-gray-600 bg-white/80 p-1.5 rounded-xl border border-gray-100">
        <div><b>Est. cost/person:</b> <span class="text-terracotta-600 font-bold">${money(p.estCostPerPerson)}</span></div>
        <div><b>Diet options:</b> <span class="text-sage-600 font-bold capitalize">${esc(diets)}</span></div>
      </div>
      ${p.why ? `<p class="text-[10px] text-gray-600 leading-snug">${esc(p.why)}</p>` : ''}
      ${reasons.length ? `<p class="text-[9px] text-amberWarm-800 leading-snug"><i class="fa-solid fa-circle-exclamation"></i> ${reasons.map(esc).join(' · ')}</p>` : ''}
      <div class="flex items-center justify-between gap-2 pt-1">
        <div class="flex items-center gap-1.5 min-w-0">
          ${voters.length ? `<div class="flex -space-x-1.5">${voters.map(avatar).join('')}</div>` : ''}
          <span class="font-extrabold ${voters.length ? 'text-terracotta-600' : 'text-gray-400'} text-[10px]">${plural(voters.length, 'vote')}</span>
        </div>
        <div class="flex gap-1.5">
          ${copyButton(p, 'finder')}
          ${voteButton(p, s)}
        </div>
      </div>
    </div>`;
}

const collapsible = (key, label, rows) => `
  <button data-click="toggle" data-list="${key}" aria-expanded="${open[key]}" class="flex items-center justify-between w-full py-2 text-[10px] font-bold text-espresso border-t border-gray-100">
    <span>${label}</span><i class="fa-solid fa-chevron-${open[key] ? 'up' : 'down'} text-gray-400" aria-hidden="true"></i>
  </button>
  ${open[key] ? `<div class="flex flex-col gap-1.5 -mt-1">${rows}</div>` : ''}`;

function moreRow(r, s) {
  const votes = votersOf(r.place, s).length;
  return `
  <div class="${cls.row} gap-2">
    <div class="min-w-0">
      <p class="font-bold text-espresso truncate">${esc(r.place.name)}</p>
      <p class="text-[9px] text-gray-500">${money(r.place.estCostPerPerson)}/person • ${placeMeta(r.place)}</p>
      <p class="text-[9px] text-gray-500"><b class="text-espresso">${r.matchPct}% match</b> • ${happy(r, s)}${votes ? ` • <b class="text-terracotta-600">${plural(votes, 'vote')}</b>` : ''}</p>
    </div>
    ${voteButton(r.place, s)}
  </div>`;
}

// Guests have no phone, so whoever is with them votes for them.
function votingAsPicker(s) {
  const guests = Object.values(s.members).filter((m) => m.guest).sort(byJoin);
  if (!guests.length) return '';
  const who = voter(s);
  const option = (id, label) => `<button data-click="voteAs" data-id="${esc(id)}" aria-pressed="${who === id}"
    class="px-2.5 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-all ${who === id ? 'bg-espresso text-white' : 'bg-gray-100 hover:bg-gray-200 text-espresso'}">${label}</button>`;
  return `<div class="flex flex-col gap-1">
    <div role="group" aria-label="Voting as" class="flex flex-wrap items-center gap-1.5">
      <span class="text-[9px] font-bold uppercase tracking-wider text-gray-400">Voting as</span>
      ${option(store.me.id, 'You')}${guests.map((g) => option(g.id, esc(g.name))).join('')}
    </div>
    <p class="${cls.sub}">Guests don't have the app, so tap their name to vote for them.</p>
  </div>`;
}

const overRow = (x) => `
  <div class="${cls.row}">
    <div class="min-w-0">
      <p class="font-bold text-espresso truncate">${esc(x.place.name)} ${mapLink(x.place) ? `<span class="text-[9px] font-normal">${mapLink(x.place)}</span>` : ''}</p>
      <p class="text-[9px] text-amberWarm-800">${esc(x.reason)}</p>
    </div>
  </div>`;

const lockedNote = (p) => `
  <div class="p-2.5 rounded-2xl bg-sage-50 border border-sage-100 flex items-center justify-between gap-2">
    <div class="min-w-0">
      <p class="text-[9px] font-bold uppercase tracking-wider text-sage-600"><i class="fa-solid fa-lock"></i> Locked in</p>
      <p class="font-display font-bold text-xs text-espresso truncate">${esc(p.name)}</p>
      ${p.address ? `<p class="text-[9px] text-gray-500 truncate">${esc(p.address)}</p>` : ''}
    </div>
    <button data-click="toPlanner" class="px-3 py-2 rounded-xl bg-espresso text-white font-bold text-[10px] shrink-0">Open planner <i class="fa-solid fa-arrow-right"></i></button>
  </div>`;

function resultsCard(s) {
  const f = s.finder;
  if (!f.places.length) {
    return f.searchedAt ? `<div class="${cls.card}"><p class="text-[10px] text-gray-500">No places came back for that area. Try a nearby city or a wider area.</p></div>` : '';
  }
  const { ranked, excluded } = rankPlaces(f.places, Object.values(s.members));
  const top = winner(ranked, f.votes);
  const topVotes = top ? voteCounts(f.votes)[top.place.id] ?? 0 : 0;
  const locked = f.places.find((p) => p.id === f.winnerId);
  return `<div class="${cls.card}">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 class="${cls.title}">Top matches</h3>
        <p class="${cls.sub}">Vote for your favourite, then lock the winner</p>
      </div>
      <div class="flex items-center gap-1 shrink-0">${demoBadge(f.demo)}<span class="${cls.pill} bg-amberWarm-100 text-amberWarm-800">${ranked.length} fit every budget</span></div>
    </div>
    ${ranked.length ? votingAsPicker(s) + ranked.slice(0, 3).map((row, i) => placeCard(row, i, s)).join('')
      : '<p class="text-[10px] text-gray-500">Every place is over someone\'s budget. Raise a cap or search again.</p>'}
    ${ranked.length > 3 ? collapsible('more', plural(ranked.length - 3, 'more place'), ranked.slice(3).map((r) => moreRow(r, s)).join('')) : ''}
    ${excluded.length ? collapsible('over', `Over someone's budget (${excluded.length})`, excluded.map(overRow).join('')) : ''}
    ${locked ? lockedNote(locked) : ''}
    ${top ? `
      <button data-click="lock" class="w-full py-2.5 rounded-2xl bg-gradient-to-r from-terracotta-500 to-amberWarm-500 text-white font-bold text-xs shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 mt-1">
        <i class="fa-solid fa-lock text-xs"></i><span>Lock winner &amp; send to planner</span>
      </button>
      <p class="text-[9px] text-gray-400 text-center -mt-1.5">Winner right now: <b class="text-espresso">${esc(top.place.name)}</b> (${plural(topVotes, 'vote')}). Ties go to the higher-ranked place.</p>` : ''}
  </div>`;
}

// --- Places like ones you've loved (this phone's ledger) ---

const similarRow = (p) => `
  <div class="p-2 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col gap-1">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="font-bold text-xs text-espresso truncate">${esc(p.name)}</p>
        <p class="text-[9px] text-gray-500">${money(p.estCostPerPerson)}/person • ${placeMeta(p)}</p>
      </div>
      ${copyButton(p, 'similar')}
    </div>
    ${p.why ? `<p class="text-[10px] text-gray-600 leading-snug">${esc(p.why)}</p>` : ''}
  </div>`;

function similarCard() {
  const hist = similarHistory(listMeals());
  const label = hist.length ? `Find places like ${hist[0].restaurant}${hist.length > 1 ? ` and ${plural(hist.length - 1, 'other')}` : ''}` : '';
  return `<div class="${cls.card}">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 class="${cls.title}"><i class="fa-solid fa-heart text-terracotta-500"></i> Places like ones you've loved</h3>
        <p class="${cls.sub}">Based on past meals saved on this phone</p>
      </div>
      ${similar ? demoBadge(similar.demo) : ''}
    </div>
    ${hist.length ? `
      <button data-click="similar" ${similarBusy ? 'disabled' : ''} class="${cls.btnDark} disabled:opacity-60">
        <i class="fa-solid ${similarBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}"></i>
        <span aria-live="polite">${similarBusy ? 'Searching the web…' : esc(label)}</span>
      </button>
      ${similar ? (similar.places.length ? similar.places.map(similarRow).join('') : '<p class="text-[10px] text-gray-500">Nothing new came back. Try a wider area.</p>') : ''}`
      : '<p class="text-[10px] text-gray-500">Finish a meal on the Split tab and we\'ll suggest new places like it here.</p>'}
  </div>`;
}

// --- Screen contract ---

export function mount(root) {
  rootEl = root;
  // Area box: arrow keys move the highlight, Enter picks it, Escape or leaving the box closes the list.
  root.addEventListener('keydown', (e) => {
    if (e.target.id !== 'groupArea' || !areaHits) return;
    const n = areaHits.length;
    if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      areaActive = e.key === 'ArrowDown' ? (areaActive + 1) % n : (areaActive <= 0 ? n : areaActive) - 1;
      paintAreaList();
    } else if (e.key === 'Enter' && areaActive >= 0) {
      e.preventDefault();
      chooseArea(areaActive);
    } else if (e.key === 'Enter' || e.key === 'Escape') closeAreaList();
  });
  // Pressing a suggestion keeps the box focused, so the list is still there when the click lands.
  // (Picking on pointerdown instead would let iOS send the click to the card under the closed list.)
  root.addEventListener('mousedown', (e) => { if (e.target.closest('[data-pick]')) e.preventDefault(); });
  // Short wait: a re-render puts focus straight back in the box, and that isn't leaving it.
  root.addEventListener('focusout', (e) => {
    if (e.target.id !== 'groupArea') return;
    setTimeout(() => {
      if (document.activeElement?.id === 'groupArea') return;
      closeAreaList();
      // A sync re-render mid-typing swaps in a new box, which won't fire change, so save the draft here.
      if (areaDraft != null) saveArea(areaDraft);
    }, 150);
  });
  delegate(root, {
    setArea: (el) => saveArea(el.value),
    typeArea: (el) => { areaDraft = el.value; lookUpArea(el.value.trim()); },
    pickArea: (el) => chooseArea(Number(el.dataset.pick)),
    edit: (el) => { const m = store.state.members[el.dataset.id]; if (m) editSheet(m); },
    addGuest: () => editSheet(null),
    find: async () => {
      const area = areaValue();
      if (!area) return needArea();
      searching = true;
      rerender();
      try {
        const places = await findPlaces({ area, members: Object.values(store.state.members) });
        await store.dispatch({ type: 'finder/setPlaces', places, demo: places.some((p) => p.demo) });
        open.more = open.over = false;
      } catch (e) {
        console.error(e);
        toast("Couldn't find places", e.message, 'warn');
      }
      searching = false;
      rerender();
    },
    voteAs: (el) => { votingAs = el.dataset.id; rerender(); },
    vote: (el) => {
      const memberId = voter(store.state);
      if (!store.state.members[memberId]) return toast('Add your name first', 'Open Settings to join the group, then vote.', 'info');
      store.dispatch({ type: 'finder/vote', memberId, placeId: el.dataset.id });
    },
    copy: (el) => {
      const list = el.dataset.src === 'similar' ? similar?.places ?? [] : store.state.finder.places;
      const p = list.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const text = [p.name, p.address].filter(Boolean).join(', ');
      // Promise wrapper: navigator.clipboard is missing on plain-http pages, which would throw.
      Promise.resolve().then(() => navigator.clipboard.writeText(text))
        .then(() => toast('Address copied', text))
        .catch(() => toast("Couldn't copy", text, 'warn'));
    },
    toggle: (el) => { open[el.dataset.list] = !open[el.dataset.list]; rerender(); },
    lock: async () => {
      const s = store.state;
      const top = winner(rankPlaces(s.finder.places, Object.values(s.members)).ranked, s.finder.votes);
      if (!top) return;
      await store.dispatch({ type: 'finder/lock', placeId: top.place.id });
      await setPlanSettings({ headcount: Math.max(1, Object.keys(s.members).length) });
      toast('Locked in!', `${top.place.name} is in the planner.`);
      go('planner');
    },
    toPlanner: () => go('planner'),
    similar: async () => {
      const area = areaValue();
      if (!area) return needArea();
      similarBusy = true;
      rerender();
      try {
        const places = await findPlaces({ mode: 'similar', area, history: similarHistory(listMeals()) });
        similar = { places, demo: places.some((p) => p.demo) };
      } catch (e) {
        console.error(e);
        toast("Couldn't find places", e.message, 'warn');
      }
      similarBusy = false;
      rerender();
    },
  });
}

export function render(root, state) {
  patch(root, banner(state) + membersCard(state) + findButton() + resultsCard(state) + similarCard());
}
