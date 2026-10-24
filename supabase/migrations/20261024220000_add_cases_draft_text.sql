-- Persist the full Case Agent draft so the approval screen can show it verbatim
-- and editable, rather than reconstructing it from trace summaries.
alter table cases add column if not exists draft_text text;
