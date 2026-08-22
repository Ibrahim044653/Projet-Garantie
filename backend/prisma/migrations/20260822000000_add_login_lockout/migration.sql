-- AddColumn: failedLoginAttempts and lockedUntil on User for account lockout
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMPTZ;
