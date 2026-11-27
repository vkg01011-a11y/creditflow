CREATE TYPE "WorkerRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "WorkerRun" (
    "id" TEXT NOT NULL,
    "status" "WorkerRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerRun_startedAt_idx"
ON "WorkerRun"("startedAt" DESC);

CREATE INDEX "WorkerRun_status_startedAt_idx"
ON "WorkerRun"("status", "startedAt" DESC);
