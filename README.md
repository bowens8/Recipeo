# Recipeo — weekly meal planner

A small static web app: recipes with ingredients & steps, a pantry, a weekly meal
calendar (with leftovers tracking), an auto-generated shopping list, and per-ingredient
calorie tracking. Runs entirely client-side, data stored in Firebase.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it anything (e.g. `recipeo-app`) → finish the wizard.
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

## Searchable ingredient picker

Everywhere you pick an ingredient from your library — adding an ingredient to a recipe,
or picking one for a Quick item — it's a type-to-search box instead of a long dropdown.
Click it to browse everything, or start typing to filter by name. Selecting one fills in
its icon and name; if you type something and click away without picking a result, it
reverts rather than leaving a half-typed, invalid selection.

## Faster ingredient entry: autofill & bulk add

Recipeo ships with a built-in database of ~100 common pantry staples, produce, proteins,
dairy, spices, and condiments — entirely local, no external API or key involved. Two ways
it saves you typing:

- **Autofill while creating an ingredient** — start typing a name that matches (e.g.
  "chicken breast", "garlic", "olive oil") and a suggestion banner offers to fill in the
  emoji, unit, and calories for you. Only appears for brand-new ingredients, never
  overwrites an existing one, and you can always adjust anything after applying it.
- **Quick add multiple** (Ingredients tab) — paste a list of names, one per line or
  comma-separated, and hit Add. Anything Recipeo recognizes gets fully autofilled;
  anything it doesn't still gets created (with a shopping-cart emoji and 0 calories) so
  you can fill in the rest later. Names that already exist in your library are skipped
  automatically. Handy for seeding your whole pantry at once instead of one ingredient
  at a time.

Both features use the same built-in list — if you paste "bell pepper, cheddar cheese,
lemon" you'll get all three fully filled in immediately.

## Meal types, and quick (non-recipe) items

Every meal you add to the Week Plan now gets a type — Breakfast 🍳, Lunch 🥪, Dinner 🍽️,
or Snack 🍿 — shown as an icon right on its chip so a day's plan is readable at a glance.

For things that aren't really a "recipe" — cereal, coffee, a piece of fruit — use the
**Quick item** option (alongside "Cook something" and "Eat leftovers") when adding a
meal. Pick an ingredient straight from your Ingredients tab and how much, no recipe
needed. Quick items count toward that day's calories and toward the shopping list
exactly like a recipe ingredient would, combining with any of the same ingredient used
in actual recipes that week.

## Cook Mode

Click **🍳 Cook this** on any recipe card for a full-screen, distraction-free view for
actually cooking: a checklist of everything to gather (tap to check off as you pull
things out), followed by the recipe's steps as large, easy-to-read cards you scroll
through — including step photos if you added any. Nothing here is saved; it's just a
clean read-only view for while you're at the stove.

## Custom units (e.g. cloves ↔ bulbs)

Some ingredients don't fit g/kg/ml/l/cup/tbsp/tsp/oz/lb/each at all — garlic bulbs, bunches
of scallions, cans of something, whatever. On an ingredient's Unit dropdown, pick **Custom
unit…** and name it (e.g. "clove") — that becomes this ingredient's own unit, used as the
reference for its calories.

Underneath that, **Custom units** lets you define other units recipes might use for this
ingredient, in either direction:
- **smaller** — e.g. "pinch", where several of them make up 1 of the ingredient's own unit
- **larger** — e.g. "bulb", where 1 of them is worth several of the ingredient's own unit
  (say, 10 cloves)

Recipes can then pick any of these units directly from that ingredient's unit dropdown,
and the shopping list converts and combines everything from every recipe automatically.

**Pricing in the larger unit:** once you've defined at least one "larger" custom unit,
every store's price row in that ingredient's Pricing section grows an extra dropdown so
you can price it per that larger unit instead of per the base unit — e.g. price Garlic
per bulb ($0.99/bulb at Kroger) even though the base unit is clove and recipes call for
cloves. Combine this with "Sold in fixed-size packages" and a package size of 1, and the
shopping list will total up all the cloves needed across your recipes, convert to bulbs,
round up to whole bulbs, and price it correctly — with any leftover cloves from rounding
up credited straight to your pantry once you check it off while shopping.

A given ingredient's custom units are only ever visible/usable on that specific
ingredient — they don't leak into any other ingredient's unit list.

## Mixed units in recipes (cups, tsp, oz, etc.) — combined automatically

Each ingredient has one reference unit (set when you create it — e.g. Flour is tracked
in grams, just as a reference for its calories). When adding that ingredient to a
recipe, pick whatever unit the recipe actually uses for that row — cups, tbsp, tsp, ml,
l, g, kg, oz, lb, or each.

On the Shopping List, quantities from different recipes are combined automatically with
**no setup required**: any volume amounts (tsp/tbsp/cup/ml/l) combine together, and any
weight amounts (g/kg/oz/lb) combine together, then the app picks whichever size actually
makes sense to see on a list — "3 lb" instead of "1360 g", "2 cups" instead of "32 tbsp"
— leaning metric or US customary based on which system that ingredient's reference unit
uses. There's nothing to fill in for this to work.

The one thing that's genuinely not possible to auto-combine without help: if the *same
ingredient* is measured by weight in one recipe and by volume in another (e.g. one
recipe says "2 cups flour", another says "150 g flour"), there's no universal
conversion between weight and volume — it depends on the ingredient's density. For that
specific situation, each ingredient has an optional **grams per cup** field (leave it
blank for everything else) — set it once on that ingredient (e.g. honey ≈ 240 g/cup,
flour ≈ 120 g/cup — a quick web search for "[ingredient] grams per cup" gives a good
number) and mismatched amounts for that ingredient will combine correctly from then on.
Until it's set, those amounts show up as a separate, clearly flagged line instead of
being silently combined incorrectly. "each" (whole items, like eggs) never mixes with a
measurement either way.

## Photos

Ingredients can use a small uploaded photo instead of an emoji (Ingredients tab → Or
upload a photo), and recipes can have a cover photo plus a photo per step (Recipes tab →
open/create a recipe) — each with a crop-and-zoom step before saving. The ingredient
photo crops to a square (it's used as a small icon), but recipe cover and step photos
can be cropped to **any rectangle** — drag the corner handles freely, there's no locked
aspect ratio. Photos are automatically resized and compressed in your browser before
saving, and stored directly alongside the rest of your data in Firestore — there's no
separate file-storage service to set up (Firebase's file storage product now requires a
paid billing plan; keeping images inline in Firestore avoids that entirely on the free
tier). Because of this, keep photos reasonable: a recipe with a cover photo and a photo
on every single step could approach Firestore's 1&nbsp;MB per-document limit if you have
many steps — if you ever hit that, drop a couple of step photos.

## Shopping mode

Click **Start Shopping** on the Shopping List tab while you're actually at the store.
Check off each item as you put it in your cart, then hit **Add checked items to pantry
& finish** — every checked item's quantity gets added to your Pantry automatically, and
since the shopping list is always computed as "what recipes need minus what's in your
pantry," purchased items disappear from the list on their own once they're covered.
Items flagged with a unit-mismatch warning (see above) aren't checkable this way — add
them to your pantry manually on the Pantry tab instead.

## Store prices

Each ingredient now has optional pricing for Aldi, Kroger, and Giant Eagle — enter what
you know when you create/edit an ingredient. On the Shopping List tab, toggle which of
the three stores you're willing to shop at; for each item the app picks the cheapest
option among your enabled stores, shows which store that is, and totals everything at
the bottom (plus a per-store subtotal so you can see the split if you end up shopping at
more than one). Items with no price entered anywhere just show "no price set" and aren't
included in the total — there's no live price lookup, since none of these chains publish
a public price API and prices vary by your specific store location, so you'll need to
update prices yourself occasionally (e.g. after a store visit or checking their app).

**Packaged items** — check "Sold in fixed-size packages" on an ingredient (a box of
pasta, a block of cheese, a bag of flour — anything you can't buy in an exact amount) and
enter each store's **package size** alongside its price (in that ingredient's unit — e.g.
Kroger: $2.50, 8 oz). The shopping list then rounds up to the number of whole packages
you'd actually need to buy and prices it accordingly (2 packages of an 8&nbsp;oz block to
cover 12&nbsp;oz needed, not a fractional 1.5) — and shows a small "need 12 oz" note right
underneath, so you can always see the actual amount a recipe calls for alongside the
rounded-up purchase. Whatever's left over from rounding up gets credited straight to your
pantry the moment you check that item off in Shopping Mode, so next week's shopping list
already knows about it. Leave the box unchecked for anything bought as an exact amount
(deli meat sliced to order, produce sold by weight, etc.) — those price per unit as
before, with no rounding.

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
