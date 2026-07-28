import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, serverTimestamp
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
// Convert qty from one unit to another. Returns a number, or null if it can't be done
// (count units never convert; weight<->volume needs the ingredient's gramsPerCup density).
function convertQty(qty, fromUnit, toUnit, gramsPerCup){
  if (fromUnit === toUnit) return qty;
  const catFrom = unitCategory(fromUnit), catTo = unitCategory(toUnit);
  if (catFrom === 'count' || catTo === 'count' || catFrom==='unknown' || catTo==='unknown') return null;
  if (catFrom === catTo){
    if (catFrom === 'volume') return (qty * VOLUME_TO_ML[fromUnit]) / VOLUME_TO_ML[toUnit];
    return (qty * WEIGHT_TO_G[fromUnit]) / WEIGHT_TO_G[toUnit];
  }
  if (!gramsPerCup) return null; // crossing volume<->weight needs a density
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
function col(name){ return collection(db, 'users', state.uid, name); }

function attachListeners(){
  state.unsubs.push(onSnapshot(col('ingredients'), snap => {
    state.ingredients = {};
    snap.forEach(d => state.ingredients[d.id] = d.data());
    renderAll();
  }));
  state.unsubs.push(onSnapshot(col('recipes'), snap => {
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
  document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function closeModals(){ backdrop.classList.add('hidden'); }
backdrop.addEventListener('click', (e)=>{ if (e.target === backdrop) closeModals(); });
document.querySelectorAll('.modal-close').forEach(b=>{
  b.addEventListener('click', ()=> closeModals());
});

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
    const qtyInCanonicalUnit = convertQty(Number(ri.qty)||0, rowUnit, ing.unit, ing.gramsPerCup);
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
      const recipe = state.recipes[m.recipeId];
      if (!recipe) return;
      const perServing = recipeCaloriesPerServing(recipe);
      const eaten = m.type === 'cook' ? Number(m.eatenServings)||0 : Number(m.eatenServings)||0;
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
      const recipe = state.recipes[m.recipeId];
      const chip = document.createElement('div');
      chip.className = 'meal-chip' + (m.type==='leftover' ? ' leftover' : '');
      const name = recipe ? recipe.name : '(deleted recipe)';
      const metaBits = [];
      if (m.type==='cook'){
        metaBits.push(`cooked ${m.batchServings} · eating ${m.eatenServings}`);
        const remain = remainingLeftoverServings(m.id);
        if (remain > 0) metaBits.push(`${remain} left over`);
      } else {
        metaBits.push(`leftovers · eating ${m.eatenServings}`);
      }
      chip.innerHTML = `<div class="chip-title">${m.type==='leftover'?'♻️':'🍳'} ${escapeHtml(name)}</div>
        <div class="chip-meta">${metaBits.join(' · ')}</div>`;
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

document.getElementById('toggle-cook').addEventListener('click', ()=> setMealType('cook'));
document.getElementById('toggle-leftover').addEventListener('click', ()=> setMealType('leftover'));

function setMealType(type){
  document.getElementById('toggle-cook').classList.toggle('active', type==='cook');
  document.getElementById('toggle-leftover').classList.toggle('active', type==='leftover');
  document.getElementById('meal-cook-fields').classList.toggle('hidden', type!=='cook');
  document.getElementById('meal-leftover-fields').classList.toggle('hidden', type!=='leftover');
  state.editing.mealType = type;
}

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
    setMealType(m.type);
    if (m.type === 'cook'){
      mealRecipeSelect.value = m.recipeId;
      batchServingsInput.value = m.batchServings;
      eatenServingsInput.value = m.eatenServings;
    } else {
      mealLeftoverSelect.value = m.sourceMealId;
      leftoverServingsInput.value = m.eatenServings;
    }
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('meal-modal-title').textContent = 'Add meal';
    setMealType('cook');
    batchServingsInput.value = 4;
    eatenServingsInput.value = 4;
    leftoverServingsInput.value = 1;
    deleteBtn.classList.add('hidden');
  }
  openModal('meal-modal');
}

document.getElementById('save-meal-btn').addEventListener('click', async ()=>{
  const type = state.editing.mealType;
  let data;
  if (type === 'cook'){
    if (!mealRecipeSelect.value){ toast('Add a recipe first'); return; }
    data = {
      date: state.editing.mealDate,
      type: 'cook',
      recipeId: mealRecipeSelect.value,
      batchServings: Number(batchServingsInput.value)||0,
      eatenServings: Number(eatenServingsInput.value)||0,
      createdAt: serverTimestamp()
    };
  } else {
    if (!mealLeftoverSelect.value){ toast('No leftovers available'); return; }
    const source = state.mealPlan[mealLeftoverSelect.value];
    data = {
      date: state.editing.mealDate,
      type: 'leftover',
      recipeId: source.recipeId,
      sourceMealId: mealLeftoverSelect.value,
      eatenServings: Number(leftoverServingsInput.value)||0,
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

// Cheapest available price for an ingredient among currently-enabled stores.
// Returns {price, store} or null if no enabled store has a price for it.
function cheapestPrice(ing){
  let best = null;
  STORES.forEach(store => {
    if (!state.storeSettings[store]) return;
    const p = ing.prices ? Number(ing.prices[store]) : NaN;
    if (!p || p <= 0 || isNaN(p)) return;
    if (best === null || p < best.price){ best = { price: p, store }; }
  });
  return best;
}

function renderShoppingList(){
  const container = document.getElementById('shopping-list');
  const totalEl = document.getElementById('shopping-total');
  const dates = weekDates().map(fmtDate);
  const needed = {};       // ingredientId -> qty, in that ingredient's own canonical unit
  const unconverted = {};  // "ingredientId__unit" -> {ingredientId, unit, qty} — couldn't be reconciled

  Object.values(state.mealPlan).forEach(m => {
    if (m.type !== 'cook') return;
    if (!dates.includes(m.date)) return;
    const recipe = state.recipes[m.recipeId];
    if (!recipe || !recipe.baseServings) return;
    const scale = (Number(m.batchServings)||0) / recipe.baseServings;
    (recipe.ingredients||[]).forEach(ri => {
      const ing = state.ingredients[ri.ingredientId];
      if (!ing) return;
      const rowUnit = ri.unit || ing.unit;
      const rawQty = (Number(ri.qty)||0) * scale;
      const converted = convertQty(rawQty, rowUnit, ing.unit, ing.gramsPerCup);
      if (converted !== null){
        needed[ri.ingredientId] = (needed[ri.ingredientId]||0) + converted;
      } else {
        const key = ri.ingredientId + '__' + rowUnit;
        if (!unconverted[key]) unconverted[key] = { ingredientId: ri.ingredientId, unit: rowUnit, qty: 0 };
        unconverted[key].qty += rawQty;
      }
    });
  });

  // subtract pantry (pantry is always tracked in the ingredient's canonical unit)
  Object.keys(needed).forEach(ingId => {
    const have = Number(state.pantry[ingId]?.qty) || 0;
    needed[ingId] = Math.max(0, needed[ingId] - have);
  });

  const rows = Object.entries(needed).filter(([id,qty]) => qty > 0.0001);
  const warnRows = Object.values(unconverted).filter(r => r.qty > 0.0001);

  if (rows.length === 0 && warnRows.length === 0){
    container.innerHTML = '<p class="shop-empty">Nothing to buy — plan some meals this week, or your pantry already covers it.</p>';
    totalEl.innerHTML = '';
    return;
  }

  let grandTotal = 0;
  const storeSubtotals = {}; // store -> $ (items assigned to it as the cheapest option)
  let missingPriceCount = 0;

  const itemsHtml = rows.map(([id, qty]) => {
    const ing = state.ingredients[id];
    if (!ing) return '';
    const best = cheapestPrice(ing);
    let priceHtml;
    if (best){
      const cost = best.price * qty;
      grandTotal += cost;
      storeSubtotals[best.store] = (storeSubtotals[best.store]||0) + cost;
      priceHtml = `<span class="s-price">$${cost.toFixed(2)} at ${escapeHtml(best.store)}</span>`;
    } else {
      missingPriceCount++;
      priceHtml = `<span class="s-noprice">no price set</span>`;
    }
    return `<label class="shop-item" data-ing="${id}">
      <input type="checkbox" class="shop-check" data-ing="${id}" data-qty="${qty}" />
      <span class="s-emoji">${ing.emoji||'🛒'}</span>
      <span class="s-name">${escapeHtml(ing.name)}</span>
      <span class="s-price-block">
        <span class="s-amount">${formatQty(qty)} ${UNIT_LABEL[ing.unit]||ing.unit}</span>
        ${priceHtml}
      </span>
    </label>`;
  }).join('');

  const warnHtml = warnRows.map(w => {
    const ing = state.ingredients[w.ingredientId];
    if (!ing) return '';
    return `<div class="shop-item warn" data-ing="${w.ingredientId}">
      <span class="s-emoji">${ing.emoji||'🛒'}</span>
      <span class="s-name">${escapeHtml(ing.name)}</span>
      <span class="s-price-block">
        <span class="s-amount">${formatQty(w.qty)} ${UNIT_LABEL[w.unit]||w.unit}</span>
        <span class="s-warn-note">couldn't combine with the ${UNIT_LABEL[ing.unit]} total — add "grams per cup" on this ingredient</span>
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

  const anyStoresOn = STORES.some(s => state.storeSettings[s]);
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
  return (Math.round(n*100)/100).toString();
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
    const boughtQty = Number(cb.dataset.qty) || 0;
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
      return `<span class="ing-badge" title="${ing?escapeHtml(ing.name):''}">${ing?ing.emoji:'❔'}</span>`;
    }).join('');
    const cal = Math.round(recipeCaloriesPerServing(r));
    return `<div class="recipe-card" data-id="${id}">
      <h3>${escapeHtml(r.name)}</h3>
      <div class="rc-servings">makes ${r.baseServings} servings</div>
      <div class="rc-ingredients">${badges}</div>
      <div class="rc-cal">${cal>0? cal+' kcal / serving' : ''}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.recipe-card').forEach(card=>{
    card.addEventListener('click', ()=> openRecipeModal(card.dataset.id));
  });
}

document.getElementById('new-recipe-btn').addEventListener('click', ()=> openRecipeModal(null));

/* ============================================================
   RECIPE MODAL
   ============================================================ */
const recipeIngredientsEl = document.getElementById('recipe-ingredients');
const recipeStepsEl = document.getElementById('recipe-steps');

function openRecipeModal(recipeId){
  state.editing.recipeId = recipeId;
  const r = recipeId ? state.recipes[recipeId] : { name:'', baseServings:4, ingredients:[], steps:[] };

  document.getElementById('recipe-modal-title').textContent = recipeId ? 'Edit recipe' : 'New recipe';
  document.getElementById('recipe-name').value = r.name || '';
  document.getElementById('recipe-servings').value = r.baseServings || 4;

  recipeIngredientsEl.innerHTML = '';
  (r.ingredients && r.ingredients.length ? r.ingredients : [{ingredientId:'', qty:''}])
    .forEach(ri => addRecipeIngredientRow(ri));

  recipeStepsEl.innerHTML = '';
  (r.steps && r.steps.length ? r.steps : [''])
    .forEach(s => addRecipeStepRow(s));

  document.getElementById('delete-recipe-btn').classList.toggle('hidden', !recipeId);
  openModal('recipe-modal');
}

function ingredientOptionsHtml(selectedId){
  const ids = Object.keys(state.ingredients);
  if (ids.length===0) return `<option value="">Add ingredients first (Ingredients tab)</option>`;
  return `<option value="">Select ingredient…</option>` + ids.map(id =>
    `<option value="${id}" ${id===selectedId?'selected':''}>${state.ingredients[id].emoji} ${escapeHtml(state.ingredients[id].name)}</option>`
  ).join('');
}

function addRecipeIngredientRow(ri = {ingredientId:'', qty:'', unit:''}){
  const row = document.createElement('div');
  row.className = 'ri-row';
  const initialIng = ri.ingredientId ? state.ingredients[ri.ingredientId] : null;
  const initialUnit = ri.unit || (initialIng ? initialIng.unit : 'g');
  row.innerHTML = `
    <select class="ri-ingredient">${ingredientOptionsHtml(ri.ingredientId)}</select>
    <input type="number" class="ri-qty" placeholder="qty" step="any" min="0" value="${ri.qty ?? ''}" />
    <select class="ri-unit">${unitOptionsHtml(initialUnit)}</select>
    <button type="button" class="ri-remove">✕</button>`;
  row.querySelector('.ri-ingredient').addEventListener('change', (e)=>{
    const ing = state.ingredients[e.target.value];
    if (ing) row.querySelector('.ri-unit').value = ing.unit; // default to that ingredient's usual unit; still editable
  });
  row.querySelector('.ri-remove').addEventListener('click', ()=> row.remove());
  recipeIngredientsEl.appendChild(row);
}
function unitOptionsHtml(selected){
  return Object.keys(UNIT_LABEL).map(u =>
    `<option value="${u}" ${u===selected?'selected':''}>${UNIT_LABEL[u]}</option>`).join('');
}
document.getElementById('add-recipe-ingredient').addEventListener('click', ()=> addRecipeIngredientRow());

function addRecipeStepRow(text=''){
  const row = document.createElement('div');
  row.className = 'rs-row';
  const num = recipeStepsEl.children.length + 1;
  row.innerHTML = `<span class="rs-num">${num}.</span>
    <textarea class="rs-text" placeholder="Describe this step…">${escapeHtml(text)}</textarea>
    <button type="button" class="rs-remove">✕</button>`;
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

  const steps = Array.from(recipeStepsEl.querySelectorAll('.rs-text'))
    .map(t=>t.value.trim()).filter(Boolean);

  const data = { name, baseServings, ingredients, steps };

  if (state.editing.recipeId){
    await setDoc(doc(db,'users',state.uid,'recipes', state.editing.recipeId), data);
  } else {
    await addDoc(col('recipes'), data);
  }
  closeModals();
  toast('Recipe saved');
});

document.getElementById('delete-recipe-btn').addEventListener('click', async ()=>{
  if (!state.editing.recipeId) return;
  if (!confirm('Delete this recipe? This cannot be undone.')) return;
  await deleteDoc(doc(db,'users',state.uid,'recipes', state.editing.recipeId));
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
      <span class="p-emoji">${ing.emoji}</span>
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
      <span class="ir-emoji">${ing.emoji}</span>
      <span class="ir-name">${escapeHtml(ing.name)}</span>
      <span class="ir-unit">per ${UNIT_LABEL[ing.unit]||ing.unit}</span>
      <span class="ir-cal">${ing.calories||0} kcal</span>
    </div>`).join('');
  container.querySelectorAll('.ing-row').forEach(row=>{
    row.addEventListener('click', ()=> openIngredientModal(row.dataset.id));
  });
}

document.getElementById('new-ingredient-btn').addEventListener('click', ()=> openIngredientModal(null));

function openIngredientModal(ingId){
  state.editing.ingredientId = ingId;
  const ing = ingId ? state.ingredients[ingId] : { emoji:'🥕', name:'', unit:'g', calories:'', prices:{} };
  document.getElementById('ingredient-modal-title').textContent = ingId ? 'Edit ingredient' : 'New ingredient';
  document.getElementById('ingredient-emoji').value = ing.emoji || '🥕';
  document.getElementById('ingredient-name').value = ing.name || '';
  document.getElementById('ingredient-unit').value = ing.unit || 'g';
  document.getElementById('ingredient-calories').value = ing.calories ?? '';
  document.getElementById('ingredient-density').value = ing.gramsPerCup ?? '';

  const priceContainer = document.getElementById('ingredient-prices');
  const prices = ing.prices || {};
  priceContainer.innerHTML = STORES.map(store => `
    <div class="price-row" data-store="${store}">
      <span>${store}</span>
      <input type="number" class="price-input" min="0" step="0.01" placeholder="e.g. 1.29" value="${prices[store] ?? ''}" />
    </div>`).join('');

  document.getElementById('delete-ingredient-btn').classList.toggle('hidden', !ingId);
  openModal('ingredient-modal');
}

document.getElementById('save-ingredient-btn').addEventListener('click', async ()=>{
  const name = document.getElementById('ingredient-name').value.trim();
  if (!name){ toast('Give the ingredient a name'); return; }
  const prices = {};
  document.querySelectorAll('#ingredient-prices .price-row').forEach(row => {
    const store = row.dataset.store;
    const val = row.querySelector('.price-input').value;
    if (val !== '') prices[store] = Number(val);
  });

  const data = {
    name,
    emoji: document.getElementById('ingredient-emoji').value.trim() || '🥕',
    unit: document.getElementById('ingredient-unit').value,
    calories: Number(document.getElementById('ingredient-calories').value)||0,
    gramsPerCup: Number(document.getElementById('ingredient-density').value)||0,
    prices
  };
  if (state.editing.ingredientId){
    await setDoc(doc(db,'users',state.uid,'ingredients', state.editing.ingredientId), data);
  } else {
    await addDoc(col('ingredients'), data);
  }
  closeModals();
  toast('Ingredient saved');
});

document.getElementById('delete-ingredient-btn').addEventListener('click', async ()=>{
  if (!state.editing.ingredientId) return;
  if (!confirm('Delete this ingredient? Recipes using it will show a missing ingredient.')) return;
  await deleteDoc(doc(db,'users',state.uid,'ingredients', state.editing.ingredientId));
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
