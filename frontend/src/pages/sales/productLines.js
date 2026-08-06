// Segments products into the three business lines the ERP now keeps visually and
// operationally separate — Bulk (RO) Water, Bottled Water, and Ice. This is a pure
// frontend grouping: the backend already tags every product with a category_id
// (see categories table: 6 = Bottled Water, 7 = Ice Products, 10 = Bulk Water), so
// no API or schema change is needed — we just read /products and bucket by it.
export const CATEGORY_ID = { bulk: 10, bottled: 6, ice: 7 };

export function lineForCategoryId(categoryId) {
  const id = Number(categoryId);
  if (id === CATEGORY_ID.bulk) return 'bulk';
  if (id === CATEGORY_ID.bottled) return 'bottled';
  if (id === CATEGORY_ID.ice) return 'ice';
  return 'other';
}

// Builds a lookup from product name -> business line, for joining against report
// endpoints (e.g. /reports/sales) that return product_name but not category_id.
export function buildProductLineMap(products) {
  const map = {};
  for (const p of products || []) {
    map[p.name] = lineForCategoryId(p.category_id);
  }
  return map;
}

export const LINE_LABEL = { bulk: 'Bulk / RO Water', bottled: 'Bottled Water', ice: 'Ice', other: 'Other' };
