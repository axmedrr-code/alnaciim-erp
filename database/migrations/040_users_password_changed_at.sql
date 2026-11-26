-- Tokens issued before this moment are rejected (set whenever a password is changed or reset).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
