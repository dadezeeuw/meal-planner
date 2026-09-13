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
  let nextId = recipes.length + 1;
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

  function applySession(session) {
    const userId = session?.user?.id || null;
    if (userId === activeUserId) return;
    activeUserId = userId;
    const generation = ++authGeneration;
    readController?.abort();
    $('editor').close(); $('detail').close();
    $('detail-content').replaceChildren();
    form.reset(); photo = ''; photoVersion++;
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
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      client.auth.onAuthStateChange((_event, session) => applySession(session));
      const generation = authGeneration;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (generation === authGeneration) applySession(data.session);
      $('login-submit').disabled = false;
    } catch (error) {
      $('login-status').textContent = `${error.message} Reload to try again.`;
    }
  }

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

  async function loadRecipes() {
    if (!activeUserId) return;
    const generation = authGeneration;
    $('status').textContent = 'Loading Supabase recipes. Showing demo/preview data until reads finish.';
    const controller = new AbortController();
    readController?.abort();
    readController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // The shared SDK client supplies and refreshes the authenticated token.
      // Database operations remain SELECT-only.
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
        $('status').textContent = 'Demo/preview data · No recipes are visible to this household account. The table may be empty or access may be restricted by RLS. Changes stay in this tab only.';
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
        photo: safeUrl(row.photo_url || row.image_url || row.photo),
        instructions: String(row.instructions || ''),
        tags: [...new Set(recipeTags.filter(link => link.recipe_id === row.id).map(link => tagNames.get(link.tag_id)).filter(Boolean))],
        ingredients: ingredients.filter(item => item.recipe_id === row.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(item => ({ ...item, quantity_text: item.quantity_text ?? String(item.quantity ?? ''), ingredient: item.ingredient ?? item.name ?? '', unit: item.unit ?? '', preparation: item.preparation ?? '' }))
      }));
      // Preserve anything added to the preview while the requests were pending.
      const previews = recipes.filter(recipe => recipe.data_source === 'preview');
      recipes.splice(0, recipes.length, ...loaded, ...previews);
      selectedTag = '';
      render();
      $('status').textContent = `Loaded ${loaded.length} Supabase recipes (read only). Tags and ingredients reflect household access. New recipes and favorite changes are preview-only and disappear on reload or logout.`;
    } catch (error) {
      if (generation !== authGeneration) return;
      $('status').textContent = `Demo/preview data · ${error.name === 'AbortError' ? 'Supabase reads timed out.' : error.message} Local recipes remain available; nothing is saved to the database.`;
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
    if (recipe.data_source !== 'supabase') tags.append(node('span', 'tag', recipe.data_source === 'demo' ? 'Demo / preview' : 'Local preview'));
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
      const favorite = button(recipe.favorite ? '♥' : '♡', 'favorite-mark', () => { recipe.favorite = !recipe.favorite; render(); });
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
    const favorite = button(recipe.favorite ? '♥ Favorited' : '♡ Add to favorites', 'secondary', () => {
      recipe.favorite = !recipe.favorite;
      favorite.textContent = recipe.favorite ? '♥ Favorited' : '♡ Add to favorites';
      favorite.setAttribute('aria-pressed', String(recipe.favorite));
      render();
    });
    favorite.setAttribute('aria-pressed', String(recipe.favorite));
    content.append(stats, favorite, body);
    const links = node('div', 'detail-links');
    [['source_url', 'Original recipe'], ['video_url', 'Watch video']].forEach(([key, label]) => {
      const url = safeUrl(recipe[key]);
      if (!url) return;
      const link = node('a', '', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
    });
    content.append(links);
    $('detail').showModal();
  }
  function safeUrl(value) {
    if (!value) return '';
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function openEditor() {
    form.reset(); photo = ''; photoVersion++; reviewedText = null;
    $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
    $('ingredient-review').replaceChildren(); $('form-status').textContent = '';
    $('preview-submit').disabled = false;
    $('editor').showModal();
  }
  function reviewIngredients() {
    reviewedText = $('ingredient-paste').value;
    $('ingredient-review').replaceChildren();
    parse(reviewedText).forEach(item => {
      const row = node('div', 'ingredient-row');
      [['quantity_text', 'Quantity'], ['unit', 'Unit'], ['ingredient', 'Ingredient'], ['preparation', 'Preparation']].forEach(([key, label]) => {
        const wrapper = node('label', '', label);
        const input = node('input'); input.value = item[key]; input.dataset.key = key;
        wrapper.append(input); row.append(wrapper);
      });
      $('ingredient-review').append(row);
    });
  }
  $('photo').addEventListener('change', async () => {
    const version = ++photoVersion;
    photo = ''; $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
    $('form-status').textContent = ''; $('preview-submit').disabled = false;
    const file = $('photo').files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      $('form-status').textContent = 'Choose a JPG, PNG, or WebP photo no larger than 20 MB.'; $('photo').value = ''; return;
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
      photo = canvas.toDataURL('image/webp', 0.85);
      $('photo-preview').src = photo; $('photo-preview').hidden = false;
    } catch {
      if (version === photoVersion) { $('form-status').textContent = 'This photo could not be opened. Choose another image.'; $('photo').value = ''; }
    } finally {
      URL.revokeObjectURL(url);
      if (version === photoVersion) $('preview-submit').disabled = false;
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if ($('preview-submit').disabled || !form.reportValidity()) return;
    const title = field('title').value.trim();
    if (!title) { $('form-status').textContent = 'Enter a recipe title.'; field('title').focus(); return; }
    for (const key of ['source_url', 'video_url']) {
      if (field(key).value && !safeUrl(field(key).value)) { $('form-status').textContent = 'Recipe and video links must use http or https.'; field(key).focus(); return; }
    }
    if (reviewedText !== $('ingredient-paste').value) reviewIngredients();
    const ingredients = Array.from($('ingredient-review').children, (row, index) => {
      const item = { sort_order: index, grocery_section: 'Other' };
      row.querySelectorAll('input').forEach(input => { item[input.dataset.key] = input.value.trim(); });
      item.quantity = window.Ingredients.quantityValue(item.quantity_text);
      return item;
    });
    if (ingredients.some(item => !item.ingredient || (item.quantity_text && item.quantity === null))) {
      $('form-status').textContent = 'Give each ingredient a name and use a number or fraction for its quantity, or leave the quantity blank.'; return;
    }
    const tags = [...new Map(field('tags').value.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()];
    const recipe = { id: nextId++, title, description: field('description').value.trim(), servings: Number(field('servings').value), prep_minutes: Number(field('prep_minutes').value), cook_minutes: Number(field('cook_minutes').value), favorite: field('favorite').checked, tags, source_url: safeUrl(field('source_url').value), video_url: safeUrl(field('video_url').value), photo, ingredients, instructions: field('instructions').value.trim(), last_made: null };
    recipe.data_source = 'preview';
    recipe.added_order = nextId;
    recipes.push(recipe);
    resetFilters(); $('sort').value = 'newest'; render(); $('editor').close();
    $('status').textContent = `Added “${title}” to this tab's preview collection. Changes disappear on reload.`;
  });
  function resetFilters() { selectedTag = ''; favoritesOnly = false; $('search').value = ''; render(); }
  function navigate() {
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
  ['add-recipe', 'empty-add'].forEach(id => $(id).addEventListener('click', openEditor));
  document.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', () => $(control.dataset.close).close()));
  $('editor').addEventListener('close', () => { photoVersion++; });
  $('parse').addEventListener('click', reviewIngredients);
  $('search').addEventListener('input', render);
  $('sort').addEventListener('change', render);
  $('favorites').addEventListener('click', () => { favoritesOnly = !favoritesOnly; render(); });
  $('reset-filters').addEventListener('click', resetFilters);
  window.addEventListener('hashchange', navigate);
  $('status').textContent = 'Demo mode · Recipes and photos stay in this tab until you reload.';
  render(); navigate();
  initializeAuth();
})();
