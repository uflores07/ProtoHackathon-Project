# Split

**Plan the order, split the bill fairly.**

Split is a phone app for eating out with friends:

1. **Group:** everyone sets a budget, cuisine, travel distance and diet. Split searches the web for restaurants that work for the whole group, ranks them, and you vote.
2. **Planner:** snap the menu, enter headcount and budget, and get an order that fits *after* tax and tip. Then use the live tab at the table to tap who's eating what.
3. **Fair Split:** snap the receipt. Everyone taps what they ate, and tax, tip, service charges and discounts are split by item, not evenly. Payment requests go out by e-Transfer, PayPal or Venmo.
4. **Ledger:** past meals, who owes who, and what you've spent.

It's a web app you add to your home screen, so there's no app store. It works on iPhone and Android.

## Put it on your phone

Open the app's link on your phone: **https://uflores07.github.io/ProtoHackathon-Project/** (once GitHub Pages is turned on, see below). Then:

- **iPhone (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** tap ⋮, then **Install app** (or **Add to Home screen**).

It opens full screen like a normal app. To invite friends, tap the group code in the header. They scan the QR code or open the link.
If they already installed Split, it's quicker to open the app, tap the code chip in the header, and type the code under **Join another group**
(on iPhone, links always open in Safari instead of the installed app).

## Turn on GitHub Pages (once, by the repo owner)

Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**. After a minute, the link above works. Every push to `main` updates the app; phones get the new version the next time they open it with internet.

## AI and sync

- **Demo mode:** with no API key, scanning and restaurant search use built-in sample data (`js/fixtures/`), so the whole app can be shown without any setup.
- **Real AI (local):** put `GEMINI_API_KEY=...` in a `.env` file in the repo root and run `npm start`. The dev server sends AI calls to Gemini with that key, so it never reaches the browser. `.env` is gitignored; never commit a key to this repo.
- **Real AI (GitHub Pages):** there's no server there, so open **Settings** (gear icon) and paste a Gemini API key (from aistudio.google.com). Only the phone doing the scanning needs it. The key stays on that phone. A key in Settings also overrides `.env`.
- **Phones syncing live:** add a free Firebase Realtime Database config to `js/config.js` (steps in [TEAM.md](TEAM.md), Person 4). Until then, Split syncs between tabs on the same device only.

## Run it on your laptop

```bash
npm start            # serves the app at http://localhost:8080 (needs Node 20.12+)
npm test             # runs the logic tests (needs Node 18+)
```

No install step and no build: it's plain HTML, CSS and JavaScript modules. On `localhost`, the offline cache is turned off, so your edits show on reload. To test on your phone during development, use the GitHub Pages link, or run a tunnel like `npx localtunnel --port 8080`.

To pretend to be a second person on one laptop, open the app in a private/incognito window as well. Without Firebase, use a second tab instead (same person, but you can watch updates sync).

## Files

| Path | What it is |
| --- | --- |
| `index.html` | App shell: header, tabs, bottom nav |
| `js/app.js` | Startup, routing, Settings and Invite sheets |
| `js/screens/` | One file per tab: `group.js`, `planner.js`, `split.js`, `ledger.js` |
| `js/lib/` | The logic (fair split math, order planner, place ranking, ledger), tested in `tests/` |
| `js/reducer.js` | The shared group session and every action that changes it |
| `js/store.js`, `js/sync/` | Sends changes to every phone (Firebase) or this device only (localStorage) |
| `js/ai/` | Gemini calls: read a receipt, read a menu, search for restaurants |
| `js/fixtures/` | Sample data used in demo mode |
| `js/ui.js` | Shared helpers: escaping, money, toasts, bottom sheets, button styles |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable and work offline |
| `design/prototype.html` | The original UI mockup the app is styled on |

Who builds what is in **[TEAM.md](TEAM.md)**.
