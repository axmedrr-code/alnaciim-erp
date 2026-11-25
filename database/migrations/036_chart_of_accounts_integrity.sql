-- Prevent cycles in the chart-of-accounts hierarchy, including concurrent
-- re-parenting requests. The advisory transaction lock serializes hierarchy edits.
CREATE OR REPLACE FUNCTION prevent_chart_account_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE creates_cycle BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
            RETURN NEW;
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(704301, 36);

    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'An account cannot be its own parent' USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE descendants(id) AS (
        SELECT id FROM chart_of_accounts WHERE parent_id = NEW.id
        UNION
        SELECT account.id FROM chart_of_accounts account JOIN descendants d ON account.parent_id = d.id
    )
    SELECT EXISTS (SELECT 1 FROM descendants WHERE id = NEW.parent_id) INTO creates_cycle;

    IF creates_cycle THEN
        RAISE EXCEPTION 'An account cannot use one of its descendants as its parent' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chart_account_parent_cycle
    BEFORE INSERT OR UPDATE OF parent_id ON chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION prevent_chart_account_parent_cycle();

-- System accounts underpin automatic postings and must remain active.
CREATE OR REPLACE FUNCTION prevent_system_account_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_system AND OLD.is_active AND NOT NEW.is_active THEN
        RAISE EXCEPTION 'System accounts cannot be deactivated' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_system_account_active
    BEFORE UPDATE OF is_active ON chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION prevent_system_account_deactivation();
