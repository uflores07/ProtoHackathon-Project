// Small helpers every screen uses. Keep screens consistent by reaching for these first.

export const $ = (sel, root = document) => root.querySelector(sel);

// ALWAYS escape text that came from a person or the AI before putting it in innerHTML:
// member names sync from other phones and receipt text comes from a photo.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

export const uid = (n = 8) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};

// Member chip colours. member.color is an index into this list.
export const COLORS = [
  { solid: 'bg-terracotta-500', text: 'text-terracotta-600', soft: 'bg-terracotta-100' },
  { solid: 'bg-amberWarm-500', text: 'text-amberWarm-600', soft: 'bg-amberWarm-100' },
  { solid: 'bg-sage-500', text: 'text-sage-600', soft: 'bg-sage-100' },
  { solid: 'bg-purple-500', text: 'text-purple-600', soft: 'bg-purple-100' },
  { solid: 'bg-sky-500', text: 'text-sky-600', soft: 'bg-sky-100' },
  { solid: 'bg-rose-500', text: 'text-rose-600', soft: 'bg-rose-100' },
  { solid: 'bg-teal-500', text: 'text-teal-600', soft: 'bg-teal-100' },
  { solid: 'bg-indigo-500', text: 'text-indigo-600', soft: 'bg-indigo-100' },
];
export const color = (member) => COLORS[(member?.color ?? 0) % COLORS.length];
export const initials = (name) => esc(String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());

// Replace an element's HTML but keep the focused input focused, so a sync update
// from another phone doesn't kick you out of the box you're typing in.
// Give inputs a stable id or data-key for this to work.
export function patch(el, html) {
  const active = document.activeElement;
  const key = active && el.contains(active) ? active.dataset.key || active.id : null;
  let sel = null;
  try { sel = key ? [active.selectionStart, active.selectionEnd] : null; } catch { /* number inputs have no selection */ }
  el.innerHTML = html;
  if (!key) return;
  const again = el.querySelector(`[data-key="${CSS.escape(key)}"]`) || el.querySelector(`#${CSS.escape(key)}`);
  if (!again) return;
  again.focus({ preventScroll: true });
  try { if (sel && sel[0] != null) again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
}

// One listener per screen. Mark elements with data-click="name", data-change="name",
// data-input="name" or data-submit="name", and pass { name: (el, event) => {} }.
export function delegate(root, handlers) {
  for (const type of ['click', 'change', 'input', 'submit']) {
    root.addEventListener(type, (e) => {
      const el = e.target.closest(`[data-${type}]`);
      if (!el || !root.contains(el)) return;
      const fn = handlers[el.dataset[type]];
      if (!fn) return;
      if (type === 'submit') e.preventDefault();
      fn(el, e);
    });
  }
}

let toastTimer;
export function toast(title, msg = '', kind = 'ok') {
  const icons = {
    ok: 'fa-circle-check text-sage-500',
    warn: 'fa-triangle-exclamation text-amberWarm-500',
    info: 'fa-circle-info text-sky-400',
  };
  const t = $('#toast');
  $('#toastIcon').className = `fa-solid ${icons[kind] || kind} text-sm`;
  $('#toastTitle').textContent = title;
  $('#toastMsg').textContent = msg;
  t.classList.remove('-translate-y-24', 'opacity-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('-translate-y-24', 'opacity-0'), 2600);
}

// Bottom sheet in the prototype's style. Returns { el, close }.
// body is an HTML string; wire buttons with delegate(el, ...) or el.querySelector in onOpen.
export function sheet({ title, subtitle = '', icon = 'fa-circle-info', body, onClose }) {
  const root = $('#sheetRoot');
  const wrap = document.createElement('div');
  wrap.className = 'absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end animate-fade-in';
  wrap.innerHTML = `
    <div class="bg-white rounded-t-3xl p-4 flex flex-col gap-3 animate-sheet-in max-h-[88%] overflow-y-auto no-scrollbar safe-bottom" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="flex items-center justify-between border-b border-gray-100 pb-2">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-xl bg-terracotta-100 text-terracotta-600 flex items-center justify-center text-xs"><i class="fa-solid ${icon}"></i></div>
          <div>
            <h3 class="font-display font-bold text-xs text-espresso">${esc(title)}</h3>
            ${subtitle ? `<p class="text-[9px] text-gray-400">${esc(subtitle)}</p>` : ''}
          </div>
        </div>
        <button data-close class="text-gray-400 hover:text-espresso text-sm p-1" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="sheet-body flex flex-col gap-3">${body}</div>
    </div>`;
  const close = () => { wrap.remove(); onClose?.(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  root.appendChild(wrap);
  return { el: wrap.querySelector('.sheet-body'), close };
}

// Shared look for cards, buttons and inputs, copied from the prototype.
export const cls = {
  card: 'bg-white rounded-3xl p-4 border border-orange-100 shadow-sm flex flex-col gap-3',
  title: 'font-display font-extrabold text-[15.5px] leading-snug text-espresso',
  sub: 'text-[12px] leading-snug text-gray-500',
  label: 'block text-[11.5px] font-extrabold uppercase tracking-wider text-terracotta-700 mb-1',
  input: 'w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs font-semibold text-espresso focus:outline-none focus:border-terracotta-300',
  btn: 'w-full py-2.5 rounded-2xl bg-terracotta-500 hover:bg-terracotta-600 text-white font-bold text-xs shadow-xs active:scale-98 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50',
  btnGhost: 'w-full py-2 rounded-2xl bg-gray-100 hover:bg-gray-200 text-espresso font-bold text-xs active:scale-98 transition-all flex items-center justify-center gap-1.5',
  btnDark: 'w-full py-2.5 rounded-2xl bg-espresso text-white font-bold text-xs shadow-xs active:scale-98 transition-all flex items-center justify-center gap-1.5',
  pill: 'text-[9px] px-2 py-0.5 rounded-full font-bold',
  row: 'flex items-center justify-between p-2 rounded-2xl bg-gray-50 border border-gray-100 text-xs',
};

// A "demo data" badge for anything that came from js/fixtures instead of the AI.
export const demoBadge = (on) => (on ? `<span class="${cls.pill} bg-gray-100 text-gray-700" title="Sample data, not from a real scan">Demo data</span>` : '');
