// The sheet for one saved friend, or a new one (f = null). Moved here from Settings; the Group tab opens it.
// onChange runs after the friend list changes, so the screen that opened it can redraw.
import { removeFriend, saveFriend } from '../friends.js';
import { dietLabel } from '../lib/rankPlaces.js';
import { DIETS } from '../reducer.js';
import { store } from '../store.js';
import { $, cls, delegate, esc, sheet, toast } from '../ui.js';

// People paste "paypal.me/name", the whole link or "@name"; PayPal.me names are just letters and numbers.
const paypalName = (v) => String(v ?? '').trim()
  .replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
const validPaypal = (name) => /^[A-Za-z0-9]{1,20}$/.test(name);

const field = (id, label, value, attrs = '') => `
  <div><label for="${id}" class="${cls.label}">${label}</label>
  <input id="${id}" value="${esc(value)}" class="${cls.input}" ${attrs}></div>`;

// Only e-Transfer and PayPal (no Venmo in Canada).
const payFields = (pay = {}) => `
  ${field('payEmail', 'Interac e-Transfer email', pay.email, 'type="email" autocomplete="email" placeholder="them@email.com"')}
  ${field('payPaypal', 'PayPal.me name or link', pay.paypal ? paypalName(pay.paypal) : '', 'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="paypal.me/theirname"')}`;
const readPay = (el) => ({ email: $('#payEmail', el).value.trim(), paypal: paypalName($('#payPaypal', el).value) });

// Same chips as the preferences sheet in js/screens/group.js.
const dietChips = (diet = []) => `
  <fieldset><legend class="${cls.label}">Dietary needs</legend>
    <div class="flex flex-wrap gap-1.5">${DIETS.map((d) => `<label>
      <input type="checkbox" name="diet" value="${d}" class="peer sr-only" ${diet.includes(d) ? 'checked' : ''}>
      <span class="inline-block px-3 py-1.5 rounded-full text-[10px] font-bold capitalize bg-gray-100 text-espresso cursor-pointer peer-checked:bg-sage-500 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-sage-300">${dietLabel(d)}</span>
    </label>`).join('')}</div>
  </fieldset>`;
const readDiet = (el) => [...el.querySelectorAll('input[name="diet"]:checked')].map((i) => i.value);

export function openFriendSheet(f, onChange = () => {}) {
  const s = store.state;
  const inGroup = !!(f && s?.members[f.id]);
  const { el, close } = sheet({
    title: f ? f.name : 'Add a friend', subtitle: 'Saved on this phone only', icon: f ? 'fa-user-pen' : 'fa-user-plus',
    body: `<form data-submit="save" class="flex flex-col gap-2.5">
      ${field('friendName', 'Name', f?.name, 'required maxlength="24" placeholder="e.g. Sam"')}
      ${payFields(f?.pay)}
      ${dietChips(f?.diet)}
      <button class="${cls.btn}"><i class="fa-solid fa-check"></i> Save</button>
      ${!s ? '' : inGroup
        ? `<button type="button" disabled class="${cls.btnGhost} opacity-60 cursor-default"><i class="fa-solid fa-check"></i> In this group</button>`
        : `<button type="button" data-click="addToGroup" class="${cls.btnDark}"><i class="fa-solid fa-user-plus"></i> Add to this group</button>`}
      ${f ? `<button type="button" data-click="remove" class="${cls.btnGhost} text-terracotta-600"><i class="fa-solid fa-trash-can"></i> Remove friend</button>` : ''}
    </form>`,
  });
  const form = $('form', el);
  const nameBox = $('#friendName', el);
  const named = () => { if (nameBox.value.trim()) return true; nameBox.focus(); return false; };
  const paypalOk = () => {
    const { paypal } = readPay(el);
    if (!paypal || validPaypal(paypal)) return true;
    $('#payPaypal', el).focus();
    toast('Check the PayPal name', 'PayPal.me names only use letters and numbers.', 'warn');
    return false;
  };
  // Keeps any pay details the form doesn't show (e.g. an old Venmo name).
  const keep = () => saveFriend({ id: f?.id, name: nameBox.value, pay: { ...f?.pay, ...readPay(el) }, diet: readDiet(el) });
  delegate(el, {
    save: () => {
      if (!form.reportValidity() || !named() || !paypalOk()) return;
      close();
      keep();
      onChange();
    },
    addToGroup: () => {
      if (!form.reportValidity() || !named() || !paypalOk()) return;
      close();
      const { id, name, pay, diet } = keep();
      store.dispatch({ type: 'member/join', member: { id, name, guest: true, pay, diet } });
      toast(`${name} is in the group`, 'Their diet and pay details came along.');
      onChange();
    },
    remove: () => {
      if (!confirm(`Remove ${f.name} from your friends? They stay in any group they're in.`)) return;
      close();
      removeFriend(f.id);
      onChange();
    },
  });
  if (!f) nameBox.focus();
}
