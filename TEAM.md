# Split: who does what

Four people, four parts. Each part has its own files, so you can all work at once without merge conflicts.
Every part already has a working first version (try it in demo mode, no setup needed). Your job at the hackathon is to make
your part work on real menus, receipts and phones, polish it, and own it in the demo.

| | Part | Your files | Your tab |
| --- | --- | --- | --- |
| **Person 1** | Fair Split (the demo hook) | `js/screens/split.js`, `js/lib/fairSplit.js`, `js/lib/payLinks.js`, `js/ai/receipt.js` (prompt), `js/fixtures/receipt.js` | Fair Split |
| **Person 2** | Order Planner + Live Tab | `js/screens/planner.js`, `js/lib/orderPlan.js`, `js/ai/menu.js` (prompt), `js/fixtures/menu.js` | Planner |
| **Person 3** | Group Finder + recommendations | `js/screens/group.js`, `js/lib/rankPlaces.js`, `js/ai/places.js` (prompts), `js/fixtures/places.js` | Group |
| **Person 4** | Ledger, sync, phone app, deploy, pitch | `js/screens/ledger.js`, `js/lib/ledger.js`, `js/fixtures/history.js`, `js/history.js`, `js/store.js`, `js/sync/`, `js/config.js`, `js/app.js`, `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | Ledger |

Each person also owns the tests for their logic: `tests/fairSplit.test.js` + `tests/payLinks.test.js` (1),
`tests/orderPlan.test.js` (2), `tests/rankPlaces.test.js` (3), `tests/ledger.test.js` + `tests/reducer.test.js` (4).

**Shared files.** Tell the group before changing these, because everyone depends on them:
`js/reducer.js` (the shared state and actions), `js/ui.js` (helpers and button styles), `js/scanner.js` (camera screen),
`js/ai/client.js` (the Gemini call), `js/router.js`, `js/tailwind-config.js`, `css/app.css`.

## How we work

1. Clone the repo. Each person works on a branch named after their part (`fair-split`, `planner`, `group`, `ledger`).
2. Run it: `npm start`, then open http://localhost:8080. Run the tests with `npm test` before you push.
3. Commit small and often. Merge into `main` often too. `main` is what GitHub Pages serves to everyone's phones.
4. Escape anything a person or the AI typed before putting it in HTML (`esc()` in `js/ui.js`). Names sync from other phones,
   and receipt text comes from a photo.
5. How a screen works: `mount(root)` runs once to wire up buttons; `render(root, state)` runs whenever anything changes.
   You change shared data with `store.dispatch({ type: 'receipt/claim', ... })`. Every action is listed in `js/reducer.js`.

---

## Person 1: Fair Split

**Already works:** receipt scan (demo or Gemini), tap "Mine" or split an item between people, editing items and totals when the
scan is wrong, tax/tip/service/discount split by item to the exact cent, tip buttons, choosing who paid, each person's
breakdown with a "how your share was worked out" line, "Budget vs reality", payment requests (share sheet with e-Transfer, PayPal and
Venmo links), **Request all**, **I've paid** (the payer can undo), coupons that make someone's share negative (the payer pays them back),
and Finish, which saves the meal to everyone's ledger. Claims carry over from the Planner's live tab. A service charge on the bill
means no extra tip by default.

**Next:**
- Scan 5 to 10 real receipts with an API key: Canadian GST/PST, one with an automatic gratuity, one with a coupon, and one with a comped item.
  Fix what the AI gets wrong by tuning the prompt in `js/ai/receipt.js`, and time how fast someone can fix a bad scan with the edit buttons.
- Two phones (after Person 4 sets up Firebase): claim items on both at the same moment and check the totals match to the cent.
- Try the payment buttons for real: put your PayPal.me and e-Transfer email in Settings, and have a friend tap them.
  Venmo is US only; consider hiding it unless the bill is in USD.
- Tune the name matching between live tab items and receipt lines (`MATCH` in `js/lib/fairSplit.js`) and add a test for each mismatch.

## Person 2: Order Planner + Live Tab

**Already works:** menu scan, budget-fitting order after tax and tip (Family spread or Individual plates), hunger levels, diet filters,
each person's own diet in Individual mode, a "Your group: vegetarian (Dana)…" hint with one-tap filter chips, an optional dessert,
value score ("feeds 3"), swapping a dish for a similar one at a similar price, and "Lock plan" into a live tab where anyone taps who's eating
what, with running totals per person that add up to the table total to the cent.

**Next:**
- Scan 3 or 4 real menus (one with sizes, one cafe with no mains, one with "for two" platters) and check Gemini gets the category, "serves"
  and diet tags right. Tune the prompt in `js/ai/menu.js`.
- Tune the numbers with the team: `HUNGER` and the repeat-dish penalty in `js/lib/orderPlan.js`. Rerun `node --test tests/orderPlan.test.js`.
- On a real phone: check that the budget and price boxes bring up the number keypad, and that chips wrap nicely with 6 to 8 people.
- Small gap: a dessert still counts toward "Portions" on the recommendation card.

## Person 3: Group Finder + recommendations

**Already works:** everyone's budget, cuisine, distance and diet (your own on your phone; add "guests" for friends without the app), AI web
search for real restaurants, ranking by how many people each place fully satisfies with a partial-credit match %, strict budget filter
with reasons, voting on every place (and "voting as" a guest), Google Maps links and "copy address", Lock winner (sends the place and
the group size to the Planner), and "places like ones you've loved" from the ledger.

**Next:**
- Add an API key and run a real search for the hackathon's city. Check the AI's cost per person and distances against Google Maps for a few
  places, then tune the prompts in `js/ai/places.js`.
- Add dish words your friends use to `SYNONYMS` in `js/lib/rankPlaces.js` (it already knows dim sum, poke, pad thai, biryani and more), with a test for each.
- Test voting with 2 to 4 phones once sync is on: votes and the winner should agree on every phone.
- Demo tip: set one friend's budget to $20 so a place drops into "Over someone's budget" with the reason shown.

## Person 4: Ledger, sync, phone app, deploy, pitch

**Already works:** the Ledger tab (who owes who across meals, mark settled, pay buttons, **Remind**, who pays next, saved-vs-plan,
monthly spending chart, meal history with per-person shares, delete), paid flags that stay in step with the Fair Split tab for the
group's current meal, the app shell, invite QR code and join link, Settings, installable phone app (manifest, icons, offline cache),
and Firebase sync, which was tested with two browser "phones" against Firebase's local emulator: 12 claims tapped at the same moment all landed.

**First thing to do (about 10 minutes): turn on live sync between phones.**
1. Go to https://console.firebase.google.com, **Add project** (Analytics not needed).
2. **Build → Realtime Database → Create database**, pick the closest location, choose **Start in test mode**.
3. On the **Rules** tab, paste this and **Publish**:
   ```json
   { "rules": { "sessions": { "$code": { ".read": true, ".write": true } } } }
   ```
4. **Project settings** (gear) → **Your apps** → **Web** (`</>`) → register "split" → copy the `firebaseConfig` object.
   Make sure it has a `databaseURL` line (copy it from the Realtime Database page if it's missing).
5. Paste it into `js/config.js` as `export const FIREBASE_CONFIG = { ... };`, then commit and push. This config is safe to commit;
   the rules decide who can read or write.

   Anyone with a group code can read and write that group. That's fine for a hackathon; "Firebase Auth + tighter rules" goes on the future-work slide.

**Then:**
- Turn on GitHub Pages (the repo owner does this once; steps are in README.md) and install the app on an iPhone and an Android phone.
- Do one real meal end to end with the team and check the meal shows up in everyone's Ledger with the right shares and payer.
- Run the demo on bad Wi-Fi: the app still opens offline, and demo mode (no key) is the backup if the AI or internet fails.
- Own the pitch and the demo script below.
- Stretch: sync "mark settled" between phones (right now each phone keeps its own ledger).

---

## Demo script (about 2 minutes)

1. **Group (Person 3):** "Four of us, four phones." Everyone joins by scanning the QR code in the header. Show the budgets and diets, tap
   **Find places for everyone**, point out the strict budget filter and the reasons, everyone votes on their own phone, **Lock winner**.
2. **Planner (Person 2):** "4 people, $80." Snap the real menu. The order comes back already fitting after tax and tip.
   Swap one dish, then **Lock plan & start live tab**.
3. **Fair Split (Person 1):** pull out a real crumpled receipt and scan it live. Teammates tap their items on their own phones *at the same
   moment*. Show that the salad person pays less tax and tip than the steak person, then the payment requests, and
   "you came in $X under budget".
4. **Ledger (Person 4):** the meal lands in everyone's ledger, who owes who, who pays next. Close with "no app store: it's a link you add to
   your home screen, on iPhone and Android."

**Edge cases to mention to judges:** discounts and coupons spread proportionally; a service charge already on the bill means no double tip; comped
items cost nothing; shared items split to the exact cent (the cents always add up to the bill).

**Backup plan:** if the AI or Wi-Fi fails, remove the API key in Settings. Demo mode runs the same flow on sample data.

## Future work (slide)

- Move AI calls behind a small server so the API key never sits on a phone.
- Accounts and a shared ledger that syncs between phones; Firebase Auth with tighter database rules.
- Real payment requests through a bank or payments partner (Interac Request Money).
- Restaurant data from a places API, with menus and live prices.
