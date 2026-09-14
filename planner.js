(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const types = ['breakfast', 'lunch', 'dinner'];
  const stamp = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function dateValue(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) throw new Error('Choose a valid date.');
    const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
    if (stamp(date) !== value) throw new Error('Choose a valid date.');
    return date;
  }
  function shift(value, days) { const date = dateValue(value); date.setDate(date.getDate() + days); return stamp(date); }
  function monday(value = stamp(new Date())) {
    return shift(value, -((dateValue(value).getDay() + 6) % 7));
  }
  const label = value => dateValue(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const key = item => `${item.meal_date}:${item.meal_type}`;
  const errorText = error => `${error.message || String(error)}${error.code ? ` (${error.code})` : ''}`;
  let client, userId = null, sessionVersion = 0, loadVersion = 0;
  let selectedWeek = monday(), plan = null, items = [], catalog = [];
  let visible = false, loading = false, ready = false, busy = false;
  let chosenRecipe = null, fixedSlot = false, copyJob = null;

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function action(text, fn, className = 'secondary') {
    const result = element('button', className, text); result.type = 'button';
    result.addEventListener('click', fn); return result;
  }
  function check(version) {
    if (!client || !userId || version !== sessionVersion) throw new Error('Your session changed. Sign in again to continue.');
  }
  async function request(query, version = sessionVersion) {
    check(version);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await query.abortSignal(controller.signal);
      check(version);
      if (error) throw error;
      return data;
    } finally { clearTimeout(timer); }
  }
  async function readWeek(week, version = sessionVersion) {
    const row = await request(client.from('meal_plans').select('*').eq('week_start', week).maybeSingle(), version);
    const meals = row ? await request(client.from('meal_plan_items').select('*').eq('meal_plan_id', row.id).order('meal_date').order('meal_type'), version) : [];
    return { plan: row, items: meals };
  }
  async function ensureWeek(week, version) {
    const existing = await request(client.from('meal_plans').select('*').eq('week_start', week).maybeSingle(), version);
    if (existing) return existing;
    const now = new Date().toISOString();
    try {
      return await request(client.from('meal_plans').insert({ id: crypto.randomUUID(), week_start: week, created_at: now, updated_at: now }).select('*').single(), version);
    } catch (error) {
      if (error.code !== '23505') throw error;
      const row = await request(client.from('meal_plans').select('*').eq('week_start', week).maybeSingle(), version);
      if (!row) throw error;
      return row;
    }
  }
  // History remains a query over meal_plan_items; recipes are never assigned
  // a last_made column. readWeek and slot data can support future history labels.
  async function writeSlot(date, type, values, version = sessionVersion) {
    dateValue(date);
    if (!types.includes(type)) throw new Error('Choose breakfast, lunch, or dinner.');
    const weekPlan = await ensureWeek(monday(date), version);
    const lookup = () => request(client.from('meal_plan_items').select('id').eq('meal_plan_id', weekPlan.id).eq('meal_date', date).eq('meal_type', type).maybeSingle(), version);
    let existing = await lookup();
    const payload = { ...values, updated_at: new Date().toISOString() };
    if (!existing) {
      try {
        return await request(client.from('meal_plan_items').insert({ id: crypto.randomUUID(), meal_plan_id: weekPlan.id, meal_date: date, meal_type: type, ...payload, created_at: payload.updated_at }).select('*').single(), version);
      } catch (error) {
        if (error.code !== '23505') throw error;
        existing = await lookup();
        if (!existing) throw error;
      }
    }
    return request(client.from('meal_plan_items').update(payload).eq('id', existing.id).select('*').single(), version);
  }
  async function readCatalog(version = sessionVersion) {
    const rows = [];
    for (;;) {
      const page = await request(client.from('recipes').select('id,title,description,servings,image_path').order('id').range(rows.length, rows.length + 999), version);
      if (!page.length) return rows;
      rows.push(...page);
    }
  }
  function photoUrl(recipe) {
    return recipe?.image_path ? client.storage.from('recipe-images').getPublicUrl(recipe.image_path).data.publicUrl : '';
  }
  function controls() {
    const locked = busy || Boolean(copyJob);
    for (const id of ['previous-week', 'next-week', 'current-week']) $(id).disabled = locked;
    $('copy-week').disabled = busy || loading || !ready;
    $('copy-week').textContent = copyJob ? 'Retry copy previous week' : 'Copy previous week';
    $('planner-retry').disabled = busy;
    Array.from($('meal-form').elements).forEach(control => { control.disabled = busy; });
    $('meal-date').disabled = busy || fixedSlot;
    $('meal-type').disabled = busy || fixedSlot;
    $('meal-results').querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  function renderWeek() {
    $('week-heading').textContent = `${label(selectedWeek)} – ${label(shift(selectedWeek, 6))} · ${dateValue(shift(selectedWeek, 6)).getFullYear()}`;
    $('week-grid').replaceChildren();
    if (!ready) { controls(); return; }
    const bySlot = new Map(items.map(item => [key(item), item]));
    const byRecipe = new Map(catalog.map(recipe => [recipe.id, recipe]));
    for (let day = 0; day < 7; day++) {
      const date = shift(selectedWeek, day);
      const column = element('section', 'planner-day');
      const heading = element('h3', '', dateValue(date).toLocaleDateString(undefined, { weekday: 'long' }));
      heading.append(element('small', '', label(date)));
      column.append(heading);
      for (const type of types) {
        const meal = bySlot.get(`${date}:${type}`);
        const recipe = meal?.recipe_id ? byRecipe.get(meal.recipe_id) : null;
        const slot = element('div', 'meal-slot');
        slot.append(element('p', 'eyebrow', type));
        if (meal) {
          const url = photoUrl(recipe);
          if (url) { const img = element('img', 'meal-photo'); img.src = url; img.alt = ''; img.loading = 'lazy'; slot.append(img); }
          slot.append(element('p', 'meal-title', recipe?.title || meal.custom_text || 'Recipe unavailable'));
          if (meal.servings !== null) slot.append(element('small', '', `${meal.servings} servings`));
        } else slot.append(element('p', 'meal-placeholder', 'Something delicious?'));
        const edit = action(meal ? 'Edit meal' : 'Choose recipe', () => openSlot(date, type, meal));
        edit.setAttribute('aria-label', `${meal ? 'Edit' : 'Plan'} ${type} for ${label(date)}`);
        edit.disabled = busy || Boolean(copyJob);
        slot.append(edit);
        const second = meal ? action('Clear meal', () => clearSlot(meal)) : action('Custom meal', () => openSlot(date, type, null, 'custom'));
        second.setAttribute('aria-label', `${meal ? 'Clear' : 'Enter custom'} ${type} for ${label(date)}`);
        second.disabled = busy || Boolean(copyJob);
        slot.append(second); column.append(slot);
      }
      $('week-grid').append(column);
    }
    controls();
  }
  async function loadWeek() {
    const version = sessionVersion, sequence = ++loadVersion, week = selectedWeek;
    loading = true; ready = false; renderWeek();
    $('planner-retry').hidden = true; $('planner-status').textContent = 'Loading your week…';
    try {
      const results = await Promise.allSettled([readWeek(week, version), readCatalog(version)]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (sequence !== loadVersion || version !== sessionVersion) return false;
      ({ plan, items } = results[0].value); catalog = results[1].value;
      ready = true;
      $('planner-status').textContent = items.length ? `${items.length} meals planned.` : 'Your week is open. Choose a recipe or add a custom meal.';
      return true;
    } catch (error) {
      if (sequence === loadVersion && version === sessionVersion) {
        $('planner-status').textContent = `Could not load week: ${errorText(error)}`;
        $('planner-retry').hidden = false;
      }
      return false;
    } finally {
      if (sequence === loadVersion && version === sessionVersion) { loading = false; renderWeek(); }
    }
  }
  function chooseRecipe(recipe) {
    chosenRecipe = recipe;
    $('meal-servings').value = recipe.servings ?? 4;
    renderPicker();
  }
  function renderPicker() {
    const query = $('meal-search').value.trim().toLowerCase();
    $('meal-selected').textContent = chosenRecipe ? `Selected: ${chosenRecipe.title}` : 'Choose a saved recipe below.';
    $('meal-results').replaceChildren();
    const matches = catalog.filter(recipe => `${recipe.title} ${recipe.description || ''}`.toLowerCase().includes(query));
    for (const recipe of matches) {
      const pick = action('', () => chooseRecipe(recipe), 'meal-pick');
      pick.setAttribute('aria-pressed', String(chosenRecipe?.id === recipe.id));
      const url = photoUrl(recipe);
      if (url) { const img = element('img'); img.src = url; img.alt = ''; img.loading = 'lazy'; pick.append(img); }
      pick.append(element('span', '', recipe.title)); pick.disabled = busy;
      $('meal-results').append(pick);
    }
    if (!matches.length) $('meal-results').append(element('p', '', catalog.length ? 'No matching recipes.' : 'No saved recipes are visible. You can enter a custom meal.'));
  }
  function mealKind() {
    const custom = $('meal-kind').value === 'custom';
    $('meal-picker').hidden = custom; $('custom-meal-label').hidden = !custom;
    $('custom-meal').required = custom; $('meal-servings').required = !custom;
  }
  function openSlot(date, type, meal, kind = 'recipe', detailRecipe = null) {
    if (busy || copyJob || !userId) return;
    $('meal-form').reset(); fixedSlot = !detailRecipe;
    $('meal-date').value = date; $('meal-type').value = type;
    $('meal-kind').value = meal?.custom_text ? 'custom' : kind;
    $('custom-meal').value = meal?.custom_text || '';
    chosenRecipe = detailRecipe || catalog.find(recipe => recipe.id === meal?.recipe_id) || null;
    $('meal-servings').value = meal?.servings ?? chosenRecipe?.servings ?? '';
    $('meal-status').textContent = '';
    $('meal-editor-title').textContent = detailRecipe ? 'Add to meal plan' : `${label(date)} · ${type}`;
    mealKind(); renderPicker(); controls(); $('meal-editor').showModal();
  }
  async function clearSlot(meal) {
    if (busy || copyJob) return;
    const version = sessionVersion; busy = true; renderWeek();
    try {
      await request(client.from('meal_plan_items').delete().eq('meal_plan_id', meal.meal_plan_id).eq('meal_date', meal.meal_date).eq('meal_type', meal.meal_type), version);
      items = items.filter(item => key(item) !== key(meal));
      $('planner-status').textContent = 'Meal cleared.';
    } catch (error) {
      if (version === sessionVersion) $('planner-status').textContent = `Could not clear meal: ${errorText(error)}`;
    } finally { if (version === sessionVersion) { busy = false; renderWeek(); } }
  }
  async function copyPreviousWeek() {
    if (busy || !userId) return;
    const version = sessionVersion; busy = true; renderWeek();
    try {
      if (!copyJob) {
        const previous = await readWeek(shift(selectedWeek, -7), version);
        if (!previous.items.length) { $('planner-status').textContent = 'The previous week has no meals to copy.'; return; }
        const destination = await readWeek(selectedWeek, version);
        if (destination.items.length && !window.confirm('Replace every meal in this week with the previous week’s meals?')) return;
        const now = new Date().toISOString();
        copyJob = { week: selectedWeek, cleared: false, rows: previous.items.map(item => ({ id: crypto.randomUUID(), meal_date: shift(item.meal_date, 7), meal_type: item.meal_type, recipe_id: item.recipe_id, custom_text: item.custom_text, servings: item.servings, created_at: now, updated_at: now })) };
      }
      const job = copyJob;
      job.plan ||= await ensureWeek(job.week, version);
      if (!job.cleared) {
        await request(client.from('meal_plan_items').delete().eq('meal_plan_id', job.plan.id), version);
        job.cleared = true;
      }
      // Stable NEW IDs and the unique slot constraint make retry safe, including
      // an insert response lost after the server committed the entire batch.
      await request(client.from('meal_plan_items').upsert(job.rows.map(row => ({ ...row, meal_plan_id: job.plan.id })), { onConflict: 'meal_plan_id,meal_date,meal_type' }).select('id'), version);
      copyJob = null;
      if (await loadWeek()) $('planner-status').textContent = 'Copied the previous week successfully.';
    } catch (error) {
      if (version === sessionVersion) $('planner-status').textContent = `Copy failed: ${errorText(error)}${copyJob ? ' Some changes may already be saved. Keep this tab open and retry the copy to finish.' : ''}`;
    } finally { if (version === sessionVersion) { busy = false; renderWeek(); } }
  }
  $('meal-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !$('meal-form').reportValidity()) return;
    const custom = $('meal-kind').value === 'custom';
    const customText = $('custom-meal').value.trim();
    if (custom ? !customText : !chosenRecipe) { $('meal-status').textContent = custom ? 'Enter a meal name.' : 'Choose a saved recipe.'; return; }
    const date = $('meal-date').value, type = $('meal-type').value;
    const values = { recipe_id: custom ? null : chosenRecipe.id, custom_text: custom ? customText : null, servings: $('meal-servings').value === '' ? null : Number($('meal-servings').value) };
    const version = sessionVersion; busy = true; controls(); $('meal-status').textContent = 'Saving meal…';
    let saved = false;
    try {
      await writeSlot(date, type, values, version); saved = true;
      selectedWeek = monday(date);
      if (!await loadWeek()) throw new Error($('planner-status').textContent);
      check(version);
      $('meal-editor').close(); visible = true; location.hash = 'planner';
      $('planner-status').textContent = 'Meal saved successfully.';
    } catch (error) {
      if (version === sessionVersion) $('meal-status').textContent = `${saved ? 'Meal saved, but the week could not reload. ' : 'Could not save meal: '}${errorText(error)} You can retry.`;
    } finally { if (version === sessionVersion) { busy = false; controls(); renderWeek(); } }
  });
  function changeWeek(week) { if (busy || copyJob) return; selectedWeek = week; loadWeek(); }
  $('previous-week').addEventListener('click', () => changeWeek(shift(selectedWeek, -7)));
  $('next-week').addEventListener('click', () => changeWeek(shift(selectedWeek, 7)));
  $('current-week').addEventListener('click', () => changeWeek(monday()));
  $('planner-retry').addEventListener('click', () => loadWeek());
  $('copy-week').addEventListener('click', copyPreviousWeek);
  $('meal-search').addEventListener('input', renderPicker);
  $('meal-kind').addEventListener('change', mealKind);
  for (const id of ['meal-close', 'meal-cancel']) $(id).addEventListener('click', () => { if (!busy) $('meal-editor').close(); });
  $('meal-editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  window.MealPlanner = {
    getWeek() { return selectedWeek; },
    selectWeek(week) {
      if (busy || copyJob) return false;
      selectedWeek = monday(week); ready = false;
      return true;
    },
    initialize(value) { client = value; },
    setSession(value) {
      if (value === userId) return;
      userId = value; sessionVersion++; loadVersion++;
      plan = null; items = []; catalog = []; chosenRecipe = null; copyJob = null;
      selectedWeek = monday(); busy = false; loading = false; ready = false; visible = false;
      $('meal-editor').close(); $('meal-form').reset(); $('meal-results').replaceChildren();
      $('planner').hidden = true; $('week-grid').replaceChildren();
    },
    show(value) {
      $('planner').hidden = !value;
      const opening = value && !visible; visible = value;
      if (opening && userId && !busy) loadWeek();
    },
    addRecipe(recipe) {
      if (!userId || busy || copyJob) { $('status').textContent = 'Finish the pending planner action before adding a meal.'; return; }
      if (!catalog.some(item => item.id === recipe.id)) catalog.push(recipe);
      openSlot(stamp(new Date()), 'dinner', null, 'recipe', recipe);
    }
  };
})();
