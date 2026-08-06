-- =====================================================================
-- HNO COMMA CLEANUP
--
-- HNO is the permanent, physical tank number stamped on the customer's
-- drum — a plain number (7739), never formatted with thousand separators.
-- The original bulk import parsed Excel cells with raw:false, which
-- rendered numeric-formatted cells with their display grouping intact
-- (e.g. "14,054" instead of "14054"), so a large share of already-imported
-- customers ended up with a comma baked into their stored HNO. That import
-- bug is fixed going forward (imports.routes.js strips commas/whitespace
-- before validating or writing HNO); this is the one-time backfill for
-- rows already written with the bug.
--
-- Only touches values that are purely digits/commas/whitespace — legacy
-- non-numeric HNOs (the original HNO-C-##### sequence-generated customers,
-- and any other hand-entered exception) are left completely untouched.
-- =====================================================================

UPDATE customers
SET hno = regexp_replace(hno, '[,\s]', '', 'g')
WHERE hno ~ '^[0-9,\s]+$'
  AND hno <> regexp_replace(hno, '[,\s]', '', 'g');
