import { describe, expect, it } from 'vitest';
import { defaultAssumptions } from '../src/shared/assumptions';
import { runDesign } from '../src/shared/engine';
import { blankDesign } from '../src/shared/sample';
import { DEFAULT_UNITS } from '../src/shared/units';
import { buildReportPdf } from '../src/server/pdf/report';
import { BW30_400, ctx, sample } from './helpers';

const settings = { assumptions: defaultAssumptions(), units: DEFAULT_UNITS, company: { name: 'Test Engineering', address: '', phone: '', email: '' } };

function pageCount(buf: Buffer) {
  return (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

describe('PDF report', () => {
  it('generates a multi-page report for the 30 m³/h sample', async () => {
    const input = sample();
    input.costing.enabled = true;
    input.bomOverrides.ro_membranes = { unitCost: 450 };
    const result = runDesign(input, ctx());
    const buf = await buildReportPdf({ input, result, membrane: BW30_400, settings });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThanOrEqual(12);
  });

  it('still generates when data is missing (blank design, no membrane)', async () => {
    const input = blankDesign();
    const result = runDesign(input, ctx(null));
    const buf = await buildReportPdf({ input, result, membrane: null, settings });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThanOrEqual(5);
  });
});
