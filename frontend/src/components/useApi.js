import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';

// Small data-fetching hook: GETs `url`, exposes { rows, loading, error, reload }.
// `deps` re-triggers the fetch (e.g. when a filter changes).
export function useApi(url, deps = []) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!url) { setRows(null); setLoading(false); return; }
    setLoading(true);
    client.get(url)
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);

  return { rows, loading, error, reload };
}
