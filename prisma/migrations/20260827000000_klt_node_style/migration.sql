-- Per-node display style for ONE set's concept tree.
--
-- Both nullable and both purely cosmetic: a null `color` means "inherit from
-- the nearest ancestor that sets one", a null `icon` means the default glyph.
-- Nothing here participates in placement, rollup or mastery, so existing rows
-- need no backfill and an unrecognised value degrades to the default rather
-- than breaking a render.
--
-- NOTE for whoever regenerates this: `prisma migrate diff` also emits a
-- `DROP INDEX "SetKltNode_ancestorIds_idx"` line. That index is the GIN index
-- hand-added in 20260826000000_klt_per_set, which the Prisma schema cannot
-- express, so the diff reports it as drift on every run. It MUST NOT be
-- included here.
ALTER TABLE "SetKltNode" ADD COLUMN     "color" TEXT,
ADD COLUMN     "icon" TEXT;
