-- CreateTable
CREATE TABLE "SyncProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remoteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "revision" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("userId","kind","recordId")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "revision" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("revision")
);

-- CreateTable
CREATE TABLE "SyncMutation" (
    "userId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,

    CONSTRAINT "SyncMutation_pkey" PRIMARY KEY ("userId","mutationId")
);

-- CreateIndex
CREATE INDEX "SyncProject_userId_idx" ON "SyncProject"("userId");

-- CreateIndex
CREATE INDEX "SyncRecord_userId_projectId_idx" ON "SyncRecord"("userId", "projectId");

-- CreateIndex
CREATE INDEX "SyncEvent_userId_projectId_revision_idx" ON "SyncEvent"("userId", "projectId", "revision");
