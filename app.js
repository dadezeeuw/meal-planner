(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('recipe-form');
  const field = name => form.elements.namedItem(name);
  const parse = text => window.Ingredients.parseIngredients(text);
  const recipes = [
    { id: 1, title: 'Lemon garlic pasta', description: 'A bright, simple dinner for busy evenings.', servings: 4, prep_minutes: 10, cook_minutes: 15, tags: ['Dinner', 'Quick', 'Vegetarian'], favorite: true, last_made: '2026-09-08', ingredients: parse('400 g spaghetti\n2 tbsp olive oil\n3 cloves garlic, minced\n1 lemon, zest and juice\n1/2 cup parmesan, grated'), instructions: 'Cook the spaghetti in salted water until al dente. Reserve a cup of pasta water before draining.\n\nWarm the olive oil and garlic in a skillet. Add the pasta, lemon zest and juice, and a splash of pasta water.\n\nToss with parmesan, adding more pasta water as needed. Season to taste and serve.' },
    { id: 2, title: 'Sheet-pan chicken and potatoes', description: 'Golden chicken, tender potatoes, and very little washing up.', servings: 4, prep_minutes: 15, cook_minutes: 40, tags: ['Dinner', 'Family favorites'], favorite: true, last_made: '2026-09-05', ingredients: parse('1.5 lb chicken thighs\n1 lb potatoes, cut into small chunks\n2 tbsp olive oil\n1 tsp dried rosemary\n1/2 tsp salt'), instructions: 'Heat the oven to 425°F (220°C).\n\nToss the potatoes and chicken with oil, rosemary, and salt on a sheet pan. Spread in a single layer.\n\nRoast for about 40 minutes, turning the potatoes halfway through, until tender and the chicken reaches 165°F (74°C) in the thickest part.' },
    { id: 3, title: 'Chickpea lunch bowls', description: 'Crunchy vegetables and chickpeas with a lemony dressing.', servings: 2, prep_minutes: 15, cook_minutes: 0, tags: ['Lunch', 'Quick', 'Vegetarian'], favorite: false, last_made: null, ingredients: parse('1 can chickpeas, drained and rinsed\n1 cucumber, diced\n2 tomatoes, diced\n2 tbsp olive oil\n1 lemon, juiced'), instructions: 'Combine the chickpeas, cucumber, and tomatoes in a bowl.\n\nWhisk the olive oil with lemon juice and salt to taste. Toss with the vegetables and divide between two bowls.' },
    { id: 4, title: 'Weekend pancakes', description: 'A slow-morning favorite, ready for your favorite toppings.', servings: 4, prep_minutes: 10, cook_minutes: 20, tags: ['Breakfast', 'Family favorites', 'Vegetarian'], favorite: false, last_made: '2026-09-06', ingredients: parse('1.5 cups flour\n2 tsp baking powder\n1 tbsp sugar\n1.25 cups milk\n1 egg\n2 tbsp butter, melted'), instructions: 'Mix the flour, baking powder, and sugar. In another bowl, whisk the milk, egg, and melted butter.\n\nStir the wet ingredients into the dry ingredients just until combined.\n\nSpoon batter onto a lightly greased skillet over medium heat. Cook until bubbles form, then flip and cook until golden and cooked through.' }
  ];
  let savingRecipe = false;
  let saveDraft = null;
  let editingRecipe = null;
  let photoRemoved = false;
  const busyRecipes = new Set();
  let photoBlob = null;
  let selectedTag = '';
  let favoritesOnly = false;
  let photo = '';
  let photoVersion = 0;
  let reviewedText = null;
  recipes.forEach(recipe => { recipe.data_source = 'demo'; recipe.added_order = recipe.id; });
  const demoRecipes = JSON.stringify(recipes);
  let client;
  let activeUserId;
  let readController;
  let authGeneration = 0;
  const recoveryParams = new URLSearchParams(location.hash.slice(1));
  let recovering = recoveryParams.get('type') === 'recovery' || location.hash === '#password-recovery';
  let recoverySession = null;
  let recoverySaving = false;

  function showRecovery(session) {
    recoverySession = session;
    ++authGeneration;
    readController?.abort();
    $('editor').close(); $('detail').close();
    $('login').hidden = false;
    $('login-form').hidden = true;
    $('recovery-form').hidden = false;
    $('login-title').textContent = 'Set new password';
    $('login-description').textContent = 'Choose a new password for your household account.';
    ['library', 'upcoming', 'main-nav', 'logout', 'status'].forEach(id => { $(id).hidden = true; });
    $('recovery-submit').disabled = !session || recoverySaving;
    if (!session) $('recovery-status').textContent = 'No valid recovery session. Open a fresh password recovery link.';
    // Keep recovery mode on reload without retaining tokens in the URL.
    if (session) history.replaceState(null, '', `${location.pathname}${location.search}#password-recovery`);
  }

  function applySession(session) {
    if (recovering) { showRecovery(session); return; }
    const userId = session?.user?.id || null;
    if (userId === activeUserId) return;
    activeUserId = userId;
    const generation = ++authGeneration;
    readController?.abort();
    $('editor').close(); $('detail').close();
    $('detail-content').replaceChildren();
    form.reset(); photo = ''; photoVersion++;
    saveDraft = null; photoBlob = null;
    editingRecipe = null; photoRemoved = false;
    $('remove-photo').hidden = true;
    $('photo-preview').removeAttribute('src'); $('photo-preview').hidden = true;
    $('ingredient-review').replaceChildren(); reviewedText = null;
    recipes.splice(0, recipes.length, ...JSON.parse(demoRecipes));
    resetFilters();
    $('login').hidden = Boolean(userId);
    $('main-nav').hidden = !userId;
    $('logout').hidden = !userId;
    $('status').hidden = !userId;
    $('login-password').value = '';
    $('login-status').textContent = userId ? '' : 'Enter your household account credentials.';
    if (userId) {
      location.hash = 'recipes';
      // Keep SDK requests outside the synchronous auth event callback.
      setTimeout(() => { if (generation === authGeneration) loadRecipes(); }, 0);
    } else {
      $('status').textContent = '';
    }
    navigate();
  }

  async function initializeAuth() {
    try {
      const config = window.MEAL_CONFIG;
      if (!config?.SUPABASE_URL || !config?.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase configuration is missing.');
      if (!window.supabase?.createClient) throw new Error('The login service could not load. Check your connection and reload.');
      const projectUrl = new URL(config.SUPABASE_URL);
      projectUrl.pathname = projectUrl.pathname.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
      projectUrl.search = ''; projectUrl.hash = '';
      client = window.supabase.createClient(projectUrl.href, config.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') recovering = true;
        applySession(session);
      });
      const generation = authGeneration;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (generation === authGeneration) applySession(data.session);
      $('login-submit').disabled = false;
    } catch (error) {
      $(recovering ? 'recovery-status' : 'login-status').textContent = `${error.message} Reload to try again.`;
    }
  }

  $('recovery-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !recoverySession || $('recovery-submit').disabled || !$('recovery-form').reportValidity()) return;
    const password = $('new-password').value;
    if (password !== $('confirm-password').value) {
      $('recovery-status').textContent = 'Passwords do not match.';
      $('confirm-password').focus();
      return;
    }
    recoverySaving = true;
    $('recovery-submit').disabled = true;
    $('recovery-status').textContent = 'Saving new password…';
    const session = recoverySession;
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      if (!recoverySession || recoverySession.user.id !== session.user.id) return;
      const currentSession = recoverySession;
      recovering = false; recoverySession = null;
      $('recovery-form').reset(); $('recovery-form').hidden = true;
      $('login-form').hidden = false;
      $('login-title').textContent = 'Household login';
      $('login-description').textContent = 'Sign in with your shared household email and password.';
      activeUserId = undefined;
      applySession(currentSession);
    } catch (error) {
      $('recovery-status').textContent = error.message;
    } finally {
      recoverySaving = false;
      $('recovery-submit').disabled = !recoverySession;
    }
  });

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || $('login-submit').disabled || !$('login-form').reportValidity()) return;
    $('login-submit').disabled = true;
    $('login-status').textContent = 'Signing in…';
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $('login-email').value.trim(), password: $('login-password').value
      });
      if (error) throw error;
      applySession(data.session);
    } catch (error) {
      console.error('Supabase signInWithPassword failed:', error);
      $('login-status').textContent = `Could not log in: ${error.message}`;
    } finally {
      $('login-password').value = '';
      $('login-submit').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      applySession(null);
      $('login-email').focus();
    } catch (error) {
      $('status').textContent = `Could not log out: ${error.message} Please try again.`;
    } finally {
      $('logout').disabled = false;
    }
  });

  async function loadRecipes({ savedId } = {}) {
    if (!activeUserId) return;
    const generation = authGeneration;
    $('status').textContent = 'Loading recipes from Supabase…';
    const controller = new AbortController();
    readController?.abort();
    readController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // The shared SDK client supplies and refreshes the authenticated token.
      // Library reads remain SELECT-only.
      async function readTable(table, order) {
        const rows = [];
        for (;;) {
          let query = client.from(table).select('*');
          order.split(',').forEach(sort => { query = query.order(sort.split('.')[0], { ascending: true }); });
          const { data: page, error } = await query.range(rows.length, rows.length + 999).abortSignal(controller.signal);
          if (generation !== authGeneration) return [];
          if (error) throw new Error(`Supabase ${table} read failed: ${error.message}`);
          if (!Array.isArray(page)) throw new Error(`Supabase ${table} returned an unexpected response.`);
          if (!page.length) return rows;
          rows.push(...page);
        }
      }
      const rows = await readTable('recipes', 'id.asc');
      if (generation !== authGeneration) return;
      if (!rows.length) {
        if (savedId) throw new Error('The recipe was saved, but is not visible to this account. Check household read access.');
        $('status').textContent = 'Demo data · No recipes are visible to this household account. The table may be empty or access may be restricted by RLS.';
        return;
      }
      const [recipeTags, tags, ingredients] = await Promise.all([
        readTable('recipe_tags', 'recipe_id.asc,tag_id.asc'),
        readTable('tags', 'id.asc'),
        readTable('recipe_ingredients', 'recipe_id.asc,sort_order.asc,id.asc')
      ]);
      if (generation !== authGeneration) return;
      const tagNames = new Map(tags.map(tag => [tag.id, tag.name]));
      const loaded = rows.map(row => ({
        ...row,
        data_source: 'supabase',
        title: String(row.title || 'Untitled recipe'),
        description: String(row.description || ''),
        servings: Number(row.servings ?? 4),
        prep_minutes: Number(row.prep_minutes || 0),
        cook_minutes: Number(row.cook_minutes || 0),
        favorite: Boolean(row.favorite ?? row.is_favorite),
        last_made: row.last_made ?? row.last_made_at ?? null,
        photo: row.image_path ? client.storage.from('recipe-images').getPublicUrl(row.image_path).data.publicUrl : safeUrl(row.photo_url || row.image_url || row.photo),
        instructions: String(row.instructions || ''),
        tags: [...new Set(recipeTags.filter(link => link.recipe_id === row.id).map(link => tagNames.get(link.tag_id)).filter(Boolean))],
        ingredients: ingredients.filter(item => item.recipe_id === row.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(item => ({ ...item, quantity_text: item.quantity_text ?? String(item.quantity ?? ''), ingredient: item.ingredient ?? item.name ?? '', unit: item.unit ?? '', preparation: item.preparation ?? '' }))
      }));
      if (savedId && !loaded.some(recipe => recipe.id === savedId)) throw new Error('The recipe was saved, but is not visible to this account. Check household read access.');
      recipes.splice(0, recipes.length, ...loaded);
      if (savedId) recipes.find(recipe => recipe.id === savedId).added_order = Date.now();
      selectedTag = '';
      render();
      $('status').textContent = `Loaded ${loaded.length} recipes from Supabase.`;
    } catch (error) {
      if (generation !== authGeneration) return;
      if (savedId) throw error;
      $('status').textContent = `${error.name === 'AbortError' ? 'Supabase reads timed out.' : error.message} Showing the currently loaded collection; demo recipes are labeled.`;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Recipe content is inserted as text, never interpreted as HTML.
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(text, className, action) {
    const element = node('button', className, text);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }
  const duration = recipe => recipe.prep_minutes + recipe.cook_minutes;
  function tagsFor(recipe) {
    const tags = node('div', 'card-tags');
    if (recipe.data_source === 'demo') tags.append(node('span', 'tag', 'Demo data'));
    recipe.tags.forEach(tag => tags.append(node('span', 'tag', tag)));
    return tags;
  }
  function render() {
    const query = $('search').value.trim().toLowerCase();
    const visible = recipes.filter(recipe =>
      (!favoritesOnly || recipe.favorite) &&
      (!selectedTag || recipe.tags.includes(selectedTag)) &&
      [recipe.title, recipe.description, ...recipe.tags, ...recipe.ingredients.map(item => item.ingredient)].join(' ').toLowerCase().includes(query)
    );
    const sorts = {
      newest: (a, b) => (b.added_order || 0) - (a.added_order || 0) || (b.created_at || '').localeCompare(a.created_at || ''),
      title: (a, b) => a.title.localeCompare(b.title),
      quickest: (a, b) => duration(a) - duration(b),
      last: (a, b) => (b.last_made || '').localeCompare(a.last_made || '')
    };
    visible.sort(sorts[$('sort').value] || sorts.newest);
    $('tags').replaceChildren();
    ['', ...new Set(recipes.flatMap(recipe => recipe.tags).sort((a, b) => a.localeCompare(b)))].forEach(tag => {
      const chip = button(tag || 'All recipes', 'chip', () => { selectedTag = tag; render(); });
      chip.setAttribute('aria-pressed', String(selectedTag === tag));
      $('tags').append(chip);
    });
    $('favorites').setAttribute('aria-pressed', String(favoritesOnly));
    $('favorites').textContent = `${favoritesOnly ? '♥' : '♡'} Favorites`;
    $('recipe-grid').replaceChildren();
    visible.forEach(recipe => {
      const card = node('article', 'recipe-card');
      const open = button('', 'card-open', () => showDetail(recipe));
      open.setAttribute('aria-label', `View ${recipe.title}`);
      const picture = node('div', 'photo-wrap');
      if (recipe.photo) {
        const img = node('img'); img.src = recipe.photo; img.alt = recipe.title; picture.append(img);
      } else {
        const fallback = node('div', 'photo-fallback');
        fallback.append(node('span', '', '♧'), node('div', '', 'From our kitchen'));
        picture.append(fallback);
      }
      const copy = node('div', 'card-copy');
      const meta = node('div', 'card-meta');
      meta.append(node('span', '', `${duration(recipe)} min · ${recipe.servings} servings`), node('span', '', recipe.last_made ? `Last made ${recipe.last_made}` : 'Not made yet'));
      copy.append(node('h3', '', recipe.title), tagsFor(recipe), meta);
      open.append(picture, copy);
      const favorite = button(recipe.favorite ? '♥' : '♡', 'favorite-mark', () => toggleFavorite(recipe));
      favorite.disabled = recipe.data_source !== 'supabase' || busyRecipes.has(recipe.id);
      favorite.setAttribute('aria-label', `Favorite ${recipe.title}`);
      favorite.setAttribute('aria-pressed', String(recipe.favorite));
      card.append(open, favorite);
      $('recipe-grid').append(card);
    });
    $('count').textContent = `${visible.length} of ${recipes.length} recipes`;
    $('empty').hidden = visible.length > 0;
    $('empty-message').textContent = 'No recipes match your search or filters. Try another search or add a recipe.';
  }
  function showDetail(recipe) {
    const content = $('detail-content');
    content.replaceChildren();
    const heading = node('div', 'dialog-heading');
    const title = node('h2', '', recipe.title); title.id = 'detail-title';
    const close = button('×', 'icon-button', () => $('detail').close());
    close.setAttribute('aria-label', 'Close recipe details');
    heading.append(title, close);
    content.append(heading, node('p', '', recipe.description), tagsFor(recipe));
    if (recipe.photo) {
      const img = node('img', 'detail-photo'); img.src = recipe.photo; img.alt = recipe.title; content.append(img);
    }
    const stats = node('div', 'detail-stats');
    [[recipe.servings, 'Servings'], [recipe.prep_minutes, 'Prep minutes'], [recipe.cook_minutes, 'Cook minutes']].forEach(([value, label]) => {
      const stat = node('div'); stat.append(node('strong', '', value), document.createTextNode(label)); stats.append(stat);
    });
    const body = node('div', 'detail-body');
    const ingredients = node('section');
    const list = node('ul');
    recipe.ingredients.forEach(item => list.append(node('li', '', [item.quantity_text, item.unit, item.ingredient, item.preparation ? `(${item.preparation})` : ''].filter(Boolean).join(' '))));
    ingredients.append(node('h3', '', 'Ingredients'), list);
    const instructions = node('section');
    instructions.append(node('h3', '', 'Instructions'), node('p', 'instructions', recipe.instructions || 'No instructions added.'));
    body.append(ingredients, instructions);
    const favorite = button(recipe.favorite ? '♥ Favorited' : '♡ Add to favorites', 'secondary', () => toggleFavorite(recipe));
    favorite.disabled = recipe.data_source !== 'supabase' || busyRecipes.has(recipe.id) || recipe.deleted;
    favorite.setAttribute('aria-pressed', String(recipe.favorite));
    content.append(stats, favorite, body);
    if (recipe.data_source === 'supabase') {
      const actions = node('div', 'form-actions');
      const edit = button('Edit recipe', 'secondary', () => { $('detail').close(); openEditor(recipe); });
      const remove = button(recipe.deleted ? 'Retry image cleanup' : 'Delete recipe', 'secondary', () => deleteRecipe(recipe));
      edit.disabled = busyRecipes.has(recipe.id) || recipe.deleted;
      remove.disabled = busyRecipes.has(recipe.id);
      actions.append(edit, remove);
      const message = node('p'); message.id = 'detail-status'; message.setAttribute('role', 'status');
      content.append(actions, message);
    }
    const links = node('div', 'detail-links');
    [['source_url', 'Original recipe'], ['video_url', 'Watch video']].forEach(([key, label]) => {
      const url = safeUrl(recipe[key]);
      if (!url) return;
      const link = node('a', '', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
    });
    content.append(links);
    if (!$('detail').open) $('detail').showModal();
  }
  async function toggleFavorite(recipe) {
    if (savingRecipe || saveDraft) {
      $('status').textContent = 'Finish the pending recipe save before changing favorites.';
      if ($('detail-status')) $('detail-status').textContent = $('status').textContent;
      return;
    }
    if (recipe.data_source !== 'supabase' || busyRecipes.has(recipe.id) || !activeUserId || recovering) return;
    const generation = authGeneration;
    busyRecipes.add(recipe.id); render();
    try {
      const { data, error } = await client.from('recipes').update({ favorite: !recipe.favorite }).eq('id', recipe.id).select('favorite').single();
      if (error) throw error;
      if (generation !== authGeneration) return;
      recipe.favorite = data.favorite;
      $('status').textContent = 'Favorite updated.';
    } catch (error) {
      if (generation !== authGeneration) return;
      $('status').textContent = `Favorite update failed: ${error.message}`;
      if ($('detail-status')) $('detail-status').textContent = $('status').textContent;
    } finally {
      busyRecipes.delete(recipe.id);
      if (generation === authGeneration) {
        render();
        if ($('detail').open && $('detail-title').textContent === recipe.title) {
          const message = $('detail-status')?.textContent;
          showDetail(recipe);
          if (message) $('detail-status').textContent = message;
        }
      }
    }
  }
  async function deleteRecipe(recipe) {
    if (busyRecipes.has(recipe.id) || savingRecipe || saveDraft || !activeUserId || recovering) {
      if ($('detail-status')) $('detail-status').textContent = 'Finish the pending save before deleting a recipe.';
      return;
    }
    if (!recipe.deleted && !window.confirm(`Delete “${recipe.title}”? This permanently deletes the recipe and its ingredients and tag links.`)) return;
    const generation = authGeneration;
    busyRecipes.add(recipe.id); showDetail(recipe);
    try {
      if (!recipe.deleted) {
        const { data, error } = await client.from('recipes').delete().eq('id', recipe.id).select('id,image_path');
        if (error) throw error;
        if (!data.length) throw new Error('Recipe was not deleted. It may no longer exist or access may be restricted.');
        recipe.image_path = data[0].image_path;
        recipe.deleted = true;
      }
      if (generation !== authGeneration) return;
      const index = recipes.findIndex(item => item.id === recipe.id);
      if (index !== -1) recipes.splice(index, 1);
      selectedTag = ''; render();
      if (recipe.image_path) {
        const { error } = await client.storage.from('recipe-images').remove([recipe.image_path]);
        if (error) throw error;
      }
      if (generation !== authGeneration) return;
      $('detail').close();
      $('status').textContent = `Deleted “${recipe.title}” successfully.`;
    } catch (error) {
      if (generation !== authGeneration) return;
      busyRecipes.delete(recipe.id); showDetail(recipe);
      const message = `${recipe.deleted ? 'Recipe deleted, but image cleanup failed' : 'Delete failed'}: ${error.message}`;
      $('detail-status').textContent = message; $('status').textContent = message;
    } finally { busyRecipes.delete(recipe.id); }
  }
  function safeUrl(value) {
    if (!value) return '';
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function openEditor(recipe = null) {
    if (savingRecipe) return;
    if (saveDraft) { $('editor').showModal(); return; }
    Array.from(form.elements).forEach(control => { control.disabled = false; });
    photoBlob = null;
    $('remove-photo').hidden = true;
    form.reset(); photo = ''; photoVersion++; reviewedText = null;
    editingRecipe = recipe;
    photoRemoved = false;
    $('editor-title').textContent = recipe ? 'Edit recipe' : 'Add a recipe';
    $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
    $('ingredient-review').replaceChildren(); $('form-status').textContent = '';
    $('preview-submit').textContent = 'Save recipe';
    $('preview-submit').disabled = false;
    if (recipe) {
      for (const key of ['title', 'description', 'servings', 'prep_minutes', 'cook_minutes', 'instructions', 'source_url', 'video_url']) field(key).value = recipe[key] ?? '';
      field('favorite').checked = recipe.favorite;
      field('tags').value = recipe.tags.join(', ');
      $('ingredient-paste').value = recipe.ingredients.map(item => [item.quantity_text, item.unit, item.ingredient + (item.preparation ? `, ${item.preparation}` : '')].filter(Boolean).join(' ')).join('\n');
      reviewIngredients(recipe.ingredients);
      if (recipe.photo) {
        photo = recipe.photo;
        $('photo-preview').src = photo; $('photo-preview').hidden = false;
        $('remove-photo').hidden = false;
      }
    }
    $('editor').showModal();
  }
  function reviewIngredients(items) {
    reviewedText = $('ingredient-paste').value;
    $('ingredient-review').replaceChildren();
    (Array.isArray(items) ? items : parse(reviewedText)).forEach(item => {
      const row = node('div', 'ingredient-row');
      row.dataset.grocerySection = item.grocery_section || 'Other';
      [['quantity_text', 'Quantity'], ['unit', 'Unit'], ['ingredient', 'Ingredient'], ['preparation', 'Preparation']].forEach(([key, label]) => {
        const wrapper = node('label', '', label);
        const input = node('input'); input.value = item[key] ?? ''; input.dataset.key = key;
        wrapper.append(input); row.append(wrapper);
      });
      $('ingredient-review').append(row);
    });
  }
  $('remove-photo').addEventListener('click', () => {
    if (savingRecipe) return;
    // Invalidate decoding/compression that may still be running.
    photoVersion++;
    $('photo').value = '';
    photo = ''; photoBlob = null;
    photoRemoved = true;
    $('photo-preview').removeAttribute('src'); $('photo-preview').hidden = true;
    $('remove-photo').hidden = true;
    if (saveDraft) {
      if (saveDraft.imagePath) saveDraft.cleanupPaths.add(saveDraft.imagePath);
      // Keep all recipe/ingredient/tag progress. Clear even an image-path
      // update whose response was lost, using the existing recipe ID.
      saveDraft.clearImage = saveDraft.clearImage || Boolean(saveDraft.imagePath || saveDraft.oldImagePath);
      saveDraft.blob = null;
      saveDraft.imagePath = null;
      saveDraft.uploaded = false;
      saveDraft.imageSaved = false;
      saveDraft.recipe.image_path = null;
    }
    $('preview-submit').disabled = false;
    $('form-status').textContent = saveDraft ? 'Photo removed. Retry save to finish the existing recipe without an image.' : 'Photo removed. You can save without an image.';
  });
  $('photo').addEventListener('change', async () => {
    const version = ++photoVersion;
    photo = ''; photoBlob = null; $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
    $('form-status').textContent = ''; $('preview-submit').disabled = false;
    const file = $('photo').files[0];
    $('remove-photo').hidden = !file;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      $('form-status').textContent = 'Choose a JPG, PNG, or WebP photo no larger than 20 MB.'; $('photo').value = ''; $('remove-photo').hidden = true; return;
    }
    $('preview-submit').disabled = true;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (version !== photoVersion) return;
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
      if (version !== photoVersion) return;
      if (!compressed || !['image/jpeg', 'image/png', 'image/webp'].includes(compressed.type)) throw new Error('Photo compression failed.');
      photoBlob = compressed;
      photoRemoved = false;
      photo = canvas.toDataURL('image/webp', 0.85);
      $('photo-preview').src = photo; $('photo-preview').hidden = false;
    } catch {
      if (version === photoVersion) { photo = ''; photoBlob = null; $('form-status').textContent = 'This photo could not be opened. Choose another image.'; $('photo').value = ''; $('remove-photo').hidden = true; }
    } finally {
      URL.revokeObjectURL(url);
      if (version === photoVersion) $('preview-submit').disabled = false;
    }
  });
  function normalizeTags(text) {
    const tags = new Map();
    text.split(',').forEach(value => {
      const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!name) return;
      const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
      if (!slug) throw new Error(`Tag “${name}” needs at least one letter or number.`);
      tags.set(slug, { name, slug });
    });
    return [...tags.values()];
  }

  // Stable IDs let retries recognize a previous insert whose response was lost.
  async function insertOnce(table, row, keys = ['id']) {
    const { error } = await client.from(table).insert(row);
    if (!error) return;
    if (error.code === '23505') {
      let query = client.from(table).select(keys.join(','));
      keys.forEach(key => { query = query.eq(key, row[key]); });
      const { data, error: readError } = await query.maybeSingle();
      if (!readError && data) return;
    }
    throw error;
  }

  async function saveRecipe(draft) {
    const checkAccount = () => {
      if (draft.userId !== activeUserId || draft.generation !== authGeneration || recovering) throw new Error('Your session changed. Sign in again before saving.');
    };
    checkAccount();
    if (!draft.recipeSaved) {
      draft.stage = 'Recipe save';
      if (draft.editing) {
        const { id, image_path, ...changes } = draft.recipe;
        const { error } = await client.from('recipes').update(changes).eq('id', id).select('id').single();
        if (error) throw error;
      } else await insertOnce('recipes', draft.recipe);
      draft.recipeSaved = true;
    }
    if (draft.editing && !draft.ingredientsCleared) {
      checkAccount(); draft.stage = 'Replace ingredients';
      const { error } = await client.from('recipe_ingredients').delete().eq('recipe_id', draft.recipe.id);
      if (error) throw error;
      draft.ingredientsCleared = true;
    }
    if (draft.editing && !draft.tagsCleared) {
      checkAccount(); draft.stage = 'Replace tag links';
      const { error } = await client.from('recipe_tags').delete().eq('recipe_id', draft.recipe.id);
      if (error) throw error;
      draft.tagsCleared = true;
    }
    for (const ingredient of draft.ingredients) {
      checkAccount(); draft.stage = 'Ingredient save';
      if (draft.completed.has(ingredient.id)) continue;
      await insertOnce('recipe_ingredients', ingredient);
      draft.completed.add(ingredient.id);
    }
    for (const tag of draft.tags) {
      checkAccount(); draft.stage = 'Tag save';
      if (tag.linked) continue;
      if (!tag.id) {
        const lookup = () => client.from('tags').select('id').eq('slug', tag.slug).maybeSingle();
        let { data, error } = await lookup();
        if (error) throw error;
        if (!data) {
          const result = await client.from('tags').insert({ name: tag.name, slug: tag.slug }).select('id').single();
          if (result.error?.code === '23505') {
            ({ data, error } = await lookup());
            if (error || !data) throw error || result.error;
          } else {
            if (result.error) throw result.error;
            data = result.data;
          }
        }
        tag.id = data.id;
      }
      checkAccount(); draft.stage = 'Recipe tag save';
      await insertOnce('recipe_tags', { recipe_id: draft.recipe.id, tag_id: tag.id }, ['recipe_id', 'tag_id']);
      tag.linked = true;
    }
    checkAccount();
    if (draft.blob && !draft.uploaded) {
      draft.stage = 'Photo upload';
      // A unique path belongs only to this draft. Retrying replaces that same
      // object if an earlier upload succeeded but its response was lost.
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[draft.blob.type];
      if (!extension) throw new Error('Unsupported compressed photo format. Remove the photo and choose a JPG, PNG, or WebP.');
      draft.imagePath ||= `${draft.userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from('recipe-images').upload(draft.imagePath, draft.blob, { contentType: draft.blob.type, upsert: true });
      if (error) throw error;
      draft.uploaded = true;
    }
    checkAccount();
    if (draft.clearImage || (draft.uploaded && !draft.imageSaved)) {
      draft.stage = 'Photo path save';
      const { error } = await client.from('recipes').update({ image_path: draft.clearImage ? null : draft.imagePath }).eq('id', draft.recipe.id).select('id').single();
      if (error) throw error;
      draft.imageSaved = true;
      draft.clearImage = false;
      if (draft.oldImagePath && draft.oldImagePath !== draft.imagePath) draft.cleanupPaths.add(draft.oldImagePath);
    }
    checkAccount();
    if (draft.imageSaved && draft.cleanupPaths.size) {
      draft.stage = 'Old photo cleanup';
      const { error } = await client.storage.from('recipe-images').remove([...draft.cleanupPaths]);
      if (error) throw error;
      draft.cleanupPaths.clear();
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (savingRecipe || $('preview-submit').disabled) return;
    if (!activeUserId || recovering) { $('form-status').textContent = 'Log in before saving a recipe.'; return; }
    if (!saveDraft && !form.reportValidity()) return;
    if (!saveDraft) {
      const title = field('title').value.trim();
      if (!title) { $('form-status').textContent = 'Enter a recipe title.'; field('title').focus(); return; }
      for (const key of ['source_url', 'video_url']) {
        if (field(key).value && !safeUrl(field(key).value)) { $('form-status').textContent = 'Recipe and video links must use http or https.'; field(key).focus(); return; }
      }
      if (reviewedText !== $('ingredient-paste').value) reviewIngredients();
      const ingredients = Array.from($('ingredient-review').children, (row, index) => {
        const item = { sort_order: index, grocery_section: row.dataset.grocerySection || 'Other' };
        row.querySelectorAll('input').forEach(input => { item[input.dataset.key] = input.value.trim(); });
        item.quantity = window.Ingredients.quantityValue(item.quantity_text);
        return item;
      });
      if (ingredients.some(item => !item.ingredient || (item.quantity_text && item.quantity === null))) {
        $('form-status').textContent = 'Give each ingredient a name and use a number or fraction for its quantity, or leave the quantity blank.'; return;
      }
      let tags;
      try { tags = normalizeTags(field('tags').value); } catch (error) { $('form-status').textContent = error.message; return; }
      const id = editingRecipe ? editingRecipe.id : crypto.randomUUID();
      const recipe = { id, title, description: field('description').value.trim(), servings: Number(field('servings').value), prep_minutes: field('prep_minutes').value === '' ? null : Number(field('prep_minutes').value), cook_minutes: field('cook_minutes').value === '' ? null : Number(field('cook_minutes').value), favorite: field('favorite').checked, source_url: safeUrl(field('source_url').value) || null, video_url: safeUrl(field('video_url').value) || null, instructions: field('instructions').value.trim(), image_path: null };
      saveDraft = { userId: activeUserId, generation: authGeneration, recipe, tags, ingredients: ingredients.map(item => ({ ...item, id: crypto.randomUUID(), recipe_id: id })), blob: photoBlob, completed: new Set(), editing: Boolean(editingRecipe), oldImagePath: editingRecipe?.image_path || null, clearImage: photoRemoved, cleanupPaths: new Set() };
    }
    const draft = saveDraft;
    savingRecipe = true;
    Array.from(form.elements).forEach(control => { control.disabled = true; });
    $('form-status').textContent = 'Saving recipe…';
    try {
      await saveRecipe(draft);
      draft.stage = 'Library reload';
      selectedTag = ''; favoritesOnly = false; $('search').value = ''; $('sort').value = 'newest';
      await loadRecipes({ savedId: draft.recipe.id });
      if (draft.userId !== activeUserId || draft.generation !== authGeneration || recovering) return;
      saveDraft = null;
      $('editor').close();
      $('status').textContent = `Saved “${draft.recipe.title}” successfully.`;
    } catch (error) {
      const message = `${draft.stage || 'Save'} failed: ${error.message}${error.code ? ` (code ${error.code})` : ''}. Some changes may already be saved to recipe ${draft.recipe.id}. Retry to finish without duplicating completed rows. Keep this tab open until saving finishes.`;
      $('form-status').textContent = message;
      if (!$('editor').open) $('status').textContent = message;
    } finally {
      savingRecipe = false;
      Array.from(form.elements).forEach(control => { control.disabled = Boolean(saveDraft) && control.id !== 'remove-photo' && !control.hasAttribute('data-close') && control.type !== 'submit'; });
      $('preview-submit').textContent = saveDraft ? 'Retry save' : 'Save recipe';
    }
  });
  function resetFilters() { selectedTag = ''; favoritesOnly = false; $('search').value = ''; render(); }
  function navigate() {
    if (recovering) { $('library').hidden = true; $('upcoming').hidden = true; return; }
    if (!activeUserId) { $('library').hidden = true; $('upcoming').hidden = true; return; }
    const page = location.hash.slice(1);
    const upcoming = { planner: ['Weekly Planner', 'Meal planning is coming soon. Explore the recipe library in the meantime.'], groceries: ['Grocery List', 'Grocery lists are coming soon. Your demo recipes are ready to explore.'], history: ['History', 'Cooking history is coming soon. Demo last-made dates appear on recipe cards.'] };
    const destination = upcoming[page];
    $('library').hidden = Boolean(destination); $('upcoming').hidden = !destination;
    if (destination) { $('upcoming-title').textContent = destination[0]; $('upcoming-description').textContent = destination[1]; }
    document.querySelectorAll('nav a').forEach(link => {
      if (link.hash === `#${destination ? page : 'recipes'}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  ['add-recipe', 'empty-add'].forEach(id => $(id).addEventListener('click', () => openEditor()));
  document.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', () => $(control.dataset.close).close()));
  $('editor').addEventListener('cancel', event => { if (savingRecipe) event.preventDefault(); });
  $('editor').addEventListener('close', () => { photoVersion++; });
  $('parse').addEventListener('click', reviewIngredients);
  $('search').addEventListener('input', render);
  $('sort').addEventListener('change', render);
  $('favorites').addEventListener('click', () => { favoritesOnly = !favoritesOnly; render(); });
  $('reset-filters').addEventListener('click', resetFilters);
  window.addEventListener('hashchange', navigate);
  $('status').textContent = 'Demo recipes are labeled until your collection loads.';
  render(); navigate();
  if (recovering) {
    showRecovery(null);
    $('recovery-status').textContent = 'Checking your recovery session…';
  }
  initializeAuth();
})();
