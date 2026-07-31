# RecipeMe — weekly meal planner

A small static web app: recipes with ingredients & steps, a pantry, a weekly meal
calendar (with leftovers tracking), an auto-generated shopping list, and per-ingredient
calorie tracking. Runs entirely client-side, data stored in Firebase.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it anything (e.g. `recipeme-app`) → finish the wizard.
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
    // Ingredients and Recipes are shared: any signed-in user can read and write them —
    // that's the whole point, so everyone using this planner shares one library.
    match /shared_ingredients/{ingredientId} {
      allow read, write: if request.auth != null;
    }
    match /shared_recipes/{recipeId} {
      allow read, write: if request.auth != null;
    }
    // Everything else (pantry, week plan, personal store-price toggles) stays private
    // to each account.
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**. Ingredients and Recipes are now shared — anyone with an account on
this planner can see and edit the same library. Everything under `users/{their-uid}/...`
(pantry, week plan, store-price preferences) stays private to that one account, same as
before.

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

## Import detailed ingredient data from text

Click **📄 Import detailed data** on the Ingredients tab for a more precise format aimed
at nutrition/pricing data sheets rather than casual entry — paste or upload one or more
`INGREDIENT` blocks like this:

```
INGREDIENT
name: Jasmine Rice
grocery_aisle: Pantry & Dry Goods
UNIT_INFORMATION
standard_unit: cup_cooked
standard_unit_weight_g: 158
calories_per_standard_unit: 205
DENSITY_CONVERSION
grams_per_cup_dry: 185
grams_per_cup_cooked: 158
PACKAGE_INFORMATION
common_package_unit: bag
units_per_package: 1
package_weight_g: 2268
PRICE_INFORMATION
ALDI
package_price: 4.99
package_size_g: 2268
KROGER
package_price: 5.99
package_size_g: 2268
GIANT_EAGLE
package_price: 6.49
package_size_g: 2268
```

Paste as many `INGREDIENT` blocks as you like in one file — each is its own ingredient.
This maps directly onto features already in the app, with no separate system underneath:

- The ingredient's base unit becomes grams, and `calories_per_standard_unit ÷
  standard_unit_weight_g` becomes its calories-per-gram.
- `grocery_aisle` (optional) sets which section of the shopping list's "Grocery aisle"
  grouping this ingredient lands in — must exactly match one of the categories listed in
  that section above. Omit it and the app guesses from the name instead.
- Every `grams_per_X` line under `DENSITY_CONVERSION` becomes a **custom unit** — exactly
  the same custom-unit system used for things like cloves/bulbs — so "cup_dry" and
  "cup_cooked" both become real units you can pick when adding this ingredient to a
  recipe, each converting to grams correctly on its own.
- `PACKAGE_INFORMATION` turns on "sold in fixed-size packages" automatically, and each
  store under `PRICE_INFORMATION` becomes that store's price + package size — store
  names are matched case-insensitively (`GIANT_EAGLE` → Giant Eagle, etc.).

You'll see a preview first — a name that matches an existing ingredient gets **updated**
(its unit/calories/custom units/pricing get replaced with the imported values) rather
than creating a duplicate, so re-importing an updated price sheet is safe to do anytime.
Each card in the preview also has an optional **photo** field (same crop-and-zoom step as
everywhere else) — leave it alone and an existing ingredient's photo/emoji stay
untouched; upload one and it takes priority over whatever was already there.

## Import a recipe from text

Don't have the text yet? Open **📄 Import from text** and expand "Don't have the text
yet?" right in the modal — it has a ready-to-copy prompt you can hand to Claude along
with a recipe URL, and paste back whatever it sends you. (The ingredient importer below
has the same thing, for researching nutrition + store pricing from a URL or just a
name.) Full explanation of why that's more reliable than in-app URL fetching is in
`import-prompts.md` alongside these files, if you want the background.

Click **📄 Import from text** on the Recipes tab to skip manual entry entirely — paste
recipe text (or upload a `.txt` file) in this exact format and it builds the whole
recipe for you:

```
TITLE
Recipe Name
SERVINGS
4
INGREDIENTS
- 1 cup flour
- 2 eggs
PANTRY ITEMS
- Salt
- Pepper
INSTRUCTIONS
1. First step.
2. Second step.
```

Section headers (`TITLE`, `SERVINGS`, `INGREDIENTS`, `PANTRY ITEMS`, `INSTRUCTIONS`) each
go on their own line; ingredient lines start with `- `; steps are numbered. `PANTRY
ITEMS` is optional and gets folded into the recipe's ingredient list right alongside
`INGREDIENTS` — it's just a way of grouping the staples you probably already have
separately from the main shopping items in your source text.

It understands fractions ("1/4 cup"), decimals ("7.2 g"), and plain counts with no unit
("2 scallions" → each). Lines with no amount at all (just "Salt", "Pepper") get a small
placeholder amount using that ingredient's usual unit if it's a recognized common
ingredient — editable afterward like anything else.

You'll see a preview before anything is created — every ingredient name is matched
against your existing library first; anything that doesn't already exist gets created
automatically (autofilled from the same built-in database used for Quick Add, where it
recognizes the name). The preview also has an optional **cover photo** field (with the
same crop-and-zoom step as everywhere else in the app) if you want to attach one before
importing. Every row marked "new ingredient" also gets its own optional **photo**
upload (same crop-and-zoom step) — attach one right there instead of having to go find
and edit the ingredient afterward. Click **Import recipe** to confirm.

**Full ingredient data in the same paste.** After the `INSTRUCTIONS` section, you can
append one or more `INGREDIENT` blocks — the exact same detailed format the ingredient
importer uses (see below), one per ingredient in the recipe. Any ingredient line whose
name matches one of these blocks (exact or close enough) gets created with real
calories, pricing, and grocery-aisle data instead of a blank placeholder — the preview
shows a **"new — full data"** badge and a summary line for these. The built-in prompt
(open "Don't have the text yet?" in the importer) already asks Claude to research and
include this for every ingredient, so this happens automatically if you use it — no
extra step. Ingredients without a matching block still fall back to the common-database
autofill exactly as before.

Any row marked "new ingredient" also gets a **"Create new ingredient" / "Use an existing
ingredient instead"** toggle — handy when the recipe's wording doesn't quite match
something already in your library (e.g. the text says "chicken cutlets" but you already
have "Chicken Breast Cutlets"). Switch it to the second option and search for the real
one instead of ending up with a near-duplicate.

Ingredients that do get auto-created without a recognized match or detailed data block
(no real calories, no price — just a placeholder) show up with a **red "⚠️ needs data"
warning** on the Ingredients tab afterward, so they're easy to spot and go fill in. The
warning clears the moment you open and save that ingredient, whether or not you
actually change anything — saving it is how you tell the app "reviewed."

## Searchable ingredient picker

Everywhere you pick an ingredient from your library — adding an ingredient to a recipe,
or picking one for a Quick item — it's a type-to-search box instead of a long dropdown.
Click it to browse everything, or start typing to filter by name. Selecting one fills in
its icon and name; if you type something and click away without picking a result, it
reverts rather than leaving a half-typed, invalid selection.

## Data completeness at a glance

Every row on the Ingredients tab has a small colored status dot on the right:

- 🔴 **Red** — the core data is missing (no calories set). This is the same signal as
  the "⚠️ needs data" warning on auto-created ingredients, shown as a dot here too.
- 🟡 **Yellow** — calories are set, but it's missing a price at one or more of your
  three stores.
- 🟢 **Green** — fully filled in: calories, plus a price at Aldi, Kroger, *and* Giant
  Eagle.

Hover any dot for a specific reason (e.g. "Missing a price at: Giant Eagle").

## Sorting the ingredient library

The **Sort by** dropdown on the Ingredients tab reorders the list — alphabetically
(A–Z or Z–A), by when it was added (newest or oldest first), by calories (high–low
or low–high), or **Grocery aisle** — the same store-section grouping used on the
shopping list (Produce, Meat & Seafood, Dairy & Eggs, etc., with a header for each),
using the same automatic guess (or manual override) described below. Ingredients that
already existed before this feature was added get a
one-time automatic backfill the first time you sign in after updating, so date sorting
works for them too — it's not their real historical creation date (there's no way to
recover that), but it gives them a stable, consistent order instead of Recently/Oldest
Added doing nothing for your existing library.

## Faster ingredient entry: autofill & bulk add

RecipeMe ships with a built-in database of ~100 common pantry staples, produce, proteins,
dairy, spices, and condiments — entirely local, no external API or key involved. Two ways
it saves you typing:

- **Autofill while creating an ingredient** — start typing a name that matches (e.g.
  "chicken breast", "garlic", "olive oil") and a suggestion banner offers to fill in the
  emoji, unit, and calories for you. Only appears for brand-new ingredients, never
  overwrites an existing one, and you can always adjust anything after applying it.
- **Quick add multiple** (Ingredients tab) — paste a list of names, one per line or
  comma-separated, and hit Add. Anything RecipeMe recognizes gets fully autofilled;
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

## Baking tab

A separate **Baking** tab works identically to Recipes — same shared ingredient
library, same Cook Mode, same importer, same favorites, same missing-ingredients
check — it's just a different bucket. Check **"This is a baking recipe"** on a
recipe's edit screen to move it there instead of the main Recipes tab (creating from
the Baking tab's own "+ New baking recipe" button checks this automatically, and
importing from its "📄 Import from text" button tags the result the same way).

## Favorites & sorting recipes

Tap the ♥ on any recipe card to favorite it (turns red) — favorites are yours alone,
not shared with everyone else using this planner. The **Sort by** dropdown on the
Recipes tab reorders the list: alphabetically, favorites first, calories (low–high), or
**fewest missing from pantry** — handy for "what can I basically make right now?"

## Cook Mode

Today's meals stand out on the Week Plan — their chips get a brick-colored highlight so
it's obvious what's actually on deck, and every "cook" meal gets a **🍳 Cook this**
button right on the chip for one tap straight into Cook Mode, no need to open the meal
first. (Clicking anywhere else on the chip still opens it for editing, same as before.)

Every recipe card has two buttons: **📄 Overview** and **🍳 Cook this**.

**Overview** is a simple single-screen read view — ingredients and steps listed plainly,
like reading a recipe off a page, no checklists or interaction. Good for a quick glance
or reading through before you start.

**Cook this** is the full-screen, distraction-free mode for actually cooking: a
checklist of everything to gather (tap to check off as you pull things out), followed by
the recipe's steps as large, easy-to-read cards you scroll through — including step
photos if you added any. Nothing in either view is saved; they're just read-only ways to
look at a recipe.

The Cook button checks your Pantry first. If everything the recipe needs (at its base
servings) is already in stock, it's the normal button. If you're short on anything, it
grays out and relabels itself "⚠️ Missing N items" — clicking it still works, but shows a
popup listing exactly what's short and by how much, with a choice to **Cancel** or **Cook
anyway** (useful if you're planning to grab something on the way home, or just don't keep
your pantry perfectly up to date). "Cook anyway" always opens Cook Mode regardless of
what's missing — the pantry check is just a heads-up, never a hard block.

At the bottom of Cook Mode, **✅ I cooked this — remove ingredients from pantry** subtracts
that recipe's ingredients (at its base servings) from your Pantry in one tap, so you don't
have to go update quantities by hand after every meal.

## Spices

A dedicated tab for a common case: spices you don't measure precisely week to week, and
blends made by mixing several of them together.

**Base spices** — mark any ingredient "This is a spice" (in its regular editor) and it
shows up on the Spices tab with a simple **✅ Have it / 🛒 Need to buy** toggle instead of
a quantity — spices don't run out the way produce does, so tracking an exact amount
usually isn't worth the trouble.

**Spice blends** — click **+ New spice blend** to define a mix (e.g. Taco Seasoning = 2
tsp chili powder + 1 tsp cumin + 1 tsp paprika), picking the unit it's stored/used in
(tsp, tbsp, cup, g, oz) and adding base spices with amounts. You'll see a live "makes
about X total" preview as you go.

A blend is really just a regular ingredient under the hood — which means it's
automatically usable **anywhere** any other ingredient is: search for it directly in any
recipe ("2 tbsp Taco Seasoning"), add it as a Quick item, track it in your pantry, and so
on. The one thing that's special about it: wherever a recipe calls for some amount of a
blend — Cook Mode, Recipe Overview, and the Shopping List — a **"Mix together:"** note
appears underneath, showing exactly how much of each base spice that amount works out to,
scaled proportionally. Need 2 tbsp of a blend that makes 1⅓ tbsp per batch? It'll show
you 1.5× everything in the recipe automatically — no manual math.

## Ingredients bought by count, referenced by weight or volume

Some ingredients (an onion, an egg, a bell pepper) are naturally bought "each," but
recipes sometimes call for them by weight or volume instead ("1 onion" in one recipe,
"150 g onion" or "1 cup diced onion" in another). Set **Grams per each** on the
ingredient (how much one whole item weighs) to bridge "each" to weight — and if you also
want volume amounts like cups to combine correctly, set **Grams per cup** too, since
weight is what connects the two. Without Grams per each, "each"-based ingredients can't
convert to weight or volume at all, so a recipe using the wrong unit for one will show
up as unconverted on the shopping list even with Grams per cup filled in.

## Sorting the shopping list

The **Sort by** dropdown above the shopping list has three options: **Recommended**
(the default order), **Alphabetical**, or **Grocery aisle** — groups everything into
sections roughly matching a store's layout (Produce, Meat & Seafood, Dairy & Eggs,
Bakery, Frozen, Pantry & Dry Goods, Canned Goods, Condiments & Sauces, Spices &
Seasonings, Beverages, Other) in that walking order, with a header for each section.

The category is guessed automatically — spices/blends always land in Spices &
Seasonings (using the flag already set on the Spices tab), everything else is guessed
from the ingredient's name. If a guess is wrong, set **Grocery aisle** on that
ingredient's edit screen to override it permanently. The detailed data importer (see
below) can also set this directly via a `grocery_aisle` line, which takes priority over
the automatic guess — the prompt built into that importer already asks for it.

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
**no setup required**: any volume amounts (tsp/tbsp/fl oz/cup/ml/l) combine together, and any
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

Each item gets a small **"add \_\_\_ to pantry"** field once you're in Shopping Mode,
pre-filled with the suggested amount — but it's editable. If the store didn't have the
package size you expected (their 12 oz block was actually a 16 oz one, say), just type
the real number before checking it off; that's what actually gets credited to your
pantry, not the original estimate.

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

Amounts under about 0.05 (in an ingredient's own unit) are treated as negligible
everywhere — both when deciding whether a tiny overage forces an extra package (see
above), and when deciding whether something needs to show up on the shopping list at
all. So if a recipe needs 8.01 oz of something sold in 8 oz packages, buying that one
package and checking it off doesn't leave a phantom "0.01 oz still needed" line behind
next time you look — it's just done.

## Multiple people, one shared library

Anyone can create their own account (Sign in screen → Create account) — this is meant
for a household, roommates, or a family to share.

- **Shared with everyone who has an account:** Ingredients and Recipes. Anyone adds or
  edits an ingredient or recipe, everyone sees it. One communal library instead of each
  person rebuilding their own.
- **Private to each account:** Pantry, Week Plan (and which stores you shop from). What
  you have on hand and what you're planning to eat is yours — nobody else's account
  affects it, and you don't see anyone else's.

If you already had recipes/ingredients saved from before this existed, they migrate into
the shared library automatically the first time you sign in after updating — no action
needed, and nothing is deleted in the process (see `## 3. Lock down Firestore` above for
the security rules that make the sharing possible).

## How the data model works

- **Ingredients** are the master list: emoji, name, a unit (g, ml, each, etc.), and
  calories *per one unit* — shared across every account. Everything else (recipes,
  pantry, shopping list) references this list, so define an ingredient once and reuse it
  everywhere, for everyone.
- **Recipes** store a base serving size and a list of `{ingredient, quantity}` pairs plus
  numbered steps — also shared. Calories per serving are computed automatically from the
  ingredients.
- **Pantry** is just "how much of each ingredient you currently have" — private per
  account, subtracted from that account's shopping list, not tied to any specific week.
- **Week Plan**: private per account. Each day gets meals you add as either "Cook
  something" (pick a recipe, how many servings to batch-cook, how many you're eating
  that day — the rest becomes available as leftovers), "Eat leftovers" (pick from any
  earlier cooked batch that still has servings remaining), or "Quick item" (a bare
  ingredient like coffee or cereal, no recipe needed).
- **Shopping List** looks at every "Cook" meal and Quick item scheduled in that
  account's visible week, scales each recipe's ingredients to the batch size, combines
  duplicate ingredients across recipes, and subtracts whatever's already in that
  account's pantry.

## Notes / limitations

- Quantities are simple numbers in one unit per ingredient (with the custom-unit system
  bridging different units where you set it up) — see the Custom units and Mixed units
  sections above.
- Anyone with an account can edit or delete any shared ingredient or recipe — there's no
  per-item ownership or edit history, so it works best for a small trusted group (a
  household) rather than a large public group.
