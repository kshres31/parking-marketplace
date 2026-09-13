-- The original multi-column duration check is named booking_check by PostgreSQL.
-- Compare elapsed time instead of adding calendar days in the session timezone.
ALTER TABLE booking DROP CONSTRAINT booking_check;
ALTER TABLE booking ADD CONSTRAINT booking_duration
    CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '720 hours');
