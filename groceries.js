(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const sections = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Spices & Seasonings', 'Other'];
  const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const plurals = { onions: 'onion', carrots: 'carrot', potatoes: 'potato', tomatoes: 'tomato', eggs: 'egg', lemons: 'lemon', limes: 'lime', apples: 'apple', bananas: 'banana', peppers: 'pepper', cucumbers: 'cucumber', cloves: 'clove' };
  const unitAliases = { tablespoons: 'tbsp', tablespoon: 'tbsp', teaspoons: 'tsp', teaspoon: 'tsp', cups: 'cup', grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', pounds: 'lb', pound: 'lb', lbs: 'lb', ounces: 'oz', ounce: 'oz', milliliters: 'ml', milliliter: 'ml', liters: 'l', liter: 'l', cloves: 'clove', cans: 'can', slices: 'slice', bunches: 'bunch' };
  function ingredientName(value) {
    const words = normalize(value).split(' ');
    words[words.length - 1] = plurals[words[words.length - 1]] || words[words.length - 1];
    return words.join(' ');
  }
  function unitName(value) { const unit = normalize(value).replace(/\.$/, ''); return unitAliases[unit] || unit; }
  function sectionName(value) { return sections.find(section => normalize(section) === normalize(value)) || 'Other'; }
  const matchKey = row => JSON.stringify([ingredientName(row.item), unitName(row.unit), sectionName(row.section)]);
  const rounded = value => Number(value.toFixed(6));
  const errorText = error => `${error.message || String(error)}${error.code ? ` (${error.code})` : ''}`;
  function generateRows(meals, recipes, ingredients) {
    const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
    const ingredientsByRecipe = new Map();
    for (const ingredient of ingredients) {
      if (!ingredientsByRecipe.has(ingredient.recipe_id)) ingredientsByRecipe.set(ingredient.recipe_id, []);
      ingredientsByRecipe.get(ingredient.recipe_id).push(ingredient);
    }
    const rows = [], combined = new Map();
    for (const meal of meals) {
      if (!meal.recipe_id) continue;
      const recipe = recipeById.get(meal.recipe_id);
      if (!recipe) throw new Error(`Recipe ${meal.recipe_id} is unavailable. Grocery generation stopped.`);
      const normal = Number(recipe.servings), planned = Number(meal.servings ?? recipe.servings);
      if (!(normal > 0) || !(planned > 0) || !Number.isFinite(normal + planned)) throw new Error(`Recipe ${recipe.id} has invalid default or planned servings.`);
      const factor = planned / normal;
      for (const ingredient of ingredientsByRecipe.get(recipe.id) || []) {
        const numeric = ingredient.quantity == null ? window.Ingredients.quantityValue(String(ingredient.quantity_text || '')) : Number(ingredient.quantity);
        if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) throw new Error(`Invalid quantity for ${ingredient.ingredient}.`);
        const quantity = numeric === null ? null : numeric * factor;
        const notes = [ingredient.preparation?.trim()];
        if (quantity === null && factor !== 1) notes.push(`Quantity not scaled; planned servings are ${rounded(factor)}× the recipe.`);
        const row = { item: ingredientName(ingredient.ingredient), quantity, quantity_text: quantity === null ? ingredient.quantity_text || null : null, unit: unitName(ingredient.unit) || null, section: sectionName(ingredient.grocery_section), notes: notes.filter(Boolean).join('; ') || null, checked: false, manually_added: false };
        if (!row.item) throw new Error('A recipe ingredient has no name.');
        // Unknown quantities remain separate. Equal canonical units combine;
        // no volume-to-weight or other uncertain conversions are attempted.
        const key = matchKey(row);
        const existing = quantity === null ? null : combined.get(key);
        if (existing) {
          existing.quantity += quantity;
          existing.notes = [...new Set([existing.notes, row.notes].filter(Boolean))].join('; ') || null;
        } else {
          rows.push(row);
          if (quantity !== null) combined.set(key, row);
        }
      }
    }
    return rows.map((row, sort_order) => {
      if (row.quantity !== null) { row.quantity = rounded(row.quantity); row.quantity_text = String(row.quantity); }
      if (!row.unit && row.quantity !== null && row.quantity !== 1) {
        const words = row.item.split(' ');
        words[words.length - 1] = Object.keys(plurals).find(word => plurals[word] === words[words.length - 1]) || words[words.length - 1];
        row.item = words.join(' ');
      }
      return { ...row, sort_order };
    });
  }
  function preserveChecks(generated, existing) {
    const before = new Map(), after = new Map();
    for (const row of existing.filter(item => !item.manually_added)) {
      const key = matchKey(row); if (!before.has(key)) before.set(key, []); before.get(key).push(row);
    }
    for (const row of generated) { const key = matchKey(row); after.set(key, (after.get(key) || 0) + 1); }
    return generated.map(row => {
      const matches = before.get(matchKey(row)) || [];
      return { ...row, checked: matches.length === 1 && after.get(matchKey(row)) === 1 ? Boolean(matches[0].checked) : false };
    });
  }
  function wouldOverwrite(generated, existing) {
    const signature = row => JSON.stringify([matchKey(row), row.quantity == null ? null : rounded(Number(row.quantity)), row.quantity == null ? row.quantity_text || '' : '', row.notes || '']);
    const counts = new Map();
    for (const row of generated) { const key = signature(row); counts.set(key, (counts.get(key) || 0) + 1); }
    return existing.filter(row => !row.manually_added).some(row => {
      const key = signature(row), count = counts.get(key) || 0;
      if (!count) return true;
      counts.set(key, count - 1); return false;
    });
  }

  let client, userId = null, version = 0, loadSequence = 0;
  let week = '', mealPlan = null, groceryList = null, items = [];
  let visible = false, ready = false, busy = false, generationJob = null, editorDraft = null;
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  }
  function button(text, fn) { const node = element('button', 'secondary', text); node.type = 'button'; node.addEventListener('click', fn); return node; }
  function check(token) { if (!client || !userId || token !== version) throw new Error('Your session changed. Sign in again to continue.'); }
  async function request(query, token = version) {
    check(token); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try { const { data, error } = await query.abortSignal(controller.signal); check(token); if (error) throw error; return data; }
    finally { clearTimeout(timer); }
  }
  async function allRows(makeQuery, token = version) {
    const rows = [];
    for (;;) { const page = await request(makeQuery().order('id').range(rows.length, rows.length + 999), token); if (!page.length) return rows; rows.push(...page); }
  }
  async function readList(selected, token = version) {
    const plan = await request(client.from('meal_plans').select('id,week_start').eq('week_start', selected).maybeSingle(), token);
    const list = plan ? await request(client.from('grocery_lists').select('*').eq('meal_plan_id', plan.id).maybeSingle(), token) : null;
    const rows = list ? await allRows(() => client.from('grocery_items').select('*').eq('grocery_list_id', list.id), token) : [];
    return { plan, list, rows };
  }
  async function ensurePlan(selected, token) {
    const lookup = () => request(client.from('meal_plans').select('id,week_start').eq('week_start', selected).maybeSingle(), token);
    const old = await lookup(); if (old) return old;
    const now = new Date().toISOString();
    try { return await request(client.from('meal_plans').insert({ id: crypto.randomUUID(), week_start: selected, created_at: now, updated_at: now }).select('id,week_start').single(), token); }
    catch (error) { if (error.code !== '23505') throw error; const row = await lookup(); if (!row) throw error; return row; }
  }
  async function ensureList(plan, token) {
    const lookup = () => request(client.from('grocery_lists').select('*').eq('meal_plan_id', plan.id).maybeSingle(), token);
    const old = await lookup(); if (old) return old;
    const now = new Date().toISOString();
    try { return await request(client.from('grocery_lists').insert({ id: crypto.randomUUID(), meal_plan_id: plan.id, created_at: now, updated_at: now }).select('*').single(), token); }
    catch (error) { if (error.code !== '23505') throw error; const row = await lookup(); if (!row) throw error; return row; }
  }
  function shiftDate(date, days) {
    const [y, m, d] = date.split('-').map(Number), value = new Date(y, m - 1, d + days, 12);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  function label(date) { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function controls() {
    for (const id of ['grocery-previous', 'grocery-next', 'grocery-current']) $(id).disabled = busy || Boolean(generationJob);
    $('generate-groceries').disabled = busy || (!ready && !generationJob);
    $('generate-groceries').textContent = generationJob ? 'Retry generation' : 'Generate grocery list';
    $('add-grocery').disabled = busy || !ready || Boolean(generationJob);
    $('grocery-retry').disabled = busy;
    Array.from($('grocery-form').elements).forEach(control => { control.disabled = busy; });
  }
  function render() {
    $('grocery-week').textContent = week ? `${label(week)} – ${label(shiftDate(week, 6))} · ${week.slice(0, 4)}` : '';
    $('grocery-sections').replaceChildren();
    if (ready) {
      if (!items.length) $('grocery-sections').append(element('p', 'subheading', 'Your list is empty. Generate it from your meals or add an item.'));
      for (const section of sections) {
        const rows = items.filter(item => sectionName(item.section) === section).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.item.localeCompare(b.item));
        if (!rows.length) continue;
        const group = element('section', 'grocery-group'); group.append(element('h2', '', section));
        for (const item of rows) {
          const row = element('div', `grocery-row${item.checked ? ' is-checked' : ''}`);
          const label = element('label', 'grocery-check');
          const check = element('input'); check.type = 'checkbox'; check.checked = item.checked;
          check.setAttribute('aria-label', `${item.checked ? 'Uncheck' : 'Check'} ${item.item}`);
          check.disabled = busy || Boolean(generationJob);
          check.addEventListener('change', () => toggleChecked(item));
          const copy = element('span', 'grocery-copy');
          copy.append(element('strong', '', item.item), element('span', '', [item.quantity_text || (item.quantity == null ? '' : String(item.quantity)), item.unit].filter(Boolean).join(' ')));
          if (item.notes) copy.append(element('small', '', item.notes));
          if (item.manually_added) copy.append(element('small', '', 'Added by you'));
          label.append(check, copy); row.append(label);
          const edit = button('Edit', () => openEditor(item)); edit.setAttribute('aria-label', `Edit ${item.item}`);
          const remove = button('Delete', () => deleteItem(item)); remove.setAttribute('aria-label', `Delete ${item.item}`);
          edit.disabled = remove.disabled = busy || Boolean(generationJob);
          const actions = element('div', 'grocery-row-actions'); actions.append(edit, remove); row.append(actions); group.append(row);
        }
        $('grocery-sections').append(group);
      }
    }
    controls();
  }
  async function loadList(selected = window.MealPlanner.getWeek()) {
    const token = version, sequence = ++loadSequence; week = selected; ready = false; render();
    $('grocery-status').textContent = 'Loading your grocery list…'; $('grocery-retry').hidden = true;
    try {
      const result = await readList(selected, token);
      if (token !== version || sequence !== loadSequence) return false;
      mealPlan = result.plan; groceryList = result.list; items = result.rows; ready = true;
      $('grocery-status').textContent = `${items.filter(item => !item.checked).length} items left to pick up.`;
      return true;
    } catch (error) {
      if (token === version && sequence === loadSequence) {
        $('grocery-status').textContent = `Could not load groceries: ${errorText(error)}`; $('grocery-retry').hidden = false;
      }
      return false;
    } finally { if (token === version && sequence === loadSequence) render(); }
  }
  async function sourceIngredients(plan, token) {
    const meals = await allRows(() => client.from('meal_plan_items').select('id,recipe_id,servings').eq('meal_plan_id', plan.id).not('recipe_id', 'is', null), token);
    const ids = [...new Set(meals.map(meal => meal.recipe_id).filter(Boolean))];
    const recipes = [], ingredients = [];
    // Bound URL size and use shared queries, never one request per ingredient.
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      const results = await Promise.allSettled([
        allRows(() => client.from('recipes').select('id,servings').in('id', batch), token),
        allRows(() => client.from('recipe_ingredients').select('*').in('recipe_id', batch), token)
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      recipes.push(...results[0].value); ingredients.push(...results[1].value);
    }
    return generateRows(meals, recipes, ingredients);
  }
  async function generate() {
    if (busy || !userId) return;
    const token = version; busy = true; render();
    try {
      if (!generationJob) {
        const current = await readList(week, token);
        if (!current.plan) { $('grocery-status').textContent = 'No meal plan exists for this week. Plan some recipes first, or add a manual item.'; return; }
        let rows = await sourceIngredients(current.plan, token);
        rows = preserveChecks(rows, current.rows);
        if (wouldOverwrite(rows, current.rows) && !window.confirm('Regeneration will replace changed generated items, including quantities and notes. Manual items will be kept. Continue?')) return;
        generationJob = { week, plan: current.plan, rows: rows.map(row => ({ ...row, id: crypto.randomUUID() })), cleared: false };
      }
      const job = generationJob;
      job.list ||= await ensureList(job.plan, token);
      if (!job.cleared) {
        await request(client.from('grocery_items').delete().eq('grocery_list_id', job.list.id).eq('manually_added', false), token);
        job.cleared = true;
      }
      // New, stable IDs make retry idempotent even if an insert response is lost.
      const now = new Date().toISOString();
      for (let index = 0; index < job.rows.length; index += 200) {
        await request(client.from('grocery_items').upsert(job.rows.slice(index, index + 200).map(row => ({ ...row, grocery_list_id: job.list.id, created_at: now, updated_at: now })), { onConflict: 'id' }), token);
      }
      await request(client.from('grocery_lists').update({ updated_at: now }).eq('id', job.list.id).select('id').single(), token);
      generationJob = null;
      if (await loadList(job.week)) $('grocery-status').textContent = 'Grocery list generated. Manual items and clearly matching checked items were preserved.';
    } catch (error) {
      if (token === version) $('grocery-status').textContent = `Generation failed: ${errorText(error)}${generationJob ? ' Some steps may be saved. Keep this tab open and retry generation to finish without duplicate rows.' : ''}`;
    } finally { if (token === version) { busy = false; render(); } }
  }
  function openEditor(item = null) {
    if (busy || generationJob || !ready) return;
    editorDraft = { id: item?.id || crypto.randomUUID(), existing: Boolean(item), manually_added: item?.manually_added ?? true, sort_order: item?.sort_order ?? Math.max(-1, ...items.map(row => row.sort_order || 0)) + 1, list: groceryList, week };
    $('grocery-form').reset(); $('grocery-editor-title').textContent = item ? 'Edit grocery item' : 'Add grocery item';
    $('grocery-name').value = item?.item || '';
    $('grocery-quantity').value = item?.quantity_text || (item?.quantity == null ? '' : String(item.quantity));
    $('grocery-unit').value = item?.unit || ''; $('grocery-section').value = sectionName(item?.section);
    $('grocery-notes').value = item?.notes || ''; $('grocery-checked').checked = Boolean(item?.checked);
    $('grocery-form-status').textContent = ''; controls(); $('grocery-editor').showModal();
  }
  $('grocery-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !$('grocery-form').reportValidity()) return;
    const item = $('grocery-name').value.trim(); if (!item) { $('grocery-form-status').textContent = 'Enter an item name.'; return; }
    const quantity_text = $('grocery-quantity').value.trim() || null;
    const quantity = quantity_text ? window.Ingredients.quantityValue(quantity_text) : null;
    const token = version, draft = editorDraft; busy = true; controls();
    try {
      draft.list ||= await ensureList(await ensurePlan(draft.week, token), token);
      const now = new Date().toISOString();
      const values = { item, quantity, quantity_text, unit: $('grocery-unit').value.trim() || null, section: $('grocery-section').value, notes: $('grocery-notes').value.trim() || null, checked: $('grocery-checked').checked, updated_at: now };
      if (draft.existing) {
        await request(client.from('grocery_items').update(values).eq('id', draft.id).eq('grocery_list_id', draft.list.id).select('id').single(), token);
      } else {
        await request(client.from('grocery_items').upsert({ ...values, id: draft.id, grocery_list_id: draft.list.id, manually_added: true, sort_order: draft.sort_order, created_at: now }, { onConflict: 'id' }).select('id').single(), token);
        draft.existing = true;
      }
      if (!await loadList(draft.week)) throw new Error($('grocery-status').textContent);
      check(token); $('grocery-editor').close(); editorDraft = null; $('grocery-status').textContent = 'Grocery item saved.';
    } catch (error) { if (token === version) $('grocery-form-status').textContent = `Could not finish saving: ${errorText(error)} You can retry.`; }
    finally { if (token === version) { busy = false; controls(); render(); } }
  });
  async function toggleChecked(item) {
    if (busy || generationJob) return;
    const token = version; busy = true; render();
    try {
      const data = await request(client.from('grocery_items').update({ checked: !item.checked, updated_at: new Date().toISOString() }).eq('id', item.id).select('checked').single(), token);
      item.checked = data.checked; $('grocery-status').textContent = `${items.filter(row => !row.checked).length} items left to pick up.`;
    } catch (error) { if (token === version) $('grocery-status').textContent = `Could not update item: ${errorText(error)}`; }
    finally { if (token === version) { busy = false; render(); } }
  }
  async function deleteItem(item) {
    if (busy || generationJob) return;
    const token = version; busy = true; render();
    try {
      const data = await request(client.from('grocery_items').delete().eq('id', item.id).select('id'), token);
      if (!data.length) throw new Error('The item was not deleted. Reload the list and check your access.');
      items = items.filter(row => row.id !== item.id); $('grocery-status').textContent = 'Item deleted from this grocery list.';
    } catch (error) { if (token === version) $('grocery-status').textContent = `Could not delete item: ${errorText(error)}`; }
    finally { if (token === version) { busy = false; render(); } }
  }
  function changeWeek(selected) {
    if (busy || generationJob) return;
    if (!window.MealPlanner.selectWeek(selected)) { $('grocery-status').textContent = 'Finish the pending planner action before changing weeks.'; return; }
    loadList(window.MealPlanner.getWeek());
  }
  for (const section of sections) { const option = element('option', '', section); option.value = section; $('grocery-section').append(option); }
  $('generate-groceries').addEventListener('click', generate);
  $('add-grocery').addEventListener('click', () => openEditor());
  $('grocery-retry').addEventListener('click', () => loadList(generationJob?.week || window.MealPlanner.getWeek()));
  $('grocery-previous').addEventListener('click', () => changeWeek(shiftDate(week, -7)));
  $('grocery-next').addEventListener('click', () => changeWeek(shiftDate(week, 7)));
  $('grocery-current').addEventListener('click', () => {
    const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    changeWeek(shiftDate(date, -((now.getDay() + 6) % 7)));
  });
  for (const id of ['grocery-close', 'grocery-cancel']) $(id).addEventListener('click', () => { if (!busy) $('grocery-editor').close(); });
  $('grocery-editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  window.Groceries = {
    normalizeIngredient: ingredientName,
    initialize(value) { client = value; },
    setSession(value) {
      if (value === userId) return;
      userId = value; version++; loadSequence++; ready = false; busy = false; visible = false;
      items = []; mealPlan = null; groceryList = null; generationJob = null; editorDraft = null;
      $('groceries').hidden = true; $('grocery-sections').replaceChildren(); $('grocery-editor').close(); $('grocery-form').reset();
    },
    show(value) {
      $('groceries').hidden = !value;
      const opening = value && !visible; visible = value;
      if (opening && userId && !busy) loadList(generationJob?.week || window.MealPlanner.getWeek());
    }
  };
})();
