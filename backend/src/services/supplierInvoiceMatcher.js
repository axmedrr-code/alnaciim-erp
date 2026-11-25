const CENT = 0.01;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Pure validation for the three-way comparison; the caller supplies PO and
// accepted-GRN quantities while holding the relevant database rows locked.
function matchSupplierInvoice(invoiceTotal, lines) {
  const exceptions = [];
  for (const line of lines) {
    const available = Number(line.quantity_accepted) - Number(line.previously_invoiced);
    if (Number(line.quantity) > available + 0.0005) exceptions.push({
      type: 'quantity', purchase_item_id: line.purchase_item_id, product: line.product_name,
      invoice_quantity: Number(line.quantity), accepted_uninvoiced_quantity: Math.max(0, available)
    });
    if (Math.abs(Number(line.unit_price) - Number(line.unit_cost)) > CENT) exceptions.push({
      type: 'unit_price', purchase_item_id: line.purchase_item_id, product: line.product_name,
      invoice_unit_price: Number(line.unit_price), purchase_order_unit_price: Number(line.unit_cost)
    });
    if (Math.abs(round2(Number(line.quantity) * Number(line.unit_price)) - round2(line.line_total)) > CENT)
      exceptions.push({ type: 'line_total', purchase_item_id: line.purchase_item_id });
  }
  const linesTotal = round2(lines.reduce((sum, line) => sum + Number(line.line_total), 0));
  if (Math.abs(linesTotal - Number(invoiceTotal)) > CENT)
    exceptions.push({ type: 'invoice_total', lines_total: linesTotal, invoice_total: Number(invoiceTotal) });
  return {
    matched: exceptions.length === 0,
    basis: 'purchase order + accepted goods receipts + supplier invoice',
    lines_total: linesTotal,
    exceptions
  };
}

module.exports = { matchSupplierInvoice };
