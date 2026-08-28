-- Public sets, fork attribution, recents and moderation.
--
-- `visibility` is NOT altered here. It is already a TEXT column with a
-- 'private' default; adding 'public' to SET_VISIBILITIES is a change to the
-- application's vocabulary, not to the column. Existing rows are untouched and
-- no set becomes public as a result of this migration — which is the point:
-- collapsing `link` into `public` would publish every already-shared set on
-- deploy (spec §3).
ALTER TABLE "Set" ADD COLUMN "listingBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "forkedFromId" TEXT,
ADD COLUMN "forkedFromTitle" TEXT,
ADD COLUMN "forkedFromHandle" TEXT;

CREATE TABLE "SetView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SetReport" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SetView_userId_setId_key" ON "SetView"("userId", "setId");
CREATE INDEX "SetView_userId_viewedAt_idx" ON "SetView"("userId", "viewedAt");
CREATE UNIQUE INDEX "SetReport_setId_reporterId_key" ON "SetReport"("setId", "reporterId");
CREATE INDEX "SetReport_status_createdAt_idx" ON "SetReport"("status", "createdAt");
CREATE INDEX "Set_visibility_listingBlocked_publishedAt_idx" ON "Set"("visibility", "listingBlocked", "publishedAt");
CREATE INDEX "Set_forkedFromId_idx" ON "Set"("forkedFromId");

ALTER TABLE "SetView" ADD CONSTRAINT "SetView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetView" ADD CONSTRAINT "SetView_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetReport" ADD CONSTRAINT "SetReport_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetReport" ADD CONSTRAINT "SetReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Set" ADD CONSTRAINT "Set_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
