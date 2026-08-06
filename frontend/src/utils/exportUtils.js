import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Every export function takes the SAME shape the shared Table component already
// uses — `columns: [{ key, header, render? }]` and `rows: [...]` — so any screen
// that already renders a Table can export it with zero extra data plumbing. Export
// happens entirely in the browser (no backend endpoint), reading whatever text each
// column's render() produces (falling back to the raw field) so exported values match
// what's on screen (formatted money, dates, etc.) rather than raw numbers.

function cellText(col, row) {
  const raw = col.render ? col.render(row) : row[col.key];
  if (raw == null) return '';
  if (typeof raw === 'object') {
    // React elements (e.g. <span className="badge">) — pull the visible text back out.
    const text = raw.props?.children;
    if (Array.isArray(text)) return text.join('');
    return text != null ? String(text) : '';
  }
  return String(raw);
}

function toRows(columns, rows) {
  return rows.map((row) => columns.map((col) => cellText(col, row)));
}

export function exportToCSV(columns, rows, filename = 'export') {
  const header = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const body = toRows(columns, rows)
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToExcel(columns, rows, filename = 'export', sheetName = 'Sheet1') {
  const data = [columns.map((c) => c.header), ...toRows(columns, rows)];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export function exportToPDF(columns, rows, filename = 'export', title = 'Report', subtitle = '') {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subtitle, 14, 23);
  }
  autoTable(doc, {
    startY: subtitle ? 28 : 22,
    head: [columns.map((c) => c.header)],
    body: toRows(columns, rows),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 94, 117] }
  });
  doc.save(`${filename}.pdf`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
