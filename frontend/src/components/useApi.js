import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';

// Small data-fetching hook: GETs `url`, exposes { rows, loading, error, reload }.
// `deps` re-triggers the fetch (e.g. when a filter changes).
export function useApi(url, deps = []) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Only the newest request may write its result: when the filter changes quickly, a slower earlier answer must not
  // overwrite the newer one (the screen would show the old filter's list under the new filter's tab).
  const latest = useRef(0);

  const reload = useCallback(() => {
    const mine = ++latest.current;
    if (!url) { setRows(null); setLoading(false); return; }
    setLoading(true);
    client.get(url)
      .then((res) => { if (mine === latest.current) { setRows(res.data.data); setError(null); } })
      .catch((err) => { if (mine === latest.current) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (mine === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);

  return { rows, loading, error, reload };
}
