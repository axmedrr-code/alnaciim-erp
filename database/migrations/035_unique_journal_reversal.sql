-- A posted journal entry can be reversed at most once. Fail safely with a clear
-- migration error if historical data already contains conflicting reversals.
DO $$
BEGIN
    IF EXISTS (
        SELECT reverses_entry_id
        FROM journal_entries
        WHERE reverses_entry_id IS NOT NULL
        GROUP BY reverses_entry_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce unique journal reversals: duplicate reverses_entry_id values exist';
    END IF;
END $$;

CREATE UNIQUE INDEX uq_journal_entries_single_reversal
    ON journal_entries(reverses_entry_id)
    WHERE reverses_entry_id IS NOT NULL;
