-- CreateTable
CREATE TABLE "DemoTicket" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'demo',
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedAt" TIMESTAMP(3),
    "inviteCode" TEXT,

    CONSTRAINT "InviteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoTicket_ipHash_feature_createdAt_idx" ON "DemoTicket"("ipHash", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "DemoTicket_createdAt_idx" ON "DemoTicket"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoTicket_guestId_feature_key" ON "DemoTicket"("guestId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "InviteRequest_email_key" ON "InviteRequest"("email");

-- CreateIndex
CREATE INDEX "InviteRequest_invitedAt_createdAt_idx" ON "InviteRequest"("invitedAt", "createdAt");
