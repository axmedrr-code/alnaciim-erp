const PDFDocument = require('pdfkit');

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

// Streams a PDF invoice for a sales order directly to the HTTP response.
// `order` must include `customer_*` fields and an `items` array (see sales.routes.js).
function streamInvoicePdf(res, order) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${order.order_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text('Alnaciim Water Company', { continued: false });
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text('RO Water Purification, Bottling & Ice Production')
    .text('Hargeisa, Somaliland');
  doc.moveDown(1.5);

  doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
  doc.fontSize(10).font('Helvetica').fillColor('#333')
    .text(`Invoice #: ${order.order_number}`, { align: 'right' })
    .text(`Order Date: ${String(order.order_date).slice(0, 10)}`, { align: 'right' })
    .text(`Delivery Date: ${order.delivery_date ? String(order.delivery_date).slice(0, 10) : '-'}`, { align: 'right' })
    .text(`Status: ${order.status.toUpperCase()}`, { align: 'right' })
    .text(`Payment: ${order.payment_status.toUpperCase()}`, { align: 'right' });
  doc.moveDown(1);

  doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Bill To');
  doc.fontSize(10).font('Helvetica')
    .text(order.customer_name || '-')
    .text(order.customer_address || '')
    .text([order.customer_city, order.customer_phone].filter(Boolean).join(' · '));
  if (order.customer_credit_limit !== undefined) {
    doc.fillColor('#555').fontSize(9)
      .text(`Credit limit: ${money(order.customer_credit_limit)}  ·  Account balance (all orders): ${money(order.customer_outstanding_balance)}`);
  }
  doc.moveDown(1.5);

  const tableTop = doc.y;
  const colX = { product: 50, qty: 290, price: 370, subtotal: 460 };
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Product', colX.product, tableTop);
  doc.text('Quantity', colX.qty, tableTop, { width: 70, align: 'right' });
  doc.text('Unit Price', colX.price, tableTop, { width: 80, align: 'right' });
  doc.text('Subtotal', colX.subtotal, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(10);
  for (const item of order.items) {
    doc.text(item.product_name, colX.product, y, { width: 230 });
    doc.text(`${Number(item.quantity).toLocaleString()} ${item.unit || ''}`.trim(), colX.qty, y, { width: 70, align: 'right' });
    doc.text(money(item.unit_price), colX.price, y, { width: 80, align: 'right' });
    doc.text(money(item.subtotal), colX.subtotal, y, { width: 90, align: 'right' });
    y += 20;
  }

  doc.moveTo(50, y + 5).lineTo(545, y + 5).strokeColor('#ccc').stroke();
  y += 15;

  const totalsX = 340;
  doc.font('Helvetica').text('Subtotal', totalsX, y, { width: 120, align: 'right' });
  doc.text(money(order.subtotal), colX.subtotal, y, { width: 90, align: 'right' });
  y += 16;
  doc.text('Discount', totalsX, y, { width: 120, align: 'right' });
  doc.text(`-${money(order.discount)}`, colX.subtotal, y, { width: 90, align: 'right' });
  y += 16;
  doc.text('Tax', totalsX, y, { width: 120, align: 'right' });
  doc.text(money(order.tax), colX.subtotal, y, { width: 90, align: 'right' });
  y += 16;
  doc.text('Tanker Delivery Fee', totalsX, y, { width: 120, align: 'right' });
  doc.text(money(order.delivery_fee || 0), colX.subtotal, y, { width: 90, align: 'right' });
  y += 18;
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Total', totalsX, y, { width: 120, align: 'right' });
  doc.text(money(order.total_amount), colX.subtotal, y, { width: 90, align: 'right' });

  if (order.amount_paid !== undefined) {
    y += 20;
    const balanceDue = Number(order.total_amount) - Number(order.amount_paid);
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    doc.text('Amount Paid', totalsX, y, { width: 120, align: 'right' });
    doc.text(money(order.amount_paid), colX.subtotal, y, { width: 90, align: 'right' });
    y += 16;
    doc.font('Helvetica-Bold').fillColor(balanceDue > 0 ? '#dc2626' : '#16a34a');
    doc.text('Balance Due', totalsX, y, { width: 120, align: 'right' });
    doc.text(money(balanceDue), colX.subtotal, y, { width: 90, align: 'right' });
  }

  doc.moveDown(4);
  doc.fillColor('#777').fontSize(9).font('Helvetica')
    .text('Thank you for your business.', 50, doc.y, { align: 'center', width: 495 });

  doc.end();
}

module.exports = { streamInvoicePdf };
