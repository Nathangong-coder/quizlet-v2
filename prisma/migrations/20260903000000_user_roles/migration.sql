-- prisma/migrations/20260903000000_user_roles/migration.sql

-- Every existing row becomes a learner. This migration deliberately does NOT
-- read KLT_EDITORS: `prisma migrate deploy` runs inside `npm run build`, where
-- that variable may be absent, and a grant that silently stamps nobody would
-- lock the operator out with no signal. Use `npm run grant-role` instead.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'learner';

CREATE TABLE "RoleGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoleGrant_userId_createdAt_idx" ON "RoleGrant"("userId", "createdAt");

ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
