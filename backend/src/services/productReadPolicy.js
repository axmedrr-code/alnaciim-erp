const { canSee } = require('../middleware/permissions');

function productReadColumns(role) {
  const columns = ['p.id', 'p.sku', 'p.barcode', 'p.name', 'p.category_id', 'p.product_type', 'p.unit', 'p.reorder_level', 'p.reorder_qty', 'p.is_active'];
  if (canSee(role, 'PRODUCT_PRICE_VIEW')) columns.push('p.unit_price');
  if (canSee(role, 'PRODUCT_COST_VIEW')) columns.push('p.unit_cost');
  return columns.join(', ');
}

module.exports = { productReadColumns };
