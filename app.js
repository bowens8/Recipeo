import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ============================================================
   STATE
   ============================================================ */
const state = {
  uid: null,
  ingredients: {},   // id -> {name, emoji, unit, calories}
  recipes: {},       // id -> {name, baseServings, ingredients:[{ingredientId,qty}], steps:[]}
  pantry: {},         // ingredientId -> {qty}
  mealPlan: {},       // id -> {date, type, recipeId, batchServings, eatenServings, sourceMealId}
  favorites: {},       // recipeId -> true, per-account (not shared — everyone's favorites are their own)
  weekStart: startOfWeek(new Date()),
  shoppingMode: false,   // transient, not persisted
  unsubs: [],
  editing: { recipeId: null, ingredientId: null, mealId: null, mealDate: null }
};

const UNIT_LABEL = { g:"g", kg:"kg", ml:"ml", l:"L", cup:"cup", tbsp:"tbsp", tsp:"tsp", floz:"fl oz", each:"each", oz:"oz", lb:"lb" };
const STORES = ["Aldi", "Kroger", "Giant Eagle"];
const MEAL_TYPE_ICON = { breakfast:'🍳', lunch:'🥪', dinner:'🍽️', snack:'🍿' };
const MEAL_TYPE_LABEL = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack' };

// Built-in starting-point data for common ingredients: emoji, a sensible default unit,
// and calories PER THAT UNIT (matching the app's own convention — e.g. per 1 gram, not
// per 100g). Entirely local — no external API, no key, no network required — so
// autofill and bulk-add both work offline. Values are reasonable averages meant as a
// starting point; people can always edit any field after autofilling.
const COMMON_INGREDIENTS = {
  // proteins
  "chicken breast": { emoji:"🍗", unit:"g", calories:1.65 },
  "chicken thigh": { emoji:"🍗", unit:"g", calories:2.09 },
  "ground beef": { emoji:"🥩", unit:"g", calories:2.54 },
  "steak": { emoji:"🥩", unit:"g", calories:2.71 },
  "bacon": { emoji:"🥓", unit:"g", calories:5.41 },
  "salmon": { emoji:"🐟", unit:"g", calories:2.08 },
  "shrimp": { emoji:"🍤", unit:"g", calories:0.99 },
  "tuna": { emoji:"🐟", unit:"g", calories:1.32 },
  "egg": { emoji:"🥚", unit:"each", calories:72 },
  "tofu": { emoji:"🍱", unit:"g", calories:0.76 },
  "sausage": { emoji:"🌭", unit:"g", calories:3.01 },
  "ham": { emoji:"🍖", unit:"g", calories:1.45 },
  "turkey": { emoji:"🦃", unit:"g", calories:1.89 },
  "pork chop": { emoji:"🥩", unit:"g", calories:2.31 },
  // dairy
  "milk": { emoji:"🥛", unit:"cup", calories:149 },
  "whole milk": { emoji:"🥛", unit:"cup", calories:149 },
  "butter": { emoji:"🧈", unit:"tbsp", calories:102 },
  "cheddar cheese": { emoji:"🧀", unit:"g", calories:4.03 },
  "mozzarella": { emoji:"🧀", unit:"g", calories:2.80 },
  "parmesan": { emoji:"🧀", unit:"g", calories:4.31 },
  "cream cheese": { emoji:"🧀", unit:"oz", calories:99 },
  "yogurt": { emoji:"🥣", unit:"cup", calories:149 },
  "greek yogurt": { emoji:"🥣", unit:"cup", calories:100 },
  "sour cream": { emoji:"🥄", unit:"tbsp", calories:23 },
  "heavy cream": { emoji:"🥛", unit:"tbsp", calories:52 },
  "half and half": { emoji:"🥛", unit:"tbsp", calories:20 },
  // produce
  "onion": { emoji:"🧅", unit:"each", calories:44 },
  "garlic": { emoji:"🧄", unit:"each", calories:4 },
  "tomato": { emoji:"🍅", unit:"each", calories:22 },
  "potato": { emoji:"🥔", unit:"each", calories:163 },
  "sweet potato": { emoji:"🍠", unit:"each", calories:112 },
  "carrot": { emoji:"🥕", unit:"each", calories:25 },
  "bell pepper": { emoji:"🫑", unit:"each", calories:24 },
  "broccoli": { emoji:"🥦", unit:"g", calories:0.34 },
  "spinach": { emoji:"🥬", unit:"g", calories:0.23 },
  "lettuce": { emoji:"🥬", unit:"g", calories:0.15 },
  "cucumber": { emoji:"🥒", unit:"each", calories:45 },
  "avocado": { emoji:"🥑", unit:"each", calories:240 },
  "lemon": { emoji:"🍋", unit:"each", calories:17 },
  "lime": { emoji:"🍋", unit:"each", calories:20 },
  "banana": { emoji:"🍌", unit:"each", calories:105 },
  "apple": { emoji:"🍎", unit:"each", calories:95 },
  "orange": { emoji:"🍊", unit:"each", calories:62 },
  "mushroom": { emoji:"🍄", unit:"g", calories:0.22 },
  "corn": { emoji:"🌽", unit:"each", calories:88 },
  "celery": { emoji:"🥬", unit:"each", calories:6 },
  "zucchini": { emoji:"🥒", unit:"each", calories:33 },
  "cauliflower": { emoji:"🥦", unit:"g", calories:0.25 },
  "green onion": { emoji:"🧅", unit:"each", calories:5 },
  "jalapeno": { emoji:"🌶️", unit:"each", calories:4 },
  "cilantro": { emoji:"🌿", unit:"g", calories:0.23 },
  "parsley": { emoji:"🌿", unit:"g", calories:0.36 },
  "ginger": { emoji:"🫚", unit:"g", calories:0.80 },
  // grains / pantry
  "rice": { emoji:"🍚", unit:"g", calories:3.65 },
  "pasta": { emoji:"🍝", unit:"g", calories:3.71 },
  "flour": { emoji:"🌾", unit:"g", calories:3.64 },
  "all purpose flour": { emoji:"🌾", unit:"g", calories:3.64 },
  "sugar": { emoji:"🍬", unit:"g", calories:3.87 },
  "brown sugar": { emoji:"🍬", unit:"g", calories:3.80 },
  "bread": { emoji:"🍞", unit:"each", calories:75 },
  "oats": { emoji:"🌾", unit:"g", calories:3.89 },
  "cereal": { emoji:"🥣", unit:"g", calories:3.79 },
  "tortilla": { emoji:"🫓", unit:"each", calories:140 },
  "quinoa": { emoji:"🍚", unit:"g", calories:3.68 },
  "breadcrumbs": { emoji:"🍞", unit:"g", calories:3.95 },
  "baking powder": { emoji:"🧁", unit:"tsp", calories:2 },
  "baking soda": { emoji:"🧁", unit:"tsp", calories:0 },
  // oils / condiments
  "olive oil": { emoji:"🫒", unit:"tbsp", calories:119 },
  "vegetable oil": { emoji:"🛢️", unit:"tbsp", calories:124 },
  "mayonnaise": { emoji:"🥪", unit:"tbsp", calories:94 },
  "ketchup": { emoji:"🍅", unit:"tbsp", calories:15 },
  "mustard": { emoji:"🌭", unit:"tbsp", calories:9 },
  "soy sauce": { emoji:"🍶", unit:"tbsp", calories:8 },
  "honey": { emoji:"🍯", unit:"tbsp", calories:64 },
  "maple syrup": { emoji:"🍁", unit:"tbsp", calories:52 },
  "vinegar": { emoji:"🍶", unit:"tbsp", calories:3 },
  "hot sauce": { emoji:"🌶️", unit:"tsp", calories:1 },
  "salsa": { emoji:"🍅", unit:"tbsp", calories:4 },
  "peanut butter": { emoji:"🥜", unit:"tbsp", calories:94 },
  "jam": { emoji:"🍓", unit:"tbsp", calories:56 },
  // spices
  "salt": { emoji:"🧂", unit:"tsp", calories:0 },
  "black pepper": { emoji:"🧂", unit:"tsp", calories:6 },
  "pepper": { emoji:"🧂", unit:"tsp", calories:6 },
  "garlic powder": { emoji:"🧄", unit:"tsp", calories:10 },
  "onion powder": { emoji:"🧅", unit:"tsp", calories:8 },
  "paprika": { emoji:"🌶️", unit:"tsp", calories:6 },
  "cumin": { emoji:"🌿", unit:"tsp", calories:8 },
  "cinnamon": { emoji:"🌿", unit:"tsp", calories:6 },
  "oregano": { emoji:"🌿", unit:"tsp", calories:3 },
  "basil": { emoji:"🌿", unit:"tsp", calories:1 },
  "thyme": { emoji:"🌿", unit:"tsp", calories:1 },
  "chili powder": { emoji:"🌶️", unit:"tsp", calories:8 },
  "red pepper flakes": { emoji:"🌶️", unit:"tsp", calories:6 },
  "cayenne": { emoji:"🌶️", unit:"tsp", calories:6 },
  // beverages
  "coffee": { emoji:"☕", unit:"cup", calories:2 },
  "orange juice": { emoji:"🍊", unit:"cup", calories:112 },
  "apple juice": { emoji:"🍎", unit:"cup", calories:114 },
  "beer": { emoji:"🍺", unit:"each", calories:153 },
  "wine": { emoji:"🍷", unit:"cup", calories:200 },
  // nuts / misc
  "almonds": { emoji:"🌰", unit:"g", calories:5.79 },
  "walnuts": { emoji:"🌰", unit:"g", calories:6.54 },
  "peanuts": { emoji:"🥜", unit:"g", calories:5.67 },
  "chocolate chips": { emoji:"🍫", unit:"g", calories:4.86 },
  "raisins": { emoji:"🍇", unit:"g", calories:3.0 },
  "black beans": { emoji:"🫘", unit:"g", calories:1.32 },
  "chickpeas": { emoji:"🫘", unit:"g", calories:1.64 },
  "lentils": { emoji:"🫘", unit:"g", calories:1.16 },
};
// Look up a common ingredient by name — trims/lowercases and also tries a simple
// singular/plural fold (e.g. "eggs" -> "egg", "tomatoes" -> "tomato") so close-enough
// typing still matches.
function lookupCommonIngredient(name){
  const key = (name||'').trim().toLowerCase();
  if (!key) return null;
  if (COMMON_INGREDIENTS[key]) return COMMON_INGREDIENTS[key];
  const singular = key.endsWith('oes') ? key.slice(0,-2) : key.endsWith('s') ? key.slice(0,-1) : null;
  if (singular && COMMON_INGREDIENTS[singular]) return COMMON_INGREDIENTS[singular];
  return null;
}

/* ============================================================
   GROCERY AISLE CATEGORIES — for grouping the shopping list the way a store is laid
   out. Category is inferred from the ingredient's own isSpice/isBlend flags (already
   tracked, and reliable) plus keyword matching on the name, with a manual override
   field ("category") the person can set on the ingredient if the guess is wrong.
   ============================================================ */
const GROCERY_CATEGORY_ORDER = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Frozen',
  'Pantry & Dry Goods', 'Canned Goods', 'Condiments & Sauces',
  'Spices & Seasonings', 'Beverages', 'Other'
];
const GROCERY_CATEGORY_KEYWORDS = {
  'Produce': ['apple','banana','orange','lemon','lime','grape','berry','strawberr','blueberr',
    'raspberr','melon','pear','peach','plum','mango','pineapple','avocado','tomato','onion',
    'garlic','potato','carrot','celery','broccoli','cauliflower','spinach','lettuce','kale',
    'cabbage','cucumber','zucchini','squash','pepper','mushroom','corn','scallion','shallot',
    'ginger','cilantro','parsley','basil','mint','dill','rosemary','thyme','fruit','vegetable',
    'herb'],
  'Meat & Seafood': ['chicken','beef','pork','turkey','lamb','bacon','sausage','ham','steak',
    'fish','salmon','tuna','shrimp','crab','lobster','scallop','cod','tilapia','meat','cutlet'],
  'Dairy & Eggs': ['milk','cheese','yogurt','butter','cream','egg','buttermilk'],
  'Bakery': ['bread','bagel','tortilla','bun','roll','baguette','pita','naan','muffin','croissant'],
  'Frozen': ['frozen','ice cream'],
  'Canned Goods': ['canned','broth','stock','tomato sauce','tomato paste'],
  'Condiments & Sauces': ['ketchup','mustard','mayo','soy sauce','hot sauce','salad dressing',
    'oil','vinegar','bbq sauce','sauce','syrup','honey','jam','jelly','peanut butter'],
  'Beverages': ['juice','soda','coffee','tea','wine','beer','sparkling water'],
  'Pantry & Dry Goods': ['flour','sugar','rice','pasta','oat','cereal','bean','lentil','quinoa',
    'bread crumb','breadcrumb','baking powder','baking soda','yeast','cornstarch','panko'],
};
function inferGroceryCategory(ing){
  if (ing.category) return ing.category; // manual override always wins
  if (ing.isSpice || ing.isBlend) return 'Spices & Seasonings';
  const name = (ing.name||'').toLowerCase();
  for (const cat of GROCERY_CATEGORY_ORDER){
    const keywords = GROCERY_CATEGORY_KEYWORDS[cat];
    if (keywords && keywords.some(k => name.includes(k))) return cat;
  }
  return 'Other';
}

state.storeSettings = STORES.reduce((o,s)=> (o[s]=true, o), {}); // which stores are "in play"

/* ============================================================
   RECIPE TEXT IMPORTER — parses a specific plain-text recipe format:
     TITLE / SERVINGS / INGREDIENTS / PANTRY ITEMS (optional) / INSTRUCTIONS
   as section headers on their own line, "- " ingredient lines, and
   "1.", "2." numbered instruction lines.
   ============================================================ */
const IMPORT_UNIT_WORDS = {
  'tbsp':'tbsp', 'tablespoon':'tbsp', 'tablespoons':'tbsp',
  'tsp':'tsp', 'teaspoon':'tsp', 'teaspoons':'tsp',
  'cup':'cup', 'cups':'cup',
  'oz':'oz', 'ounce':'oz', 'ounces':'oz',
  'lb':'lb', 'lbs':'lb', 'pound':'lb', 'pounds':'lb',
  'g':'g', 'gram':'g', 'grams':'g',
  'kg':'kg', 'kilogram':'kg', 'kilograms':'kg',
  'ml':'ml', 'milliliter':'ml', 'milliliters':'ml',
  'l':'l', 'liter':'l', 'liters':'l',
  'fl oz':'floz', 'fluid ounce':'floz', 'fluid ounces':'floz',
};
function parseImportFraction(token){
  const parts = token.split('/');
  const n = Number(parts[0]), d = Number(parts[1]);
  return d ? n/d : Number(token);
}
function parseImportQtyToken(token){
  token = token.trim();
  if (/\s/.test(token)){ // mixed number like "1 1/2"
    const [whole, frac] = token.split(/\s+/);
    return (Number(whole)||0) + parseImportFraction(frac);
  }
  if (token.includes('/')) return parseImportFraction(token);
  return Number(token);
}
// Parses one "- ..." ingredient line into {name, qty, unit, approximate}.
// Handles "8 oz broccoli florets", "1/4 cup panko breadcrumbs", "2 scallions"
// (no unit word -> "each"), and "Salt" (no quantity at all -> nominal placeholder).
function parseImportIngredientLine(raw){
  let line = raw.replace(/^[-*]\s*/, '').trim();
  if (!line) return null;

  const qtyRegex = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*/;
  const qtyMatch = line.match(qtyRegex);
  let qty = null, rest = line;
  if (qtyMatch){
    qty = parseImportQtyToken(qtyMatch[1]);
    rest = line.slice(qtyMatch[0].length).trim();
  }

  let unit = null;
  const words = rest.split(/\s+/);
  const firstTwo = words.slice(0,2).join(' ').toLowerCase().replace(/[.,]$/,'');
  const firstOne = (words[0]||'').toLowerCase().replace(/[.,]$/,'');
  if (IMPORT_UNIT_WORDS[firstTwo]){
    unit = IMPORT_UNIT_WORDS[firstTwo];
    rest = words.slice(2).join(' ');
  } else if (IMPORT_UNIT_WORDS[firstOne]){
    unit = IMPORT_UNIT_WORDS[firstOne];
    rest = words.slice(1).join(' ');
  }

  const name = rest.trim();
  if (!name) return null;

  if (qty === null){
    // e.g. "Salt", "Pepper" — no amount given at all. Use a matching common
    // ingredient's usual unit if we know one, otherwise just "each" as a nominal
    // placeholder — either way it's editable after import.
    const common = lookupCommonIngredient(name);
    return { name, qty: 1, unit: common ? common.unit : 'each', approximate: true };
  }
  const converted = convertToAmericanUnitIfMetric(qty, unit || 'each');
  return { name, qty: converted.qty, unit: converted.unit, approximate: false };
}
// Safety net for American units: even with the AI prompt asking for tsp/tbsp/cup/oz/lb,
// pasted text can still end up with metric units (an older prompt, a source recipe
// copy-pasted as-is, manual entry). Rather than passing grams/kg/ml/l through
// untouched, convert to the nearest sensible American unit right here at parse time —
// this guarantees the result regardless of what the source text actually contains.
function convertToAmericanUnitIfMetric(qty, unit){
  if (unit !== 'g' && unit !== 'kg' && unit !== 'ml' && unit !== 'l') return { qty, unit };
  const category = unitCategory(unit);
  const baseQty = toBaseUnit(qty, unit);
  if (baseQty === null || !isFinite(baseQty)) return { qty, unit };
  // Passing a US-style "preferredUnit" forces pickDisplayUnit to choose from the US
  // table (oz/lb or cup/fl oz/tbsp/tsp) instead of leaning back into metric.
  const picked = pickDisplayUnit(baseQty, category, category === 'weight' ? 'oz' : 'cup');
  return { qty: Math.round(picked.qty * 100) / 100, unit: picked.unit };
}
function parseRecipeImportText(text){
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const HEADERS = ['TITLE','SERVINGS','INGREDIENTS','PANTRY ITEMS','INSTRUCTIONS'];
  const sections = { TITLE:[], SERVINGS:[], INGREDIENTS:[], 'PANTRY ITEMS':[], INSTRUCTIONS:[] };
  let current = null;
  // A recipe import can optionally have full "INGREDIENT" detail blocks (the same
  // format the detailed ingredient importer uses) appended after the recipe itself —
  // once we see a bare "INGREDIENT" line, everything from there on belongs to that,
  // not to whatever recipe section came before it (otherwise it'd get swallowed into
  // INSTRUCTIONS as garbage steps).
  const detailLines = [];
  let inDetails = false;
  for (const line of lines){
    if (!line) continue;
    const upper = line.toUpperCase();
    if (!inDetails && upper === 'INGREDIENT') inDetails = true;
    if (inDetails){ detailLines.push(line); continue; }
    if (HEADERS.includes(upper)){ current = upper; continue; }
    if (current) sections[current].push(line);
  }

  const name = sections.TITLE[0] || '';
  const baseServings = Number((sections.SERVINGS[0]||'').replace(/[^\d.]/g,'')) || 1;

  const ingredientLines = [...sections.INGREDIENTS, ...sections['PANTRY ITEMS']]
    .filter(l => /^[-*]/.test(l));
  const ingredients = ingredientLines.map(parseImportIngredientLine).filter(Boolean);

  const steps = [];
  sections.INSTRUCTIONS.forEach(line => {
    const m = line.match(/^\d+[.)]\s*(.*)$/);
    if (m) steps.push(m[1].trim());
    else if (steps.length) steps[steps.length-1] += ' ' + line; // wrapped continuation line
  });

  const ingredientDetails = detailLines.length ? parseIngredientImportText(detailLines.join('\n')) : [];

  return { name, baseServings, ingredients, steps, ingredientDetails, hasAnyContent: !!(name || ingredients.length || steps.length) };
}

/* ============================================================
   DETAILED INGREDIENT DATA IMPORTER — parses one or more "INGREDIENT" blocks,
   each with UNIT_INFORMATION / DENSITY_CONVERSION / PACKAGE_INFORMATION /
   PRICE_INFORMATION sub-sections of "key: value" lines (PRICE_INFORMATION is
   further split by store-name lines). Maps cleanly onto the app's existing
   systems: grams as the canonical unit, DENSITY_CONVERSION entries become
   custom units (via the same engine as "1 bulb = 10 cloves"), and
   PACKAGE_INFORMATION + PRICE_INFORMATION become packaged-item store pricing.
   ============================================================ */
function canonicalStoreName(raw){
  const normalized = raw.replace(/_/g,' ').trim().toLowerCase();
  return STORES.find(s => s.toLowerCase() === normalized) || null;
}
// Matches a free-text grocery aisle/category string against our known category list,
// leniently (case-insensitive, tolerant of "and" vs "&") — returns '' if it doesn't
// recognize it, so an unrecognized guess doesn't silently become something wrong.
function normalizeGroceryAisle(raw){
  if (!raw) return '';
  const norm = raw.trim().toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ');
  const found = GROCERY_CATEGORY_ORDER.find(cat =>
    cat.toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ') === norm);
  return found || '';
}
function splitIngredientBlocks(text){
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const blocks = [];
  let current = null;
  for (const line of lines){
    if (!line) continue;
    if (/^INGREDIENT$/i.test(line)){
      current = [];
      blocks.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return blocks;
}
function parseIngredientDataBlock(lines){
  const SECTION_HEADERS = ['UNIT_INFORMATION','DENSITY_CONVERSION','PACKAGE_INFORMATION','PRICE_INFORMATION'];
  let name = '';
  const kv = {};
  const prices = {}; // canonical store name -> {package_price, package_size_g}
  let section = null;
  let currentStore = null;

  for (const line of lines){
    const kvMatch = line.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
    if (kvMatch && kvMatch[1].toLowerCase() === 'name' && !section){
      name = kvMatch[2].trim();
      continue;
    }
    if (SECTION_HEADERS.includes(line.toUpperCase())){
      section = line.toUpperCase();
      currentStore = null;
      continue;
    }
    if (section === 'PRICE_INFORMATION'){
      if (kvMatch){
        if (currentStore) prices[currentStore][kvMatch[1].toLowerCase()] = kvMatch[2].trim();
      } else {
        const canonical = canonicalStoreName(line) || line.replace(/_/g,' ');
        currentStore = canonical;
        prices[currentStore] = prices[currentStore] || {};
      }
      continue;
    }
    if (kvMatch) kv[kvMatch[1].toLowerCase()] = kvMatch[2].trim();
  }
  if (!name) return null;
  return { name, kv, prices };
}
// Converts one parsed block into the app's actual ingredient document shape.
const LIQUID_NAME_PATTERN = /\boil\b|\bvinegar\b|\bsauce\b|\bextract\b|\bsyrup\b|\bjuice\b|\bbroth\b|\bstock\b|\bwine\b|\bmilk\b|\bcream\b|\bdressing\b|\bmarinade\b|\bwater\b|\bbeer\b|\bvodka\b|\brum\b|\bwhiskey\b/i;
function buildIngredientDataFromBlock(block){
  const kv = block.kv;
  const standardUnitWeightG = Number(kv.standard_unit_weight_g) || 0;
  const caloriesPerStandardUnit = Number(kv.calories_per_standard_unit) || 0;
  const caloriesPerGram = standardUnitWeightG > 0 ? caloriesPerStandardUnit / standardUnitWeightG : 0;

  // Also populate the ingredient's plain "grams per cup" field — this is what lets a
  // recipe use the ordinary "cup" unit (not just a compound one like "cup_dry") and
  // still convert correctly. Prefer an exact "grams_per_cup" line if the data has one;
  // otherwise fall back to "cooked" then "dry" then whatever cup-ish measure is given,
  // since some density figure is more useful here than leaving it at zero. This stays
  // in raw grams-per-cup regardless of base unit — it's a bridging figure, not itself
  // expressed in the base unit. Computed early since the base-unit decision below
  // (for liquids) needs it.
  let gramsPerCup =
    Number(kv.grams_per_cup) ||
    Number(kv.grams_per_cup_cooked) ||
    Number(kv.grams_per_cup_dry) ||
    (() => {
      const anyCupKey = Object.keys(kv).find(k => /^grams_per_cup/.test(k));
      return anyCupKey ? Number(kv[anyCupKey]) : 0;
    })() || 0;

  const gramsPerEach = Number(kv.grams_per_each) || 0;
  const useEachBase = gramsPerEach > 0;
  // A liquid (oil, vinegar, sauce, extract...) is bought and measured by volume, not
  // weight — "oz" would technically work but isn't how anyone actually thinks about a
  // bottle of cooking oil, so use "fl oz" instead. Bridge grams -> fl oz using the
  // ingredient's real density if we have it (grams per cup); otherwise fall back to a
  // water-like approximation (close enough for most kitchen liquids) rather than
  // defaulting to weight ounces for something that's never bought that way. If we had
  // to approximate, actually save that value as this ingredient's own gramsPerCup too
  // (not just use it internally here) — otherwise a recipe that later references this
  // ingredient by weight instead of volume has no way to bridge the two and shows up
  // as unconverted on the shopping list despite the ingredient looking "complete."
  const OUNCE_IN_GRAMS = 28.3495;
  const FLOZ_IN_ML = 29.5735;
  const CUP_IN_ML = 236.588;
  const looksLikeLiquid = !useEachBase && LIQUID_NAME_PATTERN.test(block.name || '');
  const gramsPerCupWasExplicit = gramsPerCup > 0;
  if (looksLikeLiquid && gramsPerCup === 0) gramsPerCup = CUP_IN_ML; // ~water density approximation
  const gramsPerFlOz = looksLikeLiquid ? (gramsPerCup / CUP_IN_ML) * FLOZ_IN_ML : 0;

  // Everything below (custom units, package size, pricing) gets expressed in
  // whichever base unit this resolves to, not always grams.
  let baseUnit, baseUnitsPerGram;
  if (useEachBase){ baseUnit = 'each'; baseUnitsPerGram = 1 / gramsPerEach; }
  else if (looksLikeLiquid){ baseUnit = 'floz'; baseUnitsPerGram = 1 / gramsPerFlOz; }
  else { baseUnit = 'oz'; baseUnitsPerGram = 1 / OUNCE_IN_GRAMS; }

  const calories = caloriesPerGram / baseUnitsPerGram;

  // DENSITY_CONVERSION: any "grams_per_X" key becomes a custom unit — its factor is
  // expressed relative to whatever the base unit ended up being (each, oz, or fl oz),
  // not always grams. "each" itself is skipped here since it became the base unit
  // above, not a custom unit alongside it.
  const customUnits = [];
  Object.keys(kv).forEach(key => {
    const m = key.match(/^grams_per_(.+)$/);
    if (m && m[1] !== 'each'){
      const grams = Number(kv[key]);
      if (grams > 0) customUnits.push({ name: m[1], direction: 'larger', factor: grams * baseUnitsPerGram });
    }
  });

  // The package's own unit (e.g. "bag", "dozen") becomes a custom unit too — "1 bag"
  // means the whole package, so its factor is the package's total weight, not that
  // divided again (units_per_package instead describes how many individual items are
  // inside one package, e.g. 12 for a dozen — a separate fact from the package's own
  // size).
  const packageWeightG = Number(kv.package_weight_g) || 0;
  if (kv.common_package_unit && packageWeightG > 0){
    if (!customUnits.some(c => c.name === kv.common_package_unit)){
      customUnits.push({ name: kv.common_package_unit, direction: 'larger', factor: packageWeightG * baseUnitsPerGram });
    }
  }

  const prices = {};
  Object.entries(block.prices).forEach(([storeName, p]) => {
    const canonical = canonicalStoreName(storeName);
    if (!canonical) return; // unrecognized store name — skip rather than guess
    const price = Number(p.package_price);
    const packageSizeG = Number(p.package_size_g) || packageWeightG;
    const packageSize = packageSizeG * baseUnitsPerGram; // expressed in the base unit
    if (price > 0 && packageSize > 0) prices[canonical] = { price, packageSize, unit: '' };
  });

  const common = lookupCommonIngredient(block.name);
  return {
    name: block.name,
    emoji: common ? common.emoji : '🛒',
    photo: null,
    unit: baseUnit,
    isCustomUnit: false,
    customUnits,
    calories: Math.round(calories * 1000) / 1000,
    gramsPerCup,
    gramsPerCupWasExplicit, // metadata only — stripped before saving, used to decide whether a re-import should overwrite an existing value
    gramsPerEach,
    packaged: packageWeightG > 0,
    isSpice: false,
    isBlend: false,
    blendComponents: [],
    category: normalizeGroceryAisle(kv.grocery_aisle || kv.aisle),
    prices
  };
}
function parseIngredientImportText(text){
  return splitIngredientBlocks(text)
    .map(parseIngredientDataBlock)
    .filter(Boolean)
    .map(block => ({ name: block.name, data: buildIngredientDataFromBlock(block) }));
}



/* ---- unit conversion ---- */
const VOLUME_TO_ML = { ml:1, l:1000, cup:236.588, tbsp:14.7868, tsp:4.92892, floz:29.5735 };
const WEIGHT_TO_G = { g:1, kg:1000, oz:28.3495, lb:453.592 };
function unitCategory(u){
  if (u in VOLUME_TO_ML) return 'volume';
  if (u in WEIGHT_TO_G) return 'weight';
  if (u === 'each') return 'count';
  return 'unknown';
}
// Convert qty from one unit to another. Same-family conversions (volume<->volume,
// weight<->weight) always work with no setup. Crossing volume<->weight requires the
// ingredient's optional gramsPerCup density. Crossing count ("each")<->weight/volume
// requires gramsPerEach (how much one "each" weighs) — and, for count<->volume
// specifically, gramsPerCup too, chained through grams as the common unit. Without the
// density figures needed for a given pair, returns null rather than guessing.
function convertQty(qty, fromUnit, toUnit, gramsPerCup, gramsPerEach){
  if (fromUnit === toUnit) return qty;
  const catFrom = unitCategory(fromUnit), catTo = unitCategory(toUnit);
  if (catFrom === 'unknown' || catTo === 'unknown') return null;

  if (catFrom === 'count' || catTo === 'count'){
    if (!gramsPerEach) return null;
    if (catFrom === 'count' && catTo === 'count') return null; // only real case is fromUnit===toUnit, handled above
    if (catFrom === 'count'){
      const grams = qty * gramsPerEach;
      if (catTo === 'weight') return grams / WEIGHT_TO_G[toUnit];
      if (!gramsPerCup) return null; // count -> volume also needs the substance's density
      const gramsPerMl = gramsPerCup / VOLUME_TO_ML.cup;
      return (grams / gramsPerMl) / VOLUME_TO_ML[toUnit];
    }
    // catTo === 'count'
    let grams;
    if (catFrom === 'weight'){
      grams = qty * WEIGHT_TO_G[fromUnit];
    } else {
      if (!gramsPerCup) return null;
      const gramsPerMl = gramsPerCup / VOLUME_TO_ML.cup;
      grams = qty * VOLUME_TO_ML[fromUnit] * gramsPerMl;
    }
    return grams / gramsPerEach;
  }

  if (catFrom === catTo){
    if (catFrom === 'volume') return (qty * VOLUME_TO_ML[fromUnit]) / VOLUME_TO_ML[toUnit];
    return (qty * WEIGHT_TO_G[fromUnit]) / WEIGHT_TO_G[toUnit];
  }
  if (!gramsPerCup) return null;
  const gramsPerMl = gramsPerCup / VOLUME_TO_ML.cup;
  if (catFrom === 'volume' && catTo === 'weight'){
    const grams = qty * VOLUME_TO_ML[fromUnit] * gramsPerMl;
    return grams / WEIGHT_TO_G[toUnit];
  }
  if (catFrom === 'weight' && catTo === 'volume'){
    const ml = (qty * WEIGHT_TO_G[fromUnit]) / gramsPerMl;
    return ml / VOLUME_TO_ML[toUnit];
  }
  return null;
}
// How many of an ingredient's own unit is 1 of this custom unit worth?
// direction 'smaller' (e.g. clove, 10 per bulb): factor custom-units = 1 ingredient-unit.
// direction 'larger'  (e.g. bulb, worth 10 cloves): 1 custom-unit = factor ingredient-units.
// Falls back to the legacy `perIngredientUnit` field for ingredients saved before the
// "larger unit" option existed (always meant "smaller", so treated the same way here).
function customUnitBaseFactor(cu){
  const direction = cu.direction || 'smaller';
  const rawFactor = direction === 'larger' ? cu.factor : (cu.factor ?? cu.perIngredientUnit);
  const factor = Number(rawFactor) || 0;
  if (factor <= 0) return 0;
  return direction === 'larger' ? factor : (1 / factor);
}
// Convert a recipe quantity into an ingredient's own unit — checking that ingredient's
// custom units FIRST (smaller sub-units like "clove", or larger container units like
// "bulb", each defined per-ingredient with no global setup), then falling back to the
// standard weight/volume conversion above.
function convertToIngredientUnit(qty, fromUnit, ing){
  if (fromUnit === ing.unit) return qty;
  const custom = (ing.customUnits||[]).find(c => c.name === fromUnit);
  if (custom){
    const baseFactor = customUnitBaseFactor(custom); // 1 custom-unit = baseFactor ingredient-units
    if (baseFactor > 0) return qty * baseFactor;
  }
  return convertQty(qty, fromUnit, ing.unit, ing.gramsPerCup, ing.gramsPerEach);
}
// The reverse: convert a quantity FROM an ingredient's own unit INTO some other unit of
// theirs — used so a store's price can be entered per a "larger" custom unit (e.g. per
// bulb) even though everything else is tracked in the ingredient's base unit (clove).
function convertFromIngredientUnit(qtyInIngUnit, toUnit, ing){
  if (toUnit === ing.unit) return qtyInIngUnit;
  const custom = (ing.customUnits||[]).find(c => c.name === toUnit);
  if (custom){
    const baseFactor = customUnitBaseFactor(custom);
    if (baseFactor > 0) return qtyInIngUnit / baseFactor;
  }
  return null;
}
// Base-unit helpers: every weight amount is tracked internally in grams,
// every volume amount in milliliters, so amounts from different recipes
// (2 tbsp here, 1 cup there) always combine cleanly with zero setup. Count-like and
// custom units (e.g. "bulb") aren't subdivided further — they pass through as-is.
function toBaseUnit(qty, unit){
  const cat = unitCategory(unit);
  if (cat === 'volume') return qty * VOLUME_TO_ML[unit];
  if (cat === 'weight') return qty * WEIGHT_TO_G[unit];
  return qty;
}
// Auto-pick the largest unit that "makes sense" for a grocery list — e.g. show
// 3 lb instead of 1360 g, or 2 cups instead of 32 tbsp — with zero configuration.
// Leans metric or US-customary based on which system the ingredient's own
// reference unit belongs to, purely as a display preference. Custom/count units
// (e.g. "each", "bulb") aren't auto-scaled — they're shown in their own unit as-is.
const WEIGHT_METRIC  = [['kg',1000], ['g',1]];
const WEIGHT_US      = [['lb',453.592], ['oz',28.3495]];
const VOLUME_METRIC  = [['l',1000], ['ml',1]];
const VOLUME_US      = [['cup',236.588], ['floz',29.5735], ['tbsp',14.7868], ['tsp',4.92892]];
function pickDisplayUnit(baseQty, category, preferredUnit){
  if (category !== 'weight' && category !== 'volume'){
    return { unit: category === 'count' ? 'each' : preferredUnit, qty: baseQty };
  }
  const table = category === 'weight'
    ? ((preferredUnit==='g'||preferredUnit==='kg') ? WEIGHT_METRIC : WEIGHT_US)
    : ((preferredUnit==='ml'||preferredUnit==='l') ? VOLUME_METRIC : VOLUME_US);
  for (const [unit, factor] of table){
    const val = baseQty / factor;
    if (val >= 1) return { unit, qty: val };
  }
  const [unit, factor] = table[table.length-1];
  return { unit, qty: baseQty / factor };
}

/* ============================================================
   DATE HELPERS
   ============================================================ */
function startOfWeek(d){
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function fmtDate(d){ return d.toISOString().slice(0,10); }
function fmtDateLabel(d){ return d.toLocaleDateString(undefined,{month:'short', day:'numeric'}); }
function weekDates(){ return Array.from({length:7}, (_,i)=> addDays(state.weekStart, i)); }
function isSameDay(a,b){ return fmtDate(a)===fmtDate(b); }

/* ============================================================
   AUTH
   ============================================================ */
const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');

document.getElementById('auth-signin-btn').addEventListener('click', (e)=>{
  e.preventDefault();
  doAuth(signInWithEmailAndPassword);
});
document.getElementById('auth-signup-btn').addEventListener('click', (e)=>{
  e.preventDefault();
  doAuth(createUserWithEmailAndPassword);
});
authForm.addEventListener('submit', (e)=>{ e.preventDefault(); doAuth(signInWithEmailAndPassword); });

function doAuth(fn){
  authError.textContent = '';
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  fn(auth, email, password).catch(err => {
    authError.textContent = friendlyAuthError(err.code);
  });
}
function friendlyAuthError(code){
  const map = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/user-not-found': 'No account with that email — try Create account.',
    'auth/wrong-password': 'Wrong password.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account already exists — try Sign in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}
document.getElementById('signout-btn').addEventListener('click', ()=> signOut(auth));

onAuthStateChanged(auth, (user)=>{
  cleanupListeners();
  if (user){
    state.uid = user.uid;
    authScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    attachListeners();
    migrateOwnDataToSharedIfNeeded();
    backfillIngredientCreatedAtIfNeeded();
    fixNonsensicalIngredientUnitsIfNeeded();
    fixMissingLiquidDensityIfNeeded();
    backfillMealPlanOrderIfNeeded();
  } else {
    state.uid = null;
    appShell.classList.add('hidden');
    authScreen.classList.remove('hidden');
  }
});

function cleanupListeners(){
  state.unsubs.forEach(u => u());
  state.unsubs = [];
}

/* ============================================================
   FIRESTORE SYNC
   ============================================================ */
// Per-user data: pantry, week plan, and personal settings live under this account only.
function col(name){ return collection(db, 'users', state.uid, name); }
// Shared data: Ingredients and Recipes live in top-level collections visible to and
// editable by every signed-in user — one communal library everyone plans meals from.
const SHARED_INGREDIENTS_COLLECTION = 'shared_ingredients';
const SHARED_RECIPES_COLLECTION = 'shared_recipes';
function sharedCol(name){ return collection(db, name); }

let renderAllScheduled = false;
function scheduleRenderAll(){
  if (renderAllScheduled) return;
  renderAllScheduled = true;
  setTimeout(()=>{ renderAllScheduled = false; renderAll(); }, 0);
}

function attachListeners(){
  state.unsubs.push(onSnapshot(sharedCol(SHARED_INGREDIENTS_COLLECTION), snap => {
    state.ingredients = {};
    snap.forEach(d => state.ingredients[d.id] = d.data());
    scheduleRenderAll();
  }));
  state.unsubs.push(onSnapshot(sharedCol(SHARED_RECIPES_COLLECTION), snap => {
    state.recipes = {};
    snap.forEach(d => state.recipes[d.id] = d.data());
    scheduleRenderAll();
  }));
  state.unsubs.push(onSnapshot(col('pantry'), snap => {
    state.pantry = {};
    snap.forEach(d => state.pantry[d.id] = d.data());
    scheduleRenderAll();
  }));
  state.unsubs.push(onSnapshot(col('mealPlan'), snap => {
    state.mealPlan = {};
    snap.forEach(d => state.mealPlan[d.id] = d.data());
    scheduleRenderAll();
  }));
  state.unsubs.push(onSnapshot(col('favorites'), snap => {
    state.favorites = {};
    snap.forEach(d => state.favorites[d.id] = true);
    scheduleRenderAll();
  }));
  state.unsubs.push(onSnapshot(doc(db,'users',state.uid,'settings','stores'), snap => {
    if (snap.exists()){
      const saved = snap.data();
      STORES.forEach(s => { state.storeSettings[s] = saved[s] !== false; });
    }
    renderShoppingList();
    renderStoreChecks();
  }));
}

async function saveStoreSettings(){
  await setDoc(doc(db,'users',state.uid,'settings','stores'), state.storeSettings);
}

// One-time upgrade path: this app used to store Ingredients and Recipes privately per
// account (users/{uid}/ingredients, users/{uid}/recipes). Now they live in a shared
// library instead. If this account has old private data but the shared library is
// still empty, copy it over automatically — using the SAME document ids, so any recipe
// referencing an ingredientId (or any meal plan entry referencing a recipeId) keeps
// working without needing to be rewritten. Safe to run more than once: it only ever
// acts when the shared library is empty, and setDoc with the same id just overwrites
// rather than duplicating.
async function migrateOwnDataToSharedIfNeeded(){
  try{
    const [sharedIngSnap, sharedRecSnap] = await Promise.all([
      getDocs(sharedCol(SHARED_INGREDIENTS_COLLECTION)),
      getDocs(sharedCol(SHARED_RECIPES_COLLECTION))
    ]);
    if (!sharedIngSnap.empty || !sharedRecSnap.empty) return; // shared library already has data

    const [oldIngSnap, oldRecSnap] = await Promise.all([
      getDocs(col('ingredients')),
      getDocs(col('recipes'))
    ]);
    if (oldIngSnap.empty && oldRecSnap.empty) return; // nothing of this account's to move

    const writes = [];
    oldIngSnap.forEach(d => writes.push(setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, d.id), d.data())));
    oldRecSnap.forEach(d => writes.push(setDoc(doc(db, SHARED_RECIPES_COLLECTION, d.id), d.data())));
    await Promise.all(writes);

    const bits = [];
    if (oldIngSnap.size) bits.push(`${oldIngSnap.size} ingredient${oldIngSnap.size!==1?'s':''}`);
    if (oldRecSnap.size) bits.push(`${oldRecSnap.size} recipe${oldRecSnap.size!==1?'s':''}`);
    toast(`Moved ${bits.join(' and ')} to the new shared library`);
  } catch(err){
    console.error('Shared-library migration check failed:', err);
  }
}

// One-time backfill: ingredients created before the "date added" sort feature existed
// have no createdAt at all, which means Recently/Oldest added has nothing real to sort
// by for them (they all tie at the same value and just stay in whatever order Firestore
// happened to return). There's no way to recover their true creation date, so this
// assigns each a stable synthetic one instead — not historically accurate, but it makes
// the sort actually produce a consistent, browsable order going forward rather than
// silently doing nothing.
async function backfillIngredientCreatedAtIfNeeded(){
  try{
    const snap = await getDocs(sharedCol(SHARED_INGREDIENTS_COLLECTION));
    const missingIds = [];
    snap.forEach(d => { if (d.data().createdAt == null) missingIds.push(d.id); });
    if (missingIds.length === 0) return;

    const base = Date.now() - missingIds.length * 1000;
    const writes = missingIds.map((id, i) =>
      setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, id), { createdAt: base + i * 1000 }, { merge: true })
    );
    await Promise.all(writes);
  } catch(err){
    console.error('Ingredient createdAt backfill failed:', err);
  }
}

// One-time cleanup for ingredients whose unit obviously doesn't make sense — a bell
// pepper tracked in grams, a spice tracked in grams instead of tsp, oil in grams
// instead of fl oz. This happens to ingredients that got auto-created blind (no real
// data behind them) before better import logic existed. Matched purely by name, since
// that's all we have for these. Deliberately conservative: only touches an ingredient
// if the signed-in account's own pantry quantity for it is currently 0 — if there's a
// real number already sitting there, changing the unit without knowing how to convert
// that number correctly would silently corrupt it, so those are left alone entirely.
const SMART_UNIT_FIXES = [
  { pattern: /\bbell pepper|poblano pepper|jalape[nñ]o pepper|banana pepper|serrano pepper\b/i, unit:'each', emoji:'🫑' },
  { pattern: /\begg(s)?\b/i, unit:'each', emoji:'🥚' },
  { pattern: /\bscallion(s)?|green onion(s)?\b/i, unit:'each', emoji:'🌱' },
  { pattern: /\bcucumber(s)?\b/i, unit:'each', emoji:'🥒' },
  { pattern: /\blime(s)?\b/i, unit:'each', emoji:'🍋' },
  { pattern: /\blemon(s)?\b/i, unit:'each', emoji:'🍋' },
  { pattern: /\byellow onion|red onion|white onion|sweet onion\b/i, unit:'each', emoji:'🧅' },
  { pattern: /\bavocado(s)?\b/i, unit:'each', emoji:'🥑' },
  { pattern: /\bapple(s)?\b/i, unit:'each', emoji:'🍎' },
  { pattern: /vegetable oil|canola oil|rice vinegar|apple cider vinegar|white wine vinegar|balsamic vinegar/i, unit:'floz' },
  { pattern: /baking soda|baking powder|vanilla extract|garlic powder|onion powder|chili powder|\bturmeric\b|\bcumin\b|\bcinnamon\b|\bpaprika\b|\bblack pepper\b|sesame seeds|chia seeds|seasoning blend|spice blend/i, unit:'tsp' },
];
function smartUnitFixFor(name){
  const found = SMART_UNIT_FIXES.find(f => f.pattern.test(name||''));
  return found || null;
}
async function fixNonsensicalIngredientUnitsIfNeeded(){
  try{
    const [ingSnap, pantrySnap] = await Promise.all([
      getDocs(sharedCol(SHARED_INGREDIENTS_COLLECTION)),
      getDocs(col('pantry'))
    ]);
    const myPantryQty = {};
    pantrySnap.forEach(d => { myPantryQty[d.id] = Number(d.data().qty) || 0; });

    const writes = [];
    let fixedCount = 0;
    ingSnap.forEach(d => {
      const ing = d.data();
      if (ing.unit !== 'g') return; // only ingredients still stuck on the old blind-import default
      if ((myPantryQty[d.id] || 0) !== 0) return; // has real stock — don't touch, can't safely convert
      const fix = smartUnitFixFor(ing.name);
      if (!fix) return;
      const patch = { unit: fix.unit };
      if (fix.emoji && (!ing.emoji || ing.emoji === '🛒')) patch.emoji = fix.emoji;
      writes.push(setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, d.id), patch, { merge: true }));
      fixedCount++;
    });
    if (writes.length === 0) return;
    await Promise.all(writes);
    toast(`Fixed units on ${fixedCount} ingredient${fixedCount!==1?'s':''} that didn't make sense (e.g. "Bell Pepper" in grams → each)`);
  } catch(err){
    console.error('Ingredient unit cleanup failed:', err);
  }
}

// A liquid tracked in fl oz with gramsPerCup still at 0 got stuck there by a bug in
// the detailed importer (fixed above it) — a water-density approximation was used to
// pick its calories/package/price at import time but never actually saved onto the
// ingredient, leaving it unable to bridge to any recipe that specifies it by weight
// instead of volume. Purely additive (fills in a missing figure, touches no existing
// quantity), so this doesn't need the same pantry-safety gate as the unit fixes above.
async function fixMissingLiquidDensityIfNeeded(){
  try{
    const CUP_IN_ML = 236.588;
    const snap = await getDocs(sharedCol(SHARED_INGREDIENTS_COLLECTION));
    const writes = [];
    let fixedCount = 0;
    snap.forEach(d => {
      const ing = d.data();
      if (ing.unit !== 'floz') return;
      if (Number(ing.gramsPerCup) > 0) return; // already has a real or previously-approximated value
      if (!LIQUID_NAME_PATTERN.test(ing.name||'')) return;
      writes.push(setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, d.id), { gramsPerCup: CUP_IN_ML }, { merge: true }));
      fixedCount++;
    });
    if (writes.length === 0) return;
    await Promise.all(writes);
    toast(`Fixed ${fixedCount} liquid ingredient${fixedCount!==1?'s':''} that couldn't convert between units (missing density)`);
  } catch(err){
    console.error('Liquid density backfill failed:', err);
  }
}

/* ============================================================
   TABS
   ============================================================ */
document.getElementById('tabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
  document.getElementById('mobile-tab-toggle-label').textContent = btn.textContent;
  closeMobileTabMenu();
});

// Mobile dropdown: tap to open/close, tap a tab or click outside to close.
function closeMobileTabMenu(){
  document.getElementById('tabs').classList.remove('mobile-open');
  document.getElementById('mobile-tab-toggle').setAttribute('aria-expanded', 'false');
}
document.getElementById('mobile-tab-toggle').addEventListener('click', (e)=>{
  e.stopPropagation();
  const tabs = document.getElementById('tabs');
  const isOpen = tabs.classList.toggle('mobile-open');
  document.getElementById('mobile-tab-toggle').setAttribute('aria-expanded', String(isOpen));
});
document.addEventListener('click', (e)=>{
  const tabs = document.getElementById('tabs');
  if (!tabs.classList.contains('mobile-open')) return;
  if (e.target.closest('#tabs') || e.target.closest('#mobile-tab-toggle')) return;
  closeMobileTabMenu();
});

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.add('hidden'), 2400);
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
const backdrop = document.getElementById('modal-backdrop');

function openModal(id){
  backdrop.classList.remove('hidden');
  backdrop.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function closeModals(){
  backdrop.classList.add('hidden');
}
backdrop.addEventListener('click', (e)=>{ if (e.target === backdrop) closeModals(); });
document.querySelectorAll('.modal-close').forEach(b=>{
  b.addEventListener('click', ()=> closeModals());
});

/* ---- crop / zoom overlay: fully independent of the modal system above, so it can
   sit on top of the recipe/ingredient editor without ever touching it ---- */
const cropOverlay = document.getElementById('crop-overlay');
function showCropOverlay(){ cropOverlay.classList.remove('hidden'); }
function hideCropOverlay(){
  cropOverlay.classList.add('hidden');
  if (typeof cropperInstance !== 'undefined' && cropperInstance){ cropperInstance.destroy(); cropperInstance = null; }
  cropConfirmHandler = null;
}
cropOverlay.addEventListener('click', (e)=>{ if (e.target === cropOverlay) hideCropOverlay(); });
document.getElementById('crop-close-x').addEventListener('click', hideCropOverlay);

/* ============================================================
   RENDER: ALL
   ============================================================ */
function renderAll(){
  renderWeekPlan();
  renderStoreChecks();
  renderShoppingList();
  renderRecipes();
  renderPantry();
  renderIngredients();
  renderSpicesTab();
}

/* ============================================================
   RECIPE HELPERS
   ============================================================ */
function recipeCaloriesTotal(recipe){
  return (recipe.ingredients || []).reduce((sum, ri) => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return sum;
    const rowUnit = ri.unit || ing.unit;
    const qtyInCanonicalUnit = convertToIngredientUnit(Number(ri.qty)||0, rowUnit, ing);
    if (qtyInCanonicalUnit === null) return sum; // can't reconcile units, skip rather than guess
    return sum + (Number(ing.calories)||0) * qtyInCanonicalUnit;
  }, 0);
}
function recipeCaloriesPerServing(recipe){
  const total = recipeCaloriesTotal(recipe);
  return recipe.baseServings ? total / recipe.baseServings : 0;
}

/* ============================================================
   SPICE BLENDS — a blend is just an Ingredient (isBlend:true) whose
   "recipe" is a list of base-spice components. Because it's a normal
   Ingredient, it's automatically searchable/usable anywhere any other
   ingredient is (recipes, quick items, shopping list, pantry, cook mode) —
   these helpers are what make the math work everywhere else.
   ============================================================ */
// How much of the blend's own unit its component list actually makes.
// e.g. 2 tsp chili powder + 1 tsp cumin + 1 tsp paprika = "makes 4 tsp".
function blendYieldInOwnUnit(blendIng){
  return (blendIng.blendComponents||[]).reduce((sum, comp) => {
    const converted = convertQty(Number(comp.qty)||0, comp.unit, blendIng.unit, blendIng.gramsPerCup, blendIng.gramsPerEach);
    return sum + (converted === null ? 0 : converted);
  }, 0);
}
// Calories per 1 unit of the blend, rolled up from its components — computed once at
// save time and stored just like any other ingredient's calories, so nothing else in
// the app (recipe calorie totals, etc.) needs to know or care that it's a blend.
function blendCaloriesPerOwnUnit(blendIng){
  const yieldAmt = blendYieldInOwnUnit(blendIng);
  if (yieldAmt <= 0) return 0;
  const totalCal = (blendIng.blendComponents||[]).reduce((sum, comp) => {
    const compIng = state.ingredients[comp.ingredientId];
    if (!compIng) return sum;
    const compQtyInOwnUnit = convertToIngredientUnit(Number(comp.qty)||0, comp.unit, compIng);
    if (compQtyInOwnUnit === null) return sum;
    return sum + (Number(compIng.calories)||0) * compQtyInOwnUnit;
  }, 0);
  return totalCal / yieldAmt;
}
// Given a needed amount of a blend (in the blend's own unit), returns the scaled
// breakdown of each base spice required — recursing through nested blends too, though
// that's a rare case. Used to show "exactly how much of each spice to mix" wherever a
// recipe calls for a blend.
function expandBlendBreakdown(blendIng, neededQtyInOwnUnit, depth){
  depth = depth || 0;
  if (depth > 5) return []; // guard against an accidental circular blend reference
  const yieldAmt = blendYieldInOwnUnit(blendIng);
  if (yieldAmt <= 0) return [];
  const scale = neededQtyInOwnUnit / yieldAmt;
  const rows = [];
  (blendIng.blendComponents||[]).forEach(comp => {
    const compIng = state.ingredients[comp.ingredientId];
    if (!compIng) return;
    const compQty = (Number(comp.qty)||0) * scale;
    if (compIng.isBlend){
      const compQtyInOwnUnit = convertQty(compQty, comp.unit, compIng.unit, compIng.gramsPerCup, compIng.gramsPerEach);
      if (compQtyInOwnUnit !== null) rows.push(...expandBlendBreakdown(compIng, compQtyInOwnUnit, depth+1));
    } else {
      rows.push({ ing: compIng, qty: compQty, unit: comp.unit });
    }
  });
  return rows;
}
// Renders the "→ exactly how much of each spice to mix" note shown under a blend
// ingredient anywhere one's used (Cook Mode, Recipe Overview, Shopping List).
function blendBreakdownHtml(blendIng, neededQtyInOwnUnit){
  const rows = expandBlendBreakdown(blendIng, neededQtyInOwnUnit);
  if (!rows.length) return '';
  const lines = rows.map(r => `<div class="blend-breakdown-row"><span>${ingredientIconHtml(r.ing)} ${escapeHtml(r.ing.name)}</span><span>${formatQty(r.qty)} ${UNIT_LABEL[r.unit]||r.unit}</span></div>`).join('');
  return `<div class="blend-breakdown"><span class="blend-breakdown-title">Mix together:</span>${lines}</div>`;
}

/* ============================================================
   RENDER: WEEK PLAN
   ============================================================ */
const weekLabel = document.getElementById('week-label');
const weekGrid = document.getElementById('week-grid');
const weekCaloriesEl = document.getElementById('week-calories');

document.getElementById('week-prev').addEventListener('click', ()=>{
  state.weekStart = addDays(state.weekStart, -7); renderWeekPlan(); renderShoppingList();
});
document.getElementById('week-next').addEventListener('click', ()=>{
  state.weekStart = addDays(state.weekStart, 7); renderWeekPlan(); renderShoppingList();
});

const MEAL_TYPE_SORT_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
function defaultMealOrder(mealType, existingCountSameType){
  return (MEAL_TYPE_SORT_ORDER[mealType] ?? 4) * 1000 + existingCountSameType;
}
// One-time backfill for meal-plan entries from before ordering existed — assigns a
// default order (grouped by meal type, in whatever order they're returned within
// that) so existing plans display sensibly immediately, and become drag-reorderable
// from then on. Uses a direct fetch rather than the state.mealPlan cache since this
// runs right after sign-in, before the live listener has necessarily populated it.
async function backfillMealPlanOrderIfNeeded(){
  try{
    const snap = await getDocs(col('mealPlan'));
    const byDate = {};
    snap.forEach(d => {
      const m = d.data();
      if (m.order != null) return;
      (byDate[m.date] = byDate[m.date] || []).push({ id: d.id, mealType: m.mealType });
    });
    if (Object.keys(byDate).length === 0) return;

    const writes = [];
    Object.values(byDate).forEach(dayMeals => {
      const counts = {};
      dayMeals.forEach(m => {
        const c = counts[m.mealType] || 0;
        counts[m.mealType] = c + 1;
        writes.push(setDoc(doc(db,'users',state.uid,'mealPlan', m.id), { order: defaultMealOrder(m.mealType, c) }, { merge: true }));
      });
    });
    await Promise.all(writes);
  } catch(err){
    console.error('Meal plan order backfill failed:', err);
  }
}
function mealsForDate(dateStr){
  return Object.entries(state.mealPlan)
    .filter(([id,m]) => m.date === dateStr)
    .map(([id,m]) => ({id, ...m, order: (m.order != null) ? m.order : defaultMealOrder(m.mealType, 0)}))
    .sort((a,b) => a.order - b.order);
}

function remainingLeftoverServings(cookMealId){
  const cook = state.mealPlan[cookMealId];
  if (!cook) return 0;
  const consumed = Object.values(state.mealPlan)
    .filter(m => m.type==='leftover' && m.sourceMealId === cookMealId)
    .reduce((s,m)=> s + (Number(m.eatenServings)||0), 0);
  return (Number(cook.batchServings)||0) - (Number(cook.eatenServings)||0) - consumed;
}

// Drag-and-drop reordering/moving of meal chips on the Week Plan. Module-level since
// it needs to be visible to both the dragged chip's own listeners and whichever day
// column / other chip it gets dropped onto.
let dragMealState = null; // { mealId, sourceDate }
async function handleMealDrop(mealId, targetDate, targetMealId, insertBefore){
  const meal = state.mealPlan[mealId];
  if (!meal) return;
  // The list of meals already in the target day, excluding the one being dragged
  // (relevant when reordering within the same day it's already in).
  const targetDayMeals = mealsForDate(targetDate).filter(m => m.id !== mealId);

  let newOrder;
  if (targetMealId){
    const idx = targetDayMeals.findIndex(m => m.id === targetMealId);
    if (idx === -1){
      newOrder = targetDayMeals.length ? targetDayMeals[targetDayMeals.length-1].order + 1 : 0;
    } else {
      const targetOrder = targetDayMeals[idx].order;
      if (insertBefore){
        const prevOrder = idx > 0 ? targetDayMeals[idx-1].order : targetOrder - 2;
        newOrder = (prevOrder + targetOrder) / 2;
      } else {
        const nextOrder = idx < targetDayMeals.length-1 ? targetDayMeals[idx+1].order : targetOrder + 2;
        newOrder = (targetOrder + nextOrder) / 2;
      }
    }
  } else {
    // Dropped into empty space / the day column itself — append to the end of that day.
    newOrder = targetDayMeals.length ? targetDayMeals[targetDayMeals.length-1].order + 1 : 0;
  }

  try{
    await setDoc(doc(db,'users',state.uid,'mealPlan', mealId), { date: targetDate, order: newOrder }, { merge: true });
  } catch(err){
    console.error('Reordering meal failed:', err);
    toast("Couldn't move that meal — see console for details");
  }
}

function renderWeekPlan(){
  const dates = weekDates();
  weekLabel.textContent = `${fmtDateLabel(dates[0])} – ${fmtDateLabel(dates[6])}`;
  weekGrid.innerHTML = '';
  const today = new Date();
  let weekTotalCal = 0;

  dates.forEach(date => {
    const dateStr = fmtDate(date);
    const dayCol = document.createElement('div');
    dayCol.className = 'day-col' + (isSameDay(date, today) ? ' is-today' : '');
    dayCol.addEventListener('dragover', (e)=>{
      if (!dragMealState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dayCol.classList.add('drag-over');
    });
    dayCol.addEventListener('dragleave', (e)=>{
      if (!dayCol.contains(e.relatedTarget)) dayCol.classList.remove('drag-over');
    });
    dayCol.addEventListener('drop', (e)=>{
      e.preventDefault();
      dayCol.classList.remove('drag-over');
      if (!dragMealState) return;
      handleMealDrop(dragMealState.mealId, dateStr, null, false); // append to end of this day
    });

    const meals = mealsForDate(dateStr);
    let dayCal = 0;
    meals.forEach(m => {
      if (m.type === 'quick'){
        const ing = state.ingredients[m.ingredientId];
        if (!ing) return;
        const qtyInIngUnit = convertToIngredientUnit(Number(m.qty)||0, m.unit || ing.unit, ing);
        dayCal += (Number(ing.calories)||0) * qtyInIngUnit;
        return;
      }
      const recipe = state.recipes[m.recipeId];
      if (!recipe) return;
      const perServing = recipeCaloriesPerServing(recipe);
      const eaten = Number(m.eatenServings)||0;
      dayCal += perServing * eaten;
    });
    weekTotalCal += dayCal;

    const head = document.createElement('div');
    head.className = 'day-col-head';
    head.innerHTML = `<div><div class="day-name">${date.toLocaleDateString(undefined,{weekday:'short'})}</div>
      <div class="day-date">${fmtDateLabel(date)}</div></div>
      <div class="day-cal">${dayCal>0? Math.round(dayCal)+' kcal' : ''}</div>`;
    dayCol.appendChild(head);

    meals.forEach(m => {
      const chip = document.createElement('div');
      chip.className = 'meal-chip' + (m.type==='leftover' ? ' leftover' : '');
      chip.draggable = true;
      chip.dataset.mealId = m.id;
      const typeIcon = MEAL_TYPE_ICON[m.mealType] || '';

      let titleHtml, metaText;
      if (m.type === 'quick'){
        const ing = state.ingredients[m.ingredientId];
        const qtyInIngUnit = ing ? convertToIngredientUnit(Number(m.qty)||0, m.unit||ing.unit, ing) : 0;
        titleHtml = `${typeIcon} <span class="chip-ing-icon">${ing ? ingredientIconHtml(ing) : ''}</span> ${escapeHtml(ing ? ing.name : '(deleted ingredient)')}`;
        metaText = ing ? `${formatQty(Number(m.qty)||0)} ${UNIT_LABEL[m.unit]||m.unit}` : '';
      } else {
        const recipe = state.recipes[m.recipeId];
        const name = recipe ? recipe.name : '(deleted recipe)';
        titleHtml = `${typeIcon} ${m.type==='leftover'?'♻️ ':''}${escapeHtml(name)}`;
        const metaBits = [];
        if (m.type==='cook'){
          metaBits.push(`cooked ${m.batchServings} · eating ${m.eatenServings}`);
          const remain = remainingLeftoverServings(m.id);
          if (remain > 0) metaBits.push(`${formatQty(remain)} left over`);
        } else {
          metaBits.push(`leftovers · eating ${m.eatenServings}`);
        }
        metaText = metaBits.join(' · ');
      }

      chip.innerHTML = `<div class="chip-title">${titleHtml}</div>
        <div class="chip-meta">${metaText}</div>`;
      if (m.type === 'cook' && state.recipes[m.recipeId]){
        const cookBtn = document.createElement('button');
        cookBtn.type = 'button';
        cookBtn.className = 'chip-cook-btn';
        cookBtn.textContent = '🍳 Cook this';
        cookBtn.addEventListener('click', (e)=>{
          e.stopPropagation();
          try{
            const missing = missingIngredientsForRecipe(state.recipes[m.recipeId], m.batchServings);
            if (missing.length === 0) openCookMode(m.recipeId, m.batchServings);
            else openMissingIngredientsModal(m.recipeId, missing, m.batchServings);
          } catch(err){
            console.error('Cook from week plan failed:', err);
            toast("Couldn't open that — see console for details");
          }
        });
        chip.appendChild(cookBtn);
      }
      chip.addEventListener('click', ()=> openMealModal(dateStr, m.id));
      chip.addEventListener('dragstart', (e)=>{
        dragMealState = { mealId: m.id, sourceDate: dateStr };
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', m.id); // some browsers require data to be set for drag to work
      });
      chip.addEventListener('dragend', ()=>{
        chip.classList.remove('dragging');
        document.querySelectorAll('.day-col.drag-over, .meal-chip.drag-over-top, .meal-chip.drag-over-bottom')
          .forEach(el => el.classList.remove('drag-over','drag-over-top','drag-over-bottom'));
        dragMealState = null;
      });
      chip.addEventListener('dragover', (e)=>{
        if (!dragMealState || dragMealState.mealId === m.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const before = (e.clientY - chip.getBoundingClientRect().top) < chip.offsetHeight/2;
        chip.classList.toggle('drag-over-top', before);
        chip.classList.toggle('drag-over-bottom', !before);
      });
      chip.addEventListener('dragleave', ()=> chip.classList.remove('drag-over-top','drag-over-bottom'));
      chip.addEventListener('drop', (e)=>{
        e.preventDefault();
        e.stopPropagation(); // don't also trigger the day column's own drop handler
        chip.classList.remove('drag-over-top','drag-over-bottom');
        if (!dragMealState || dragMealState.mealId === m.id) return;
        const before = (e.clientY - chip.getBoundingClientRect().top) < chip.offsetHeight/2;
        handleMealDrop(dragMealState.mealId, dateStr, m.id, before);
      });
      dayCol.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-meal-btn';
    addBtn.textContent = '+ Add meal';
    addBtn.addEventListener('click', ()=> openMealModal(dateStr, null));
    dayCol.appendChild(addBtn);

    weekGrid.appendChild(dayCol);
  });

  weekCaloriesEl.textContent = weekTotalCal>0 ? `Week total: ${Math.round(weekTotalCal)} kcal` : '';
}

/* ============================================================
   MEAL MODAL
   ============================================================ */
const mealRecipeSelect = document.getElementById('meal-recipe-select');
const mealLeftoverSelect = document.getElementById('meal-leftover-select');
const batchServingsInput = document.getElementById('meal-batch-servings');
const eatenServingsInput = document.getElementById('meal-eaten-servings');
const leftoverServingsInput = document.getElementById('meal-leftover-servings');
const mealTypeSelect = document.getElementById('meal-type-select');
const mealQuickIngredientSelect = document.getElementById('meal-quick-ingredient');
const mealQuickQtyInput = document.getElementById('meal-quick-qty');
const mealQuickUnitSelect = document.getElementById('meal-quick-unit');
mountIngredientCombo(document.getElementById('meal-quick-ingredient-combo'), '#meal-quick-ingredient');

// Re-syncs a combo's visible search text after its hidden input's .value is set
// programmatically (e.g. when opening the meal modal to edit an existing entry).
function syncComboDisplay(hiddenInput){
  const root = hiddenInput.closest('.ing-combo');
  if (!root) return;
  const searchInput = root.querySelector('.ing-combo-search');
  const ing = state.ingredients[hiddenInput.value];
  searchInput.value = ing ? ing.name : '';
}

document.getElementById('toggle-cook').addEventListener('click', ()=> setMealType('cook'));
document.getElementById('toggle-leftover').addEventListener('click', ()=> setMealType('leftover'));
document.getElementById('toggle-quick').addEventListener('click', ()=> setMealType('quick'));

function setMealType(type){
  document.getElementById('toggle-cook').classList.toggle('active', type==='cook');
  document.getElementById('toggle-leftover').classList.toggle('active', type==='leftover');
  document.getElementById('toggle-quick').classList.toggle('active', type==='quick');
  document.getElementById('meal-cook-fields').classList.toggle('hidden', type!=='cook');
  document.getElementById('meal-leftover-fields').classList.toggle('hidden', type!=='leftover');
  document.getElementById('meal-quick-fields').classList.toggle('hidden', type!=='quick');
  state.editing.mealType = type;
}

mealQuickIngredientSelect.addEventListener('change', (e)=>{
  const ing = state.ingredients[e.target.value];
  mealQuickUnitSelect.innerHTML = unitOptionsHtml(ing ? ing.unit : 'g', ing);
});

function openMealModal(dateStr, mealId){
  state.editing.mealDate = dateStr;
  state.editing.mealId = mealId;

  const recipeIds = Object.keys(state.recipes);
  mealRecipeSelect.innerHTML = recipeIds.map(id =>
    `<option value="${id}">${escapeHtml(state.recipes[id].name)}</option>`).join('') ||
    '<option value="">No recipes yet — add one first</option>';

  // Build leftover source options: cook meals on or before this date with remaining servings
  const options = Object.entries(state.mealPlan)
    .filter(([id,m]) => m.type==='cook' && m.date <= dateStr && remainingLeftoverServings(id) > 0)
    .sort((a,b)=> b[1].date.localeCompare(a[1].date));
  mealLeftoverSelect.innerHTML = options.map(([id,m])=>{
    const recipe = state.recipes[m.recipeId];
    const remain = remainingLeftoverServings(id);
    return `<option value="${id}">${escapeHtml(recipe? recipe.name:'?')} — cooked ${m.date} (${formatQty(remain)} left)</option>`;
  }).join('') || '<option value="">No leftovers available</option>';

  const deleteBtn = document.getElementById('delete-meal-btn');

  if (mealId){
    const m = state.mealPlan[mealId];
    document.getElementById('meal-modal-title').textContent = 'Edit meal';
    mealTypeSelect.value = m.mealType || 'dinner';
    setMealType(m.type);
    if (m.type === 'cook'){
      mealRecipeSelect.value = m.recipeId;
      batchServingsInput.value = m.batchServings;
      eatenServingsInput.value = m.eatenServings;
    } else if (m.type === 'leftover'){
      mealLeftoverSelect.value = m.sourceMealId;
      leftoverServingsInput.value = m.eatenServings;
    } else { // quick
      const ing = state.ingredients[m.ingredientId];
      mealQuickUnitSelect.innerHTML = unitOptionsHtml(m.unit || (ing?ing.unit:'g'), ing);
      mealQuickIngredientSelect.value = m.ingredientId;
      syncComboDisplay(mealQuickIngredientSelect);
      mealQuickQtyInput.value = m.qty;
      mealQuickUnitSelect.value = m.unit;
    }
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('meal-modal-title').textContent = 'Add meal';
    mealTypeSelect.value = 'dinner';
    setMealType('cook');
    batchServingsInput.value = 4;
    eatenServingsInput.value = 4;
    leftoverServingsInput.value = 1;
    mealQuickQtyInput.value = 1;
    mealQuickIngredientSelect.value = '';
    syncComboDisplay(mealQuickIngredientSelect);
    mealQuickUnitSelect.innerHTML = unitOptionsHtml('g', null);
    deleteBtn.classList.add('hidden');
  }
  openModal('meal-modal');
}

document.getElementById('save-meal-btn').addEventListener('click', async ()=>{
  const type = state.editing.mealType;
  const mealType = mealTypeSelect.value || 'dinner';
  let data;
  if (type === 'cook'){
    if (!mealRecipeSelect.value){ toast('Add a recipe first'); return; }
    data = {
      date: state.editing.mealDate,
      type: 'cook',
      mealType,
      recipeId: mealRecipeSelect.value,
      batchServings: Number(batchServingsInput.value)||0,
      eatenServings: Number(eatenServingsInput.value)||0,
      createdAt: serverTimestamp()
    };
  } else if (type === 'leftover'){
    if (!mealLeftoverSelect.value){ toast('No leftovers available'); return; }
    const source = state.mealPlan[mealLeftoverSelect.value];
    data = {
      date: state.editing.mealDate,
      type: 'leftover',
      mealType,
      recipeId: source.recipeId,
      sourceMealId: mealLeftoverSelect.value,
      eatenServings: Number(leftoverServingsInput.value)||0,
      createdAt: serverTimestamp()
    };
  } else { // quick
    if (!mealQuickIngredientSelect.value){ toast('Add an ingredient first'); return; }
    const qty = Number(mealQuickQtyInput.value)||0;
    if (qty <= 0){ toast('Enter an amount'); return; }
    data = {
      date: state.editing.mealDate,
      type: 'quick',
      mealType,
      ingredientId: mealQuickIngredientSelect.value,
      qty,
      unit: mealQuickUnitSelect.value,
      createdAt: serverTimestamp()
    };
  }
  if (state.editing.mealId){
    const existing = state.mealPlan[state.editing.mealId] || {};
    data.order = existing.order != null
      ? existing.order
      : defaultMealOrder(mealType, mealsForDate(data.date).filter(m => m.mealType === mealType).length);
    await setDoc(doc(db,'users',state.uid,'mealPlan', state.editing.mealId), data);
  } else {
    const sameTypeCount = mealsForDate(data.date).filter(m => m.mealType === mealType).length;
    data.order = defaultMealOrder(mealType, sameTypeCount);
    await addDoc(col('mealPlan'), data);
  }
  closeModals();
  toast('Meal plan updated');
});

document.getElementById('delete-meal-btn').addEventListener('click', async ()=>{
  if (!state.editing.mealId) return;
  await deleteDoc(doc(db,'users',state.uid,'mealPlan', state.editing.mealId));
  closeModals();
  toast('Meal removed');
});

/* ============================================================
   RENDER: SHOPPING LIST
   ============================================================ */
function renderStoreChecks(){
  const container = document.getElementById('store-checks');
  container.innerHTML = STORES.map(s => `
    <label class="store-pill ${state.storeSettings[s] ? 'on':''}" data-store="${s}">
      <input type="checkbox" ${state.storeSettings[s] ? 'checked':''} />
      ${s}
    </label>`).join('');
  container.querySelectorAll('.store-pill').forEach(pill=>{
    pill.querySelector('input').addEventListener('change', (e)=>{
      const store = pill.dataset.store;
      state.storeSettings[store] = e.target.checked;
      pill.classList.toggle('on', e.target.checked);
      saveStoreSettings();
      renderShoppingList();
    });
  });
}

// Reads a store's price entry for an ingredient in a format-agnostic way — handles
// the {price, packageSize, unit} shape, plus legacy shapes (plain numbers, or objects
// without a `unit`, which always meant "priced per the ingredient's own unit").
function priceEntryFor(ing, store){
  const raw = ing.prices ? ing.prices[store] : null;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return { price: raw, packageSize: 0, unit: ing.unit };
  const price = Number(raw.price);
  if (!price || price <= 0) return null;
  return { price, packageSize: Number(raw.packageSize) || 0, unit: raw.unit || ing.unit };
}

// Shared "close enough to not matter" tolerance, used both for display rounding and for
// package-buying math — e.g. needing 8.01 oz of an 8 oz-packaged item shouldn't force a
// second whole package just for a rounding-error-scale amount.
const CLOSE_ENOUGH = 0.05;

// Cost of buying enough of this ingredient at one store to cover neededQtyInIngUnit
// (expressed in the ingredient's own unit). The store may price this ingredient in a
// different unit of its own (e.g. per "bulb" while the ingredient's base unit is
// "clove") — that gets converted first. For packaged items this rounds UP to whole
// packages, forgiving a negligible overage (see CLOSE_ENOUGH) so you don't get pushed
// into buying an extra package for a fraction of a unit. Returns
// {cost, store, packages, packageSize, priceUnit, boughtQtyInIngUnit} or null if this
// store can't price it (no price entered, package size missing, or the chosen price
// unit can't be resolved for this ingredient).
function storeCostFor(ing, store, neededQtyInIngUnit){
  const entry = priceEntryFor(ing, store);
  if (!entry) return null;
  const qtyInPriceUnit = convertFromIngredientUnit(neededQtyInIngUnit, entry.unit, ing);
  if (qtyInPriceUnit === null) return null;

  if (ing.packaged){
    if (!entry.packageSize || entry.packageSize <= 0) return null;
    const packages = Math.max(1, Math.ceil((qtyInPriceUnit - CLOSE_ENOUGH) / entry.packageSize));
    const boughtQtyInPriceUnit = packages * entry.packageSize;
    return {
      cost: packages * entry.price, store, packages,
      packageSize: entry.packageSize, priceUnit: entry.unit,
      boughtQtyInIngUnit: convertToIngredientUnit(boughtQtyInPriceUnit, entry.unit, ing)
    };
  }
  return {
    cost: qtyInPriceUnit * entry.price, store, packages: null,
    packageSize: 0, priceUnit: entry.unit,
    boughtQtyInIngUnit: neededQtyInIngUnit
  };
}

// Cheapest option among currently-enabled stores for the quantity actually needed.
function cheapestOption(ing, neededQtyInIngUnit){
  let best = null;
  STORES.forEach(store => {
    if (!state.storeSettings[store]) return;
    const opt = storeCostFor(ing, store, neededQtyInIngUnit);
    if (!opt) return;
    if (best === null || opt.cost < best.cost) best = opt;
  });
  return best;
}

function renderShoppingList(){
  const container = document.getElementById('shopping-list');
  const totalEl = document.getElementById('shopping-total');
  const dates = weekDates().map(fmtDate);
  const neededBase = {};   // ingredientId -> qty, in base units (grams / ml / count)
  const unconverted = {};  // "ingredientId__unit" -> {ingredientId, unit, qty} — genuinely different unit family

  Object.values(state.mealPlan).forEach(m => {
    if (!dates.includes(m.date)) return;

    if (m.type === 'quick'){
      const ing = state.ingredients[m.ingredientId];
      if (!ing) return;
      const rowUnit = m.unit || ing.unit;
      const rawQty = Number(m.qty)||0;
      const converted = convertToIngredientUnit(rawQty, rowUnit, ing);
      if (converted !== null){
        neededBase[m.ingredientId] = (neededBase[m.ingredientId]||0) + toBaseUnit(converted, ing.unit);
      } else {
        const key = m.ingredientId + '__' + rowUnit;
        if (!unconverted[key]) unconverted[key] = { ingredientId: m.ingredientId, unit: rowUnit, qty: 0 };
        unconverted[key].qty += rawQty;
      }
      return;
    }

    if (m.type !== 'cook') return;
    const recipe = state.recipes[m.recipeId];
    if (!recipe || !recipe.baseServings) return;
    const scale = (Number(m.batchServings)||0) / recipe.baseServings;
    (recipe.ingredients||[]).forEach(ri => {
      const ing = state.ingredients[ri.ingredientId];
      if (!ing) return;
      const rowUnit = ri.unit || ing.unit;
      const rawQty = (Number(ri.qty)||0) * scale;
      const converted = convertToIngredientUnit(rawQty, rowUnit, ing);
      if (converted !== null){
        neededBase[ri.ingredientId] = (neededBase[ri.ingredientId]||0) + toBaseUnit(converted, ing.unit);
      } else {
        // e.g. this ingredient's reference unit is a weight but this recipe measured it by
        // volume, and no density is set on the ingredient to bridge the two
        const key = ri.ingredientId + '__' + rowUnit;
        if (!unconverted[key]) unconverted[key] = { ingredientId: ri.ingredientId, unit: rowUnit, qty: 0 };
        unconverted[key].qty += rawQty;
      }
    });
  });

  // subtract pantry (pantry is tracked in each ingredient's own reference unit)
  Object.keys(neededBase).forEach(ingId => {
    const ing = state.ingredients[ingId];
    if (!ing) return;
    const haveBase = toBaseUnit(Number(state.pantry[ingId]?.qty) || 0, ing.unit);
    neededBase[ingId] = Math.max(0, neededBase[ingId] - haveBase);
  });

  // Drop anything left over that's within CLOSE_ENOUGH of zero, in the ingredient's OWN
  // unit — not just a floating-point-noise epsilon. This matters most after Shopping
  // Mode credits a rounded-up package purchase to the pantry (e.g. bought 8 oz for an
  // 8.01 oz need): the tiny 0.01 oz "still short" shouldn't linger as its own line item
  // demanding to be bought again.
  const rows = Object.entries(neededBase).filter(([id, baseQty]) => {
    const ing = state.ingredients[id];
    if (!ing) return false;
    const neededQtyInIngUnit = baseQty / (toBaseUnit(1, ing.unit) || 1);
    return neededQtyInIngUnit >= CLOSE_ENOUGH;
  });
  const warnRows = Object.values(unconverted).filter(r => r.qty >= CLOSE_ENOUGH);

  if (rows.length === 0 && warnRows.length === 0){
    container.innerHTML = '<p class="shop-empty">Nothing to buy — plan some meals this week, or your pantry already covers it.</p>';
    totalEl.innerHTML = '';
    return;
  }

  let grandTotal = 0;
  const storeSubtotals = {}; // store -> $ (items assigned to it as the cheapest option)
  let missingPriceCount = 0;
  const anyStoresOn = STORES.some(s => state.storeSettings[s]);

  const shopSortMode = document.getElementById('shopping-sort-select').value || 'default';
  if (shopSortMode === 'alpha'){
    rows.sort(([idA],[idB]) => (state.ingredients[idA]?.name||'').localeCompare(state.ingredients[idB]?.name||''));
  } else if (shopSortMode === 'aisle'){
    rows.sort(([idA],[idB]) => {
      const ingA = state.ingredients[idA], ingB = state.ingredients[idB];
      const catA = ingA ? inferGroceryCategory(ingA) : 'Other';
      const catB = ingB ? inferGroceryCategory(ingB) : 'Other';
      const orderDelta = GROCERY_CATEGORY_ORDER.indexOf(catA) - GROCERY_CATEGORY_ORDER.indexOf(catB);
      if (orderDelta !== 0) return orderDelta;
      return (ingA?.name||'').localeCompare(ingB?.name||'');
    });
  }

  let lastAisleCategory = null;
  const itemsHtml = rows.map(([id, baseQty]) => {
    const ing = state.ingredients[id];
    if (!ing) return '';
    let aisleHeaderHtml = '';
    if (shopSortMode === 'aisle'){
      const cat = inferGroceryCategory(ing);
      if (cat !== lastAisleCategory){
        lastAisleCategory = cat;
        aisleHeaderHtml = `<div class="shop-aisle-header">${escapeHtml(cat)}</div>`;
      }
    }
    const category = unitCategory(ing.unit);
    const neededQtyInIngUnit = baseQty / (toBaseUnit(1, ing.unit) || 1);

    const best = anyStoresOn ? cheapestOption(ing, neededQtyInIngUnit) : null;
    let priceHtml, amountHtml, pantryQty, amountClass = 's-amount';

    if (best){
      grandTotal += best.cost;
      storeSubtotals[best.store] = (storeSubtotals[best.store]||0) + best.cost;
      priceHtml = `<span class="s-price">$${best.cost.toFixed(2)} <span style="font-weight:400;">at ${escapeHtml(best.store)}</span></span>`;
      if (best.packages !== null){
        // packaged item: lead with what's actually needed (the number that matters most
        // day-to-day), then note the package purchase underneath as supporting detail —
        // buying "2 packages" alone doesn't tell you why.
        const pkgWord = best.packages === 1 ? 'package' : 'packages';
        const pkgUnitLabel = UNIT_LABEL[best.priceUnit] || best.priceUnit;
        const { unit: neededDispUnit, qty: neededDispQty } = pickDisplayUnit(baseQty, category, ing.unit);
        amountHtml = `Need: ${formatQty(neededDispQty)} ${UNIT_LABEL[neededDispUnit]||neededDispUnit}
          <span class="s-needed-note">buy ${best.packages} ${pkgWord} (${formatQty(best.packageSize)} ${pkgUnitLabel} each)</span>`;
        pantryQty = best.boughtQtyInIngUnit; // credit the full purchased amount, incl. rounding leftover
      } else {
        const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
        amountHtml = `Need: ${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
        pantryQty = best.boughtQtyInIngUnit;
      }
    } else if (!anyStoresOn){
      // No store picked at all yet — "no price set" on every single item is just noise
      // in that state, not useful feedback. Skip it and let the amount stand on its own,
      // larger, since it's the only thing worth showing right now.
      priceHtml = '';
      amountClass = 's-amount s-amount-large';
      const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
      amountHtml = `Need: ${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
      pantryQty = neededQtyInIngUnit;
    } else {
      missingPriceCount++;
      priceHtml = `<span class="s-noprice">no price set${ing.packaged ? ' / no package size' : ''}</span>`;
      const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
      amountHtml = `Need: ${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
      pantryQty = neededQtyInIngUnit;
    }

    const breakdown = ing.isBlend ? blendBreakdownHtml(ing, neededQtyInIngUnit) : '';
    return `${aisleHeaderHtml}<div class="shop-item-wrap">
      <label class="shop-item" data-ing="${id}">
        <input type="checkbox" class="shop-check" data-ing="${id}" />
        <span class="s-emoji">${ingredientIconHtml(ing)}</span>
        <span class="s-name">${escapeHtml(ing.name)}</span>
        <span class="s-price-block">
          ${priceHtml}
          <span class="${amountClass}">${amountHtml}</span>
          <span class="pantry-qty-edit">
            <span class="pantry-qty-label">Bought:</span>
            <input type="number" class="pantry-qty-input" value="${formatQty(pantryQty)}" step="any" min="0" data-ing="${id}" />
            <span class="pantry-qty-unit">${UNIT_LABEL[ing.unit]||ing.unit}</span>
          </span>
        </span>
      </label>
      ${breakdown}
    </div>`;
  }).join('');

  const warnHtml = warnRows.map(w => {
    const ing = state.ingredients[w.ingredientId];
    if (!ing) return '';
    return `<div class="shop-item warn" data-ing="${w.ingredientId}">
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="s-name">${escapeHtml(ing.name)}</span>
      <span class="s-price-block">
        <span class="s-amount">${formatQty(w.qty)} ${UNIT_LABEL[w.unit]||w.unit}</span>
        <span class="s-warn-note">measured differently in this recipe (${UNIT_LABEL[w.unit]} vs. this ingredient's usual ${UNIT_LABEL[ing.unit]}) — set "grams per cup" on this ingredient to combine, or shown separately for now</span>
      </span>
    </div>`;
  }).join('');

  container.innerHTML = itemsHtml + warnHtml;
  container.classList.toggle('mode-active', state.shoppingMode);
  container.querySelectorAll('.shop-check').forEach(cb=>{
    cb.addEventListener('change', (e)=>{
      e.target.closest('.shop-item').classList.toggle('checked', e.target.checked);
      updateShoppingModeCount();
    });
  });
  // Clicking/typing into the pantry-amount field shouldn't also toggle the row's
  // checkbox, since it lives inside the same <label>.
  container.querySelectorAll('.pantry-qty-input').forEach(input=>{
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('mousedown', e => e.stopPropagation());
  });
  updateShoppingModeCount();

  if (!anyStoresOn){
    totalEl.innerHTML = `<span>Pick at least one store above to see prices.</span>`;
  } else {
    const breakdown = Object.entries(storeSubtotals)
      .map(([s,t]) => `${escapeHtml(s)} $${t.toFixed(2)}`).join(' · ');
    totalEl.innerHTML = `<span>${breakdown || 'No priced items yet'}</span>
      <span class="grand">Total: $${grandTotal.toFixed(2)}${missingPriceCount ? ` (+${missingPriceCount} item${missingPriceCount>1?'s':''} unpriced)` : ''}</span>`;
  }
}
function formatQty(n){
  if (!n || n <= 0) return '0';
  const nearestHalf = Math.round(n * 2) / 2; // nearest 0, 0.5, 1, 1.5, 2, ...
  const value = Math.abs(n - nearestHalf) < CLOSE_ENOUGH ? nearestHalf : n;
  const rounded = Math.round(value * 100) / 100; // avoid stray floating-point tails either way
  return rounded === 0 ? '<1' : rounded.toString();
}

/* ---- shopping mode ---- */
const shoppingModeBtn = document.getElementById('shopping-mode-btn');
const shoppingModeBar = document.getElementById('shopping-mode-bar');
const shoppingModeCount = document.getElementById('shopping-mode-count');

shoppingModeBtn.addEventListener('click', ()=>{
  state.shoppingMode = !state.shoppingMode;
  shoppingModeBtn.textContent = state.shoppingMode ? 'Exit Shopping Mode' : 'Start Shopping';
  shoppingModeBtn.classList.toggle('btn-ghost', !state.shoppingMode);
  shoppingModeBar.classList.toggle('hidden', !state.shoppingMode);
  document.getElementById('shopping-list').classList.toggle('mode-active', state.shoppingMode);
  updateShoppingModeCount();
});

function updateShoppingModeCount(){
  if (!state.shoppingMode) return;
  const checked = document.querySelectorAll('#shopping-list .shop-check:checked').length;
  shoppingModeCount.textContent = `${checked} item${checked!==1?'s':''} checked`;
}

document.getElementById('finish-shopping-btn').addEventListener('click', async ()=>{
  const checkedBoxes = Array.from(document.querySelectorAll('#shopping-list .shop-check:checked'));
  if (checkedBoxes.length === 0){ toast('Check off what you bought first'); return; }

  const writes = checkedBoxes.map(cb => {
    const ingId = cb.dataset.ing;
    // Read from the editable "add X to pantry" field next to this item — pre-filled
    // with the computed amount, but the person may have adjusted it (e.g. the store
    // only had a 16 oz package instead of the usual 12 oz).
    const qtyInput = cb.closest('.shop-item').querySelector('.pantry-qty-input');
    const boughtQty = Number(qtyInput ? qtyInput.value : 0) || 0;
    const currentHave = Number(state.pantry[ingId]?.qty) || 0;
    return setDoc(doc(db,'users',state.uid,'pantry', ingId), { qty: currentHave + boughtQty });
  });

  await Promise.all(writes);
  toast(`Added ${checkedBoxes.length} item${checkedBoxes.length!==1?'s':''} to your pantry`);

  // Exit shopping mode — the list re-renders itself once the pantry snapshot comes back,
  // and purchased items drop off automatically since they're now covered.
  state.shoppingMode = false;
  shoppingModeBtn.textContent = 'Start Shopping';
  shoppingModeBar.classList.add('hidden');
  document.getElementById('shopping-list').classList.remove('mode-active');
});

/* ============================================================
   RENDER: RECIPES
   ============================================================ */
// Checks a recipe's base-serving ingredients against the pantry. Returns an array of
// {ing, needed, have} for anything short (or entirely missing). Ingredients that can't
// be compared (deleted ingredient, or a genuine unit-family mismatch) are skipped rather
// than counted as missing, since we can't honestly say either way.
// Checks whether any of an ingredient row's listed substitutes is already available
// in sufficient quantity — returns that substitute's info, or null if none qualify.
function availableSubstituteFor(subs, scale = 1){
  if (!subs || !subs.length) return null;
  for (const sub of subs){
    const subIng = state.ingredients[sub.ingredientId];
    if (!subIng) continue;
    const needed = convertToIngredientUnit((Number(sub.qty)||0) * scale, sub.unit, subIng);
    if (needed === null) continue;
    const have = Number(state.pantry[sub.ingredientId]?.qty) || 0;
    if (have + 1e-9 >= needed) return { ing: subIng, needed };
  }
  return null;
}
// servingsOverride: when checking against a specific planned meal that used a
// different batch size than the recipe's own base servings, pass that batch size
// here so the check scales correctly (e.g. doubling a recipe needs double of
// everything). Omit it for a generic "does this recipe need anything" check.
function missingIngredientsForRecipe(r, servingsOverride){
  const scale = (servingsOverride && r.baseServings) ? (Number(servingsOverride) / r.baseServings) : 1;
  const missing = [];
  (r.ingredients||[]).forEach(ri => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return;
    const rowUnit = ri.unit || ing.unit;
    const needed = convertToIngredientUnit((Number(ri.qty)||0) * scale, rowUnit, ing);
    if (needed === null) return;
    const have = Number(state.pantry[ri.ingredientId]?.qty) || 0;
    if (have + 1e-9 < needed){
      // Short on the original, but if a listed substitute is already in stock,
      // that's not actually a blocker to cooking — don't count it as missing.
      if (availableSubstituteFor(ri.subs, scale)) return;
      missing.push({ ing, needed, have });
    }
  });
  return missing;
}

function renderRecipeCardsInto(containerId, sortSelectId, filterFn, emptyMessage){
  const container = document.getElementById(containerId);
  let entries = Object.entries(state.recipes).filter(([, r]) => filterFn(r));
  if (entries.length===0){
    container.innerHTML = `<p class="shop-empty">${emptyMessage}</p>`;
    return;
  }

  const sortMode = document.getElementById(sortSelectId).value || 'name-asc';
  entries = entries.slice().sort(([idA, a], [idB, b]) => {
    switch (sortMode){
      case 'favorites': {
        const favA = !!state.favorites[idA], favB = !!state.favorites[idB];
        if (favA !== favB) return favA ? -1 : 1;
        return (a.name||'').localeCompare(b.name||'');
      }
      case 'calories-asc': return recipeCaloriesPerServing(a) - recipeCaloriesPerServing(b);
      case 'fewest-missing': return missingIngredientsForRecipe(a).length - missingIngredientsForRecipe(b).length;
      case 'name-asc':
      default: return (a.name||'').localeCompare(b.name||'');
    }
  });

  container.innerHTML = entries.map(([id, r]) => {
    const badges = (r.ingredients||[]).slice(0,8).map(ri => {
      const ing = state.ingredients[ri.ingredientId];
      return `<span class="ing-badge" title="${ing?escapeHtml(ing.name):''}">${ingredientIconHtml(ing)}</span>`;
    }).join('');
    const cal = Math.round(recipeCaloriesPerServing(r));
    const cover = r.coverPhoto ? `<img class="rc-cover" src="${r.coverPhoto}" alt="" />` : '';
    const missing = missingIngredientsForRecipe(r);
    const cookBtnClass = missing.length ? 'btn-ghost rc-cook-btn insufficient' : 'btn-primary rc-cook-btn';
    const cookBtnLabel = missing.length ? `⚠️ Missing ${missing.length} item${missing.length>1?'s':''}` : '🍳 Cook this';
    const isFav = !!state.favorites[id];
    return `<div class="recipe-card" data-id="${id}">
      <button type="button" class="rc-fav-btn${isFav?' active':''}" data-id="${id}" aria-label="Favorite" title="${isFav?'Remove from favorites':'Add to favorites'}">♥</button>
      ${cover}
      <h3>${escapeHtml(r.name)}</h3>
      <div class="rc-servings">makes ${r.baseServings} servings</div>
      <div class="rc-ingredients">${badges}</div>
      <div class="rc-cal">${cal>0? cal+' kcal / serving' : ''}</div>
      <button type="button" class="rc-overview-link" data-id="${id}">📄 Recipe overview</button>
      <button type="button" class="btn ${cookBtnClass}" data-id="${id}">${cookBtnLabel}</button>
    </div>`;
  }).join('');
  container.querySelectorAll('.recipe-card').forEach(card=>{
    card.addEventListener('click', ()=> openRecipeModal(card.dataset.id));
  });
  container.querySelectorAll('.rc-fav-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      const isFav = !!state.favorites[id];
      try{
        if (isFav) await deleteDoc(doc(db,'users',state.uid,'favorites', id)).catch(()=>{});
        else await setDoc(doc(db,'users',state.uid,'favorites', id), { favorited: true });
      } catch(err){
        console.error('Toggling favorite failed:', err);
        toast("Couldn't update favorites — see console for details");
      }
    });
  });
  container.querySelectorAll('.rc-overview-link').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      try{ openRecipeOverview(btn.dataset.id); }
      catch(err){ console.error('Recipe overview failed:', err); toast("Couldn't open the overview — see console for details"); }
    });
  });
  container.querySelectorAll('.rc-cook-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      try{
        const recipeId = btn.dataset.id;
        const missing = missingIngredientsForRecipe(state.recipes[recipeId]);
        if (missing.length === 0){
          openCookMode(recipeId);
        } else {
          openMissingIngredientsModal(recipeId, missing);
        }
      } catch(err){
        console.error('Cook button failed:', err);
        toast("Couldn't open that — see console for details");
      }
    });
  });
}
function renderRecipes(){
  renderRecipeCardsInto('recipe-list', 'recipe-sort-select', r => !r.isBaking,
    'No recipes yet. Click "+ New recipe" to add your first one.');
  renderRecipeCardsInto('baking-list', 'baking-sort-select', r => !!r.isBaking,
    'No baking recipes yet. Click "+ New baking recipe" to add your first one.');
}
document.getElementById('recipe-sort-select').addEventListener('change', renderRecipes);
document.getElementById('baking-sort-select').addEventListener('change', renderRecipes);
document.getElementById('shopping-sort-select').addEventListener('change', renderShoppingList);

document.getElementById('new-recipe-btn').addEventListener('click', ()=> openRecipeModal(null));
document.getElementById('new-baking-btn').addEventListener('click', ()=> openRecipeModal(null, { presetBaking: true }));

/* ============================================================
   RECIPE TEXT IMPORTER — modal wiring
   ============================================================ */
function findExistingIngredientIdByName(name){
  const key = name.trim().toLowerCase();
  const found = Object.entries(state.ingredients).find(([id, ing]) => (ing.name||'').trim().toLowerCase() === key);
  return found ? found[0] : null;
}

// Lightweight fuzzy matching for the import preview: suggests existing ingredients
// whose name is textually similar to (but not an exact match for) a parsed ingredient
// name — e.g. recipe says "chicken cutlets", library already has "Chicken Cutlet (my
// brand)". No exact-match guarantee, just a helpful nudge with a one-click way to
// accept it — the person still decides.
function normalizeForFuzzyMatch(str){
  return (str||'').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function roughSingular(word){
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}
function fuzzyNameSimilarity(a, b){
  const normA = normalizeForFuzzyMatch(a), normB = normalizeForFuzzyMatch(b);
  const wordsA = [...new Set(normA.split(' ').filter(Boolean))];
  const wordsB = [...new Set(normB.split(' ').filter(Boolean))];
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  let overlap = 0;
  wordsA.forEach(wa => {
    if (wordsB.some(wb => wa === wb || roughSingular(wa) === roughSingular(wb))) overlap++;
  });
  const union = new Set([...wordsA, ...wordsB]).size;
  let score = overlap / union; // Jaccard similarity over words, plural-tolerant
  if (normA.includes(normB) || normB.includes(normA)) score = Math.max(score, 0.6); // substring bonus
  return score;
}
function findSimilarIngredients(name, limit){
  const nameLower = name.trim().toLowerCase();
  const candidates = Object.entries(state.ingredients)
    .map(([id, ing]) => ({ id, ing, score: fuzzyNameSimilarity(name, ing.name) }))
    .filter(c => c.score >= 0.34 && (c.ing.name||'').trim().toLowerCase() !== nameLower);
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit || 3);
}

// Copies a readonly textarea's content to the clipboard, with a manual-select
// fallback for browsers/contexts where the Clipboard API isn't available.
async function copyPromptTextarea(textareaId){
  const ta = document.getElementById(textareaId);
  try{
    await navigator.clipboard.writeText(ta.value);
    toast('Prompt copied — paste it into a new message to Claude');
  } catch(err){
    ta.removeAttribute('readonly');
    ta.focus();
    ta.select();
    ta.setAttribute('readonly', '');
    toast("Couldn't auto-copy — text is selected, press Cmd/Ctrl+C");
  }
}
document.getElementById('copy-recipe-prompt-btn').addEventListener('click', ()=> copyPromptTextarea('import-recipe-prompt-text'));
document.getElementById('copy-ing-prompt-btn').addEventListener('click', ()=> copyPromptTextarea('import-ing-prompt-text'));

document.getElementById('import-recipe-btn').addEventListener('click', ()=>{
  state.editing.importTargetIsBaking = false;
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-paste-step').classList.remove('hidden');
  document.getElementById('import-preview-step').classList.add('hidden');
  state.editing.pendingImportCover = null;
  document.getElementById('import-recipe-cover-input').value = '';
  setImportRecipeCoverPreview(null);
  openModal('import-recipe-modal');
});
document.getElementById('import-baking-btn').addEventListener('click', ()=>{
  state.editing.importTargetIsBaking = true;
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-paste-step').classList.remove('hidden');
  document.getElementById('import-preview-step').classList.add('hidden');
  state.editing.pendingImportCover = null;
  document.getElementById('import-recipe-cover-input').value = '';
  setImportRecipeCoverPreview(null);
  openModal('import-recipe-modal');
});

function setImportRecipeCoverPreview(dataUrl){
  const preview = document.getElementById('import-recipe-cover-preview');
  const img = document.getElementById('import-recipe-cover-img');
  if (dataUrl){ img.src = dataUrl; preview.classList.remove('hidden'); }
  else { preview.classList.add('hidden'); img.src = ''; }
}
document.getElementById('import-recipe-cover-input').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try{
    const rawDataUrl = await readFileAsRawDataUrl(file);
    await openCropper(rawDataUrl, NaN, 800, 0.75, (croppedDataUrl)=>{
      state.editing.pendingImportCover = croppedDataUrl;
      setImportRecipeCoverPreview(croppedDataUrl);
    });
  } catch(err){
    toast("Couldn't read that image");
  }
  e.target.value = '';
});
document.getElementById('import-recipe-cover-remove').addEventListener('click', ()=>{
  state.editing.pendingImportCover = null;
  document.getElementById('import-recipe-cover-input').value = '';
  setImportRecipeCoverPreview(null);
});

document.getElementById('import-file-input').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try{
    const text = await file.text();
    document.getElementById('import-textarea').value = text;
  } catch(err){
    console.error('Could not read import file:', err);
    toast("Couldn't read that file");
  }
});

document.getElementById('import-preview-btn').addEventListener('click', ()=>{
  const raw = document.getElementById('import-textarea').value;
  const parsed = parseRecipeImportText(raw);
  if (!parsed.hasAnyContent){
    toast('Nothing recognized — check the text matches the expected format');
    return;
  }
  if (parsed.ingredients.length === 0){
    toast('No ingredient lines found (expected lines starting with "- ")');
    return;
  }

  // Resolve each parsed ingredient to an existing match, a detailed-data block from
  // this same import, or "will create new" with just common-database defaults.
  const resolved = parsed.ingredients.map(ing => {
    const existingId = findExistingIngredientIdByName(ing.name);
    let detailedMatch = null;
    if (!existingId && parsed.ingredientDetails.length){
      const exact = parsed.ingredientDetails.find(d => d.name.trim().toLowerCase() === ing.name.trim().toLowerCase());
      if (exact){
        detailedMatch = exact;
      } else {
        let best = null, bestScore = 0;
        parsed.ingredientDetails.forEach(d => {
          const score = fuzzyNameSimilarity(ing.name, d.name);
          if (score > bestScore){ bestScore = score; best = d; }
        });
        if (best && bestScore >= 0.5) detailedMatch = best;
      }
    }
    const common = (existingId || detailedMatch) ? null : lookupCommonIngredient(ing.name);
    return { ...ing, existingId, common, detailedMatch };
  });
  state.editing.pendingImport = { name: parsed.name, baseServings: parsed.baseServings, steps: parsed.steps, resolved };

  document.getElementById('import-preview-title').textContent = parsed.name || '(no title found)';
  const newCount = resolved.filter(r => !r.existingId).length;
  const detailedCount = resolved.filter(r => !r.existingId && r.detailedMatch).length;
  document.getElementById('import-preview-meta').textContent =
    `Makes ${parsed.baseServings} servings · ${resolved.length} ingredient${resolved.length!==1?'s':''} `
    + `(${newCount} new${detailedCount ? `, ${detailedCount} with full nutrition/pricing data` : ''}) · `
    + `${parsed.steps.length} step${parsed.steps.length!==1?'s':''}`;

  document.getElementById('import-preview-ingredients').innerHTML = resolved.map((r, idx) => {
    const icon = r.existingId ? ingredientIconHtml(state.ingredients[r.existingId])
      : (r.detailedMatch ? r.detailedMatch.data.emoji : (r.common ? r.common.emoji : '🛒'));
    let badge;
    if (r.existingId) badge = `<span class="import-status-badge matched">matched</span>`;
    else if (r.detailedMatch) badge = `<span class="import-status-badge detailed">new — full data</span>`;
    else badge = `<span class="import-status-badge new">new ingredient</span>`;
    const detailedSummary = (!r.existingId && r.detailedMatch) ? (() => {
      const d = r.detailedMatch.data;
      const storeCount = Object.keys(d.prices||{}).length;
      const bits = [`${formatQty(d.calories)} kcal/${UNIT_LABEL[d.unit]||d.unit}`, `tracked as: ${UNIT_LABEL[d.unit]||d.unit}`];
      if (d.category) bits.push(d.category);
      if (storeCount) bits.push(`priced at ${storeCount} store${storeCount>1?'s':''}`);
      return `<div class="import-detailed-summary">📋 ${escapeHtml(bits.join(' · '))}</div>`;
    })() : '';
    let resolveControls = '';
    if (!r.existingId){
      const similar = findSimilarIngredients(r.name, 3);
      const similarHtml = similar.length ? `
        <div class="import-similar-suggestion">
          <span class="import-similar-icon">💡</span>
          <span>Looks similar to something already in your library — not an exact match, so it's still
            marked "new" unless you pick one:</span>
          <div class="import-similar-options">
            ${similar.map(m => `<button type="button" class="btn btn-ghost btn-small import-similar-pick" data-existing-id="${m.id}">
              ${ingredientIconHtml(m.ing)} ${escapeHtml(m.ing.name)}
            </button>`).join('')}
          </div>
        </div>` : '';
      resolveControls = `
      <div class="import-resolve-row" data-idx="${idx}" data-choice="new">
        ${similarHtml}
        <div class="cu-dir-toggle">
          <button type="button" class="cu-dir-btn active" data-choice="new">Create new ingredient</button>
          <button type="button" class="cu-dir-btn" data-choice="existing">Use an existing ingredient instead</button>
        </div>
        <div class="import-resolve-combo hidden">
          ${ingredientComboHtml(`class="import-resolve-existing-id" value=""`)}
        </div>
        <div class="import-resolve-photo-row">
          <img class="import-resolve-photo-thumb hidden" alt="" />
          <label>Photo <span style="font-weight:400;color:var(--ink-soft)">(optional)</span>
            <input type="file" accept="image/*" class="import-resolve-photo-input" data-idx="${idx}" />
          </label>
        </div>
      </div>`;
    }
    return `<div class="cook-ing-item">
      <span class="s-emoji">${icon}</span>
      <span class="cook-ing-name">${escapeHtml(r.name)}${r.approximate ? ' <span class="hint" style="display:inline;">(amount not given in text)</span>' : ''}</span>
      <span class="cook-ing-qty">${formatQty(r.qty)} ${UNIT_LABEL[r.unit]||r.unit}</span>
      ${badge}
    </div>${detailedSummary}${resolveControls}`;
  }).join('');

  // Wire up the "create new" / "use existing" toggle and its search box for every
  // unmatched row.
  document.querySelectorAll('#import-preview-ingredients .import-resolve-row').forEach(rowEl => {
    const comboWrap = rowEl.querySelector('.import-resolve-combo');
    mountIngredientCombo(comboWrap, '.import-resolve-existing-id');
    rowEl.querySelectorAll('.cu-dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.choice;
        rowEl.dataset.choice = choice;
        rowEl.querySelectorAll('.cu-dir-btn').forEach(b => b.classList.toggle('active', b === btn));
        comboWrap.classList.toggle('hidden', choice !== 'existing');
      });
    });
    // One-click accept for a suggested fuzzy match: switches this row straight to
    // "use existing" with that ingredient already picked, no manual search needed.
    rowEl.querySelectorAll('.import-similar-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const existingId = btn.dataset.existingId;
        rowEl.dataset.choice = 'existing';
        rowEl.querySelectorAll('.cu-dir-btn').forEach(b => b.classList.toggle('active', b.dataset.choice === 'existing'));
        comboWrap.classList.remove('hidden');
        const hiddenInput = comboWrap.querySelector('.import-resolve-existing-id');
        const searchInput = comboWrap.querySelector('.ing-combo-search');
        hiddenInput.value = existingId;
        searchInput.value = state.ingredients[existingId] ? state.ingredients[existingId].name : '';
      });
    });
    const photoInput = rowEl.querySelector('.import-resolve-photo-input');
    photoInput.addEventListener('change', async (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      const idx = Number(photoInput.dataset.idx);
      try{
        const rawDataUrl = await readFileAsRawDataUrl(file);
        await openCropper(rawDataUrl, 1, 240, 0.8, (croppedDataUrl)=>{
          resolved[idx].photo = croppedDataUrl;
          const thumb = rowEl.querySelector('.import-resolve-photo-thumb');
          thumb.src = croppedDataUrl;
          thumb.classList.remove('hidden');
        });
      } catch(err){
        toast("Couldn't read that image");
      }
      photoInput.value = '';
    });
  });

  document.getElementById('import-preview-steps-count').textContent =
    parsed.steps.length ? `${parsed.steps.length} numbered step${parsed.steps.length!==1?'s':''} found.` : 'No numbered steps found.';

  document.getElementById('import-paste-step').classList.add('hidden');
  document.getElementById('import-preview-step').classList.remove('hidden');
});

document.getElementById('import-back-btn').addEventListener('click', ()=>{
  document.getElementById('import-preview-step').classList.add('hidden');
  document.getElementById('import-paste-step').classList.remove('hidden');
});

document.getElementById('import-confirm-btn').addEventListener('click', async ()=>{
  const pending = state.editing.pendingImport;
  if (!pending) return;
  const btn = document.getElementById('import-confirm-btn');
  if (btn.disabled) return;

  // Apply any manual resolution choices made in the preview: redirecting an
  // otherwise-"new" ingredient to an existing one instead of creating a duplicate.
  let unresolvedChoice = false;
  document.querySelectorAll('#import-preview-ingredients .import-resolve-row').forEach(rowEl => {
    const idx = Number(rowEl.dataset.idx);
    if (rowEl.dataset.choice === 'existing'){
      const chosenId = rowEl.querySelector('.import-resolve-existing-id').value;
      if (chosenId) pending.resolved[idx].existingId = chosenId;
      else unresolvedChoice = true;
    }
  });
  if (unresolvedChoice){
    toast('Pick an existing ingredient for each row set to "use an existing ingredient" — or switch it back to "create new"');
    return;
  }

  btn.disabled = true;
  try{
    let createdCount = 0;
    const newlyCreatedByName = {}; // dedupe if the same new ingredient name appears twice in one import
    const recipeIngredients = [];
    for (const r of pending.resolved){
      let ingredientId = r.existingId;
      if (!ingredientId){
        const key = r.name.trim().toLowerCase();
        if (newlyCreatedByName[key]){
          ingredientId = newlyCreatedByName[key];
        } else {
          // A full INGREDIENT detail block for this ingredient (from the same paste)
          // takes priority over the built-in common-ingredients database — it's more
          // specific, and can include pricing/aisle/density data the built-in list
          // doesn't have at all.
          const data = r.detailedMatch
            ? (() => { const { gramsPerCupWasExplicit, ...rest } = r.detailedMatch.data; return { ...rest, name: r.name, photo: r.photo || null, createdAt: serverTimestamp(), needsReview: false }; })()
            : {
                name: r.name,
                emoji: r.common ? r.common.emoji : '🛒',
                photo: r.photo || null,
                unit: r.common ? r.common.unit : r.unit,
                isCustomUnit: false,
                customUnits: [],
                calories: r.common ? r.common.calories : 0,
                gramsPerCup: 0,
                packaged: false,
                isSpice: false,
                isBlend: false,
                blendComponents: [],
                prices: {},
                createdAt: serverTimestamp(),
                // No matching entry in the built-in common-ingredients database means
                // this was created blind — no real calories, no price. Flag it so it's
                // obvious on the Ingredients tab that it needs a human to fill it in.
                needsReview: !r.common
              };
          const docRef = await addDoc(sharedCol(SHARED_INGREDIENTS_COLLECTION), data);
          ingredientId = docRef.id;
          state.ingredients[ingredientId] = data;
          newlyCreatedByName[key] = ingredientId;
          createdCount++;
        }
      }
      recipeIngredients.push({ ingredientId, qty: r.qty, unit: r.unit });
    }

    const recipeData = {
      name: pending.name || 'Imported recipe',
      baseServings: pending.baseServings || 1,
      ingredients: recipeIngredients,
      steps: pending.steps.map(text => ({ text, photo: null })),
      coverPhoto: state.editing.pendingImportCover || null,
      isBaking: !!state.editing.importTargetIsBaking
    };
    await addDoc(sharedCol(SHARED_RECIPES_COLLECTION), recipeData);

    state.editing.pendingImport = null;
    state.editing.pendingImportCover = null;
    closeModals();
    toast(`Imported "${recipeData.name}" — ${recipeIngredients.length} ingredients (${createdCount} new), ${pending.steps.length} steps`);
  } catch(err){
    console.error('Recipe import failed:', err);
    toast("Couldn't import that recipe — see console for details");
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   DETAILED INGREDIENT DATA IMPORTER — modal wiring
   ============================================================ */
document.getElementById('import-ingredient-btn').addEventListener('click', ()=>{
  document.getElementById('import-ing-textarea').value = '';
  document.getElementById('import-ing-file-input').value = '';
  document.getElementById('import-ing-paste-step').classList.remove('hidden');
  document.getElementById('import-ing-preview-step').classList.add('hidden');
  openModal('import-ingredient-modal');
});

document.getElementById('import-ing-file-input').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try{
    document.getElementById('import-ing-textarea').value = await file.text();
  } catch(err){
    console.error('Could not read import file:', err);
    toast("Couldn't read that file");
  }
});

document.getElementById('import-ing-preview-btn').addEventListener('click', ()=>{
  const raw = document.getElementById('import-ing-textarea').value;
  let parsed;
  try{
    parsed = parseIngredientImportText(raw);
  } catch(err){
    console.error('Ingredient import parse failed:', err);
    toast("Couldn't parse that text — check it matches the expected format");
    return;
  }
  if (parsed.length === 0){
    toast('No "INGREDIENT" blocks found — check the text matches the expected format');
    return;
  }

  const resolved = parsed.map(p => ({
    name: p.name,
    data: p.data,
    existingId: findExistingIngredientIdByName(p.name)
  }));
  state.editing.pendingIngredientImport = resolved;

  document.getElementById('import-ing-preview-list').innerHTML = resolved.map((r, i) => {
    const unitLabel = UNIT_LABEL[r.data.unit] || r.data.unit;
    const storeLines = Object.entries(r.data.prices).map(([store, p]) =>
      `${store}: $${p.price.toFixed(2)} / ${formatQty(p.packageSize)} ${unitLabel}`).join(' · ');
    const customUnitLines = r.data.customUnits.map(c =>
      `1 ${c.name} = ${formatQty(c.factor)} ${unitLabel}`).join(', ');
    const badge = r.existingId
      ? `<span class="import-status-badge matched">updates existing</span>`
      : `<span class="import-status-badge new">new ingredient</span>`;
    return `<div class="import-ing-card" data-idx="${i}">
      <div class="import-ing-card-head">
        <span class="s-emoji">${r.data.emoji}</span>
        <h4>${escapeHtml(r.name)}</h4>
        ${badge}
      </div>
      <div class="import-ing-detail-list">
        <span><strong>Tracked as:</strong> ${unitLabel}</span>
        <span><strong>Calories:</strong> ${formatQty(r.data.calories)} kcal/${unitLabel}</span>
        ${r.data.category ? `<span><strong>Grocery aisle:</strong> ${escapeHtml(r.data.category)}</span>` : ''}
        ${r.data.gramsPerCup ? `<span><strong>Grams per cup:</strong> ${formatQty(r.data.gramsPerCup)} g (lets recipes use plain "cup" too)</span>` : ''}
        ${customUnitLines ? `<span><strong>Custom units:</strong> ${escapeHtml(customUnitLines)}</span>` : ''}
        ${r.data.packaged ? `<span><strong>Packaged:</strong> yes</span>` : ''}
        ${storeLines ? `<span><strong>Prices:</strong> ${escapeHtml(storeLines)}</span>` : '<span>No recognized store prices found</span>'}
      </div>
      <div class="import-ing-photo-row">
        <img class="import-ing-photo-thumb hidden" alt="" />
        <label>Photo <span style="font-weight:400;color:var(--ink-soft)">(optional)</span>
          <input type="file" accept="image/*" class="import-ing-photo-input" data-idx="${i}" />
        </label>
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('.import-ing-photo-input').forEach(input => {
    input.addEventListener('change', async (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      const idx = Number(input.dataset.idx);
      try{
        const rawDataUrl = await readFileAsRawDataUrl(file);
        await openCropper(rawDataUrl, 1, 240, 0.8, (croppedDataUrl)=>{
          resolved[idx].photo = croppedDataUrl;
          const card = document.querySelector(`.import-ing-card[data-idx="${idx}"]`);
          const thumb = card.querySelector('.import-ing-photo-thumb');
          thumb.src = croppedDataUrl;
          thumb.classList.remove('hidden');
        });
      } catch(err){
        toast("Couldn't read that image");
      }
      input.value = '';
    });
  });

  document.getElementById('import-ing-paste-step').classList.add('hidden');
  document.getElementById('import-ing-preview-step').classList.remove('hidden');
});

document.getElementById('import-ing-back-btn').addEventListener('click', ()=>{
  document.getElementById('import-ing-preview-step').classList.add('hidden');
  document.getElementById('import-ing-paste-step').classList.remove('hidden');
});

document.getElementById('import-ing-confirm-btn').addEventListener('click', async ()=>{
  const pending = state.editing.pendingIngredientImport;
  if (!pending || !pending.length) return;
  const btn = document.getElementById('import-ing-confirm-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  try{
    let created = 0, updated = 0;
    for (const r of pending){
      if (r.existingId){
        // Merge onto the existing doc — keep its photo/emoji/isSpice/etc. as-is,
        // but the imported data fully owns unit/calories/customUnits/packaged/prices
        // since that's exactly what this format describes. A newly-uploaded photo
        // (if the person added one during this import) takes priority; otherwise the
        // existing photo is left untouched.
        const existing = state.ingredients[r.existingId] || {};
        const { gramsPerCupWasExplicit, ...importedData } = r.data;
        const merged = {
          ...existing,
          ...importedData,
          emoji: existing.emoji || importedData.emoji,
          photo: r.photo || existing.photo || null,
          isSpice: !!existing.isSpice,
          isBlend: !!existing.isBlend,
          blendComponents: existing.blendComponents || [],
          // Only overwrite an existing density value if this import actually gave an
          // explicit one — a water-density approximation (used when a liquid had no
          // real density data) shouldn't silently clobber a value someone corrected
          // by hand, any more than a re-import with no DENSITY_CONVERSION at all should.
          gramsPerCup: gramsPerCupWasExplicit ? importedData.gramsPerCup : (existing.gramsPerCup || importedData.gramsPerCup || 0),
          gramsPerEach: importedData.gramsPerEach || existing.gramsPerEach || 0,
          // Same idea for the base unit itself: only switch it if this import
          // explicitly determined "each" is right (via grams_per_each) — otherwise
          // keep whatever unit the ingredient already had rather than silently
          // reverting an "each"-based ingredient back to grams.
          unit: importedData.gramsPerEach > 0 ? importedData.unit : (existing.unit || importedData.unit),
          category: importedData.category || existing.category || ''
        };
        await setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, r.existingId), merged);
        updated++;
      } else {
        const { gramsPerCupWasExplicit, ...importedData } = r.data;
        await addDoc(sharedCol(SHARED_INGREDIENTS_COLLECTION), { ...importedData, photo: r.photo || null, createdAt: serverTimestamp() });
        created++;
      }
    }
    state.editing.pendingIngredientImport = null;
    closeModals();
    toast(`Imported ${pending.length} ingredient${pending.length!==1?'s':''} — ${created} new, ${updated} updated`);
  } catch(err){
    console.error('Ingredient data import failed:', err);
    toast("Couldn't import — see console for details");
  } finally {
    btn.disabled = false;
  }
});
/* ---- "missing ingredients" confirmation before Cook Mode ---- */
function openMissingIngredientsModal(recipeId, missing, servingsOverride){
  state.editing.pendingCookRecipeId = recipeId;
  state.editing.pendingCookServingsOverride = servingsOverride || null;
  document.getElementById('cook-confirm-recipe-name').textContent = state.recipes[recipeId]?.name || '';
  document.getElementById('cook-confirm-missing-list').innerHTML = missing.map(m => `
    <div class="missing-item">
      <span class="s-emoji">${ingredientIconHtml(m.ing)}</span>
      <span class="missing-name">${escapeHtml(m.ing.name)}</span>
      <span class="missing-amounts">need ${formatQty(m.needed)} ${UNIT_LABEL[m.ing.unit]||m.ing.unit} · have ${formatQty(m.have)}</span>
    </div>`).join('');
  openModal('cook-confirm-modal');
}
document.getElementById('cook-confirm-cancel-btn').addEventListener('click', closeModals);
document.getElementById('cook-confirm-anyway-btn').addEventListener('click', ()=>{
  try{
    const recipeId = state.editing.pendingCookRecipeId;
    const servingsOverride = state.editing.pendingCookServingsOverride;
    closeModals();
    if (recipeId) openCookMode(recipeId, servingsOverride);
    else toast("Couldn't tell which recipe — try clicking Cook again");
  } catch(err){
    console.error('"Cook anyway" failed:', err);
    toast("Couldn't open Cook Mode — see console for details");
  }
});

/* ============================================================
   COOK MODE — full-screen: gather ingredients + scroll through steps
   ============================================================ */
// Shared display for a recipe ingredient's substitute options — used in Cook Mode,
// Recipe Overview, and the missing-ingredients popup.
function substitutesHtml(subs){
  if (!subs || !subs.length) return '';
  const lines = subs.map(sub => {
    const ing = state.ingredients[sub.ingredientId];
    if (!ing) return '';
    return `<div class="ri-sub-display-row"><span>${ingredientIconHtml(ing)} ${escapeHtml(ing.name)}</span><span>${formatQty(sub.qty)} ${UNIT_LABEL[sub.unit]||sub.unit}</span></div>`;
  }).filter(Boolean).join('');
  if (!lines) return '';
  return `<div class="ri-sub-display"><span class="ri-sub-display-title">↔ Substitute with:</span>${lines}</div>`;
}

function openCookMode(recipeId, servingsOverride){
  const r = state.recipes[recipeId];
  if (!r) return;
  state.editing.cookingRecipeId = recipeId;
  // When cooking a specific planned meal that used a different batch size than the
  // recipe's own base servings (e.g. doubling a 4-serving recipe to make 8), scale
  // every ingredient amount shown here to match — and remember that scale so "I
  // cooked this" subtracts the correct (scaled) amounts from pantry, not the
  // recipe's unscaled base amounts.
  const scale = (servingsOverride && r.baseServings) ? (Number(servingsOverride) / r.baseServings) : 1;
  state.editing.cookingScale = scale;

  document.getElementById('cook-recipe-title').textContent = r.name;
  document.getElementById('cook-servings-label').textContent =
    `makes ${servingsOverride ? formatQty(servingsOverride) : r.baseServings}`;

  const ingList = document.getElementById('cook-ingredient-list');
  const rowsHtml = (r.ingredients||[]).map(ri => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return '';
    const unit = ri.unit || ing.unit;
    const qty = (Number(ri.qty)||0) * scale;
    const breakdown = ing.isBlend ? blendBreakdownHtml(ing, convertToIngredientUnit(qty, unit, ing) ?? 0) : '';
    return `<label class="cook-ing-item">
      <input type="checkbox" />
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="cook-ing-name">${escapeHtml(ing.name)}</span>
      <span class="cook-ing-qty">${formatQty(qty)} ${UNIT_LABEL[unit]||unit}</span>
    </label>${breakdown}${substitutesHtml(ri.subs)}`;
  }).join('');
  ingList.innerHTML = rowsHtml || '<p class="shop-empty">No ingredients listed for this recipe.</p>';
  ingList.querySelectorAll('.cook-ing-item').forEach(item=>{
    item.querySelector('input').addEventListener('change', (e)=> item.classList.toggle('checked', e.target.checked));
  });

  const stepsList = document.getElementById('cook-steps-list');
  const steps = r.steps || [];
  stepsList.innerHTML = steps.length ? steps.map((s, i) => {
    const text = typeof s === 'string' ? s : (s.text || '');
    const photo = (s && typeof s === 'object') ? s.photo : null;
    return `<div class="cook-step-card">
      <div class="cook-step-num">Step ${i+1} of ${steps.length}</div>
      ${photo ? `<img class="cook-step-photo" src="${photo}" alt="" />` : ''}
      <p class="cook-step-text">${escapeHtml(text)}</p>
    </div>`;
  }).join('') : '<p class="shop-empty">No steps added for this recipe yet.</p>';

  document.getElementById('cook-overlay').classList.remove('hidden');
  document.getElementById('cook-overlay').scrollTop = 0;
}
document.getElementById('cook-close-btn').addEventListener('click', ()=>{
  document.getElementById('cook-overlay').classList.add('hidden');
});
document.getElementById('cook-done-btn').addEventListener('click', async ()=>{
  const recipeId = state.editing.cookingRecipeId;
  const r = state.recipes[recipeId];
  if (!r){ toast("Couldn't tell which recipe this was"); return; }
  const btn = document.getElementById('cook-done-btn');
  btn.disabled = true;
  try{
    const writes = [];
    const scale = state.editing.cookingScale || 1;
    (r.ingredients||[]).forEach(ri => {
      const ing = state.ingredients[ri.ingredientId];
      if (!ing) return;
      const rowUnit = ri.unit || ing.unit;
      const usedQtyInIngUnit = convertToIngredientUnit((Number(ri.qty)||0) * scale, rowUnit, ing);
      if (usedQtyInIngUnit === null || usedQtyInIngUnit <= 0) return;
      const haveQty = Number(state.pantry[ri.ingredientId]?.qty) || 0;
      const newQty = Math.max(0, haveQty - usedQtyInIngUnit);
      writes.push(newQty > 0
        ? setDoc(doc(db,'users',state.uid,'pantry', ri.ingredientId), { qty: newQty })
        : deleteDoc(doc(db,'users',state.uid,'pantry', ri.ingredientId)).catch(()=>{}));
    });
    await Promise.all(writes);
    toast(`Pantry updated — ingredients for ${r.name} removed`);
    document.getElementById('cook-overlay').classList.add('hidden');
  } catch(err){
    console.error('"I cooked this" failed:', err);
    toast("Couldn't update your pantry — see console for details");
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   RECIPE OVERVIEW — simple single-screen read view (no checklists, no cards)
   ============================================================ */
function openRecipeOverview(recipeId){
  const r = state.recipes[recipeId];
  if (!r) return;

  document.getElementById('overview-recipe-title').textContent = r.name;
  document.getElementById('overview-servings').textContent = `makes ${r.baseServings} servings`;

  const coverImg = document.getElementById('overview-cover-img');
  if (r.coverPhoto){
    coverImg.src = r.coverPhoto;
    coverImg.classList.remove('hidden');
  } else {
    coverImg.classList.add('hidden');
    coverImg.src = '';
  }

  const ingList = document.getElementById('overview-ingredient-list');
  const ingRows = (r.ingredients||[]).map(ri => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return '';
    const unit = ri.unit || ing.unit;
    const qty = Number(ri.qty)||0;
    const breakdown = ing.isBlend ? blendBreakdownHtml(ing, convertToIngredientUnit(qty, unit, ing) ?? 0) : '';
    return `<div class="cook-ing-item">
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="cook-ing-name">${escapeHtml(ing.name)}</span>
      <span class="cook-ing-qty">${formatQty(qty)} ${UNIT_LABEL[unit]||unit}</span>
    </div>${breakdown}${substitutesHtml(ri.subs)}`;
  }).join('');
  ingList.innerHTML = ingRows || '<p class="shop-empty">No ingredients listed for this recipe.</p>';

  const stepsList = document.getElementById('overview-steps-list');
  const steps = r.steps || [];
  stepsList.innerHTML = steps.length ? steps.map(s => {
    const text = typeof s === 'string' ? s : (s.text || '');
    const photo = (s && typeof s === 'object') ? s.photo : null;
    return `<li>${escapeHtml(text)}${photo ? `<img src="${photo}" alt="" />` : ''}</li>`;
  }).join('') : '<li class="shop-empty" style="list-style:none;margin-left:-22px;">No steps added for this recipe yet.</li>';

  openModal('recipe-overview-modal');
}

/* ============================================================
   RECIPE MODAL
   ============================================================ */
const recipeIngredientsEl = document.getElementById('recipe-ingredients');
const recipeStepsEl = document.getElementById('recipe-steps');
const recipeCoverInput = document.getElementById('recipe-cover-input');
const recipeCoverPreview = document.getElementById('recipe-cover-preview');
const recipeCoverImg = document.getElementById('recipe-cover-img');

function openRecipeModal(recipeId, opts){
  opts = opts || {};
  state.editing.recipeId = recipeId;
  const r = recipeId ? state.recipes[recipeId] : { name:'', baseServings:4, ingredients:[], steps:[], coverPhoto:null, isBaking: !!opts.presetBaking };

  document.getElementById('recipe-modal-title').textContent = recipeId ? 'Edit recipe' : (opts.presetBaking ? 'New baking recipe' : 'New recipe');
  document.getElementById('recipe-name').value = r.name || '';
  document.getElementById('recipe-servings').value = r.baseServings || 4;
  document.getElementById('recipe-is-baking').checked = !!r.isBaking;

  state.editing.recipeCover = r.coverPhoto || null;
  recipeCoverInput.value = '';
  setRecipeCoverPreview(state.editing.recipeCover);

  recipeIngredientsEl.innerHTML = '';
  (r.ingredients && r.ingredients.length ? r.ingredients : [{ingredientId:'', qty:''}])
    .forEach(ri => addRecipeIngredientRow(ri));

  recipeStepsEl.innerHTML = '';
  (r.steps && r.steps.length ? r.steps : [''])
    .forEach(s => addRecipeStepRow(s));

  document.getElementById('delete-recipe-btn').classList.toggle('hidden', !recipeId);
  openModal('recipe-modal');
}

function setRecipeCoverPreview(dataUrl){
  if (dataUrl){
    recipeCoverImg.src = dataUrl;
    recipeCoverPreview.classList.remove('hidden');
  } else {
    recipeCoverPreview.classList.add('hidden');
    recipeCoverImg.src = '';
  }
}
recipeCoverInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try{
    const rawDataUrl = await readFileAsRawDataUrl(file);
    await openCropper(rawDataUrl, NaN, 800, 0.75, (croppedDataUrl)=>{
      state.editing.recipeCover = croppedDataUrl;
      setRecipeCoverPreview(croppedDataUrl);
    });
  } catch(err){
    toast("Couldn't read that image");
  }
  recipeCoverInput.value = '';
});
document.getElementById('recipe-cover-remove').addEventListener('click', ()=>{
  state.editing.recipeCover = null;
  recipeCoverInput.value = '';
  setRecipeCoverPreview(null);
});

// Reusable "type to search" ingredient picker. Give it a hidden <input> (matching
// hiddenSelector) that holds the actual selected ingredientId — existing code that
// reads/listens on that hidden input keeps working unchanged, since we still set its
// .value and dispatch a real 'change' event on it.
function ingredientComboLabel(ing){
  return ing ? `${ing.emoji || '🥕'} ${ing.name}` : '';
}
function ingredientComboHtml(hiddenAttrs){
  return `<div class="ing-combo">
    <input type="text" class="ing-combo-search" placeholder="Search ingredients…" autocomplete="off" />
    <input type="hidden" ${hiddenAttrs} />
    <div class="ing-combo-list hidden"></div>
  </div>`;
}
function mountIngredientCombo(root, hiddenSelector, filterFn){
  const searchInput = root.querySelector('.ing-combo-search');
  const hiddenInput = root.querySelector(hiddenSelector);
  const listEl = root.querySelector('.ing-combo-list');

  function renderList(filterText){
    if (!listEl.isConnected) return; // row was removed since this was scheduled
    const q = (filterText||'').trim().toLowerCase();
    let ids = Object.keys(state.ingredients);
    if (filterFn) ids = ids.filter(id => filterFn(state.ingredients[id]));
    ids = ids.filter(id => !q || state.ingredients[id].name.toLowerCase().includes(q));
    listEl.innerHTML = ids.length
      ? ids.slice(0,50).map(id => `<div class="ing-combo-item" data-id="${id}">${ingredientComboLabel(state.ingredients[id])}</div>`).join('')
      : `<div class="ing-combo-empty">No matches — add it on the Ingredients tab first</div>`;
    listEl.classList.remove('hidden');
  }
  function selectIngredient(id){
    if (!hiddenInput.isConnected) return;
    hiddenInput.value = id;
    searchInput.value = state.ingredients[id] ? state.ingredients[id].name : '';
    listEl.classList.add('hidden');
    hiddenInput.dispatchEvent(new Event('change', { bubbles:true }));
  }

  searchInput.addEventListener('focus', ()=> renderList(''));
  searchInput.addEventListener('input', ()=>{ hiddenInput.value=''; renderList(searchInput.value); });
  listEl.addEventListener('mousedown', (e)=>{ // mousedown fires before the input's blur
    const item = e.target.closest('.ing-combo-item');
    if (item) selectIngredient(item.dataset.id);
  });
  searchInput.addEventListener('blur', ()=>{
    setTimeout(()=>{
      // The row (and this whole combo) may have been removed from the DOM in the 150ms
      // since blur fired — e.g. the modal was closed/reopened for a different recipe.
      // Touching a detached node here was an intermittent source of save errors.
      if (!listEl.isConnected || !searchInput.isConnected) return;
      listEl.classList.add('hidden');
      // revert the visible text to match whatever's actually selected, in case they
      // typed to search but clicked away without picking anything
      const ing = state.ingredients[hiddenInput.value];
      searchInput.value = ing ? ing.name : '';
    }, 150);
  });

  const preselected = state.ingredients[hiddenInput.value];
  if (preselected) searchInput.value = preselected.name;
}

function addRecipeIngredientRow(ri = {ingredientId:'', qty:'', unit:'', subs:[]}){
  const wrap = document.createElement('div');
  wrap.className = 'ri-row-wrap';

  const row = document.createElement('div');
  row.className = 'ri-row';
  const initialIng = ri.ingredientId ? state.ingredients[ri.ingredientId] : null;
  const initialUnit = ri.unit || (initialIng ? initialIng.unit : 'g');
  row.innerHTML = `
    ${ingredientComboHtml(`class="ri-ingredient" value="${ri.ingredientId||''}"`)}
    <input type="number" class="ri-qty" placeholder="qty" step="any" min="0" value="${ri.qty ?? ''}" />
    <select class="ri-unit">${unitOptionsHtml(initialUnit, initialIng)}</select>
    <button type="button" class="ri-remove">✕</button>`;
  mountIngredientCombo(row.querySelector('.ing-combo'), '.ri-ingredient');
  row.querySelector('.ri-ingredient').addEventListener('change', (e)=>{
    const ing = state.ingredients[e.target.value];
    // rebuild the unit list for the newly-chosen ingredient (it may have its own custom units)
    row.querySelector('.ri-unit').innerHTML = unitOptionsHtml(ing ? ing.unit : 'g', ing);
  });
  row.querySelector('.ri-remove').addEventListener('click', ()=> wrap.remove());
  wrap.appendChild(row);

  const subsList = document.createElement('div');
  subsList.className = 'ri-subs-list';
  wrap.appendChild(subsList);

  const addSubBtn = document.createElement('button');
  addSubBtn.type = 'button';
  addSubBtn.className = 'ri-add-sub-link';
  addSubBtn.textContent = '+ Add substitute';
  addSubBtn.addEventListener('click', ()=> addRecipeSubRow(subsList));
  wrap.appendChild(addSubBtn);

  (ri.subs||[]).forEach(sub => addRecipeSubRow(subsList, sub));

  recipeIngredientsEl.appendChild(wrap);
}
// A substitute row lives nested under its "parent" ingredient — same combo-search
// pattern, just a smaller/indented row, with its own qty+unit since a substitute
// doesn't always swap in at the same amount (e.g. buttermilk -> 1 cup milk + 1 tbsp
// vinegar isn't representable here, but "1 cup yogurt" instead of "1 cup buttermilk" is).
function addRecipeSubRow(subsList, sub = {ingredientId:'', qty:'', unit:''}){
  const row = document.createElement('div');
  row.className = 'ri-sub-row';
  const initialIng = sub.ingredientId ? state.ingredients[sub.ingredientId] : null;
  const initialUnit = sub.unit || (initialIng ? initialIng.unit : 'g');
  row.innerHTML = `
    <span class="ri-sub-label">↔</span>
    ${ingredientComboHtml(`class="ri-sub-ingredient" value="${sub.ingredientId||''}"`)}
    <input type="number" class="ri-sub-qty" placeholder="qty" step="any" min="0" value="${sub.qty ?? ''}" />
    <select class="ri-sub-unit">${unitOptionsHtml(initialUnit, initialIng)}</select>
    <button type="button" class="ri-remove">✕</button>`;
  mountIngredientCombo(row.querySelector('.ing-combo'), '.ri-sub-ingredient');
  row.querySelector('.ri-sub-ingredient').addEventListener('change', (e)=>{
    const ing = state.ingredients[e.target.value];
    row.querySelector('.ri-sub-unit').innerHTML = unitOptionsHtml(ing ? ing.unit : 'g', ing);
  });
  row.querySelector('.ri-remove').addEventListener('click', ()=> row.remove());
  subsList.appendChild(row);
}
// Builds the <option> list for a recipe-row unit picker: the standard units, plus
// whichever custom unit(s) belong to the currently-selected ingredient (its own custom
// base unit, e.g. "bulb", and any custom sub-units defined on it, e.g. "clove").
function unitOptionsHtml(selected, ing){
  const seen = new Set();
  const opts = Object.keys(UNIT_LABEL).map(u => {
    seen.add(u);
    return `<option value="${u}" ${u===selected?'selected':''}>${UNIT_LABEL[u]}</option>`;
  });
  if (ing){
    const customNames = [];
    if (ing.isCustomUnit && ing.unit) customNames.push(ing.unit);
    (ing.customUnits||[]).forEach(c => { if (c.name) customNames.push(c.name); });
    customNames.forEach(name => {
      if (seen.has(name)) return; // e.g. a custom "each" from imported density data — the
      seen.add(name);              // custom definition still wins at conversion time either way
      opts.push(`<option value="${escapeHtml(name)}" ${name===selected?'selected':''}>${escapeHtml(name)}</option>`);
    });
  }
  return opts.join('');
}
document.getElementById('add-recipe-ingredient').addEventListener('click', ()=> addRecipeIngredientRow());

/* ============================================================
   SPICE BLEND EDITOR
   ============================================================ */
const blendComponentsEl = document.getElementById('blend-components');

function openBlendModal(ingId){
  state.editing.blendId = ingId;
  const ing = ingId ? state.ingredients[ingId] : { emoji:'🌶️', name:'', unit:'tsp', blendComponents:[] };
  document.getElementById('blend-modal-title').textContent = ingId ? 'Edit spice blend' : 'New spice blend';
  document.getElementById('blend-emoji').value = ing.emoji || '🌶️';
  document.getElementById('blend-name').value = ing.name || '';
  document.getElementById('blend-unit').value = ing.unit || 'tsp';

  blendComponentsEl.innerHTML = '';
  (ing.blendComponents && ing.blendComponents.length ? ing.blendComponents : [{ingredientId:'', qty:'', unit:'tsp'}])
    .forEach(comp => addBlendComponentRow(comp));

  refreshBlendYieldNote();
  document.getElementById('delete-blend-btn').classList.toggle('hidden', !ingId);
  openModal('blend-modal');
}

function addBlendComponentRow(comp = {ingredientId:'', qty:'', unit:'tsp'}){
  const row = document.createElement('div');
  row.className = 'ri-row';
  const initialIng = comp.ingredientId ? state.ingredients[comp.ingredientId] : null;
  const initialUnit = comp.unit || (initialIng ? initialIng.unit : 'tsp');
  row.innerHTML = `
    ${ingredientComboHtml(`class="blend-comp-ingredient" value="${comp.ingredientId||''}"`)}
    <input type="number" class="blend-comp-qty" placeholder="qty" step="any" min="0" value="${comp.qty ?? ''}" />
    <select class="blend-comp-unit">${unitOptionsHtml(initialUnit, initialIng)}</select>
    <button type="button" class="ri-remove">✕</button>`;
  // Only base spices (not other blends) can go into a blend — keeps things simple and
  // avoids any risk of a blend accidentally referencing itself.
  mountIngredientCombo(row.querySelector('.ing-combo'), '.blend-comp-ingredient', ing => ing.isSpice && !ing.isBlend);
  row.querySelector('.blend-comp-ingredient').addEventListener('change', (e)=>{
    const ing = state.ingredients[e.target.value];
    if (ing) row.querySelector('.blend-comp-unit').value = ing.unit;
    refreshBlendYieldNote();
  });
  row.querySelector('.blend-comp-qty').addEventListener('input', refreshBlendYieldNote);
  row.querySelector('.blend-comp-unit').addEventListener('change', refreshBlendYieldNote);
  row.querySelector('.ri-remove').addEventListener('click', ()=>{ row.remove(); refreshBlendYieldNote(); });
  blendComponentsEl.appendChild(row);
}
document.getElementById('add-blend-component').addEventListener('click', ()=>{
  addBlendComponentRow();
  refreshBlendYieldNote();
});

function currentBlendComponentsFromForm(){
  return Array.from(blendComponentsEl.querySelectorAll('.ri-row')).map(row => ({
    ingredientId: row.querySelector('.blend-comp-ingredient').value,
    qty: Number(row.querySelector('.blend-comp-qty').value) || 0,
    unit: row.querySelector('.blend-comp-unit').value
  })).filter(c => c.ingredientId && c.qty > 0);
}

function refreshBlendYieldNote(){
  const unit = document.getElementById('blend-unit').value;
  const components = currentBlendComponentsFromForm();
  const yieldAmt = blendYieldInOwnUnit({ unit, blendComponents: components, gramsPerCup: 0 });
  const note = document.getElementById('blend-yield-note');
  note.textContent = yieldAmt > 0
    ? `This mix makes about ${formatQty(yieldAmt)} ${UNIT_LABEL[unit]||unit} total — that's what recipes will scale against.`
    : 'Add spices with amounts above to see how much this makes.';
}
document.getElementById('blend-unit').addEventListener('change', refreshBlendYieldNote);

document.getElementById('save-blend-btn').addEventListener('click', async ()=>{
  const name = document.getElementById('blend-name').value.trim();
  if (!name){ toast('Give the blend a name'); return; }
  const components = currentBlendComponentsFromForm();
  if (components.length === 0){ toast('Add at least one spice to the blend'); return; }
  const unit = document.getElementById('blend-unit').value;

  const existingIng = state.editing.blendId ? state.ingredients[state.editing.blendId] : null;
  const calories = blendCaloriesPerOwnUnit({ unit, blendComponents: components, gramsPerCup: 0 });

  const data = {
    name,
    emoji: document.getElementById('blend-emoji').value.trim() || '🌶️',
    photo: existingIng ? (existingIng.photo || null) : null,
    unit,
    isCustomUnit: false,
    customUnits: [],
    calories,
    gramsPerCup: 0,
    packaged: existingIng ? !!existingIng.packaged : false,
    isSpice: false,
    isBlend: true,
    blendComponents: components,
    prices: existingIng ? (existingIng.prices || {}) : {},
    createdAt: existingIng ? (existingIng.createdAt || serverTimestamp()) : serverTimestamp()
  };

  if (state.editing.blendId){
    await setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, state.editing.blendId), data);
  } else {
    await addDoc(sharedCol(SHARED_INGREDIENTS_COLLECTION), data);
  }
  closeModals();
  toast('Spice blend saved');
});

document.getElementById('delete-blend-btn').addEventListener('click', async ()=>{
  if (!state.editing.blendId) return;
  if (!confirm('Delete this spice blend? It\'s shared, so this removes it for everyone using this planner, and any recipe using it will show a missing ingredient.')) return;
  await deleteDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, state.editing.blendId));
  closeModals();
  toast('Spice blend deleted');
});

/* ============================================================
   SPICES TAB — base spice have/need list + spice blend cards
   ============================================================ */
function renderSpicesTab(){
  const baseListEl = document.getElementById('base-spice-list');
  const baseSpices = Object.entries(state.ingredients).filter(([id,ing]) => ing.isSpice && !ing.isBlend);
  baseListEl.innerHTML = baseSpices.length ? baseSpices.map(([id, ing]) => {
    const have = (Number(state.pantry[id]?.qty)||0) > 0;
    return `<div class="spice-row" data-id="${id}">
      <span class="p-emoji">${ingredientIconHtml(ing)}</span>
      <span class="p-name">${escapeHtml(ing.name)}</span>
      <button type="button" class="spice-have-toggle ${have?'have':'need'}" data-id="${id}">${have ? '✅ Have it' : '🛒 Need to buy'}</button>
    </div>`;
  }).join('') : '<p class="shop-empty">No base spices yet — click "+ Add base spice" above to add your first one.</p>';

  baseListEl.querySelectorAll('.p-name').forEach(nameEl => {
    nameEl.addEventListener('click', ()=> openIngredientModal(nameEl.closest('.spice-row').dataset.id));
  });
  baseListEl.querySelectorAll('.spice-have-toggle').forEach(btn => {
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const have = (Number(state.pantry[id]?.qty)||0) > 0;
      if (have){
        await deleteDoc(doc(db,'users',state.uid,'pantry', id)).catch(()=>{});
      } else {
        await setDoc(doc(db,'users',state.uid,'pantry', id), { qty: 1 });
      }
    });
  });

  const blendListEl = document.getElementById('spice-blend-list');
  const blends = Object.entries(state.ingredients).filter(([id,ing]) => ing.isBlend);
  blendListEl.innerHTML = blends.length ? blends.map(([id, ing]) => {
    const badges = (ing.blendComponents||[]).slice(0,8).map(c => {
      const compIng = state.ingredients[c.ingredientId];
      return `<span class="ing-badge" title="${compIng?escapeHtml(compIng.name):''}">${ingredientIconHtml(compIng)}</span>`;
    }).join('');
    const yieldAmt = blendYieldInOwnUnit(ing);
    return `<div class="recipe-card" data-id="${id}">
      <h3>${ing.emoji||'🌶️'} ${escapeHtml(ing.name)}</h3>
      <div class="rc-servings">makes ${formatQty(yieldAmt)} ${UNIT_LABEL[ing.unit]||ing.unit}</div>
      <div class="rc-ingredients">${badges}</div>
    </div>`;
  }).join('') : '<p class="shop-empty">No spice blends yet — click "+ New spice blend" above to create your first mix.</p>';
  blendListEl.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', ()=> openBlendModal(card.dataset.id));
  });
}
document.getElementById('new-blend-btn').addEventListener('click', ()=> openBlendModal(null));

function addRecipeStepRow(step=''){
  const text = typeof step === 'string' ? step : (step.text || '');
  const photo = (step && typeof step === 'object') ? (step.photo || null) : null;

  const row = document.createElement('div');
  row.className = 'rs-row';
  row._photoData = photo;
  const num = recipeStepsEl.children.length + 1;
  row.innerHTML = `<span class="rs-num">${num}.</span>
    <div style="flex:1">
      <textarea class="rs-text" placeholder="Describe this step…">${escapeHtml(text)}</textarea>
      <div class="rs-photo-row">
        <img class="rs-photo-thumb ${photo?'':'hidden'}" src="${photo||''}" alt="" />
        <input type="file" accept="image/*" class="rs-photo-input" />
        <button type="button" class="rs-photo-remove btn btn-ghost btn-small ${photo?'':'hidden'}">Remove photo</button>
      </div>
    </div>
    <button type="button" class="rs-remove">✕</button>`;

  const thumb = row.querySelector('.rs-photo-thumb');
  const removeBtn = row.querySelector('.rs-photo-remove');
  const stepPhotoInput = row.querySelector('.rs-photo-input');
  stepPhotoInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    try{
      const rawDataUrl = await readFileAsRawDataUrl(file);
      await openCropper(rawDataUrl, NaN, 640, 0.65, (croppedDataUrl)=>{
        row._photoData = croppedDataUrl;
        thumb.src = croppedDataUrl; thumb.classList.remove('hidden');
        removeBtn.classList.remove('hidden');
      });
    } catch(err){ toast("Couldn't read that image"); }
    stepPhotoInput.value = '';
  });
  removeBtn.addEventListener('click', ()=>{
    row._photoData = null;
    thumb.src = ''; thumb.classList.add('hidden');
    removeBtn.classList.add('hidden');
    row.querySelector('.rs-photo-input').value = '';
  });
  row.querySelector('.rs-remove').addEventListener('click', ()=>{ row.remove(); renumberSteps(); });
  recipeStepsEl.appendChild(row);
}
document.getElementById('add-recipe-step').addEventListener('click', ()=> addRecipeStepRow());
function renumberSteps(){
  recipeStepsEl.querySelectorAll('.rs-row').forEach((row,i)=>{
    row.querySelector('.rs-num').textContent = (i+1)+'.';
  });
}

document.getElementById('save-recipe-btn').addEventListener('click', async ()=>{
  const name = document.getElementById('recipe-name').value.trim();
  const baseServings = Number(document.getElementById('recipe-servings').value)||1;
  if (!name){ toast('Give the recipe a name'); return; }

  const allWraps = Array.from(recipeIngredientsEl.querySelectorAll('.ri-row-wrap'));
  // Catch rows that look filled in but never actually got a valid ingredient picked from
  // the search list — e.g. typed a name and clicked away without selecting a result.
  // These used to just silently vanish on save, which looked like the app "lost" them.
  const halfFilled = allWraps.some(wrap => {
    const row = wrap.querySelector('.ri-row');
    const hasIngredient = !!row.querySelector('.ri-ingredient').value;
    const hasQty = Number(row.querySelector('.ri-qty').value) > 0;
    return hasQty && !hasIngredient;
  });
  if (halfFilled){
    toast('One of your ingredient rows has an amount but no ingredient selected — pick one from the search results');
    return;
  }
  const halfFilledSub = allWraps.some(wrap =>
    Array.from(wrap.querySelectorAll('.ri-sub-row')).some(subRow => {
      const hasIngredient = !!subRow.querySelector('.ri-sub-ingredient').value;
      const hasQty = Number(subRow.querySelector('.ri-sub-qty').value) > 0;
      return hasQty && !hasIngredient;
    })
  );
  if (halfFilledSub){
    toast('One of your substitute rows has an amount but no ingredient selected — pick one from the search results');
    return;
  }

  const ingredients = allWraps.map(wrap => {
    const row = wrap.querySelector('.ri-row');
    const subs = Array.from(wrap.querySelectorAll('.ri-sub-row')).map(subRow => ({
      ingredientId: subRow.querySelector('.ri-sub-ingredient').value,
      qty: Number(subRow.querySelector('.ri-sub-qty').value)||0,
      unit: subRow.querySelector('.ri-sub-unit').value
    })).filter(s => s.ingredientId && s.qty > 0);
    return {
      ingredientId: row.querySelector('.ri-ingredient').value,
      qty: Number(row.querySelector('.ri-qty').value)||0,
      unit: row.querySelector('.ri-unit').value,
      subs
    };
  }).filter(ri => ri.ingredientId && ri.qty > 0);

  const steps = Array.from(recipeStepsEl.querySelectorAll('.rs-row')).map(row => ({
    text: row.querySelector('.rs-text').value.trim(),
    photo: row._photoData || null
  })).filter(s => s.text || s.photo);

  const data = {
    name, baseServings, ingredients, steps,
    coverPhoto: state.editing.recipeCover || null,
    isBaking: document.getElementById('recipe-is-baking').checked
  };

  const btn = document.getElementById('save-recipe-btn');
  if (btn.disabled) return; // guard against a double-click firing two saves
  btn.disabled = true;
  try{
    if (state.editing.recipeId){
      await setDoc(doc(db, SHARED_RECIPES_COLLECTION, state.editing.recipeId), data);
    } else {
      await addDoc(sharedCol(SHARED_RECIPES_COLLECTION), data);
    }
    closeModals();
    toast('Recipe saved');
  } catch(err){
    console.error('Recipe save failed:', err);
    toast("Couldn't save the recipe — see console for details");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('delete-recipe-btn').addEventListener('click', async ()=>{
  if (!state.editing.recipeId) return;
  if (!confirm('Delete this recipe? It\'s shared, so this removes it for everyone using this planner. This cannot be undone.')) return;
  await deleteDoc(doc(db, SHARED_RECIPES_COLLECTION, state.editing.recipeId));
  closeModals();
  toast('Recipe deleted');
});

/* ============================================================
   RENDER: PANTRY
   ============================================================ */
function renderPantry(){
  const container = document.getElementById('pantry-list');
  const ids = Object.keys(state.ingredients);
  if (ids.length===0){
    container.innerHTML = '<p class="shop-empty">Add ingredients in the Ingredients tab first, then mark what you have here.</p>';
    return;
  }
  container.innerHTML = ids.map(id => {
    const ing = state.ingredients[id];
    const qty = state.pantry[id]?.qty ?? '';
    return `<div class="pantry-item" data-id="${id}">
      <span class="p-emoji">${ingredientIconHtml(ing)}</span>
      <span class="p-name">${escapeHtml(ing.name)}</span>
      <input type="number" class="p-qty" min="0" step="any" value="${qty}" placeholder="0" />
      <span class="p-unit">${UNIT_LABEL[ing.unit]||ing.unit}</span>
    </div>`;
  }).join('');

  container.querySelectorAll('.p-qty').forEach(input=>{
    input.addEventListener('change', async (e)=>{
      const id = e.target.closest('.pantry-item').dataset.id;
      const val = Number(e.target.value);
      if (!val || val<=0){
        await deleteDoc(doc(db,'users',state.uid,'pantry', id)).catch(()=>{});
      } else {
        await setDoc(doc(db,'users',state.uid,'pantry', id), { qty: val });
      }
    });
  });
}

/* ============================================================
   RENDER: INGREDIENTS
   ============================================================ */
// Firestore Timestamps can show up in a couple of shapes depending on SDK version and
// whether a write is still pending locally — handle all of them, and treat ingredients
// with no timestamp at all (created before this feature existed) as the oldest.
function ingredientCreatedAtMillis(ing){
  const ts = ing.createdAt;
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

// Classifies how complete an ingredient's data is, for the status column on the
// Ingredients tab: green = calories set AND priced at every enabled-in-app store;
// yellow = calories (and everything else) set, just missing some/all store prices;
// red = the core data itself (calories) is missing, same signal as the "needs data"
// warning — this is the more serious gap since price alone isn't very useful without it.
function ingredientCompletenessStatus(ing){
  const missingCore = !!ing.needsReview || !(Number(ing.calories) > 0);
  if (missingCore){
    return { level:'red', glyph:'✕', label:'Missing core data — calories haven\'t been set' };
  }
  const missingStores = STORES.filter(s => {
    const p = ing.prices ? ing.prices[s] : null;
    if (!p || !(Number(p.price) > 0)) return true;
    if (ing.packaged && !(Number(p.packageSize) > 0)) return true;
    return false;
  });
  const missingGramsPerCup = !(Number(ing.gramsPerCup) > 0);
  if (missingStores.length === 0 && !missingGramsPerCup){
    return { level:'green', glyph:'✓', label:'Complete — calories, grams per cup, and a price at every store' };
  }
  const reasons = [];
  if (missingGramsPerCup) reasons.push('missing grams per cup');
  if (missingStores.length) reasons.push(`missing a price at: ${missingStores.join(', ')}`);
  return { level:'yellow', glyph:'!', label: reasons.join(' · ') };
}

function renderIngredients(){
  const container = document.getElementById('ingredient-list');
  let entries = Object.entries(state.ingredients);
  if (entries.length===0){
    container.innerHTML = '<p class="shop-empty">No ingredients yet. Add your first one — pick an emoji, name it, and set its calories.</p>';
    return;
  }

  const sortMode = document.getElementById('ingredient-sort-select').value || 'name-asc';
  entries = entries.slice().sort(([idA, a], [idB, b]) => {
    switch (sortMode){
      case 'name-desc': return (b.name||'').localeCompare(a.name||'');
      case 'newest': return ingredientCreatedAtMillis(b) - ingredientCreatedAtMillis(a);
      case 'oldest': return ingredientCreatedAtMillis(a) - ingredientCreatedAtMillis(b);
      case 'calories-desc': return (Number(b.calories)||0) - (Number(a.calories)||0);
      case 'calories-asc': return (Number(a.calories)||0) - (Number(b.calories)||0);
      case 'aisle': {
        const orderDelta = GROCERY_CATEGORY_ORDER.indexOf(inferGroceryCategory(a)) - GROCERY_CATEGORY_ORDER.indexOf(inferGroceryCategory(b));
        if (orderDelta !== 0) return orderDelta;
        return (a.name||'').localeCompare(b.name||'');
      }
      case 'name-asc':
      default: return (a.name||'').localeCompare(b.name||'');
    }
  });

  let lastAisleCategory = null;
  container.innerHTML = entries.map(([id, ing])=>{
    let aisleHeaderHtml = '';
    if (sortMode === 'aisle'){
      const cat = inferGroceryCategory(ing);
      if (cat !== lastAisleCategory){
        lastAisleCategory = cat;
        aisleHeaderHtml = `<div class="shop-aisle-header">${escapeHtml(cat)}</div>`;
      }
    }
    const calSpan = ing.needsReview
      ? `<span class="ir-cal ir-cal-warning" title="Auto-created without real data — click to fill it in">⚠️ needs data</span>`
      : `<span class="ir-cal" title="${formatQty(ing.calories||0)} kcal">${formatQty(ing.calories||0)} kcal</span>`;
    const status = ingredientCompletenessStatus(ing);
    return `${aisleHeaderHtml}<div class="ing-row${ing.needsReview ? ' needs-review' : ''}" data-id="${id}">
      <span class="ir-emoji">${ingredientIconHtml(ing)}</span>
      <span class="ir-name" title="${escapeHtml(ing.name)}">${escapeHtml(ing.name)}</span>
      <span class="ir-unit" title="per ${escapeHtml(UNIT_LABEL[ing.unit]||ing.unit)}">per ${UNIT_LABEL[ing.unit]||ing.unit}</span>
      ${calSpan}
      <span class="ing-status-badge status-${status.level}" title="${escapeHtml(status.label)}">${status.glyph}</span>
    </div>`;
  }).join('');
  container.querySelectorAll('.ing-row').forEach(row=>{
    row.addEventListener('click', ()=> openIngredientModal(row.dataset.id));
  });
}
document.getElementById('ingredient-sort-select').addEventListener('change', renderIngredients);

document.getElementById('new-ingredient-btn').addEventListener('click', ()=> openIngredientModal(null));

/* ============================================================
   AUTO-FILL MISSING PHOTOS — no API key needed: Wikipedia's public API supports
   cross-origin requests via origin=*, so we can look up a free thumbnail for any
   ingredient name directly from the browser. Two steps per ingredient: a fuzzy
   full-text search to find the best-matching article (tolerant of plurals/wording),
   then that article's lead image. Not every result will be spot-on for something
   very specific or branded — it's a starting point, not a guarantee, and never
   touches an ingredient that already has a photo.
   ============================================================ */
async function fetchWikipediaThumbnailFor(name){
  try{
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&origin=*&srlimit=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const hit = searchData.query && searchData.query.search && searchData.query.search[0];
    if (!hit) return null;

    const thumbUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(hit.title)}&prop=pageimages&format=json&pithumbsize=240&origin=*`;
    const thumbRes = await fetch(thumbUrl);
    const thumbData = await thumbRes.json();
    const pages = thumbData.query && thumbData.query.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    return (page && page.thumbnail && page.thumbnail.source) || null;
  } catch(err){
    return null;
  }
}
document.getElementById('autofill-photos-btn').addEventListener('click', async ()=>{
  const missing = Object.entries(state.ingredients).filter(([, ing]) => !ing.photo);
  if (missing.length === 0){ toast('Every ingredient already has a photo'); return; }

  const btn = document.getElementById('autofill-photos-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  toast(`Looking up photos for ${missing.length} ingredient${missing.length!==1?'s':''}…`);

  let found = 0, done = 0;
  const BATCH_SIZE = 5;
  try{
    for (let i = 0; i < missing.length; i += BATCH_SIZE){
      const batch = missing.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ([id, ing]) => {
        const thumb = await fetchWikipediaThumbnailFor(ing.name);
        done++;
        btn.textContent = `🖼️ Finding photos… (${done}/${missing.length})`;
        if (thumb){
          await setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, id), { photo: thumb }, { merge: true });
          found++;
        }
      }));
    }
    toast(`Found photos for ${found} of ${missing.length} ingredients — worth a quick look to make sure they're the right ones`);
  } catch(err){
    console.error('Auto-fill photos failed:', err);
    toast("Couldn't finish looking up photos — see console for details");
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

document.getElementById('new-spice-btn').addEventListener('click', ()=> openIngredientModal(null, { presetSpice: true }));

document.getElementById('bulk-add-btn').addEventListener('click', ()=>{
  document.getElementById('bulk-add-textarea').value = '';
  openModal('bulk-add-modal');
});

document.getElementById('bulk-add-confirm-btn').addEventListener('click', async ()=>{
  const raw = document.getElementById('bulk-add-textarea').value;
  const names = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0){ toast('Paste at least one ingredient name'); return; }

  const existingNames = new Set(Object.values(state.ingredients).map(i => (i.name||'').trim().toLowerCase()));
  const seenInPaste = new Set();
  let added = 0, autofilled = 0, skipped = 0;

  for (const name of names){
    const key = name.toLowerCase();
    if (existingNames.has(key) || seenInPaste.has(key)){ skipped++; continue; }
    seenInPaste.add(key);
    const match = lookupCommonIngredient(name);
    const data = {
      name,
      emoji: match ? match.emoji : '🛒',
      photo: null,
      unit: match ? match.unit : 'each',
      isCustomUnit: false,
      customUnits: [],
      calories: match ? match.calories : 0,
      gramsPerCup: 0,
      packaged: false,
      prices: {},
      createdAt: serverTimestamp(),
      needsReview: !match
    };
    await addDoc(sharedCol(SHARED_INGREDIENTS_COLLECTION), data);
    added++;
    if (match) autofilled++;
  }

  closeModals();
  const bits = [`Added ${added} ingredient${added!==1?'s':''}`];
  if (autofilled) bits.push(`${autofilled} autofilled`);
  if (skipped) bits.push(`${skipped} skipped (already existed)`);
  toast(bits.join(' · '));
});

const ingredientPhotoInput = document.getElementById('ingredient-photo-input');
const ingredientPhotoPreview = document.getElementById('ingredient-photo-preview');
const ingredientPhotoImg = document.getElementById('ingredient-photo-img');

function openIngredientModal(ingId, opts){
  opts = opts || {};
  state.editing.ingredientId = ingId;
  const ing = ingId ? state.ingredients[ingId] : { emoji:'🌶️', name:'', unit: opts.presetSpice ? 'tsp' : 'g', calories:'', prices:{}, photo:null, packaged:false, isCustomUnit:false, customUnits:[], isSpice: !!opts.presetSpice };
  document.getElementById('ingredient-modal-title').textContent = ingId ? 'Edit ingredient' : 'New ingredient';
  document.getElementById('ingredient-emoji').value = ing.emoji || (opts.presetSpice ? '🌶️' : '🥕');
  document.getElementById('ingredient-name').value = ing.name || '';
  document.getElementById('ingredient-calories').value = ing.calories ?? '';
  document.getElementById('ingredient-density').value = ing.gramsPerCup ?? '';
  document.getElementById('ingredient-grams-per-each').value = ing.gramsPerEach ?? '';
  document.getElementById('ingredient-is-spice').checked = !!ing.isSpice;
  document.getElementById('ingredient-category').value = ing.category || '';
  hideAutofillSuggestion();

  const unitSelect = document.getElementById('ingredient-unit');
  const customUnitWrap = document.getElementById('ingredient-custom-unit-wrap');
  const customUnitNameInput = document.getElementById('ingredient-custom-unit-name');
  if (ing.isCustomUnit){
    unitSelect.value = '__custom__';
    customUnitNameInput.value = ing.unit || '';
    customUnitWrap.classList.remove('hidden');
  } else {
    unitSelect.value = ing.unit || 'g';
    customUnitNameInput.value = '';
    customUnitWrap.classList.add('hidden');
  }

  const customUnitsEl = document.getElementById('ingredient-custom-units');
  customUnitsEl.innerHTML = '';
  (ing.customUnits && ing.customUnits.length ? ing.customUnits : []).forEach(cu => addCustomUnitRow({
    name: cu.name,
    direction: cu.direction || 'smaller',
    factor: cu.direction ? cu.factor : (cu.factor ?? cu.perIngredientUnit) // normalize legacy rows
  }));

  state.editing.ingredientPhoto = ing.photo || null;
  ingredientPhotoInput.value = '';
  setIngredientPhotoPreview(state.editing.ingredientPhoto);

  const priceContainer = document.getElementById('ingredient-prices');
  const packagedCheckbox = document.getElementById('ingredient-packaged');
  packagedCheckbox.checked = !!ing.packaged;
  priceContainer.classList.toggle('packaged', !!ing.packaged);

  const prices = ing.prices || {};
  priceContainer.innerHTML = STORES.map(store => {
    const entry = priceEntryFor(ing, store) || { price:'', packageSize:'', unit: ing.unit };
    const priceUnit = (entry.unit && entry.unit !== ing.unit) ? entry.unit : '';
    return `
    <div class="price-row" data-store="${store}">
      <span>${store}</span>
      <input type="number" class="price-input" min="0" step="0.01" placeholder="price $" value="${entry.price || ''}" />
      <input type="number" class="package-size-input" min="0" step="any" placeholder="pkg size" value="${entry.packageSize || ''}" />
      <select class="price-unit-select" data-selected="${escapeHtml(priceUnit)}"></select>
    </div>`;
  }).join('');

  refreshCustomUnitsUI(); // builds price-unit-select options and restores each store's saved selection

  document.getElementById('delete-ingredient-btn').classList.toggle('hidden', !ingId);
  openModal('ingredient-modal');
}

/* ---- ingredient autofill suggestion (built-in common-ingredients database) ---- */
let autofillSuggestionTimer = null;
let autofillPending = null; // the matched {emoji, unit, calories} waiting to be applied

function hideAutofillSuggestion(){
  document.getElementById('ingredient-autofill-suggestion').classList.add('hidden');
  autofillPending = null;
}
function showAutofillSuggestion(name, data){
  autofillPending = data;
  document.getElementById('ingredient-autofill-text').textContent =
    `Looks like "${name}" — autofill ${data.emoji} ${UNIT_LABEL[data.unit]||data.unit}, ${data.calories} kcal/${UNIT_LABEL[data.unit]||data.unit}?`;
  document.getElementById('ingredient-autofill-suggestion').classList.remove('hidden');
}
document.getElementById('ingredient-name').addEventListener('input', (e)=>{
  clearTimeout(autofillSuggestionTimer);
  // Only offer this for brand-new ingredients — editing an existing one shouldn't
  // suddenly suggest overwriting fields the person already set on purpose.
  if (state.editing.ingredientId){ hideAutofillSuggestion(); return; }
  const name = e.target.value;
  autofillSuggestionTimer = setTimeout(()=>{
    const match = lookupCommonIngredient(name);
    if (match) showAutofillSuggestion(name.trim(), match);
    else hideAutofillSuggestion();
  }, 250);
});
document.getElementById('ingredient-autofill-apply').addEventListener('click', ()=>{
  if (!autofillPending) return;
  document.getElementById('ingredient-emoji').value = autofillPending.emoji;
  document.getElementById('ingredient-unit').value = autofillPending.unit;
  document.getElementById('ingredient-unit').dispatchEvent(new Event('change'));
  document.getElementById('ingredient-calories').value = autofillPending.calories;
  hideAutofillSuggestion();
  toast('Autofilled — feel free to adjust anything');
});
document.getElementById('ingredient-autofill-dismiss').addEventListener('click', hideAutofillSuggestion);

document.getElementById('ingredient-unit').addEventListener('change', (e)=>{
  const isCustom = e.target.value === '__custom__';
  document.getElementById('ingredient-custom-unit-wrap').classList.toggle('hidden', !isCustom);
  if (isCustom) document.getElementById('ingredient-custom-unit-name').focus();
  refreshCustomUnitsUI();
});
document.getElementById('ingredient-custom-unit-name').addEventListener('input', refreshCustomUnitsUI);

function currentUnitLabelForModal(){
  const unitSelectVal = document.getElementById('ingredient-unit').value;
  if (unitSelectVal === '__custom__'){
    return document.getElementById('ingredient-custom-unit-name').value.trim() || 'unit';
  }
  return UNIT_LABEL[unitSelectVal] || unitSelectVal;
}

// Recomputes every custom-unit row's live preview sentence, and rebuilds each store's
// price-unit dropdown (base unit + any "larger" custom units currently defined) —
// called whenever a custom-unit row or the ingredient's own unit changes.
function refreshCustomUnitsUI(){
  const baseLabel = currentUnitLabelForModal();
  const largerUnits = []; // names of currently-defined "larger" custom units

  document.querySelectorAll('#ingredient-custom-units .cu-row').forEach(row => {
    const name = row.querySelector('.cu-name').value.trim();
    const direction = row.dataset.direction || 'smaller';
    const factor = row.querySelector('.cu-factor').value;
    const preview = row.querySelector('.cu-preview');
    if (!name || !factor || Number(factor) <= 0){
      preview.textContent = 'Fill in a name and a number above';
    } else if (direction === 'smaller'){
      preview.textContent = `${factor} ${name} = 1 ${baseLabel}`;
    } else {
      preview.textContent = `1 ${name} = ${factor} ${baseLabel}`;
      largerUnits.push(name);
    }
  });

  // Rebuild each store's price-unit dropdown, preserving the current selection if it's
  // still valid (base unit or one of the still-defined larger units).
  const priceContainer = document.getElementById('ingredient-prices');
  priceContainer.classList.toggle('has-larger-units', largerUnits.length > 0);
  priceContainer.querySelectorAll('.price-unit-select').forEach(sel => {
    const prevValue = sel.value || sel.dataset.selected || '';
    const options = [`<option value="">${escapeHtml(baseLabel)} (default)</option>`]
      .concat(largerUnits.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`));
    sel.innerHTML = options.join('');
    sel.value = largerUnits.includes(prevValue) ? prevValue : '';
  });
}

function addCustomUnitRow(cu = {name:'', direction:'smaller', factor:''}){
  const row = document.createElement('div');
  row.className = 'cu-row';
  row.dataset.direction = cu.direction || 'smaller';
  row.innerHTML = `
    <div class="cu-row-top">
      <input type="text" class="cu-name" placeholder="e.g. clove or bulb" value="${cu.name ? escapeHtml(cu.name) : ''}" />
      <button type="button" class="cu-remove" aria-label="Remove custom unit">✕</button>
    </div>
    <div class="cu-row-bottom">
      <div class="cu-dir-toggle">
        <button type="button" class="cu-dir-btn ${row.dataset.direction==='smaller'?'active':''}" data-dir="smaller">smaller</button>
        <button type="button" class="cu-dir-btn ${row.dataset.direction==='larger'?'active':''}" data-dir="larger">larger</button>
      </div>
      <input type="number" class="cu-factor" min="0" step="any" placeholder="10" value="${cu.factor || cu.perIngredientUnit || ''}" />
    </div>
    <span class="cu-preview"></span>`;

  row.querySelectorAll('.cu-dir-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
      row.dataset.direction = btn.dataset.dir;
      row.querySelectorAll('.cu-dir-btn').forEach(b => b.classList.toggle('active', b===btn));
      refreshCustomUnitsUI();
    });
  });
  row.querySelector('.cu-name').addEventListener('input', refreshCustomUnitsUI);
  row.querySelector('.cu-factor').addEventListener('input', refreshCustomUnitsUI);
  row.querySelector('.cu-remove').addEventListener('click', ()=>{ row.remove(); refreshCustomUnitsUI(); });

  document.getElementById('ingredient-custom-units').appendChild(row);
  refreshCustomUnitsUI();
}
document.getElementById('add-custom-unit-btn').addEventListener('click', ()=> addCustomUnitRow());

document.getElementById('ingredient-packaged').addEventListener('change', (e)=>{
  document.getElementById('ingredient-prices').classList.toggle('packaged', e.target.checked);
});

function setIngredientPhotoPreview(dataUrl){
  if (dataUrl){
    ingredientPhotoImg.src = dataUrl;
    ingredientPhotoPreview.classList.remove('hidden');
  } else {
    ingredientPhotoPreview.classList.add('hidden');
    ingredientPhotoImg.src = '';
  }
}

ingredientPhotoInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try{
    const rawDataUrl = await readFileAsRawDataUrl(file);
    await openCropper(rawDataUrl, 1, 240, 0.8, (croppedDataUrl)=>{
      state.editing.ingredientPhoto = croppedDataUrl;
      setIngredientPhotoPreview(croppedDataUrl);
    });
  } catch(err){
    toast("Couldn't read that image");
  }
  ingredientPhotoInput.value = '';
});
document.getElementById('ingredient-photo-remove').addEventListener('click', ()=>{
  state.editing.ingredientPhoto = null;
  ingredientPhotoInput.value = '';
  setIngredientPhotoPreview(null);
});

document.getElementById('save-ingredient-btn').addEventListener('click', async ()=>{
  const name = document.getElementById('ingredient-name').value.trim();
  if (!name){ toast('Give the ingredient a name'); return; }

  const unitSelectVal = document.getElementById('ingredient-unit').value;
  let unit, isCustomUnit;
  if (unitSelectVal === '__custom__'){
    unit = document.getElementById('ingredient-custom-unit-name').value.trim();
    if (!unit){ toast('Enter a name for the custom unit (e.g. "bulb")'); return; }
    isCustomUnit = true;
  } else {
    unit = unitSelectVal;
    isCustomUnit = false;
  }

  const customUnits = Array.from(document.querySelectorAll('#ingredient-custom-units .cu-row')).map(row => ({
    name: row.querySelector('.cu-name').value.trim(),
    direction: row.dataset.direction === 'larger' ? 'larger' : 'smaller',
    factor: Number(row.querySelector('.cu-factor').value) || 0
  })).filter(cu => cu.name && cu.factor > 0);

  const prices = {};
  document.querySelectorAll('#ingredient-prices .price-row').forEach(row => {
    const store = row.dataset.store;
    const priceVal = row.querySelector('.price-input').value;
    const pkgVal = row.querySelector('.package-size-input').value;
    const unitVal = row.querySelector('.price-unit-select').value; // '' = the ingredient's own unit
    if (priceVal !== ''){
      prices[store] = { price: Number(priceVal), packageSize: pkgVal !== '' ? Number(pkgVal) : 0, unit: unitVal || unit };
    }
  });

  const existingIng = state.editing.ingredientId ? state.ingredients[state.editing.ingredientId] : null;
  const data = {
    name,
    emoji: document.getElementById('ingredient-emoji').value.trim() || '🥕',
    photo: state.editing.ingredientPhoto || null,
    unit,
    isCustomUnit,
    customUnits,
    calories: Number(document.getElementById('ingredient-calories').value)||0,
    gramsPerCup: Number(document.getElementById('ingredient-density').value)||0,
    gramsPerEach: Number(document.getElementById('ingredient-grams-per-each').value)||0,
    packaged: document.getElementById('ingredient-packaged').checked,
    isSpice: document.getElementById('ingredient-is-spice').checked,
    category: document.getElementById('ingredient-category').value || '',
    // This modal never edits blend composition — preserve it as-is so saving a regular
    // ingredient edit (setDoc replaces the whole document) can't accidentally wipe out
    // a spice blend's recipe. The dedicated blend editor owns these fields instead.
    isBlend: existingIng ? !!existingIng.isBlend : false,
    blendComponents: existingIng ? (existingIng.blendComponents || []) : [],
    prices,
    createdAt: existingIng ? (existingIng.createdAt || serverTimestamp()) : serverTimestamp(),
    needsReview: false // any manual save through this editor counts as resolved
  };
  if (state.editing.ingredientId){
    await setDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, state.editing.ingredientId), data);
  } else {
    await addDoc(sharedCol(SHARED_INGREDIENTS_COLLECTION), data);
  }
  closeModals();
  toast('Ingredient saved');
});

document.getElementById('delete-ingredient-btn').addEventListener('click', async ()=>{
  if (!state.editing.ingredientId) return;
  if (!confirm('Delete this ingredient? It\'s shared, so this removes it for everyone using this planner, and any recipe using it will show a missing ingredient.')) return;
  await deleteDoc(doc(db, SHARED_INGREDIENTS_COLLECTION, state.editing.ingredientId));
  closeModals();
  toast('Ingredient deleted');
});

/* ============================================================
   UTIL
   ============================================================ */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// Renders an ingredient's photo if it has one, otherwise its emoji.
function ingredientIconHtml(ing){
  if (!ing) return '❔';
  if (ing.photo) return `<img src="${ing.photo}" alt="" />`;
  return escapeHtml(ing.emoji || '🛒');
}

// Reads a File as a raw (uncompressed) data URL — used as the source image for cropping.
function readFileAsRawDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

// Downsizes a data URL on a canvas and resolves a compressed JPEG data URL. Keeping
// images small matters here since they're stored directly in Firestore documents
// (no separate file storage / billing plan required).
function resizeDataUrl(dataUrl, maxDim = 480, quality = 0.7){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim){
        if (w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = dataUrl;
  });
}
async function readImageAsDataUrl(file, maxDim = 480, quality = 0.7){
  const raw = await readFileAsRawDataUrl(file);
  return resizeDataUrl(raw, maxDim, quality);
}

/* ============================================================
   CROP / ZOOM (shared modal for ingredient photo, recipe cover, step photos)
   ============================================================ */
let cropperInstance = null;
let cropConfirmHandler = null;
const cropModalImg = document.getElementById('crop-image');

// Opens the crop UI on a raw data URL; calls onConfirm(dataUrl) with the final
// cropped + compressed image once the person clicks "Use this photo". Falls back to a
// plain center-resize with no crop UI if Cropper.js failed to load (e.g. offline).
async function openCropper(rawDataUrl, aspectRatio, outputMaxDim, quality, onConfirm){
  if (typeof Cropper === 'undefined'){
    try{
      onConfirm(await resizeDataUrl(rawDataUrl, outputMaxDim, quality));
    } catch(err){ toast("Couldn't process that image"); }
    return;
  }
  cropConfirmHandler = { onConfirm, outputMaxDim, quality };
  showCropOverlay();
  cropModalImg.onload = () => {
    if (cropperInstance) cropperInstance.destroy();
    cropperInstance = new Cropper(cropModalImg, {
      aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      responsive: true,
      guides: true,
      dragMode: 'move'
    });
  };
  cropModalImg.src = rawDataUrl;
}

document.getElementById('crop-confirm-btn').addEventListener('click', ()=>{
  if (!cropperInstance || !cropConfirmHandler) return;
  try{
    const { onConfirm, outputMaxDim, quality } = cropConfirmHandler;
    const canvas = cropperInstance.getCroppedCanvas({ width: outputMaxDim, imageSmoothingQuality: 'high' });
    if (!canvas) throw new Error('getCroppedCanvas returned nothing');
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    onConfirm(dataUrl);
    hideCropOverlay();
  } catch(err){
    console.error('Crop confirm failed:', err);
    toast("Couldn't save that crop — see console for details");
  }
});
document.getElementById('crop-cancel-btn').addEventListener('click', hideCropOverlay);
