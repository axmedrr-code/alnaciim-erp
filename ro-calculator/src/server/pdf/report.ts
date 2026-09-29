import PDFDocument from 'pdfkit';
import type { CalcStep, DesignResult } from '../../shared/engine';
import { HEAD_CATEGORY_LABEL, PT_STATUS_LABEL } from '../../shared/engine';
import type { HeadComponent, Level, PfdNode, PretreatmentItem, PumpResult } from '../../shared/engine';
import type { Assumptions } from '../../shared/assumptions';
import { ASSUMPTION_DEFS } from '../../shared/assumptions';
import type { DesignInput, MembraneSpec } from '../../shared/types';
import { WATER_PARAMS, WATER_SOURCE_LABELS } from '../../shared/types';
import type { DisplayUnits } from '../../shared/units';
import { fmt, fmtFlow, fmtPower, fmtPressure } from '../../shared/units';

export interface ReportInput {
  input: DesignInput;
  result: DesignResult;
  membrane: MembraneSpec | null;
  settings: { assumptions: Assumptions; units: DisplayUnits; company: { name: string; address: string; phone: string; email: string } };
}

// ============================================================== Text sanitising
// Standard PDF fonts (Helvetica) use WinAnsi encoding – anything outside it renders as garbage.

const CHAR_MAP: Record<string, string> = {
  '≥': '>=', '≤': '<=', '√': 'sqrt', '≈': '~', '−': '-', 'Σ': 'Sum ', '∑': 'Sum ', 'π': 'pi', 'ρ': 'rho', 'η': 'eta', 'β': 'beta',
  'Δ': 'd', '∆': 'd', 'δ': 'd', 'ε': 'eps', 'ν': 'nu', 'α': 'alpha', 'γ': 'gamma', 'λ': 'lambda', 'σ': 'sigma', 'θ': 'theta', 'τ': 'tau',
  'μ': 'µ', 'Ω': 'Ohm', 'ω': 'omega', 'φ': 'phi', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≠': '!=', '∞': 'inf',
  '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '⁺': '+', '⁻': '-', '₀': '0', '₁': '1', '₂': '2',
  '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ᵢ': 'i', '∝': '~', '’': "'", '‘': "'", '‐': '-', '‑': '-',
  '′': "'", '″': '"', '✓': 'OK', '✔': 'OK', '✗': 'X', '⚠': '!',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '️': '', '🟢': '', '🟡': '', '🔴': '', '\t': ' ',
};
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ“”•–—˜™š›œžŸ'.split(''));

function allowed(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || ch === '\n' || WIN_ANSI_EXTRA.has(ch);
}

// Ionic charges written with superscripts ("Ca²⁺", "SO₄²⁻", "HCO₃⁻") -> "Ca2+", "SO4 2-", "HCO3-"
const SUP_CHAR: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
const SUB_CHAR: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const ION_CHARGE = /([₀₁₂₃₄₅₆₇₈₉]?)([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([⁺⁻])/g;

export function sanitize(text: unknown): string {
  const s = (text == null ? '' : String(text)).replace(ION_CHARGE, (_m, sub: string, digits: string, sign: string) => {
    const d = [...digits].map((c) => SUP_CHAR[c]).join('');
    return (sub ? SUB_CHAR[sub] + (d ? ' ' : '') : '') + d + SUP_CHAR[sign];
  });
  let out = '';
  for (const ch of s) {
    if (allowed(ch)) { out += ch; continue; }
    const m = CHAR_MAP[ch];
    if (m !== undefined) { out += m; continue; }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every(allowed) ? base : '?';
  }
  return out.replace(/Sum {2,}/g, 'Sum ');
}

// ============================================================== Styling
const C = {
  navy: '#12305a',
  teal: '#0f8b8d',
  text: '#1f2933',
  muted: '#5f6b7a',
  rule: '#c9d2dc',
  zebra: '#f2f6f9',
  headFill: '#12305a',
  groupFill: '#dcecef',
  green: '#2e9e5b',
  amber: '#e0a100',
  red: '#d03838',
  blue: '#2b6cb0',
  grey: '#6b7280',
};
const LEVEL_COLOR: Record<Level, string> = { ok: C.green, review: C.amber, critical: C.red };
const LEVEL_TEXT: Record<Level, string> = { ok: 'Acceptable', review: 'Review', critical: 'Critical' };
const INSUFFICIENT_TXT = 'INSUFFICIENT DATA — LAB ANALYSIS REQUIRED';
const DISCLAIMER =
  'This is a preliminary engineering design produced by simplified calculations. Final equipment selection must be verified against a complete, certified water analysis and against manufacturer data and design software (membrane projection, pump curves, antiscalant projection) before procurement or construction.';

type Align = 'left' | 'right' | 'center';
type CellObj = { text: string; color?: string; bold?: boolean; fill?: string; align?: Align };
type Cell = string | CellObj;
type Row = Cell[] | { group: string };
interface Col { h: string; w: number; align?: Align }

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = { top: 62, bottom: 52, left: 45, right: 45 };
const CW = PAGE_W - M.left - M.right;

const num = (v: number | null | undefined, d = 2) => fmt(v, d);
const stepVal = (v: number | string) => (typeof v === 'number' ? fmt(v, Math.abs(v) < 1 && v !== 0 ? 4 : 2) : String(v));
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const resultText = (s: CalcStep) => {
  const v = stepVal(s.value);
  return s.unit && s.unit !== '–' && s.unit !== '-' ? `${v} ${s.unit}` : v;
};
const LABEL_PRELIM = 'PRELIMINARY ENGINEERING DESIGN';
const LABEL_VERIFY = 'FINAL EQUIPMENT SELECTION MUST BE VERIFIED AGAINST ACTUAL WATER ANALYSIS AND MANUFACTURER DATASHEETS.';

// ============================================================== Report writer
class Writer {
  readonly doc: PDFKit.PDFDocument;
  constructor(doc: PDFKit.PDFDocument) {
    this.doc = doc;
  }
  get bottom() {
    return PAGE_H - M.bottom;
  }
  get y() {
    return this.doc.y;
  }
  set y(v: number) {
    this.doc.y = v;
  }
  remaining() {
    return this.bottom - this.doc.y;
  }
  ensure(h: number) {
    if (this.doc.y + h > this.bottom) this.newPage();
  }
  newPage() {
    this.doc.addPage();
    this.doc.x = M.left;
    this.doc.y = M.top;
  }
  font(bold: boolean, size: number, color = C.text) {
    this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    return this.doc;
  }
  gap(h = 6) {
    this.doc.y += h;
  }

  section(n: number, title: string) {
    if (this.remaining() < 150) this.newPage();
    else this.gap(10);
    const y = this.y;
    this.doc.rect(M.left, y, CW, 22).fill(C.navy);
    this.doc.rect(M.left, y + 22, CW, 2.5).fill(C.teal);
    this.font(true, 12, '#ffffff').text(sanitize(`${n}.  ${title.toUpperCase()}`), M.left + 8, y + 6, { width: CW - 16, lineBreak: false });
    this.doc.x = M.left;
    this.y = y + 32;
  }

  sub(title: string, minSpace = 60) {
    this.ensure(minSpace);
    this.gap(4);
    const y = this.y;
    this.font(true, 10, C.navy).text(sanitize(title), M.left, y, { width: CW });
    const y2 = this.doc.y + 1;
    this.doc.moveTo(M.left, y2).lineTo(M.left + CW, y2).lineWidth(0.6).strokeColor(C.teal).stroke();
    this.doc.x = M.left;
    this.y = y2 + 5;
  }

  para(text: string, opts: { size?: number; color?: string; bold?: boolean; indent?: number } = {}) {
    const size = opts.size ?? 8.5;
    const ind = opts.indent ?? 0;
    const t = sanitize(text);
    this.font(!!opts.bold, size, opts.color ?? C.text);
    const h = this.doc.heightOfString(t, { width: CW - ind, lineGap: 1 });
    this.ensure(Math.min(h, 40) + 2);
    this.doc.text(t, M.left + ind, this.y, { width: CW - ind, lineGap: 1 });
    this.doc.x = M.left;
    this.gap(3);
  }

  bullets(items: string[], opts: { size?: number; color?: string; indent?: number } = {}) {
    const size = opts.size ?? 8.5;
    const ind = opts.indent ?? 6;
    for (const it of items) {
      const t = sanitize(it);
      this.font(false, size, opts.color ?? C.text);
      const w = CW - ind - 10;
      const h = this.doc.heightOfString(t, { width: w, lineGap: 1 });
      this.ensure(h + 2);
      const y = this.y;
      this.doc.circle(M.left + ind + 2, y + size * 0.42, 1.4).fill(opts.color ?? C.teal);
      this.font(false, size, opts.color ?? C.text).text(t, M.left + ind + 10, y, { width: w, lineGap: 1 });
      this.doc.x = M.left;
      this.gap(1.5);
    }
    this.gap(2);
  }

  /** List of findings with coloured status dots. */
  dotList(items: { level: Level; text: string }[], size = 8.5) {
    for (const it of items) {
      const t = sanitize(it.text);
      this.font(false, size);
      const w = CW - 16;
      const h = this.doc.heightOfString(t, { width: w, lineGap: 1 });
      this.ensure(h + 3);
      const y = this.y;
      this.doc.circle(M.left + 5, y + size * 0.45, 3.2).fill(LEVEL_COLOR[it.level]);
      this.font(false, size).text(t, M.left + 16, y, { width: w, lineGap: 1 });
      this.doc.x = M.left;
      this.gap(3);
    }
  }

  /** Coloured "pill" label followed by optional plain text on the same line. */
  pill(label: string, color: string, x: number, y: number, size = 7) {
    const t = sanitize(label);
    this.font(true, size, '#ffffff');
    const w = this.doc.widthOfString(t) + 10;
    this.doc.roundedRect(x, y, w, size + 5, 3).fill(color);
    this.font(true, size, '#ffffff').text(t, x + 5, y + 2.6, { lineBreak: false });
    return w;
  }

  // ------------------------------------------------------------ Table helper
  table(cols: Col[], rows: Row[], opts: { size?: number; pad?: number; headerFill?: string } = {}) {
    const doc = this.doc;
    const size = opts.size ?? 8;
    const pad = opts.pad ?? 3;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * CW);
    const xs: number[] = [];
    widths.reduce((x, w) => (xs.push(x), x + w), M.left);

    const cellOf = (c: Cell): CellObj => (typeof c === 'string' ? { text: c } : c);
    const textH = (t: string, w: number, bold: boolean) => {
      this.font(bold, size);
      return doc.heightOfString(t || ' ', { width: Math.max(w - 2 * pad, 4), lineGap: 0.5 });
    };
    const rowHeight = (cells: CellObj[], bold: boolean) =>
      Math.max(...cells.map((c, i) => textH(sanitize(c.text), widths[i], bold || !!c.bold))) + 2 * pad;

    const headerCells: CellObj[] = cols.map((c) => ({ text: c.h, align: c.align }));
    const headerH = rowHeight(headerCells, true);
    const drawHeader = () => {
      const y = this.y;
      doc.rect(M.left, y, CW, headerH).fill(opts.headerFill ?? C.headFill);
      headerCells.forEach((c, i) => {
        this.font(true, size, '#ffffff').text(sanitize(c.text), xs[i] + pad, y + pad, {
          width: widths[i] - 2 * pad - (c.align === 'right' ? 3 : 0), align: c.align ?? 'left', lineGap: 0.5, height: headerH,
        });
      });
      this.y = y + headerH;
    };

    const first = rows[0];
    const firstH = !first ? 0 : Array.isArray(first) ? rowHeight(first.map(cellOf), false) : size + 2 * pad + 2;
    this.ensure(headerH + firstH + 2);
    drawHeader();

    let zebra = 0;
    for (const row of rows) {
      if (!Array.isArray(row)) {
        const t = sanitize(row.group);
        const h = textH(t, CW, true) + 2 * pad + 1;
        if (this.y + h + firstH > this.bottom) { this.newPage(); drawHeader(); }
        const y = this.y;
        doc.rect(M.left, y, CW, h).fill(C.groupFill);
        this.font(true, size, C.navy).text(t, M.left + pad, y + pad + 0.5, { width: CW - 2 * pad, lineGap: 0.5, height: h });
        this.y = y + h;
        zebra = 0;
        continue;
      }
      const cells = row.map(cellOf);
      const h = rowHeight(cells, false);
      if (this.y + h > this.bottom) { this.newPage(); drawHeader(); }
      const y = this.y;
      if (zebra % 2 === 1) doc.rect(M.left, y, CW, h).fill(C.zebra);
      cells.forEach((c, i) => {
        if (c.fill) doc.rect(xs[i], y, widths[i], h).fill(c.fill);
        const al = c.align ?? cols[i]?.align ?? 'left';
        this.font(!!c.bold, size, c.color ?? C.text).text(sanitize(c.text), xs[i] + pad, y + pad, {
          width: widths[i] - 2 * pad - (al === 'right' ? 3 : 0), align: al, lineGap: 0.5, height: h,
        });
      });
      doc.moveTo(M.left, y + h).lineTo(M.left + CW, y + h).lineWidth(0.3).strokeColor(C.rule).stroke();
      this.y = y + h;
      zebra++;
    }
    doc.x = M.left;
    this.gap(6);
  }

  /** Key/value pairs laid out two pairs per row. */
  kv(pairs: [string, Cell][], twoCol = true, size = 8) {
    const lbl = (s: string): CellObj => ({ text: s, bold: true, color: C.navy });
    const rows: Row[] = [];
    if (twoCol) {
      for (let i = 0; i < pairs.length; i += 2) {
        const a = pairs[i];
        const b = pairs[i + 1];
        rows.push([lbl(a[0]), a[1], b ? lbl(b[0]) : '', b ? b[1] : '']);
      }
      this.table([{ h: 'Parameter', w: 0.22 }, { h: 'Value', w: 0.28 }, { h: 'Parameter', w: 0.22 }, { h: 'Value', w: 0.28 }], rows, { size });
    } else {
      for (const [k, v] of pairs) rows.push([lbl(k), v]);
      this.table([{ h: 'Parameter', w: 0.35 }, { h: 'Value', w: 0.65 }], rows, { size });
    }
  }

  /** 5-column calculation-step table: Parameter | Input | Formula | Assumptions | Result. */
  steps(steps: CalcStep[], size = 7, firstCol = 'Parameter') {
    if (!steps.length) {
      this.para('No calculation steps available.', { color: C.muted });
      return;
    }
    this.table(
      [{ h: firstCol, w: 0.19 }, { h: 'Input', w: 0.25 }, { h: 'Formula', w: 0.24 }, { h: 'Assumptions', w: 0.17 }, { h: 'Result', w: 0.15, align: 'right' }],
      steps.map((s) => [
        { text: s.label, bold: true },
        s.inputs || '–',
        { text: s.formula, color: C.muted },
        { text: s.assumptions || '–', color: C.muted },
        { text: resultText(s), bold: true },
      ]),
      { size, pad: 2.5 },
    );
  }

  /** Warning box with a thick coloured border. */
  box(title: string, text: string, color: string, fill: string) {
    const t = sanitize(text);
    this.font(false, 8);
    const th = t ? this.doc.heightOfString(t, { width: CW - 24, lineGap: 1 }) : 0;
    const h = 22 + (t ? th + 6 : 0);
    this.ensure(h + 6);
    const y = this.y;
    this.doc.rect(M.left, y, CW, h).lineWidth(2).fillAndStroke(fill, color);
    this.font(true, 11, color).text(sanitize(title), M.left + 12, y + 7, { width: CW - 24, align: 'center', lineBreak: false });
    if (t) this.font(false, 8, color).text(t, M.left + 12, y + 23, { width: CW - 24, align: 'center', lineGap: 1 });
    this.doc.x = M.left;
    this.y = y + h + 6;
  }
}

// ============================================================== PFD drawing
const KIND_STYLE: Record<PfdNode['kind'], { fill: string; stroke: string; name: string }> = {
  source: { fill: '#dbeafe', stroke: '#1e40af', name: 'Source' },
  pump: { fill: '#dff3f1', stroke: '#00796b', name: 'Pump' },
  tank: { fill: '#e8eaf6', stroke: '#283593', name: 'Tank' },
  filter: { fill: '#fff1dc', stroke: '#c2570c', name: 'Filter' },
  membrane: { fill: '#d9f4f7', stroke: '#006064', name: 'RO membrane' },
  uv: { fill: '#f3e5f5', stroke: '#6a1b9a', name: 'UV' },
  product: { fill: '#e3f4e6', stroke: '#2e7d32', name: 'Product' },
  drain: { fill: '#eceff1', stroke: '#546e7a', name: 'Drain / reject' },
};

function arrowHead(doc: PDFKit.PDFDocument, x: number, y: number, dir: 'right' | 'left' | 'down' | 'up', color: string, s = 4.5) {
  doc.save();
  if (dir === 'right') doc.polygon([x, y], [x - s * 1.4, y - s * 0.8], [x - s * 1.4, y + s * 0.8]);
  else if (dir === 'left') doc.polygon([x, y], [x + s * 1.4, y - s * 0.8], [x + s * 1.4, y + s * 0.8]);
  else if (dir === 'down') doc.polygon([x, y], [x - s * 0.8, y - s * 1.4], [x + s * 0.8, y - s * 1.4]);
  else doc.polygon([x, y], [x - s * 0.8, y + s * 1.4], [x + s * 0.8, y + s * 1.4]);
  doc.fill(color);
  doc.restore();
}

const PFD = { per: 4, chan: 18, gapX: 26, boxH: 50, drainH: 42, legendH: 40 };
const PFD_BOX_W = (CW - 2 * PFD.chan - (PFD.per - 1) * PFD.gapX) / PFD.per;
const pfdTagText = (n: PfdNode) => n.chemicals.map((c) => sanitize(c)).join('\n');
function pfdTagH(doc: PDFKit.PDFDocument, n: PfdNode) {
  doc.font('Helvetica').fontSize(6);
  return n.chemicals.length ? doc.heightOfString(pfdTagText(n), { width: PFD_BOX_W - 12 }) + 6 : 0;
}

/** Vertical layout of the PFD rows: box top offsets and total height (excluding the legend). */
function pfdLayout(doc: PDFKit.PDFDocument, main: PfdNode[]) {
  const rowBoxY: number[] = [];
  let total = 0;
  for (let r = 0; r < Math.ceil(main.length / PFD.per); r++) {
    const nodes = main.slice(r * PFD.per, r * PFD.per + PFD.per);
    const th = Math.max(0, ...nodes.map((n) => pfdTagH(doc, n)));
    const tagArea = th > 0 ? th + 12 : 8;
    const hasRo = nodes.some((n) => n.id === 'ro');
    rowBoxY.push(total + tagArea);
    total += tagArea + PFD.boxH + (hasRo ? PFD.drainH + 44 : 26);
  }
  return { rowBoxY, total };
}

function drawPfd(w: Writer, main: PfdNode[], reject: PfdNode) {
  const doc = w.doc;
  const { per, chan, gapX, boxH, drainH } = PFD;
  const boxW = PFD_BOX_W;
  const x0 = M.left + chan;
  const flow = '#34495e';
  const tagText = pfdTagText;
  const tagH = (n: PfdNode) => pfdTagH(doc, n);
  const { rowBoxY, total } = pfdLayout(doc, main);
  if (w.remaining() < total + PFD.legendH) w.newPage();
  const baseY = w.y;

  const pos = main.map((n, i) => {
    const r = Math.floor(i / per);
    const k = i % per;
    const col = r % 2 === 0 ? k : per - 1 - k;
    return { n, r, x: x0 + col * (boxW + gapX), y: baseY + rowBoxY[r] };
  });

  // Flow connectors
  doc.lineWidth(1.1).strokeColor(flow);
  for (let i = 0; i < pos.length - 1; i++) {
    const a = pos[i];
    const b = pos[i + 1];
    const my = a.y + boxH / 2;
    if (a.r === b.r) {
      const ltr = a.r % 2 === 0;
      const x1 = ltr ? a.x + boxW : a.x;
      const x2 = ltr ? b.x - 1 : b.x + boxW + 1;
      doc.moveTo(x1, my).lineTo(ltr ? x2 - 5 : x2 + 5, my).lineWidth(1.1).strokeColor(flow).stroke();
      arrowHead(doc, x2, my, ltr ? 'right' : 'left', flow);
    } else {
      // U-turn through the side channel
      const right = a.r % 2 === 0;
      const cx = right ? a.x + boxW + chan - 6 : a.x - chan + 6;
      const my2 = b.y + boxH / 2;
      const xe = right ? b.x + boxW + 1 : b.x - 1;
      doc.moveTo(right ? a.x + boxW : a.x, my).lineTo(cx, my).lineTo(cx, my2).lineTo(right ? xe + 5 : xe - 5, my2).lineWidth(1.1).strokeColor(flow).stroke();
      arrowHead(doc, xe, my2, right ? 'left' : 'right', flow);
    }
  }

  const drawBox = (n: PfdNode, x: number, y: number, h: number) => {
    const st = KIND_STYLE[n.kind] ?? KIND_STYLE.source;
    doc.roundedRect(x, y, boxW, h, n.kind === 'tank' || n.kind === 'membrane' ? 3 : 7).lineWidth(1).fillAndStroke(st.fill, st.stroke);
    const label = sanitize(n.label);
    const sub = sanitize(n.sub);
    doc.font('Helvetica-Bold').fontSize(7.5);
    const lh = doc.heightOfString(label, { width: boxW - 8 });
    doc.font('Helvetica').fontSize(6.3);
    const sh = sub ? doc.heightOfString(sub, { width: boxW - 8 }) : 0;
    const ty = y + Math.max(3, (h - lh - sh - (sub ? 2 : 0)) / 2);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(st.stroke).text(label, x + 4, ty, { width: boxW - 8, align: 'center', height: h });
    if (sub) doc.font('Helvetica').fontSize(6.3).fillColor(C.text).text(sub, x + 4, ty + lh + 2, { width: boxW - 8, align: 'center', height: h });
  };

  for (const p of pos) {
    drawBox(p.n, p.x, p.y, boxH);
    if (p.n.chemicals.length) {
      const th = tagH(p.n);
      const tx = p.x + 6;
      const tw = boxW - 12;
      const ty = p.y - 10 - th;
      doc.roundedRect(tx, ty, tw, th, 2).lineWidth(0.6).fillAndStroke('#fff7e0', C.amber);
      doc.font('Helvetica').fontSize(6).fillColor('#7a5500').text(tagText(p.n), tx + 3, ty + 3, { width: tw - 6, align: 'center', height: th });
      const ax = p.x + boxW / 2;
      doc.moveTo(ax, ty + th).lineTo(ax, p.y - 5).lineWidth(0.8).strokeColor(C.amber).stroke();
      arrowHead(doc, ax, p.y - 0.5, 'down', C.amber, 3.2);
    }
  }

  // Reject branch
  const ro = pos.find((p) => p.n.id === 'ro');
  if (ro) {
    const dx = ro.x;
    const dy = ro.y + boxH + 36;
    const cx = ro.x + boxW / 2;
    doc.save();
    doc.moveTo(cx, ro.y + boxH).lineTo(cx, dy - 6).lineWidth(1.1).dash(4, { space: 3 }).strokeColor(C.red).stroke();
    doc.undash();
    doc.restore();
    arrowHead(doc, cx, dy - 0.5, 'down', C.red);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.red).text('Reject', cx + 4, ro.y + boxH + 12, { lineBreak: false });
    drawBox(reject, dx, dy, drainH);
  }

  // Legend
  let ly = baseY + total + 4;
  doc.x = M.left;
  doc.moveTo(M.left, ly).lineTo(M.left + CW, ly).lineWidth(0.4).strokeColor(C.rule).stroke();
  ly += 7;
  let lx = M.left;
  for (const k of Object.keys(KIND_STYLE) as PfdNode['kind'][]) {
    const st = KIND_STYLE[k];
    doc.rect(lx, ly, 10, 8).lineWidth(0.8).fillAndStroke(st.fill, st.stroke);
    doc.font('Helvetica').fontSize(6.5).fillColor(C.text).text(st.name, lx + 13, ly + 1, { lineBreak: false });
    lx += 13 + doc.widthOfString(st.name) + 12;
  }
  doc.rect(lx, ly, 10, 8).lineWidth(0.6).fillAndStroke('#fff7e0', C.amber);
  doc.font('Helvetica').fontSize(6.5).fillColor(C.text).text('Chemical injection', lx + 13, ly + 1, { lineBreak: false });
  ly += 14;
  doc.moveTo(M.left, ly + 3).lineTo(M.left + 22, ly + 3).lineWidth(1.1).strokeColor(flow).stroke();
  doc.font('Helvetica').fontSize(6.5).fillColor(C.text).text('Process flow', M.left + 26, ly, { lineBreak: false });
  doc.save();
  doc.moveTo(M.left + 90, ly + 3).lineTo(M.left + 112, ly + 3).lineWidth(1.1).dash(4, { space: 3 }).strokeColor(C.red).stroke();
  doc.undash();
  doc.restore();
  doc.font('Helvetica').fontSize(6.5).fillColor(C.text).text('Reject / concentrate', M.left + 116, ly, { lineBreak: false });
  doc.x = M.left;
  w.y = ly + 16;
}

// ============================================================== Main builder
export async function buildReportPdf(r: ReportInput): Promise<Buffer> {
  const { input, result: res, membrane, settings } = r;
  const U = settings.units;
  const company = settings.company ?? { name: '', address: '', phone: '', email: '' };
  const proj = input.project;

  const doc = new PDFDocument({
    size: 'A4',
    margins: M,
    bufferPages: true,
    info: { Title: sanitize(`RO System Design Report – ${proj.name}`), Author: sanitize(company.name || 'RO Calculator'), Subject: 'Preliminary RO system engineering design' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const w = new Writer(doc);
  const s = res.summary;
  const mem = res.membrane;
  const water = input.water;

  // ------------------------------------------------------------ Cover page
  {
    let y = M.top + 10;
    doc.rect(M.left, y, CW, 112).fill(C.navy);
    doc.rect(M.left, y + 112, CW, 4).fill(C.teal);
    w.font(true, 9, '#9fd3d4').text(sanitize((company.name || 'RO System Engineering Calculator').toUpperCase()), M.left + 18, y + 16, { width: CW - 36, characterSpacing: 1 });
    w.font(true, 25, '#ffffff').text('RO SYSTEM DESIGN REPORT', M.left + 18, y + 34, { width: CW - 36 });
    w.font(false, 11.5, '#ffffff').text(sanitize(proj.name || 'Untitled project'), M.left + 18, y + 68, { width: CW - 36, height: 30, ellipsis: true });
    w.font(false, 8, '#c7d6e6').text(sanitize(`Reference ${proj.reference || '–'}   ·   ${proj.date || '–'}   ·   Engine v${res.engineVersion}`), M.left + 18, y + 92, { width: CW - 36, lineBreak: false });
    y += 130;

    doc.rect(M.left, y, CW, 66).lineWidth(2).fillAndStroke('#fff4e0', C.red);
    doc.rect(M.left, y, 8, 66).fill(C.amber);
    w.font(true, 16, C.red).text(LABEL_PRELIM, M.left + 8, y + 9, { width: CW - 8, align: 'center', lineBreak: false });
    let vs = 8.5;
    doc.font('Helvetica-Bold');
    while (vs > 6 && doc.fontSize(vs).widthOfString(LABEL_VERIFY) > CW - 24) vs -= 0.25;
    w.font(true, vs, C.red).text(LABEL_VERIFY, M.left + 14, y + 31, { width: CW - 20, align: 'center', lineBreak: false });
    w.font(false, 7.8, '#7a3b00').text('Not a manufacturer-certified projection — for budgeting, layout and preliminary equipment sizing only', M.left + 8, y + 46, { width: CW - 8, align: 'center', lineBreak: false });
    w.y = y + 78;

    w.sub('Project information', 20);
    w.kv([
      ['Project', proj.name || '–'],
      ['Customer', proj.customer || '–'],
      ['Location', proj.location || '–'],
      ['Designer', proj.designer || '–'],
      ['Date', proj.date || '–'],
      ['Reference', proj.reference || '–'],
    ]);

    w.sub('Key figures', 20);
    const tiles: [string, string, string][] = [
      ['Permeate flow', fmtFlow(s.permeateM3h, U), 'design permeate production'],
      ['Daily production', fmt(s.dailyProductionM3d, 1, 'm³/day'), `${fmt(input.production.operatingHours, 1)} h/day operation`],
      ['Recovery', fmt(s.recoveryPct, 1, '%'), `feed ${fmtFlow(s.feedM3h, U)} · reject ${fmtFlow(s.rejectM3h, U)}`],
      ['Membranes / vessels', mem.available ? `${s.membranes} / ${s.vessels}` : '–', mem.available ? s.array : 'membrane not designed'],
      ['HP pump', mem.available ? `${fmtFlow(s.hpFlowM3h, U)} @ ${fmtPressure(s.hpPressureBar, U)}` : '–', mem.available ? `${fmtPower(s.hpMotorKw, U)} std. motor (calc. ${fmtPower(s.hpRequiredMotorKw, U)})` : ''],
      ['Connected load', fmtPower(s.connectedKw, U), `running ${fmtPower(s.runningKw, U)} · ${fmt(s.specificEnergyKwhM3, 2, 'kWh/m³')}`],
    ];
    const tg = 9;
    const tw = (CW - 2 * tg) / 3;
    const th = 50;
    let ty = w.y;
    tiles.forEach(([label, value, sub], i) => {
      const col = i % 3;
      if (i > 0 && col === 0) ty += th + tg;
      const tx = M.left + col * (tw + tg);
      doc.rect(tx, ty, tw, th).lineWidth(0.6).fillAndStroke('#f5f8fb', C.rule);
      doc.rect(tx, ty, 3, th).fill(C.teal);
      w.font(true, 6.8, C.muted).text(sanitize(label.toUpperCase()), tx + 9, ty + 6, { width: tw - 14, lineBreak: false });
      const vt = sanitize(value);
      let vs = 14;
      doc.font('Helvetica-Bold');
      while (vs > 8 && doc.fontSize(vs).widthOfString(vt) > tw - 14) vs -= 0.5;
      w.font(true, vs, C.navy).text(vt, tx + 9, ty + 17, { width: tw - 14, lineBreak: false });
      w.font(false, 6.5, C.muted).text(sanitize(sub), tx + 9, ty + 36, { width: tw - 14, lineBreak: false, ellipsis: true, height: 10 });
    });
    w.y = ty + th + 12;
    doc.x = M.left;

    w.sub('Design check summary', 20);
    let fx = M.left + 4;
    const fy = w.y + 2;
    for (const lv of ['critical', 'review', 'ok'] as Level[]) {
      doc.circle(fx + 5, fy + 5, 5).fill(LEVEL_COLOR[lv]);
      const t = `${res.counts[lv] ?? 0}  ${LEVEL_TEXT[lv]}`;
      w.font(true, 9.5, C.text).text(t, fx + 15, fy + 0.5, { lineBreak: false });
      fx += 15 + doc.widthOfString(t) + 28;
    }
    w.y = fy + 20;
    doc.x = M.left;

    w.gap(4);
    doc.font('Helvetica').fontSize(8);
    const dh = doc.heightOfString(DISCLAIMER, { width: CW - 20, lineGap: 1 });
    const dy = w.y;
    doc.rect(M.left, dy, CW, dh + 22).lineWidth(0.6).fillAndStroke('#f7f7f4', C.rule);
    w.font(true, 8, C.red).text('DISCLAIMER', M.left + 10, dy + 6, { width: CW - 20 });
    w.font(false, 8, C.text).text(DISCLAIMER, M.left + 10, dy + 16, { width: CW - 20, lineGap: 1 });
    w.y = dy + dh + 28;
    doc.x = M.left;
  }
  w.newPage();

  // ------------------------------------------------------------ 1. Project information
  w.section(1, 'Project information');
  w.kv([
    ['Project name', proj.name || '–'],
    ['Customer', proj.customer || '–'],
    ['Location', proj.location || '–'],
    ['Designer', proj.designer || '–'],
    ['Date', proj.date || '–'],
    ['Reference', proj.reference || '–'],
    ['Prepared by', company.name || '–'],
    ['Company address', company.address || '–'],
    ['Phone', company.phone || '–'],
    ['E-mail', company.email || '–'],
    ['Calculation engine', `v${res.engineVersion}`],
    ['Calculated at', res.calculatedAt ? res.calculatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : '–'],
  ], false);

  // ------------------------------------------------------------ 2. Design basis
  const scaleLabels: Record<string, string> = { auto: 'Automatic', antiscalant: 'Antiscalant', antiscalant_acid: 'Antiscalant + acid', softener: 'Softener', none: 'None' };
  const postLabels: Record<string, string> = { none: 'None', uv: 'UV', chlorination: 'Chlorination', uv_chlorination: 'UV + chlorination' };
  w.section(2, 'Design basis');
  w.kv([
    ['Water source', WATER_SOURCE_LABELS[water.source] ?? water.source],
    ['Required production', fmt(input.production.dailyProductionM3d, 1, 'm³/day')],
    ['Operating hours', fmt(input.production.operatingHours, 1, 'h/day')],
    ['Peak factor', fmt(input.production.peakFactor, 2)],
    ['Design recovery', fmt(input.production.recoveryPct, 1, '%')],
    ['Permeate design flow', `${fmtFlow(res.production.permeateM3h, U)}${res.production.permeateOverridden ? ' (manual override)' : ''}`],
    ['RO feed flow', fmtFlow(res.production.feedM3h, U)],
    ['Reject flow', fmtFlow(res.production.rejectM3h, U)],
    ['Design flux', `${fmt(mem.designFluxTargetLmh, 1, 'LMH')}${input.membrane.designFluxLmh == null ? ' (source default)' : ' (project input)'}`],
    ['Max flux (source)', fmt(mem.maxFluxLmh, 1, 'LMH')],
    ['Membrane', membrane ? `${membrane.manufacturer} ${membrane.model}` : mem.membraneLabel || 'Not selected'],
    ['Array', mem.available ? mem.arrayLabel : '–'],
    ['Array configuration', mem.configMode === 'manual' ? 'Manual (user-defined vessels per stage)' : 'Automatic'],
    ['Feed osmotic pressure', res.chemistry.osmoticFeedBar != null ? `${fmt(res.chemistry.osmoticFeedBar, 2, 'bar')} (${res.chemistry.osmoticMethod})` : { text: 'LABORATORY DATA REQUIRED', color: C.red, bold: true }],
    ['Scale control (input)', scaleLabels[input.pretreatment.scaleControl] ?? input.pretreatment.scaleControl],
    ['Scale control (applied)', scaleLabels[res.pretreatment.scaleStrategy] ?? res.pretreatment.scaleStrategy],
    ['Post-disinfection', postLabels[input.pretreatment.postDisinfection] ?? input.pretreatment.postDisinfection],
    ['CIP system', yesNo(input.pretreatment.cip)],
    ['Feed / booster pump', yesNo(input.hydraulics.feedPumpEnabled)],
    ['Product pump', yesNo(input.hydraulics.productPumpEnabled)],
    ['Design temperature', res.water.temperature != null ? fmt(res.water.temperature, 1, '°C') : { text: 'NOT ENTERED – INSUFFICIENT DATA', color: C.red, bold: true }],
    ['Viscosity temperature (pipes)', `${fmt(res.water.viscosityTemperature, 1, '°C')}${res.water.temperature == null ? ' (default, flagged)' : ''}`],
    ['Design feed TDS', `${fmt(res.chemistry.tdsUsed ?? res.water.tds, 0, 'mg/L')}${res.chemistry.tdsBasis !== 'none' ? ` (${res.chemistry.tdsBasis})` : ''}`],
    ['', ''],
  ]);

  // ------------------------------------------------------------ 3. Water analysis & water chemistry
  w.section(3, 'Water analysis & water chemistry');
  const ch = res.chemistry;
  const LAB = { text: 'LABORATORY DATA REQUIRED', color: C.red, bold: true };
  w.sub('3.1  Raw water analysis', 60);
  const impColor: Record<string, string> = { required: C.red, recommended: C.amber, optional: C.muted };
  const waterRows: Row[] = [];
  let lastGroup = '';
  for (const p of WATER_PARAMS) {
    if (p.group !== lastGroup) {
      waterRows.push({ group: p.group });
      lastGroup = p.group;
    }
    const v = water[p.key];
    const val: Cell =
      typeof v === 'number' && isFinite(v)
        ? { text: fmt(v, 3), bold: true }
        : p.importance === 'required'
          ? { text: INSUFFICIENT_TXT, color: C.red, bold: true }
          : { text: '–', color: C.muted };
    waterRows.push([p.label, val, p.unit, { text: p.importance, color: impColor[p.importance] }]);
  }
  w.table([{ h: 'Parameter', w: 0.34 }, { h: 'Value', w: 0.36 }, { h: 'Unit', w: 0.16 }, { h: 'Importance', w: 0.14 }], waterRows, { size: 7.8 });
  if (res.water.tdsEstimated) w.para(`Note: TDS was not measured – estimated value ${fmt(res.water.tds, 0, 'mg/L')} used (${ch.tdsBasis}).`, { color: C.amber });
  if (res.water.temperature == null)
    w.para(`Temperature not entered – LABORATORY / SITE DATA REQUIRED. No temperature is assumed for the membrane, osmotic-pressure and scaling calculations; ${fmt(res.water.viscosityTemperature, 1, '°C')} is used only for water viscosity in the pipe-friction calculation.`, { color: C.red, bold: true });
  if (res.water.missingRequired.length) w.para(`Missing required parameters: ${res.water.missingRequired.join(', ')}. ${INSUFFICIENT_TXT}.`, { color: C.red, bold: true });
  if (res.water.missingRecommended.length) w.para(`Missing recommended parameters: ${res.water.missingRecommended.join(', ')}.`, { color: C.muted });

  w.sub('3.2  Ion analysis & ionic balance', 90);
  const kindLabel: Record<string, string> = { cation: 'Cation', anion: 'Anion', neutral: 'Neutral' };
  w.table(
    [
      { h: 'Ion', w: 0.25 }, { h: 'Type', w: 0.1 }, { h: 'mg/L', w: 0.15, align: 'right' }, { h: 'Molar mass g/mol', w: 0.13, align: 'right' },
      { h: 'Charge', w: 0.08, align: 'right' }, { h: 'mmol/L', w: 0.14, align: 'right' }, { h: 'meq/L', w: 0.15, align: 'right' },
    ],
    ch.ions.map((i): Row => [
      { text: i.ion, bold: i.major },
      kindLabel[i.kind] ?? i.kind,
      i.mgL != null ? { text: fmt(i.mgL, 2), bold: true } : i.major ? LAB : { text: '–', color: C.muted },
      fmt(i.molarMass, 3),
      i.charge ? `${i.charge}${i.kind === 'anion' ? '-' : '+'}` : '0',
      fmt(i.mmolL, 4),
      fmt(i.meqL, 4),
    ]),
    { size: 7.4 },
  );
  const tolV = res.assumptionsUsed['ion_balance_tolerance'];
  const tol = typeof tolV === 'number' ? tolV : 10;
  w.kv([
    ['Sum of cations', ch.cationsMeqL != null ? fmt(ch.cationsMeqL, 3, 'meq/L') : LAB],
    ['Sum of anions', ch.anionsMeqL != null ? fmt(ch.anionsMeqL, 3, 'meq/L') : LAB],
    ['Ionic balance error', ch.balanceErrorPct != null ? { text: `${fmt(ch.balanceErrorPct, 2, '%')} (tolerance ${fmt(tol, 1)} %)`, bold: true, color: ch.balanceErrorPct > tol ? C.amber : C.green } : LAB],
    ['Major ions complete', ch.majorIonsComplete ? { text: 'Yes', color: C.green, bold: true } : { text: 'No', color: C.red, bold: true }],
  ]);
  if (!ch.majorIonsComplete) w.para(`Ionic balance not possible – LABORATORY DATA REQUIRED: ${ch.missingMajorIons.join(', ')}.`, { color: C.red, bold: true });
  w.para('HCO₃⁻ is derived from alkalinity (mg/L as CaCO₃ × 1.219, valid for pH < 8.3). Balance error = |Σcations − Σanions| ÷ (Σcations + Σanions) × 100.', { size: 7.4, color: C.muted });

  w.sub('3.3  TDS & osmotic pressure', 80);
  w.kv([
    ['TDS measured', ch.tdsMeasured != null ? fmt(ch.tdsMeasured, 0, 'mg/L') : { text: 'not measured', color: C.muted }],
    ['TDS – sum of ions', ch.tdsFromIons != null ? fmt(ch.tdsFromIons, 0, 'mg/L') : { text: 'incomplete ion analysis', color: C.muted }],
    ['TDS – conductivity estimate', ch.tdsFromConductivity != null ? fmt(ch.tdsFromConductivity, 0, 'mg/L') : { text: 'no conductivity', color: C.muted }],
    ['TDS used for design', ch.tdsUsed != null ? { text: `${fmt(ch.tdsUsed, 0, 'mg/L')} (${ch.tdsBasis})`, bold: true } : LAB],
    ['Feed osmotic pressure', ch.osmoticFeedBar != null ? { text: fmt(ch.osmoticFeedBar, 3, 'bar'), bold: true } : LAB],
    ['Osmotic method', ch.osmoticMethod === 'none' ? { text: 'not calculated', color: C.red } : ch.osmoticMethod],
    ['Concentrate osmotic pressure', mem.osmoticConcentrateBar != null ? fmt(mem.osmoticConcentrateBar, 3, 'bar') : '–'],
    ['Water temperature', res.water.temperature != null ? fmt(res.water.temperature, 1, '°C') : LAB],
  ]);
  if (ch.steps.length) w.steps(ch.steps);

  w.sub('3.4  Scaling indicators', 90);
  const indStatus = (st: string): Cell =>
    st === 'insufficient' ? LAB : { text: LEVEL_TEXT[st as Level] ?? st, color: LEVEL_COLOR[st as Level] ?? C.text, bold: true };
  w.table(
    [
      { h: 'Indicator', w: 0.22 }, { h: 'Feed', w: 0.09, align: 'right' }, { h: 'Concentrate', w: 0.11, align: 'right' }, { h: 'Unit', w: 0.06 },
      { h: 'Status', w: 0.15 }, { h: 'Interpretation', w: 0.37 },
    ],
    ch.indicators.map((i): Row => [
      { text: i.name, bold: true },
      fmt(i.feed, 2),
      fmt(i.concentrate, 2),
      i.unit,
      indStatus(i.status),
      i.status === 'insufficient'
        ? { text: `Data required: ${i.dataRequired.join(', ')}`, color: C.red, bold: true }
        : { text: i.interpretation || '–', color: C.text },
    ]),
    { size: 7.2 },
  );
  if (!ch.indicators.length) w.para(`Scaling indicators could not be calculated. ${INSUFFICIENT_TXT}.`, { color: C.red, bold: true });
  const sc = res.pretreatment.scaling;
  const sca = res.pretreatment.scalingAfterTreatment;
  if (sc) {
    w.sub('3.5  Concentrate scaling – untreated vs after scale control', 90);
    type SK = 'feedLsi' | 'concentrateLsi' | 'concentratePh' | 'caso4SatPct' | 'silicaSatPct' | 'baso4SatPct' | 'srso4SatPct' | 'maxRecoveryBySilicaPct';
    const defs: [string, SK, string, number][] = [
      ['Feed LSI', 'feedLsi', '–', 2],
      ['Concentrate LSI', 'concentrateLsi', '–', 2],
      ['Concentrate pH', 'concentratePh', '–', 2],
      ['CaSO4 saturation', 'caso4SatPct', '%', 0],
      ['Silica saturation', 'silicaSatPct', '%', 0],
      ['BaSO4 saturation', 'baso4SatPct', '%', 0],
      ['SrSO4 saturation', 'srso4SatPct', '%', 0],
      ['Max recovery limited by silica', 'maxRecoveryBySilicaPct', '%', 1],
    ];
    const cols: Col[] = [{ h: 'Index', w: 0.4 }, { h: 'Untreated feed', w: 0.2, align: 'right' }];
    if (sca) cols.push({ h: 'After treatment', w: 0.2, align: 'right' });
    cols.push({ h: 'Unit', w: 0.2 });
    const rows: Row[] = [['Concentration factor', fmt(sc.concentrationFactor, 2), ...(sca ? [fmt(sca.concentrationFactor, 2)] : []), '×']];
    for (const [label, key, unit, d] of defs) rows.push([label, { text: num(sc[key], d), bold: true }, ...(sca ? [{ text: num(sca[key], d), bold: true }] : []), unit]);
    rows.push(['Silica in concentrate / solubility', `${num(sc.silicaConcMgL, 1)} / ${num(sc.silicaSolubilityMgL, 1)}`, ...(sca ? [`${num(sca.silicaConcMgL, 1)} / ${num(sca.silicaSolubilityMgL, 1)}`] : []), 'mg/L']);
    w.table(cols, rows, { size: 7.6 });
    const notes = [...sc.notes, ...(sca ? sca.notes.filter((n) => !sc.notes.includes(n)) : [])];
    if (notes.length) w.bullets(notes, { size: 7.6 });
    if (res.pretreatment.acidTargetPh != null) w.para(`Acid dosing target pH ${fmt(res.pretreatment.acidTargetPh, 2)} (dose ${fmt(res.pretreatment.acidDoseMeqL, 2, 'meq/L')}).`);
  }
  w.para('Scaling indicators are screening values. Confirm scale control with the antiscalant supplier projection software using a complete certified analysis.', { size: 7.4, color: C.muted });

  // ------------------------------------------------------------ 4. Production requirement
  w.section(4, 'Production requirement');
  w.steps(res.production.steps);
  if (!res.production.valid) w.para('Production input is invalid – the downstream design is incomplete.', { color: C.red, bold: true });

  // ------------------------------------------------------------ 5. RO membrane design – stage by stage
  w.section(5, 'RO membrane design – stage-by-stage');
  const INS: CellObj = { text: 'INSUFFICIENT DATA', color: C.red, bold: true };
  const pv = (v: number | null | undefined, d: number, unit: string): Cell => (v == null || !mem.simulated ? INS : fmt(v, d, unit));
  if (!mem.available) {
    w.para('The RO membrane system could not be designed (no membrane selected or insufficient input). Select a membrane from the library.', { color: C.red, bold: true });
  } else {
    if (!mem.simulated) w.para(mem.simulationMessage || 'INSUFFICIENT DATA — pressures and permeate quality not calculated.', { color: C.red, bold: true });
    else w.para(`Element-by-element simulation: ${mem.simulationMessage}`, { size: 7.8, color: C.muted });
    w.para(`Array configuration: ${mem.configMode === 'manual' ? 'manual (user-defined vessels per stage)' : 'automatic'} — ${mem.arrayLabel}.`, { size: 8 });
  }
  w.sub('5.1  Membrane calculation steps', 70);
  w.steps(mem.steps);
  if (mem.available) {
    w.sub('5.2  Performance summary', 90);
    w.kv([
      ['Array', mem.arrayLabel],
      ['Elements / vessels', `${mem.elements} / ${mem.vessels}`],
      ['Average flux', fmt(mem.actualFluxLmh, 1, 'LMH')],
      ['Target / max flux', `${fmt(mem.designFluxTargetLmh, 1)} / ${fmt(mem.maxFluxLmh, 1)} LMH`],
      ['Avg element recovery', fmt(mem.averageElementRecoveryPct, 1, '%')],
      ['Capacity at target flux', fmtFlow(mem.capacityAtTargetFluxM3h, U)],
      ['TCF water / salt', mem.tcf != null ? `${fmt(mem.tcf, 3)} / ${fmt(mem.tcfSalt, 3)}` : INS],
      ['Permeability A / B (25 °C)', mem.permeabilityLmhBar != null ? `${fmt(mem.permeabilityLmhBar, 3)} LMH/bar / ${fmt(mem.saltPermeabilityLmh, 4)} LMH` : INS],
      ['Feed / conc. osmotic', mem.osmoticFeedBar != null ? `${fmt(mem.osmoticFeedBar, 2)} / ${fmt(mem.osmoticConcentrateBar, 2)} bar` : INS],
      ['Avg wall osmotic pressure', pv(mem.avgOsmoticBar, 2, 'bar')],
      ['Average NDP', pv(mem.ndpBar, 2, 'bar')],
      ['Array pressure drop', pv(mem.arrayDpBar, 2, 'bar')],
      ['Feed pressure', mem.feedPressureBar != null && mem.simulated ? { text: fmtPressure(mem.feedPressureBar, U, 2), bold: true } : INS],
      ['Concentrate pressure', mem.concentratePressureBar != null && mem.simulated ? fmtPressure(mem.concentratePressureBar, U, 2) : INS],
      ['Salt rejection / passage', mem.rejectionPct != null ? `${fmt(mem.rejectionPct, 2)} / ${fmt(mem.saltPassagePct, 2)} %` : INS],
      ['Permeate / conc. TDS', mem.permeateTdsMgL != null ? `${fmt(mem.permeateTdsMgL, 1)} / ${fmt(mem.concentrateTdsMgL, 0)} mg/L` : INS],
    ]);
  }
  mem.stageDetail.forEach((st, si) => {
    w.sub(`5.${si + 3}  Stage ${st.stage}: ${st.vessels} vessels × ${st.elementsPerVessel} elements = ${st.elements} elements`, 130);
    const y = w.y;
    const l1 = `Feed ${fmt(st.feedM3h, 2)} m³/h  ·  Permeate ${fmt(st.permeateM3h, 2)} m³/h  ·  Concentrate ${fmt(st.concentrateM3h, 2)} m³/h  ·  Recovery ${fmt(st.recoveryPct, 1)} %  ·  Avg flux ${fmt(st.avgFluxLmh, 1)} LMH  ·  Feed/PV ${fmt(st.feedPerVesselM3h, 2)}, Conc./PV ${fmt(st.concentratePerVesselM3h, 2)} m³/h`;
    const l2 = st.feedPressureBar != null && mem.simulated
      ? `Pressure in ${fmt(st.feedPressureBar, 2)} bar  ·  out ${fmt(st.concentratePressureBar, 2)} bar  ·  dP ${fmt(st.dpBar, 2)} bar  ·  TDS feed ${fmt(st.feedTds, 0)} / conc. ${fmt(st.concentrateTds, 0)} / permeate ${fmt(st.permeateTds, 1)} mg/L`
      : 'Pressures in / out, dP and TDS: INSUFFICIENT DATA';
    const t1 = sanitize(l1);
    const t2 = sanitize(l2);
    w.font(false, 7.4);
    const h1 = doc.heightOfString(t1, { width: CW - 14 });
    const h2 = doc.heightOfString(t2, { width: CW - 14 });
    doc.rect(M.left, y, CW, h1 + h2 + 10).fill('#e6f4f4');
    doc.rect(M.left, y, 3, h1 + h2 + 10).fill(C.teal);
    w.font(true, 7.4, C.navy).text(t1, M.left + 8, y + 4, { width: CW - 14 });
    w.font(true, 7.4, st.feedPressureBar != null && mem.simulated ? C.navy : C.red).text(t2, M.left + 8, y + 5 + h1, { width: CW - 14 });
    w.y = y + h1 + h2 + 14;
    doc.x = M.left;
    if (st.elementsDetail.length) {
      w.table(
        [
          { h: 'El.', w: 0.04, align: 'center' }, { h: 'Feed m³/h', w: 0.085, align: 'right' }, { h: 'Perm m³/h', w: 0.085, align: 'right' }, { h: 'Conc m³/h', w: 0.085, align: 'right' },
          { h: 'Rec %', w: 0.07, align: 'right' }, { h: 'Flux LMH', w: 0.08, align: 'right' }, { h: 'P feed bar', w: 0.085, align: 'right' }, { h: 'NDP bar', w: 0.08, align: 'right' },
          { h: 'π wall bar', w: 0.085, align: 'right' }, { h: 'β', w: 0.065, align: 'right' }, { h: 'Perm TDS mg/L', w: 0.095, align: 'right' }, { h: 'Rej %', w: 0.075, align: 'right' },
        ],
        st.elementsDetail.map((e): Row => [
          String(e.position), fmt(e.feedM3h, 3), fmt(e.permeateM3h, 3), fmt(e.concentrateM3h, 3), fmt(e.recoveryPct, 1), fmt(e.fluxLmh, 1),
          fmt(e.feedPressureBar, 2), fmt(e.ndpBar, 2), fmt(e.osmoticMembraneBar, 2), fmt(e.beta, 3), fmt(e.permeateTds, 1), fmt(e.rejectionPct, 2),
        ]),
        { size: 6.8, pad: 2.2 },
      );
    } else {
      w.para('Element-by-element results: INSUFFICIENT DATA (simulation not run). Flows shown assume equal flux per element.', { size: 7.6, color: C.red, bold: true });
    }
  });
  if (mem.available) {
    if (mem.stageDetail.some((s) => s.elementsDetail.length))
      w.para('Element values are for one pressure vessel (all vessels of a stage are identical). pi wall = osmotic pressure at the membrane wall (incl. concentration polarisation beta).', { size: 7.2, color: C.muted });
    w.para(`Total: ${mem.elements} membranes, ${mem.vessels} vessels  (${mem.vesselsPerStage.join(':')} array, ${mem.elementsPerVessel} elements per vessel)`, { bold: true, size: 9.5, color: C.navy });
  }

  // ------------------------------------------------------------ 6. Membrane selection
  w.section(6, 'Membrane selection');
  if (membrane?.isDemo || mem.isDemoData)
    w.box('DEMO DATA – NOT A MANUFACTURER DATASHEET', 'The selected membrane uses sample (demonstration) values. Enter the actual manufacturer datasheet values in the Membrane Library before using this design.', C.red, '#fdecec');
  if (!membrane) {
    w.para('No membrane selected – membrane specification not available.', { color: C.red, bold: true });
  } else {
    const m = membrane;
    const range = (a: number | null, b: number | null, unit = '') => (a == null && b == null ? '–' : `${fmt(a, 1)} – ${fmt(b, 1)}${unit ? ' ' + unit : ''}`);
    w.kv([
      ['Manufacturer', m.manufacturer || '–'],
      ['Model', m.model || '–'],
      ['Membrane type', m.membraneType || '–'],
      ['Diameter', fmt(m.diameterIn, 1, 'inch')],
      ['Active area', fmt(m.activeAreaM2, 1, 'm²')],
      ['Nominal permeate flow', fmt(m.nominalFlowM3d, 1, 'm³/day')],
      ['Salt rejection', fmt(m.saltRejectionPct, 2, '%')],
      ['Max operating pressure', fmt(m.maxPressureBar, 1, 'bar')],
      ['Max temperature', fmt(m.maxTempC, 0, '°C')],
      ['pH range (operation)', range(m.phMin, m.phMax)],
      ['Test pressure', fmt(m.testPressureBar, 1, 'bar')],
      ['Test TDS', fmt(m.testTdsMgL, 0, 'mg/L')],
      ['Test recovery', fmt(m.testRecoveryPct, 0, '%')],
      ['Data source', m.isDemo ? { text: `${m.dataSource || 'DEMO'} (DEMO)`, color: C.red, bold: true } : m.dataSource || '–'],
    ]);
    w.sub('Recommended operating range', 60);
    w.kv([
      ['Recommended flux range', range(m.recFluxMinLmh, m.recFluxMaxLmh, 'LMH')],
      ['Max feed flow / vessel', fmt(m.maxFeedFlowM3h, 1, 'm³/h')],
      ['Min concentrate flow / vessel', fmt(m.minConcentrateM3h, 2, 'm³/h')],
      ['Max element recovery', fmt(m.maxElementRecoveryPct, 0, '%')],
      ['Max element pressure drop', fmt(m.maxElementDpBar, 2, 'bar')],
      ['Design flux (this project)', fmt(mem.actualFluxLmh, 1, 'LMH')],
    ]);
    if (m.notes) w.para(`Notes: ${m.notes}`, { color: C.muted });
  }
  if (mem.assumptions.length) {
    w.sub('Membrane calculation assumptions', 40);
    w.bullets(mem.assumptions);
  }
  w.para(
    'IMPORTANT: the membrane performance above is estimated with a simplified solution-diffusion model. It is NOT a manufacturer-certified projection. Run the membrane manufacturer\'s projection software with the certified water analysis before final selection.',
    { color: C.red, bold: true },
  );

  // ------------------------------------------------------------ 7. Pump calculations
  w.section(7, 'Pump calculations');
  const enabledPumps = res.pumps.filter((p) => p.enabled);
  const disabledPumps = res.pumps.filter((p) => !p.enabled);
  if (!enabledPumps.length) w.para('No pumps in the design (insufficient input).', { color: C.red });
  const CAT_ORDER: HeadComponent['category'][] = ['static', 'friction', 'minor', 'equipment', 'terminal', 'suction'];
  enabledPumps.forEach((p: PumpResult, i) => {
    w.sub(`7.${i + 1}  ${p.name}`, 180);
    const y = w.y;
    doc.rect(M.left, y, CW, 18).fill('#e6f4f4');
    const key = `Flow ${fmt(p.designFlowM3h, 2, 'm³/h')}  |  Design TDH ${fmt(p.designHeadM, 1, 'm')}  |  Discharge ${fmt(p.dischargePressureBar ?? p.designPressureBar, 2, 'bar')}  |  Motor: calc. ${fmt(p.requiredMotorKw, 2, 'kW')} -> std. ${fmt(p.standardMotorKw, 2, 'kW')}`;
    w.font(true, 8.2, C.navy).text(sanitize(key), M.left + 8, y + 5, { width: CW - 16, lineBreak: false });
    w.y = y + 24;
    doc.x = M.left;
    // Head components grouped by category
    const compRows: Row[] = [];
    for (const cat of CAT_ORDER) {
      const cs = p.components.filter((c) => c.category === cat);
      if (!cs.length) continue;
      const sum = cs.reduce((a, c) => a + c.headM, 0);
      compRows.push({ group: `${HEAD_CATEGORY_LABEL[cat]}  –  subtotal ${fmt(sum, 2, 'm')}` });
      for (const c of cs) compRows.push([c.label, fmt(c.headM, 2), { text: c.note || '', color: C.muted }]);
    }
    compRows.push([{ text: 'Calculated total dynamic head (TDH)', bold: true }, { text: fmt(p.calculatedHeadM, 2), bold: true }, '']);
    compRows.push([{ text: 'Design TDH (incl. head margin)', bold: true }, { text: fmt(p.designHeadM, 2), bold: true }, { text: `${fmt(p.designPressureBar, 2)} bar differential`, color: C.muted }]);
    w.table([{ h: 'Head component', w: 0.42 }, { h: 'Head m', w: 0.13, align: 'right' }, { h: 'Note', w: 0.45 }], compRows, { size: 7.3, pad: 2.6 });
    // Duty summary
    const hl = (t: string, fill: string): CellObj => ({ text: t, bold: true, color: C.navy, fill });
    const sumRows: Row[] = [
      ['Flow (design)', fmt(p.designFlowM3h, 2, 'm³/h'), { text: `process flow ${fmt(p.processFlowM3h, 2, 'm³/h')}`, color: C.muted }],
      ['Static head', fmt(p.staticHeadM, 2, 'm'), ''],
      ['Pipe friction', fmt(p.frictionHeadM, 2, 'm'), ''],
      ['Minor losses', fmt(p.minorHeadM, 2, 'm'), ''],
      ['Equipment loss', fmt(p.equipmentHeadM, 2, 'm'), ''],
      ['Required operating pressure', fmt(p.terminalHeadM, 2, 'm'), { text: `${fmt(p.terminalHeadM / 10.194, 2)} bar`, color: C.muted }],
      ['Suction credit', p.suctionCreditM ? `- ${fmt(p.suctionCreditM, 2, 'm')}` : '0 m', { text: p.suctionPressureBar != null ? `suction ${fmt(p.suctionPressureBar, 2)} bar` : '', color: C.muted }],
      [{ text: 'TDH (calculated)', bold: true }, { text: fmt(p.calculatedHeadM, 2, 'm'), bold: true }, ''],
      [{ text: 'Design TDH', bold: true }, { text: fmt(p.designHeadM, 2, 'm'), bold: true }, { text: `${fmt(p.designPressureBar, 2)} bar; discharge ${fmt(p.dischargePressureBar, 2, 'bar')}`, color: C.muted }],
      ['Hydraulic power', fmt(p.hydraulicKw, 2, 'kW'), { text: 'P_h = rho·g·Q·H', color: C.muted }],
      ['Pump efficiency', fmt(p.efficiencyPct, 1, '%'), { text: `source: ${p.efficiencySource}`, color: C.muted }],
      ['Shaft power', fmt(p.shaftKw, 2, 'kW'), { text: 'P_s = P_h ÷ eta_pump', color: C.muted }],
      ['Safety factor', fmt(p.safetyFactor, 2), { text: 'motor service / safety factor', color: C.muted }],
      [hl('CALCULATED required motor power', '#fff4e0'), hl(fmt(p.requiredMotorKw, 2, 'kW'), '#fff4e0'), { text: 'P_m = P_s × safety factor', color: C.muted, fill: '#fff4e0' }],
      [hl('RECOMMENDED standard motor size', '#dff3f1'), hl(fmt(p.standardMotorKw, 2, 'kW'), '#dff3f1'), { text: 'next IEC standard motor >= P_m', color: C.muted, fill: '#dff3f1' }],
      ['Electrical input at duty', fmt(p.absorbedKw, 2, 'kW'), { text: `motor efficiency ${fmt(p.motorEfficiencyPct, 0, '%')}`, color: C.muted }],
      ['NPSH available', p.npshAvailableM != null ? fmt(p.npshAvailableM, 2, 'm') : '–', { text: p.npshNote, color: C.muted }],
    ];
    w.table([{ h: 'Duty summary', w: 0.38 }, { h: 'Value', w: 0.2, align: 'right' }, { h: 'Note', w: 0.42 }], sumRows, { size: 7.4, pad: 2.6 });
    // Selected pump & operating point
    const sp = p.selectedPump;
    const op = p.operatingPoint;
    if (sp) {
      w.para(`Selected pump: ${sp.manufacturer} ${sp.model}${sp.isDemo ? '  (DEMO curve – not manufacturer data)' : ''}`, { bold: true, color: sp.isDemo ? C.red : C.navy, size: 8.2 });
      if (op) {
        const npshMargin = op.npshrAtDesignM != null && p.npshAvailableM != null ? `  (margin ${fmt(p.npshAvailableM - op.npshrAtDesignM, 2, 'm')})` : '';
        w.kv([
          ['Head at design flow', op.headAtDesignFlowM != null ? `${fmt(op.headAtDesignFlowM, 1, 'm')} (req. ${fmt(p.designHeadM, 1, 'm')})` : 'outside curve'],
          ['Excess head', op.excessHeadPct != null ? { text: fmt(op.excessHeadPct, 1, '%'), color: op.excessHeadPct < 0 ? C.red : C.text, bold: true } : '–'],
          ['Efficiency at duty', fmt(op.efficiencyAtDesignPct, 1, '%')],
          ['NPSHr at duty', `${fmt(op.npshrAtDesignM, 2, 'm')}${npshMargin}`],
          ['BEP flow / ratio', op.bepFlowM3h != null ? `${fmt(op.bepFlowM3h, 2, 'm³/h')} / ${fmt(op.bepRatio != null ? op.bepRatio * 100 : null, 0, '%')}` : '–'],
          ['Natural intersection point', op.intersectFlowM3h != null ? `${fmt(op.intersectFlowM3h, 2, 'm³/h')} @ ${fmt(op.intersectHeadM, 1, 'm')}` : 'no intersection within curve'],
          ['Power at duty (curve)', fmt(op.powerAtDesignKw, 2, 'kW')],
          ['Curve range / within', `${fmt(op.curveMinFlow, 1)} – ${fmt(op.curveMaxFlow, 1)} m³/h / ${yesNo(op.withinCurve)}`],
        ], true, 7.4);
      } else w.para('Selected pump has no usable curve – operating point requires confirmation.', { color: C.amber, bold: true, size: 7.8 });
    } else {
      w.para('No pump curve selected – operating point requires confirmation.', { color: C.amber, bold: true, size: 8 });
      if (p.candidates.length)
        w.para(`Library candidates meeting the duty: ${p.candidates.map((c) => `${c.label} (${fmt(c.headAtFlowM, 1)} m at duty${c.bepRatio != null ? `, ${fmt(c.bepRatio * 100, 0)} % BEP` : ''})`).join('; ')}.`, { size: 7.6, color: C.muted });
    }
    w.steps(p.steps);
    if (p.notes.length) w.bullets(p.notes, { size: 7.6 });
  });
  if (disabledPumps.length) w.para(`Not in design: ${disabledPumps.map((p) => p.name).join(', ')}.`, { color: C.muted });

  // ------------------------------------------------------------ 8. Pipe calculations
  w.section(8, 'Pipe calculations');
  const stColor = (st: Level) => LEVEL_COLOR[st];
  const methods = [...new Set(res.pipes.map((p) => p.method))];
  const isHazen = methods.length === 1 && methods[0] === 'hazen';
  const methodName = (m: string) => (m === 'hazen' ? 'Hazen–Williams' : 'Darcy–Weisbach (Swamee–Jain friction factor)');
  w.para(`Friction method for this project: ${methods.map(methodName).join(' / ') || '–'}. ${isHazen ? 'Darcy–Weisbach' : 'Hazen–Williams'} loss shown as a cross-check only.`, { bold: true, size: 8.2, color: C.navy });
  w.table(
    [
      { h: 'Section', w: 0.14 }, { h: 'Flow m³/h', w: 0.058, align: 'right' }, { h: 'Material', w: 0.115 }, { h: 'DN', w: 0.042, align: 'right' },
      { h: 'ID mm', w: 0.052, align: 'right' }, { h: 'v m/s', w: 0.048, align: 'right' }, { h: 'Re', w: 0.066, align: 'right' }, { h: 'f', w: 0.056, align: 'right' },
      { h: 'hf m', w: 0.058, align: 'right' }, { h: 'hf m/100m', w: 0.06, align: 'right' }, { h: 'ΣK', w: 0.045, align: 'right' },
      { h: 'Minor m', w: 0.052, align: 'right' }, { h: isHazen ? 'D-W check m' : 'H-W check m', w: 0.062, align: 'right' }, { h: 'Total bar', w: 0.058, align: 'right' },
      { h: 'Status', w: 0.06 },
    ],
    res.pipes.map((p) => [
      { text: p.label, bold: true }, fmt(p.flowM3h, 2), p.material, p.dn != null ? `${p.dn}${p.dnForced ? '*' : ''}` : '–', fmt(p.innerDiameterMm, 1), fmt(p.velocity, 2),
      fmt(p.reynolds, 0), fmt(p.frictionFactor, 4), fmt(p.frictionLossM, 3), fmt(p.lossPer100m, 3), fmt(p.sumK, 2), fmt(p.minorLossM, 3),
      { text: isHazen ? fmt(p.darcyLossM, 3) : fmt(p.hazenLossM, 3), color: C.muted }, { text: fmt(p.totalLossBar, 3), bold: true },
      { text: p.status === 'ok' ? 'OK' : LEVEL_TEXT[p.status], color: stColor(p.status), bold: true },
    ]),
    { size: 6.3, pad: 2 },
  );
  w.para(
    'hf = pipe friction loss, Re = Reynolds number, f = Darcy friction factor. Method: required inner diameter d = sqrt(4Q / (pi · v_max)); the next standard size with ID >= d is selected from the pipe library (* = DN fixed by the user). Friction h_f = f·(L/D)·v²/2g (Darcy–Weisbach, Swamee–Jain f) or h_f = 10.67·L·Q^1.852 ÷ (C^1.852·d^4.87) (Hazen–Williams); minor losses h_m = ΣK·v²/2g; design pressures from the adjacent pump discharge.',
    { size: 7.4, color: C.muted },
  );
  const pipeMsgs = res.pipes.flatMap((p) => p.messages.map((m) => ({ level: m.level as Level, text: `${p.label}: ${m.text}` })));
  if (pipeMsgs.length) w.dotList(pipeMsgs, 8);
  w.sub('Fittings & calculation steps per section', 80);
  for (const p of res.pipes) {
    if (!(p.flowM3h > 0)) continue;
    w.ensure(90);
    w.para(`${p.label}  –  ${p.material}, DN ${p.dn ?? '–'}, L ${fmt(p.lengthM, 1)} m, design pressure ${fmt(p.designPressureBar, 1)} bar${p.pressureRatingBar != null ? ` (rating ${fmt(p.pressureRatingBar, 0)} bar)` : ''}`, { bold: true, size: 8, color: C.navy });
    if (p.fittings.length) w.para(`Fittings: ${p.fittings.map((f) => `${f.count} × ${f.label} (K ${fmt(f.k, 2)})`).join(', ')}  ->  ΣK = ${fmt(p.sumK, 2)}`, { size: 7.2, color: C.muted });
    w.steps(p.steps, 6.8);
  }

  // ------------------------------------------------------------ 9. Pretreatment
  w.section(9, 'Pretreatment');
  const ptColor: Record<string, string> = { required: C.red, recommended: C.amber, optional: C.blue, not_required: C.grey, insufficient_data: C.red };
  const sizingLines = (it: PretreatmentItem) => {
    const sz = it.sizing;
    if (!sz || !it.inDesign) return;
    if (sz.kind === 'filter') {
      w.kv([
        ['Vessels', `${sz.vessels} × Ø${fmt(sz.diameterMm, 0)} mm`],
        ['Treated flow', fmt(sz.flowM3h, 2, 'm³/h')],
        ['Area per vessel', fmt(sz.areaPerVesselM2, 3, 'm²')],
        ['Filtration rate', `${fmt(sz.actualRateMh, 1)} m/h (design ${fmt(sz.designRateMh, 1)} m/h)`],
        ['Backwash flow', fmt(sz.backwashFlowM3h, 1, 'm³/h')],
        ['', ''],
      ], true, 7.6);
      if (sz.media.length)
        w.table(
          [{ h: 'Media layer', w: 0.4 }, { h: 'Depth m', w: 0.2, align: 'right' }, { h: 'Volume L', w: 0.2, align: 'right' }, { h: 'Mass kg', w: 0.2, align: 'right' }],
          sz.media.map((l) => [l.name, fmt(l.depthM, 2), fmt(l.volumeL, 0), fmt(l.massKg, 0)]),
          { size: 7.6 },
        );
    } else if (sz.kind === 'cartridge') {
      w.kv([
        ['Rating', fmt(sz.micron, 0, 'µm')],
        ['Flow', fmt(sz.flowM3h, 2, 'm³/h')],
        ['40" elements', String(sz.elements40in)],
        ['Housings', `${sz.housings} × ${sz.roundsPerHousing} rounds`],
      ], true, 7.6);
    } else {
      w.kv([
        ['Vessels', `${sz.vessels} × Ø${fmt(sz.diameterMm, 0)} mm`],
        ['Resin per vessel', fmt(sz.resinPerVesselL, 0, 'L')],
        ['Flow / hardness', `${fmt(sz.flowM3h, 2, 'm³/h')} / ${fmt(sz.hardnessMgL, 0, 'mg/L CaCO3')}`],
        ['Service rate', fmt(sz.serviceRateMh, 1, 'm/h')],
        ['Bed depth', fmt(sz.bedDepthM, 2, 'm')],
        ['Salt per regeneration', fmt(sz.saltPerRegenKg, 1, 'kg')],
      ], true, 7.6);
    }
    if (sz.notes.length) w.bullets(sz.notes, { size: 7.6, color: C.muted });
  };
  for (const it of res.pretreatment.items) {
    w.ensure(62);
    w.gap(3);
    const y = w.y;
    doc.rect(M.left, y, CW, 17).fill('#eef3f8');
    doc.rect(M.left, y, 3, 17).fill(ptColor[it.status] ?? C.grey);
    const name = sanitize(it.name);
    w.font(true, 9, C.navy).text(name, M.left + 9, y + 4.5, { lineBreak: false });
    let px = M.left + 9 + doc.widthOfString(name) + 10;
    px += w.pill(PT_STATUS_LABEL[it.status], ptColor[it.status] ?? C.grey, px, y + 3.5) + 8;
    const extra = `In design: ${yesNo(it.inDesign)}${it.override !== 'auto' ? ` (manual ${it.override})` : ''}${it.dpBar ? `  ·  dP ${fmt(it.dpBar, 2, 'bar')}` : ''}`;
    w.font(!it.inDesign ? false : true, 7.8, it.inDesign ? C.green : C.muted).text(sanitize(extra), px, y + 5, { lineBreak: false });
    w.y = y + 21;
    doc.x = M.left;
    if (it.reason) w.para(it.reason, { size: 8 });
    if (it.basis.length) w.bullets(it.basis, { size: 7.6, color: C.muted });
    if (it.dataRequired.length) w.para(`Data required: ${it.dataRequired.join(', ')}`, { size: 7.8, color: C.red, bold: true });
    sizingLines(it);
  }
  w.sub('Chemical dosing', 80);
  if (!res.dosing.length) w.para('No chemical dosing in the design.', { color: C.muted });
  else {
    const doseStatus = (d: (typeof res.dosing)[number]): Cell =>
      d.doseStatus === 'calculated' ? { text: 'Calculated', color: C.green, bold: true }
        : d.doseStatus === 'supplier' ? { text: 'Supplier', color: C.blue, bold: true }
          : { text: 'INDICATIVE – supplier confirmation required', color: C.amber, bold: true };
    w.table(
      [
        { h: 'Chemical', w: 0.13 }, { h: 'Dosing point', w: 0.13 }, { h: 'Dose mg/L', w: 0.07, align: 'right' }, { h: 'Basis', w: 0.17 },
        { h: 'Dose status', w: 0.13 }, { h: 'Solution L/h', w: 0.08, align: 'right' }, { h: 'Pump L/h', w: 0.08, align: 'right' }, { h: 'Tank L', w: 0.06, align: 'right' },
        { h: 'Product kg/day', w: 0.08, align: 'right' },
      ],
      res.dosing.map((d) => [
        { text: d.chemical, bold: true }, d.dosingPoint, fmt(d.doseMgL, 2), { text: d.doseBasis, color: C.muted }, doseStatus(d),
        fmt(d.solutionLh, 2), fmt(d.pumpCapacityLh, 1), fmt(d.tankSelectedL, 0), fmt(d.productKgDay, 2),
      ]),
      { size: 6.9, pad: 2.5 },
    );
    const dn = res.dosing.flatMap((d) => d.notes.map((n) => `${d.chemical}: ${n}`));
    if (dn.length) w.bullets(dn, { size: 7.6, color: C.muted });
    for (const d of res.dosing) {
      if (!d.steps.length) continue;
      w.ensure(80);
      w.para(`${d.chemical} – calculation steps`, { bold: true, size: 8, color: C.navy });
      w.steps(d.steps, 6.8);
    }
  }

  // ------------------------------------------------------------ 10. Tank sizing
  w.section(10, 'Tank sizing');
  if (!res.tanks.length) w.para('No tanks in the design.', { color: C.muted });
  else {
    w.table(
      [{ h: 'Tank', w: 0.2 }, { h: 'Basis / formula', w: 0.44 }, { h: 'Calculated m³', w: 0.12, align: 'right' }, { h: 'Recommended m³', w: 0.12, align: 'right' }, { h: 'Recommended L', w: 0.12, align: 'right' }],
      res.tanks.map((t) => [{ text: t.name, bold: true }, `${t.basis}${t.formula ? `\n${t.formula}` : ''}`, fmt(t.calculatedM3, 2), { text: fmt(t.recommendedM3, 2), bold: true }, fmt(t.recommendedL, 0)]),
      { size: 7.6 },
    );
    const tn = res.tanks.flatMap((t) => t.notes.map((n) => `${t.name}: ${n}`));
    if (tn.length) w.bullets(tn, { size: 7.6, color: C.muted });
  }

  // ------------------------------------------------------------ 11. Process flow diagram
  if (w.remaining() < pfdLayout(doc, res.pfd.main).total + PFD.legendH + 70) w.newPage();
  w.section(11, 'Process flow diagram');
  w.para('Simplified process schematic generated from the design (not to scale). Equipment sizes shown are the calculated design values.', { size: 7.8, color: C.muted });
  w.gap(4);
  drawPfd(w, res.pfd.main, res.pfd.reject);

  // ------------------------------------------------------------ 12. Electrical load
  w.section(12, 'Electrical load');
  const el = res.electrical;
  w.table(
    [{ h: 'Load', w: 0.28 }, { h: 'Qty', w: 0.06, align: 'right' }, { h: 'Rated kW', w: 0.1, align: 'right' }, { h: 'Absorbed kW', w: 0.11, align: 'right' }, { h: 'h/day', w: 0.08, align: 'right' }, { h: 'Note', w: 0.37 }],
    [
      ...el.loads.map((l): Row => [l.name, String(l.qty), fmt(l.ratedKw, 2), fmt(l.absorbedKw, 2), fmt(l.hoursPerDay, 1), { text: l.note, color: C.muted }]),
      [{ text: 'Total', bold: true }, '', { text: fmt(el.connectedKw, 2), bold: true }, { text: fmt(el.runningKw, 2), bold: true }, '', { text: 'connected / running', color: C.muted }],
    ],
    { size: 7.6 },
  );
  w.kv([
    ['Connected load', fmtPower(el.connectedKw, U)],
    ['Running load', fmtPower(el.runningKw, U)],
    ['Energy per day', fmt(el.energyKwhDay, 1, 'kWh/day')],
    ['Specific energy', fmt(el.specificEnergyKwhM3, 3, 'kWh/m³')],
    ['Full-load current', fmt(el.fullLoadCurrentA, 1, 'A')],
    ['Main incomer', fmt(el.incomerA, 0, 'A')],
  ]);
  w.steps(el.steps);

  // ------------------------------------------------------------ 13. Bill of materials
  w.section(13, 'Bill of materials');
  const bom = res.bom.filter((b) => !b.removed);
  if (!bom.length) w.para('No BOM lines.', { color: C.muted });
  else {
    const cats: string[] = [];
    for (const b of bom) if (!cats.includes(b.category)) cats.push(b.category);
    const rows: Row[] = [];
    let n = 0;
    for (const cat of cats) {
      rows.push({ group: cat });
      for (const b of bom.filter((x) => x.category === cat)) {
        n++;
        rows.push([String(n), { text: b.item, bold: true }, b.description, b.specification, fmt(b.quantity, 2), b.unit, { text: b.notes, color: C.muted }]);
      }
    }
    w.table(
      [{ h: '#', w: 0.04 }, { h: 'Item', w: 0.15 }, { h: 'Description', w: 0.23 }, { h: 'Specification', w: 0.25 }, { h: 'Qty', w: 0.08, align: 'right' }, { h: 'Unit', w: 0.06 }, { h: 'Notes', w: 0.19 }],
      rows,
      { size: 7, pad: 2.5 },
    );
  }

  // ------------------------------------------------------------ 14. Cost estimate
  w.section(14, 'Cost estimate');
  const cost = res.cost;
  if (!cost.enabled) w.para('Cost estimation not enabled for this project.', { color: C.muted });
  else {
    const cur = sanitize(cost.currency || '');
    const money = (v: number) => `${cur} ${fmt(v, 2)}`;
    const catLabel: Record<string, string> = { equipment: 'Equipment', piping: 'Piping', electrical: 'Electrical', instrumentation: 'Instrumentation' };
    w.table(
      [{ h: 'Cost item', w: 0.6 }, { h: `Amount (${cur})`, w: 0.4, align: 'right' }],
      [
        ...Object.entries(cost.byCategory).map(([k, v]): Row => [catLabel[k] ?? k, money(v)]),
        [{ text: 'Subtotal', bold: true }, { text: money(cost.subtotal), bold: true }],
        [`Installation (${fmt(input.costing.installationPct, 1)} %)`, money(cost.installation)],
        [`Engineering (${fmt(input.costing.engineeringPct, 1)} %)`, money(cost.engineering)],
        [`Contingency (${fmt(input.costing.contingencyPct, 1)} %)`, money(cost.contingency)],
        [{ text: 'TOTAL ESTIMATE', bold: true, color: C.navy }, { text: money(cost.total), bold: true, color: C.navy, fill: '#e6f4f4' }],
      ],
      { size: 8.5 },
    );
    if (cost.linesWithoutCost > 0) w.para(`Warning: ${cost.linesWithoutCost} BOM line(s) have no unit cost – the estimate is incomplete.`, { color: C.amber, bold: true });
    w.para('Budgetary estimate only (+/- 30 %). Obtain supplier quotations before commitment.', { size: 7.8, color: C.muted });
  }

  // ------------------------------------------------------------ 15. Assumptions
  w.section(15, 'Assumptions');
  const groups: string[] = [];
  for (const d of ASSUMPTION_DEFS) if (!groups.includes(d.group)) groups.push(d.group);
  const aRows: Row[] = [];
  for (const g of groups) {
    aRows.push({ group: g });
    for (const d of ASSUMPTION_DEFS.filter((x) => x.group === g)) {
      const v = res.assumptionsUsed[d.key] ?? d.default;
      const vt = Array.isArray(v) ? v.map((x) => fmt(x, 3)).join(', ') : fmt(v, 4);
      const changed = JSON.stringify(v) !== JSON.stringify(d.default);
      aRows.push([d.label, { text: vt, bold: changed, color: changed ? C.blue : C.text }, d.unit]);
    }
  }
  w.para('Values shown in blue differ from the global default.', { size: 7.6, color: C.muted });
  w.table([{ h: 'Assumption', w: 0.52 }, { h: 'Value', w: 0.36 }, { h: 'Unit', w: 0.12 }], aRows, { size: 7.2, pad: 2.5 });

  // ------------------------------------------------------------ 16. Warnings
  w.section(16, 'Warnings');
  const lvlTitle: Record<Level, string> = { critical: 'Critical (red) – must be resolved', review: 'Review (amber) – engineering review required', ok: 'Acceptable (green)' };
  if (!res.findings.some((f) => f.level !== 'ok')) w.para('No warnings – all checks are within the acceptable range.', { color: C.green, bold: true });
  for (const lv of ['critical', 'review', 'ok'] as Level[]) {
    const items = res.findings.filter((f) => f.level === lv);
    if (!items.length) continue;
    w.ensure(50);
    w.gap(4);
    const y = w.y;
    doc.rect(M.left, y, CW, 16).fill(LEVEL_COLOR[lv]);
    w.font(true, 8.5, '#ffffff').text(sanitize(`${lvlTitle[lv]}  (${items.length})`), M.left + 8, y + 4.5, { width: CW - 16, lineBreak: false });
    w.y = y + 21;
    doc.x = M.left;
    w.dotList(items.map((f) => ({ level: f.level, text: `[${f.section}] ${f.message}` })), lv === 'ok' ? 7.6 : 8.2);
  }

  // ------------------------------------------------------------ 17. Calculation notes & traceability
  w.section(17, 'Calculation notes & traceability');
  w.para('For each key result the table below shows the inputs substituted into the formula, the assumptions used and the resulting value ("How was this calculated?").', { size: 7.8, color: C.muted });
  const TRACE_TITLE: Record<string, string> = {
    production: 'Production requirement', daily: 'Daily production', recovery: 'Recovery', feed: 'Feed flow', reject: 'Reject flow',
    membranes: 'Number of membranes & array', flux: 'Membrane flux', feedPressure: 'Membrane feed pressure', permeateTds: 'Permeate TDS',
    hpPump: 'High-pressure pump', rawPump: 'Raw water pump', electrical: 'Electrical load', pipes: 'Pipe sizes', osmotic: 'Osmotic pressure',
  };
  for (const [k, steps] of Object.entries(res.trace ?? {})) {
    w.sub(`How was this calculated? – ${TRACE_TITLE[k] ?? k}`, 70);
    w.steps(steps, 6.9, 'Result');
  }

  w.sub('Engineering notes', 60);
  if (proj.notes && proj.notes.trim()) {
    w.para('Project notes:', { bold: true });
    w.para(proj.notes);
  }
  w.para('Required verification before procurement:', { bold: true });
  w.bullets([
    'Verify the raw water analysis with a complete, certified laboratory analysis, including barium, strontium, silica, iron, manganese, TOC and SDI15 measured on site.',
    'Run the membrane manufacturer\'s projection software with the certified analysis and confirm array, flux, pressures and permeate quality.',
    'Confirm antiscalant type and dose with the chemical supplier\'s projection software; INDICATIVE doses are not prescriptions.',
    'Confirm all pump selections against published manufacturer pump curves (duty point, NPSH, efficiency, motor size).',
    'Confirm pipe, fitting and valve pressure ratings against the final pump shut-off pressures.',
    'Electrical design, cable sizing and protection must comply with the local electrical code and utility requirements.',
    'Confirm tank volumes against the actual demand profile and site constraints.',
  ]);
  w.gap(4);
  w.para(DISCLAIMER, { bold: true, color: C.red });
  w.para(`${LABEL_PRELIM} – ${LABEL_VERIFY}`, { bold: true, color: C.red, size: 8 });

  // ------------------------------------------------------------ Headers & footers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = { ...doc.page.margins };
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    // Header
    w.font(true, 8.5, C.navy).text(sanitize(company.name || 'RO System Engineering Calculator'), M.left, 26, { width: CW * 0.48, lineBreak: false, ellipsis: true, height: 11 });
    w.font(false, 7.5, C.muted).text(sanitize(`${proj.name || 'Untitled project'}${proj.reference ? `  ·  Ref. ${proj.reference}` : ''}`), M.left + CW * 0.5, 27, { width: CW * 0.5, align: 'right', lineBreak: false, ellipsis: true, height: 11 });
    doc.moveTo(M.left, 41).lineTo(M.left + CW, 41).lineWidth(0.7).strokeColor(C.teal).stroke();
    // Footer (two lines, fixed positions below the content area)
    const fy = PAGE_H - 42;
    doc.moveTo(M.left, fy - 4).lineTo(M.left + CW, fy - 4).lineWidth(0.5).strokeColor(C.rule).stroke();
    w.font(true, 7, C.red).text(`${LABEL_PRELIM} — not a manufacturer-certified projection`, M.left, fy, { width: CW * 0.78, lineBreak: false, height: 9 });
    w.font(false, 7, C.muted).text(`Page ${i - range.start + 1} of ${range.count}`, M.left + CW * 0.75, fy, { width: CW * 0.25, align: 'right', lineBreak: false, height: 9 });
    w.font(true, 6.2, C.red).text(LABEL_VERIFY, M.left, fy + 10, { width: CW, lineBreak: false, height: 8 });
    doc.page.margins.top = saved.top;
    doc.page.margins.bottom = saved.bottom;
  }

  doc.end();
  return done;
}
