(function (root) {
  'use strict';
  const fractions = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
  const units = new Set('tsp teaspoon teaspoons tbsp tablespoon tablespoons cup cups oz ounce ounces lb lbs pound pounds g gram grams kg ml l liter liters clove cloves can cans pinch bunch slice slices'.split(' '));
  function quantityValue(value) {
    if (!value.trim()) return null;
    const parts = value.trim().split(/\s+/);
    let result = 0;
    for (const part of parts) {
      if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); if (!b) return null; result += a / b; }
      else if (/^\d+(?:\.\d+)?$/.test(part)) result += Number(part);
      else return null;
    }
    return Number.isFinite(result) ? result : null;
  }
  function parseIngredients(text) {
    return text.split(/\r?\n/).map(line => line.trim().replace(/^[-•]\s*/, '')).filter(Boolean).map((line, index) => {
      const normalized = line.replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, '$1 $2').replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, c => fractions[c]);
      const match = normalized.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?=\s|$)\s*/);
      const quantity_text = match ? match[1] : '';
      let rest = match ? normalized.slice(match[0].length) : normalized;
      const first = rest.split(/\s+/)[0];
      const unit = units.has(first.toLowerCase().replace(/\.$/, '')) ? first : '';
      if (unit) rest = rest.slice(first.length).trim();
      const [ingredient, ...preparation] = rest.split(',');
      return { quantity: quantityValue(quantity_text), quantity_text, unit, ingredient: ingredient.trim(), preparation: preparation.join(',').trim(), grocery_section: 'Other', sort_order: index };
    });
  }
  const api = { parseIngredients, quantityValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ingredients = api;
})(typeof window !== 'undefined' ? window : globalThis);
