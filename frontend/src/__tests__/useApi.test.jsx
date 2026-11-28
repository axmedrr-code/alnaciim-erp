import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
import client from '../api/client';
import { useApi } from '../components/useApi';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => client.get.mockReset());

describe('useApi', () => {
  it('loads rows', async () => {
    client.get.mockResolvedValue({ data: { data: [{ id: 1 }] } });
    const { result } = renderHook(() => useApi('/x', []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([{ id: 1 }]);
  });

  it('a slower earlier answer does not overwrite the newer filter\'s answer', async () => {
    const slow = deferred(); const fast = deferred();
    client.get.mockImplementation((url) => (url === '/x?pending=1' ? slow.promise : fast.promise));
    const { result, rerender } = renderHook(({ url }) => useApi(url, [url]), { initialProps: { url: '/x?pending=1' } });
    rerender({ url: '/x?mine=1' });
    await act(async () => { fast.resolve({ data: { data: [{ id: 'mine' }] } }); });
    await act(async () => { slow.resolve({ data: { data: [] } }); }); // the old answer arrives last
    expect(result.current.rows).toEqual([{ id: 'mine' }]);
    expect(result.current.loading).toBe(false);
  });

  it('an error from an outdated request is ignored', async () => {
    const slow = deferred(); const fast = deferred();
    client.get.mockImplementation((url) => (url === '/a' ? slow.promise : fast.promise));
    const { result, rerender } = renderHook(({ url }) => useApi(url, [url]), { initialProps: { url: '/a' } });
    rerender({ url: '/b' });
    await act(async () => { fast.resolve({ data: { data: [1] } }); });
    await act(async () => { slow.promise.catch(() => {}); slow.resolve(Promise.reject(new Error('old failure'))); });
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toEqual([1]);
  });
});
