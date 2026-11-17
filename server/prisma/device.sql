CREATE TABLE IF NOT EXISTS "deviceCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceCode" VARCHAR(191) NOT NULL,
    "userCode" VARCHAR(191) NOT NULL,
    "userId" TEXT,
    "clientId" TEXT,
    "scope" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "pollingInterval" INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_deviceCode_key" ON "deviceCode"("deviceCode");
CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_userCode_key" ON "deviceCode"("userCode");
