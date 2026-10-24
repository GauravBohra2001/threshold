-- Allow E.164 phone numbers (optional leading "+") for caregiver_phone.
-- The original check only permitted 10-15 bare digits, which rejected valid
-- E.164 numbers like +16173960097. Applied to the hosted project via the
-- Supabase MCP; recorded here so the repo documents the schema change.
alter table households drop constraint households_caregiver_phone_check;
alter table households add constraint households_caregiver_phone_check
  check (caregiver_phone is null or caregiver_phone ~ '^\+?[0-9]{10,15}$');
