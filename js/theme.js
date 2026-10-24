// Light, dark, or follow the phone ('system'). Saved on this phone. index.html applies the saved
// choice before the first paint; this keeps it in step when it changes or the phone switches.
// Dark styles live in css/app.css under html.dark.
const KEY = 'split.theme';
const media = matchMedia('(prefers-color-scheme: dark)');

export const THEMES = ['system', 'light', 'dark'];

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme = getTheme()) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: still applies for this visit */ }
  applyTheme(theme);
}

media.addEventListener('change', () => applyTheme());
applyTheme();
