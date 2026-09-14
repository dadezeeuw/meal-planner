(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const normalize = value => String(value || '').trim().toLowerCase();
  const staples = new Set(['salt', 'sea salt', 'kosher salt', 'table salt', 'pepper', 'black pepper', 'ground black pepper', 'salt and pepper', 'water', 'oil', 'olive oil', 'vegetable oil', 'canola oil', 'cooking oil']);
  function season(date = new Date()) { return ['Winter', 'Spring', 'Summer', 'Fall'][Math.floor(((date.getMonth() + 1) % 12) / 3)]; }
  function names(recipe) { return new Set((recipe.ingredients || []).map(item => window.Groceries.normalizeIngredient(item.ingredient)).filter(Boolean)); }
  function age(recipe, today = new Date()) {
    if (!recipe.historyLoaded) return null;
    if (!recipe.lastPlannedDate) return Infinity;
    const [year, month, day] = recipe.lastPlannedDate.split('-').map(Number);
    return Math.max(0, (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(year, month - 1, day)) / 86400000);
  }
  function recencyOrder(a, b) {
    if (Boolean(a.historyLoaded) !== Boolean(b.historyLoaded)) return a.historyLoaded ? -1 : 1;
    return (a.lastPlannedDate || '').localeCompare(b.lastPlannedDate || '') || a.title.localeCompare(b.title) || String(a.id).localeCompare(String(b.id));
  }
  function overlap(recipe, reference) {
    const ingredients = names(recipe);
    const useful = [...ingredients].filter(name => !staples.has(name));
    const shared = useful.filter(name => reference.has(name)).sort();
    const incidental = [...ingredients].filter(name => staples.has(name) && reference.has(name)).length;
    return { shared, coverage: shared.length / Math.max(1, useful.length), incidental };
  }
  function rank(recipes, context, options = {}) {
    const { mode = 'recent', anchorId = '', includePlanned = false, mealType = null, today = new Date() } = options;
    const planned = new Set(context.plannedIds);
    const reference = new Set();
    if (mode === 'similar') {
      const anchor = recipes.find(recipe => recipe.id === anchorId);
      if (anchor) names(anchor).forEach(name => reference.add(name));
    } else if (mode === 'groceries') {
      context.groceryNames.forEach(name => reference.add(name));
    } else {
      recipes.filter(recipe => planned.has(recipe.id)).forEach(recipe => names(recipe).forEach(name => reference.add(name)));
    }
    const type = mealType || (mode === 'dinner' ? 'dinner' : null);
    const hasType = type && recipes.some(recipe => recipe.tags.some(tag => normalize(tag) === type));
    const result = [];
    for (const recipe of recipes) {
      if (recipe.data_source !== 'supabase') continue;
      if (!includePlanned && planned.has(recipe.id)) continue;
      if (mode === 'similar' && (!anchorId || recipe.id === anchorId)) continue;
      if (mode === 'never' && (!recipe.historyLoaded || recipe.lastPlannedDate)) continue;
      if (type && (hasType || type === 'dinner') && !recipe.tags.some(tag => normalize(tag) === type)) continue;
      const match = overlap(recipe, reference);
      if (['similar', 'week', 'groceries'].includes(mode) && !match.shared.length) continue;
      const elapsed = age(recipe, today);
      const recency = elapsed === null ? 0 : Math.min(elapsed / 30, 3);
      const seasonal = recipe.tags.some(tag => normalize(tag) === normalize(season(today))) ? 1 : 0;
      // Useful overlap dominates week/anchor modes; staple matches add only
      // a small tie-break. Dinner balances recency, overlap, and season.
      const score = mode === 'dinner'
        ? 2 * recency + 2 * seasonal + 2 * match.shared.length + match.coverage + .05 * match.incidental
        : 4 * match.shared.length + 2 * match.coverage + (mode === 'similar' ? 0 : recency + seasonal) + .05 * match.incidental;
      result.push({ recipe, score, shared: match.shared, coverage: match.coverage, seasonal });
    }
    result.sort((a, b) => ['recent', 'never'].includes(mode) ? recencyOrder(a.recipe, b.recipe) : b.score - a.score || recencyOrder(a.recipe, b.recipe));
    return result;
  }

  let client, getLibrary, onChange = () => {}, historyLabel = () => '';
  let userId = null, sessionVersion = 0, requestVersion = 0;
  let library = [], mode = '', loading = false, context = null, reasons = new Map();
  function ui() {
    $('smart-anchor-label').hidden = mode !== 'similar';
    $('smart-shortcuts').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.smart === mode)));
  }
  async function query(value, version) {
    if (!userId || version !== sessionVersion) throw new Error('Your session changed.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await value.abortSignal(controller.signal);
      if (version !== sessionVersion) throw new Error('Your session changed.');
      if (error) throw error;
      return data;
    } finally { clearTimeout(timer); }
  }
  async function allRows(makeQuery, version) {
    const rows = [];
    for (;;) { const page = await query(makeQuery().order('id').range(rows.length, rows.length + 999), version); if (!page.length) return rows; rows.push(...page); }
  }
  async function weekContext(week, version) {
    const plan = await query(client.from('meal_plans').select('id').eq('week_start', week).maybeSingle(), version);
    if (!plan) return { week, plannedIds: [], groceryNames: [], groceryWarning: '' };
    const meals = await allRows(() => client.from('meal_plan_items').select('id,recipe_id').eq('meal_plan_id', plan.id).not('recipe_id', 'is', null), version);
    let groceryNames = [], groceryWarning = '';
    try {
      const list = await query(client.from('grocery_lists').select('id').eq('meal_plan_id', plan.id).maybeSingle(), version);
      if (list) {
        const items = await allRows(() => client.from('grocery_items').select('id,item').eq('grocery_list_id', list.id), version);
        groceryNames = items.map(item => window.Groceries.normalizeIngredient(item.item));
      }
    } catch (error) { groceryWarning = `Grocery overlap unavailable: ${error.message || String(error)}`; }
    return { week, plannedIds: meals.map(meal => meal.recipe_id), groceryNames, groceryWarning };
  }
  async function refresh() {
    if (!client || !userId) return null;
    const version = sessionVersion, request = ++requestVersion, week = window.MealPlanner.getWeek();
    loading = true; context = null; reasons.clear();
    $('smart-status').textContent = 'Finding ideas for your selected week…'; $('smart-retry').hidden = true; onChange();
    try {
      const results = await Promise.allSettled([getLibrary(), weekContext(week, version)]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (version !== sessionVersion || request !== requestVersion || week !== window.MealPlanner.getWeek()) return null;
      library = results[0].value; context = results[1].value;
      $('smart-status').textContent = `Week of ${week} · ${season()} ideas. ${context.groceryWarning || 'Recency comes from planned dates; ingredient matches are approximate.'}`;
      $('smart-retry').hidden = false;
      return context;
    } catch (error) {
      if (version === sessionVersion && request === requestVersion) {
        $('smart-status').textContent = `Suggestions could not load: ${error.message || String(error)}`; $('smart-retry').hidden = false;
      }
      return null;
    } finally { if (version === sessionVersion && request === requestVersion) { loading = false; onChange(); } }
  }
  function explain(result, selectedMode) {
    const pieces = [];
    if (result.recipe.historyLoaded && !result.recipe.lastPlannedDate) pieces.push('Never made');
    else if (result.recipe.historyLoaded) pieces.push(historyLabel(result.recipe));
    if (result.shared.length) {
      pieces.push(selectedMode === 'groceries' ? 'Uses ingredients already on your list' : `Shares ${result.shared.length} ingredient${result.shared.length === 1 ? '' : 's'}${selectedMode === 'similar' ? ' with your anchor' : ' with this week’s meals'}`);
      pieces.push(`Uses ${result.shared.slice(0, 4).join(', ')}`);
    }
    if (result.seasonal && !['recent', 'never', 'similar'].includes(selectedMode)) pieces.push(`${season()} favorite`);
    return pieces.join(' · ');
  }
  $('smart-shortcuts').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.smart; ui();
    if (mode) void refresh(); else { reasons.clear(); onChange(); }
  }));
  $('smart-anchor').addEventListener('change', onAnchorChange);
  function onAnchorChange() { onChange(); }
  $('smart-include').addEventListener('change', () => onChange());
  $('smart-retry').addEventListener('click', () => refresh());
  window.SmartSuggestions = {
    initialize(value, loader, changed, label) { client = value; getLibrary = loader; onChange = changed; historyLabel = label; },
    setSession(value) {
      if (value === userId) return;
      userId = value; sessionVersion++; requestVersion++; library = []; context = null; mode = ''; reasons.clear(); loading = false;
      $('smart-status').textContent = ''; $('smart-include').checked = false; $('smart-retry').hidden = true; ui();
    },
    setRecipes(recipes) {
      library = recipes;
      const selected = $('smart-anchor').value;
      const select = $('smart-anchor');
      // Reuse recipe objects and ingredient data already loaded by the library.
      select.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an anchor recipe'; select.append(placeholder);
      [...recipes].sort((a, b) => a.title.localeCompare(b.title)).forEach(recipe => {
        const option = document.createElement('option'); option.value = recipe.id; option.textContent = recipe.title; select.append(option);
      });
      select.value = recipes.some(recipe => recipe.id === selected) ? selected : '';
    },
    active: () => Boolean(mode),
    clear() { mode = ''; reasons.clear(); ui(); },
    refresh,
    reason: id => reasons.get(id) || '',
    filter(recipes) {
      reasons.clear();
      if (!mode) return recipes;
      if (loading || !context || context.week !== window.MealPlanner.getWeek()) return [];
      const options = { mode, anchorId: $('smart-anchor').value, includePlanned: $('smart-include').checked };
      // Rank against the complete library, then apply existing search/tag filters.
      const eligible = new Set(recipes.map(recipe => recipe.id));
      let matches = rank(library, context, options).filter(result => eligible.has(result.recipe.id));
      if (mode === 'dinner') matches = matches.slice(0, 5);
      matches.forEach(result => reasons.set(result.recipe.id, explain(result, mode)));
      if (mode === 'similar' && !options.anchorId) $('smart-status').textContent = 'Choose an anchor recipe to find useful ingredient matches.';
      return matches.map(result => result.recipe);
    },
    async forMeal(type) {
      const loaded = await refresh();
      if (!loaded) throw new Error($('smart-status').textContent || 'Suggestions are unavailable.');
      const ranked = rank(library, loaded, { mode: type === 'dinner' ? 'dinner' : 'week', mealType: type });
      // Breakfast/lunch can still offer recency choices when the week has no
      // useful ingredient overlap. Apply their tag when it exists.
      const matches = ranked.length ? ranked : type === 'dinner' ? [] : rank(library, loaded, { mode: 'recent', mealType: type });
      return matches.slice(0, 5).map(result => ({ recipe: result.recipe, reason: explain(result, type === 'dinner' ? 'dinner' : 'week') }));
    }
  };
})();
