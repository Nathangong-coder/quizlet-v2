-- Text blocks keep inline formatting as structured JSON ranges so the raw text
-- remains safe for search and AI prompts.
ALTER TABLE "CardContentBlock" ADD COLUMN "marks" JSONB;
