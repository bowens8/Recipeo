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
  weekStart: startOfWeek(new Date()),
  shoppingMode: false,   // transient, not persisted
  unsubs: [],
  editing: { recipeId: null, ingredientId: null, mealId: null, mealDate: null }
};

const UNIT_LABEL = { g:"g", kg:"kg", ml:"ml", l:"L", cup:"cup", tbsp:"tbsp", tsp:"tsp", each:"each", oz:"oz", lb:"lb" };
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
state.storeSettings = STORES.reduce((o,s)=> (o[s]=true, o), {}); // which stores are "in play"

/* ---- unit conversion ---- */
const VOLUME_TO_ML = { ml:1, l:1000, cup:236.588, tbsp:14.7868, tsp:4.92892 };
const WEIGHT_TO_G = { g:1, kg:1000, oz:28.3495, lb:453.592 };
function unitCategory(u){
  if (u in VOLUME_TO_ML) return 'volume';
  if (u in WEIGHT_TO_G) return 'weight';
  if (u === 'each') return 'count';
  return 'unknown';
}
// Convert qty from one unit to another. Same-family conversions (volume<->volume,
// weight<->weight) always work with no setup. Crossing volume<->weight requires the
// ingredient's optional gramsPerCup density; without it, returns null.
function convertQty(qty, fromUnit, toUnit, gramsPerCup){
  if (fromUnit === toUnit) return qty;
  const catFrom = unitCategory(fromUnit), catTo = unitCategory(toUnit);
  if (catFrom === 'count' || catTo === 'count' || catFrom==='unknown' || catTo==='unknown') return null;
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
  return convertQty(qty, fromUnit, ing.unit, ing.gramsPerCup);
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
const VOLUME_US      = [['cup',236.588], ['tbsp',14.7868], ['tsp',4.92892]];
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

function attachListeners(){
  state.unsubs.push(onSnapshot(sharedCol(SHARED_INGREDIENTS_COLLECTION), snap => {
    state.ingredients = {};
    snap.forEach(d => state.ingredients[d.id] = d.data());
    renderAll();
  }));
  state.unsubs.push(onSnapshot(sharedCol(SHARED_RECIPES_COLLECTION), snap => {
    state.recipes = {};
    snap.forEach(d => state.recipes[d.id] = d.data());
    renderAll();
  }));
  state.unsubs.push(onSnapshot(col('pantry'), snap => {
    state.pantry = {};
    snap.forEach(d => state.pantry[d.id] = d.data());
    renderAll();
  }));
  state.unsubs.push(onSnapshot(col('mealPlan'), snap => {
    state.mealPlan = {};
    snap.forEach(d => state.mealPlan[d.id] = d.data());
    renderAll();
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

function mealsForDate(dateStr){
  return Object.entries(state.mealPlan)
    .filter(([id,m]) => m.date === dateStr)
    .map(([id,m]) => ({id, ...m}));
}

function remainingLeftoverServings(cookMealId){
  const cook = state.mealPlan[cookMealId];
  if (!cook) return 0;
  const consumed = Object.values(state.mealPlan)
    .filter(m => m.type==='leftover' && m.sourceMealId === cookMealId)
    .reduce((s,m)=> s + (Number(m.eatenServings)||0), 0);
  return (Number(cook.batchServings)||0) - (Number(cook.eatenServings)||0) - consumed;
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
          if (remain > 0) metaBits.push(`${remain} left over`);
        } else {
          metaBits.push(`leftovers · eating ${m.eatenServings}`);
        }
        metaText = metaBits.join(' · ');
      }

      chip.innerHTML = `<div class="chip-title">${titleHtml}</div>
        <div class="chip-meta">${metaText}</div>`;
      chip.addEventListener('click', ()=> openMealModal(dateStr, m.id));
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
    return `<option value="${id}">${escapeHtml(recipe? recipe.name:'?')} — cooked ${m.date} (${remain} left)</option>`;
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
    await setDoc(doc(db,'users',state.uid,'mealPlan', state.editing.mealId), data);
  } else {
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

  const itemsHtml = rows.map(([id, baseQty]) => {
    const ing = state.ingredients[id];
    if (!ing) return '';
    const category = unitCategory(ing.unit);
    const neededQtyInIngUnit = baseQty / (toBaseUnit(1, ing.unit) || 1);

    const best = anyStoresOn ? cheapestOption(ing, neededQtyInIngUnit) : null;
    let priceHtml, amountHtml, pantryQty, amountClass = 's-amount';

    if (best){
      grandTotal += best.cost;
      storeSubtotals[best.store] = (storeSubtotals[best.store]||0) + best.cost;
      priceHtml = `<span class="s-price">$${best.cost.toFixed(2)} <span style="font-weight:400;">at ${escapeHtml(best.store)}</span></span>`;
      if (best.packages !== null){
        // packaged item: show the whole-package purchase, not the raw fractional need,
        // sized in whatever unit that store's price was entered in (base or a custom
        // "larger" unit, e.g. bulb) — but also call out the actual amount needed in the
        // ingredient's own unit, since "buy 3 packages" alone hides how much you'll use.
        const pkgWord = best.packages === 1 ? 'package' : 'packages';
        const pkgUnitLabel = UNIT_LABEL[best.priceUnit] || best.priceUnit;
        const { unit: neededDispUnit, qty: neededDispQty } = pickDisplayUnit(baseQty, category, ing.unit);
        amountHtml = `${best.packages} ${pkgWord} (${formatQty(best.packageSize)} ${pkgUnitLabel} each)
          <span class="s-needed-note">need ${formatQty(neededDispQty)} ${UNIT_LABEL[neededDispUnit]||neededDispUnit}</span>`;
        pantryQty = best.boughtQtyInIngUnit; // credit the full purchased amount, incl. rounding leftover
      } else {
        const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
        amountHtml = `${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
        pantryQty = best.boughtQtyInIngUnit;
      }
    } else if (!anyStoresOn){
      // No store picked at all yet — "no price set" on every single item is just noise
      // in that state, not useful feedback. Skip it and let the amount stand on its own,
      // larger, since it's the only thing worth showing right now.
      priceHtml = '';
      amountClass = 's-amount s-amount-large';
      const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
      amountHtml = `${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
      pantryQty = neededQtyInIngUnit;
    } else {
      missingPriceCount++;
      priceHtml = `<span class="s-noprice">no price set${ing.packaged ? ' / no package size' : ''}</span>`;
      const { unit: dispUnit, qty: dispQty } = pickDisplayUnit(baseQty, category, ing.unit);
      amountHtml = `${formatQty(dispQty)} ${UNIT_LABEL[dispUnit]||dispUnit}`;
      pantryQty = neededQtyInIngUnit;
    }

    return `<label class="shop-item" data-ing="${id}">
      <input type="checkbox" class="shop-check" data-ing="${id}" data-pantry-qty="${pantryQty}" />
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="s-name">${escapeHtml(ing.name)}</span>
      <span class="s-price-block">
        ${priceHtml}
        <span class="${amountClass}">${amountHtml}</span>
      </span>
    </label>`;
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
    const boughtQty = Number(cb.dataset.pantryQty) || 0;
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
function missingIngredientsForRecipe(r){
  const missing = [];
  (r.ingredients||[]).forEach(ri => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return;
    const rowUnit = ri.unit || ing.unit;
    const needed = convertToIngredientUnit(Number(ri.qty)||0, rowUnit, ing);
    if (needed === null) return;
    const have = Number(state.pantry[ri.ingredientId]?.qty) || 0;
    if (have + 1e-9 < needed) missing.push({ ing, needed, have });
  });
  return missing;
}

function renderRecipes(){
  const container = document.getElementById('recipe-list');
  const entries = Object.entries(state.recipes);
  if (entries.length===0){
    container.innerHTML = '<p class="shop-empty">No recipes yet. Click "+ New recipe" to add your first one.</p>';
    return;
  }
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
    return `<div class="recipe-card" data-id="${id}">
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

document.getElementById('new-recipe-btn').addEventListener('click', ()=> openRecipeModal(null));

/* ---- "missing ingredients" confirmation before Cook Mode ---- */
function openMissingIngredientsModal(recipeId, missing){
  state.editing.pendingCookRecipeId = recipeId;
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
    closeModals();
    if (recipeId) openCookMode(recipeId);
    else toast("Couldn't tell which recipe — try clicking Cook again");
  } catch(err){
    console.error('"Cook anyway" failed:', err);
    toast("Couldn't open Cook Mode — see console for details");
  }
});

/* ============================================================
   COOK MODE — full-screen: gather ingredients + scroll through steps
   ============================================================ */
function openCookMode(recipeId){
  const r = state.recipes[recipeId];
  if (!r) return;

  document.getElementById('cook-recipe-title').textContent = r.name;
  document.getElementById('cook-servings-label').textContent = `makes ${r.baseServings}`;

  const ingList = document.getElementById('cook-ingredient-list');
  const rowsHtml = (r.ingredients||[]).map(ri => {
    const ing = state.ingredients[ri.ingredientId];
    if (!ing) return '';
    const unit = ri.unit || ing.unit;
    return `<label class="cook-ing-item">
      <input type="checkbox" />
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="cook-ing-name">${escapeHtml(ing.name)}</span>
      <span class="cook-ing-qty">${formatQty(Number(ri.qty)||0)} ${UNIT_LABEL[unit]||unit}</span>
    </label>`;
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
    return `<div class="cook-ing-item">
      <span class="s-emoji">${ingredientIconHtml(ing)}</span>
      <span class="cook-ing-name">${escapeHtml(ing.name)}</span>
      <span class="cook-ing-qty">${formatQty(Number(ri.qty)||0)} ${UNIT_LABEL[unit]||unit}</span>
    </div>`;
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

function openRecipeModal(recipeId){
  state.editing.recipeId = recipeId;
  const r = recipeId ? state.recipes[recipeId] : { name:'', baseServings:4, ingredients:[], steps:[], coverPhoto:null };

  document.getElementById('recipe-modal-title').textContent = recipeId ? 'Edit recipe' : 'New recipe';
  document.getElementById('recipe-name').value = r.name || '';
  document.getElementById('recipe-servings').value = r.baseServings || 4;

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
function mountIngredientCombo(root, hiddenSelector){
  const searchInput = root.querySelector('.ing-combo-search');
  const hiddenInput = root.querySelector(hiddenSelector);
  const listEl = root.querySelector('.ing-combo-list');

  function renderList(filterText){
    const q = (filterText||'').trim().toLowerCase();
    const ids = Object.keys(state.ingredients).filter(id => !q || state.ingredients[id].name.toLowerCase().includes(q));
    listEl.innerHTML = ids.length
      ? ids.slice(0,50).map(id => `<div class="ing-combo-item" data-id="${id}">${ingredientComboLabel(state.ingredients[id])}</div>`).join('')
      : `<div class="ing-combo-empty">No matches — add it on the Ingredients tab first</div>`;
    listEl.classList.remove('hidden');
  }
  function selectIngredient(id){
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

function addRecipeIngredientRow(ri = {ingredientId:'', qty:'', unit:''}){
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
  row.querySelector('.ri-remove').addEventListener('click', ()=> row.remove());
  recipeIngredientsEl.appendChild(row);
}
// Builds the <option> list for a recipe-row unit picker: the standard units, plus
// whichever custom unit(s) belong to the currently-selected ingredient (its own custom
// base unit, e.g. "bulb", and any custom sub-units defined on it, e.g. "clove").
function unitOptionsHtml(selected, ing){
  const opts = Object.keys(UNIT_LABEL).map(u =>
    `<option value="${u}" ${u===selected?'selected':''}>${UNIT_LABEL[u]}</option>`);
  if (ing){
    const customNames = [];
    if (ing.isCustomUnit && ing.unit) customNames.push(ing.unit);
    (ing.customUnits||[]).forEach(c => { if (c.name) customNames.push(c.name); });
    customNames.forEach(name => {
      opts.push(`<option value="${escapeHtml(name)}" ${name===selected?'selected':''}>${escapeHtml(name)}</option>`);
    });
  }
  return opts.join('');
}
document.getElementById('add-recipe-ingredient').addEventListener('click', ()=> addRecipeIngredientRow());

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

  const ingredients = Array.from(recipeIngredientsEl.querySelectorAll('.ri-row')).map(row=>({
    ingredientId: row.querySelector('.ri-ingredient').value,
    qty: Number(row.querySelector('.ri-qty').value)||0,
    unit: row.querySelector('.ri-unit').value
  })).filter(ri => ri.ingredientId && ri.qty > 0);

  const steps = Array.from(recipeStepsEl.querySelectorAll('.rs-row')).map(row => ({
    text: row.querySelector('.rs-text').value.trim(),
    photo: row._photoData || null
  })).filter(s => s.text || s.photo);

  const data = { name, baseServings, ingredients, steps, coverPhoto: state.editing.recipeCover || null };

  if (state.editing.recipeId){
    await setDoc(doc(db, SHARED_RECIPES_COLLECTION, state.editing.recipeId), data);
  } else {
    await addDoc(sharedCol(SHARED_RECIPES_COLLECTION), data);
  }
  closeModals();
  toast('Recipe saved');
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
function renderIngredients(){
  const container = document.getElementById('ingredient-list');
  const entries = Object.entries(state.ingredients);
  if (entries.length===0){
    container.innerHTML = '<p class="shop-empty">No ingredients yet. Add your first one — pick an emoji, name it, and set its calories.</p>';
    return;
  }
  container.innerHTML = entries.map(([id, ing])=>`
    <div class="ing-row" data-id="${id}">
      <span class="ir-emoji">${ingredientIconHtml(ing)}</span>
      <span class="ir-name">${escapeHtml(ing.name)}</span>
      <span class="ir-unit">per ${UNIT_LABEL[ing.unit]||ing.unit}</span>
      <span class="ir-cal">${ing.calories||0} kcal</span>
    </div>`).join('');
  container.querySelectorAll('.ing-row').forEach(row=>{
    row.addEventListener('click', ()=> openIngredientModal(row.dataset.id));
  });
}

document.getElementById('new-ingredient-btn').addEventListener('click', ()=> openIngredientModal(null));

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
      prices: {}
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

function openIngredientModal(ingId){
  state.editing.ingredientId = ingId;
  const ing = ingId ? state.ingredients[ingId] : { emoji:'🥕', name:'', unit:'g', calories:'', prices:{}, photo:null, packaged:false, isCustomUnit:false, customUnits:[] };
  document.getElementById('ingredient-modal-title').textContent = ingId ? 'Edit ingredient' : 'New ingredient';
  document.getElementById('ingredient-emoji').value = ing.emoji || '🥕';
  document.getElementById('ingredient-name').value = ing.name || '';
  document.getElementById('ingredient-calories').value = ing.calories ?? '';
  document.getElementById('ingredient-density').value = ing.gramsPerCup ?? '';
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

  const data = {
    name,
    emoji: document.getElementById('ingredient-emoji').value.trim() || '🥕',
    photo: state.editing.ingredientPhoto || null,
    unit,
    isCustomUnit,
    customUnits,
    calories: Number(document.getElementById('ingredient-calories').value)||0,
    gramsPerCup: Number(document.getElementById('ingredient-density').value)||0,
    packaged: document.getElementById('ingredient-packaged').checked,
    prices
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
