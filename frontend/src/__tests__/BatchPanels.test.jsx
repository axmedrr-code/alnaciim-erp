import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompleteBatchPanel, OutputDecisionPanel } from '../pages/production/BatchPanels';
import { batchState } from '../pages/production/BatchesTab';
import client from '../api/client';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), interceptors: { request: { use() {} }, response: { use() {} } } } }));

const WAREHOUSES = [{ id: 1, name: 'Raw Store', type: 'raw_material', is_active: true }, { id: 2, name: 'FG Store', type: 'finished_goods', is_active: true }];
const BATCH = { id: 7, batch_number: 'B-7', product_id: 11, product_name: 'Bottle 1.5L', machine_name: 'Filler', planned_qty: 20, unit: 'pcs', destination_warehouse_name: 'FG Store' };

beforeEach(() => {
  client.get.mockReset(); client.put.mockReset(); client.post.mockReset();
  client.get.mockImplementation((url) => {
    if (url === '/production/bom') return Promise.resolve({ data: { data: [{ id: 3, product_id: 11, name: 'BOM-1', is_active: true }] } });
    if (url === '/production/bom/3') return Promise.resolve({ data: { data: { items: [{ raw_material_product_id: 5, raw_material_name: 'Preform', unit: 'pcs', quantity_per_unit: 1 }, { raw_material_product_id: 6, raw_material_name: 'Cap', unit: 'pcs', quantity_per_unit: 1 }] } } });
    if (url === '/production/batches/7/materials') return Promise.resolve({ data: { data: [{ product_id: 5, product_name: 'Preform', unit: 'pcs', quantity_used: 20, warehouse_name: 'Raw Store' }] } });
    return Promise.resolve({ data: { data: [] } });
  });
});

describe('Complete batch panel', () => {
  it('previews the BOM deduction for actual + wastage and sends labelled values', async () => {
    const onDone = vi.fn();
    render(<CompleteBatchPanel batch={BATCH} warehouses={WAREHOUSES} onClose={() => {}} onDone={onDone} />);
    await screen.findByLabelText('Materials taken from');
    fireEvent.change(screen.getByLabelText(/Actual quantity produced/), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText(/^Wastage \(/), { target: { value: '2' } });
    expect(await screen.findByRole('table', { name: 'Materials to deduct' })).toHaveTextContent('Preform1 pcs20 pcs');
    fireEvent.change(screen.getByLabelText('Materials taken from'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Passed'));
    client.put.mockResolvedValue({ data: { data: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete batch' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(client.put).toHaveBeenCalledWith('/production/batches/7/complete', expect.objectContaining({ actual_qty: 18, wastage_qty: 2, materials_warehouse_id: 1, qc_status: 'passed' }));
  });

  it('asks for the variance reason only when the actual differs from the plan', async () => {
    render(<CompleteBatchPanel batch={BATCH} warehouses={WAREHOUSES} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/Actual quantity produced/), { target: { value: '20' } });
    expect(screen.queryByLabelText(/different from the plan/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Actual quantity produced/), { target: { value: '19' } });
    expect(screen.getByLabelText(/different from the plan/)).toBeInTheDocument();
  });

  it('requires a materials warehouse and a QC result, with a clear message, before calling the server', async () => {
    render(<CompleteBatchPanel batch={BATCH} warehouses={WAREHOUSES} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/Actual quantity produced/), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('raw-material warehouse');
    fireEvent.change(screen.getByLabelText('Materials taken from'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete batch' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('QC result'));
    expect(client.put).not.toHaveBeenCalled();
  });

  it('explains and blocks a batch with no output product or no BOM', async () => {
    const { unmount } = render(<CompleteBatchPanel batch={{ ...BATCH, product_id: null, product_name: null }} warehouses={WAREHOUSES} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/no Output Product/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete batch' })).toBeDisabled();
    unmount();
    render(<CompleteBatchPanel batch={{ ...BATCH, product_id: 99 }} warehouses={WAREHOUSES} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/no active Bill of Materials/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete batch' })).toBeDisabled();
  });

  it('shows the full server message when the server refuses', async () => {
    client.put.mockRejectedValue({ response: { data: { error: 'Production output must use an active finished-good product and active finished-goods warehouse' } } });
    render(<CompleteBatchPanel batch={BATCH} warehouses={WAREHOUSES} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/Actual quantity produced/), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Materials taken from'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete batch' }));
    expect(await screen.findByText('Production output must use an active finished-good product and active finished-goods warehouse')).toBeInTheDocument();
  });
});

describe('Output decision panel', () => {
  const DONE = { ...BATCH, status: 'completed', actual_qty: 18, wastage_qty: 2, wastage_notes: 'cracked', completed_by: 4, completed_by_name: 'Manager One' };

  it('shows what is being approved and needs a reason; no browser prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    const onDone = vi.fn();
    render(<OutputDecisionPanel batch={DONE} me={{ id: 9, role: 'Production Manager' }} onClose={() => {}} onDone={onDone} />);
    expect(screen.getByText('18 pcs (planned 20)')).toBeInTheDocument();
    expect(screen.getByText('Manager One')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Materials used' })).toHaveTextContent('Preform');
    fireEvent.click(screen.getByRole('button', { name: /Approve into stock/ }));
    expect(await screen.findByText(/at least 3 characters/)).toBeInTheDocument();
    client.post.mockResolvedValue({ data: { data: {} } });
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'pallet counted' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject output/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(client.post).toHaveBeenCalledWith('/production/batches/7/output-decision', { decision: 'reject', reason: 'pallet counted' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('the manager who completed the batch cannot decide it', () => {
    render(<OutputDecisionPanel batch={DONE} me={{ id: 4, role: 'Production Manager' }} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/another Production Manager must decide/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve into stock/ })).not.toBeInTheDocument();
  });
});

describe('batch state label', () => {
  it('turns status, QC and approval into one plain label', () => {
    expect(batchState({ status: 'planned' })[0]).toBe('Planned');
    expect(batchState({ status: 'completed', qc_status: 'failed' })[0]).toBe('QC failed, no stock');
    expect(batchState({ status: 'completed', qc_status: 'passed', output_approval_status: 'pending' })[0]).toBe('Awaiting approval');
    expect(batchState({ status: 'completed', qc_status: 'passed', output_approval_status: 'approved' })[0]).toBe('In stock');
    expect(batchState({ status: 'completed', qc_status: 'passed', output_approval_status: 'rejected' })[0]).toBe('Output rejected');
  });
});
