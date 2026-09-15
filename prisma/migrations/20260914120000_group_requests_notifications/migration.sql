-- Public groups, join requests, owner invitations, and in-app notifications (2026-09-14).
ALTER TABLE "StudyGroup" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
CREATE INDEX "StudyGroup_visibility_createdAt_idx" ON "StudyGroup"("visibility", "createdAt");

CREATE TABLE "StudyGroupJoinRequest" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "StudyGroupJoinRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudyGroupJoinRequest_groupId_userId_key" ON "StudyGroupJoinRequest"("groupId", "userId");
CREATE INDEX "StudyGroupJoinRequest_userId_status_idx" ON "StudyGroupJoinRequest"("userId", "status");
CREATE INDEX "StudyGroupJoinRequest_groupId_status_idx" ON "StudyGroupJoinRequest"("groupId", "status");
ALTER TABLE "StudyGroupJoinRequest" ADD CONSTRAINT "StudyGroupJoinRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyGroupJoinRequest" ADD CONSTRAINT "StudyGroupJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyGroupInvite" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "StudyGroupInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudyGroupInvite_groupId_userId_key" ON "StudyGroupInvite"("groupId", "userId");
CREATE INDEX "StudyGroupInvite_userId_status_idx" ON "StudyGroupInvite"("userId", "status");
CREATE INDEX "StudyGroupInvite_groupId_status_idx" ON "StudyGroupInvite"("groupId", "status");
ALTER TABLE "StudyGroupInvite" ADD CONSTRAINT "StudyGroupInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyGroupInvite" ADD CONSTRAINT "StudyGroupInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyGroupInvite" ADD CONSTRAINT "StudyGroupInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "meta" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
