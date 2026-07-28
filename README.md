# Larder — weekly meal planner

A small static web app: recipes with ingredients & steps, a pantry, a weekly meal
calendar (with leftovers tracking), an auto-generated shopping list, and per-ingredient
calorie tracking. Runs entirely client-side, data stored in Firebase.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it anything (e.g. `larder-app`) → finish the wizard.
2. In the left sidebar: **Build → Authentication → Get started**. On the "Sign-in method" tab, enable **Email/Password**.
3. In the left sidebar: **Build → Firestore Database → Create database**. Start in **production mode**, pick any region.
4. Go to **Project settings** (gear icon) → scroll to **Your apps** → click the **</>** (web) icon → register an app (nickname doesn't matter, no hosting needed) → copy the `firebaseConfig` object it shows you.

## 2. Configure the app

Open `firebase-config.js` and paste your values in:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

These values are meant to be public in a client-side app — they identify your project,
they don't grant access by themselves. Access is controlled by the Firestore rules below.

## 3. Lock down Firestore

In the Firebase console: **Firestore Database → Rules**, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**. This means each signed-in user can only ever read or write their own
`users/{their-uid}/...` data — nobody else's.

## 4. Run it locally (optional)

Any static file server works, e.g.:

```
npx serve .
```

Then open the printed localhost URL. Opening `index.html` directly via `file://` will
NOT work — Firebase's auth/module setup requires an http(s) origin.

## 5. Deploy to GitHub Pages

1. Create a new GitHub repo and push these files (`index.html`, `styles.css`, `app.js`, `firebase-config.js`) to the root of the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → **Save**.
3. GitHub gives you a URL like `https://yourname.github.io/your-repo/` after a minute or two.
4. Back in Firebase console: **Authentication → Settings → Authorized domains** → **Add domain** → add `yourname.github.io` (Firebase blocks auth from unrecognized domains by default).

That's it — visit your GitHub Pages URL, create an account (email/password, stored in
your own Firebase project), and start adding ingredients, recipes, and a week of meals.

## Mixed units in recipes (cups, tsp, oz, etc.)

Each ingredient has one "canonical" unit (set when you create it — e.g. Flour is tracked
in grams). When adding that ingredient to a recipe, you can pick *any* unit for that
row — cups, tbsp, tsp, ml, l, g, kg, oz, lb, or each. The shopping list automatically
converts every recipe's amount back to the ingredient's canonical unit and adds them
together, so "2 cups flour" in one recipe and "150 g flour" in another combine into a
single correct total.

Converting within the same family (any volume unit ↔ any other volume unit, or any
weight unit ↔ any other weight unit) always works automatically. Converting *between*
volume and weight (e.g. a recipe calls for "1 cup" of something you track in grams)
needs to know that ingredient's density — set the optional **grams per cup** field on
that ingredient (e.g. flour ≈ 120 g/cup, granulated sugar ≈ 200 g/cup — a quick web
search for "[ingredient] grams per cup" will give you a good value). If it's left blank
and a recipe mixes volume and weight for the same ingredient, the shopping list keeps
that amount as a separate line, clearly flagged, rather than silently combining it
incorrectly. "each" (whole items, like eggs) never converts to/from a measurement.

## Shopping mode

Click **Start Shopping** on the Shopping List tab while you're actually at the store.
Check off each item as you put it in your cart, then hit **Add checked items to pantry
& finish** — every checked item's quantity gets added to your Pantry automatically, and
since the shopping list is always computed as "what recipes need minus what's in your
pantry," purchased items disappear from the list on their own once they're covered.
Items flagged with a unit-mismatch warning aren't checkable this way (see above) — add a
density conversion first, or add them to your pantry manually on the Pantry tab.

## Store prices

Each ingredient now has an optional price-per-unit for Aldi, Kroger, and Giant Eagle —
enter what you know when you create/edit an ingredient. On the Shopping List tab, toggle
which of the three stores you're willing to shop at; for each item the app picks the
cheapest price among your enabled stores, shows which store that is, and totals
everything at the bottom (plus a per-store subtotal so you can see the split if you end
up shopping at more than one). Items with no price entered anywhere just show "no price
set" and aren't included in the total — there's no live price lookup, since none of these
chains publish a public price API and prices vary by your specific store location, so
you'll need to update prices yourself occasionally (e.g. after a store visit or checking
their app).

## How the data model works

- **Ingredients** are the master list: emoji, name, a unit (g, ml, each, etc.), and
  calories *per one unit*. Everything else (recipes, pantry, shopping list) references
  this list, so define an ingredient once and reuse it everywhere.
- **Recipes** store a base serving size and a list of `{ingredient, quantity}` pairs plus
  numbered steps. Calories per serving are computed automatically from the ingredients.
- **Pantry** is just "how much of each ingredient you currently have" — it's subtracted
  from the shopping list, not tied to any specific week.
- **Week Plan**: each day gets meals you add as either "Cook something" (pick a recipe,
  how many servings to batch-cook, how many you're eating that day — the rest becomes
  available as leftovers) or "Eat leftovers" (pick from any earlier cooked batch that
  still has servings remaining).
- **Shopping List** looks at every "Cook" meal scheduled in the visible week, scales each
  recipe's ingredients to the batch size, combines duplicate ingredients across recipes,
  and subtracts whatever's already in your pantry.

## Notes / limitations

- Quantities are simple numbers in one unit per ingredient — there's no automatic unit
  conversion (e.g. cups → grams), so keep a given ingredient's recipes consistent.
- Everything is scoped to one signed-in account; there's no multi-user sharing/collaboration.
