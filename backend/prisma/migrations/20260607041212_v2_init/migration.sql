-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('WAITING', 'PLAYING', 'ENDED');

-- CreateEnum
CREATE TYPE "TaskDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXTREME');

-- CreateEnum
CREATE TYPE "PlayerTaskStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CHALLENGED');

-- CreateEnum
CREATE TYPE "ConfirmStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('HIT', 'MISS');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('COMPLETED', 'CHALLENGED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('DECLARE_COMPLETE');

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'WAITING',
    "playerCount" INTEGER NOT NULL DEFAULT 6,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3) NOT NULL,
    "teamRewards" JSONB NOT NULL DEFAULT '[]',
    "teamPunishments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatar" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "isBottom2" BOOLEAN NOT NULL DEFAULT false,
    "votedEnd" BOOLEAN NOT NULL DEFAULT false,
    "refreshChances" INTEGER NOT NULL DEFAULT 3,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "tasksDenied" INTEGER NOT NULL DEFAULT 0,
    "challengesMade" INTEGER NOT NULL DEFAULT 0,
    "challengesSucceeded" INTEGER NOT NULL DEFAULT 0,
    "challengesReceived" INTEGER NOT NULL DEFAULT 0,
    "challengesHit" INTEGER NOT NULL DEFAULT 0,
    "timesTargeted" INTEGER NOT NULL DEFAULT 0,
    "punishmentsReceived" INTEGER NOT NULL DEFAULT 0,
    "extremeTasksDrawn" INTEGER NOT NULL DEFAULT 0,
    "totalTasksDrawn" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_tasks" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "difficulty" "TaskDifficulty" NOT NULL,
    "points" INTEGER NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'BEHAVIOR',
    "primaryTargetId" TEXT NOT NULL,
    "primaryTargetName" TEXT NOT NULL,
    "secondaryTargetIds" JSONB NOT NULL DEFAULT '[]',
    "secondaryTargetNames" JSONB NOT NULL DEFAULT '[]',
    "punishmentContent" TEXT NOT NULL,
    "status" "PlayerTaskStatus" NOT NULL DEFAULT 'ACTIVE',
    "declaredAt" TIMESTAMP(3),
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "player_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declare_completions" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "declarerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "taskContent" TEXT NOT NULL,
    "punishmentContent" TEXT NOT NULL,
    "status" "ConfirmStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declare_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "challengedId" TEXT NOT NULL,
    "guessContent" TEXT NOT NULL,
    "status" "ChallengeStatus" NOT NULL,
    "similarityScore" DOUBLE PRECISION,
    "hitTaskId" TEXT,
    "hitTaskContent" TEXT,
    "hitPunishmentContent" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_tips" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anonymous_tips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_messages" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" "MessageType" NOT NULL,
    "relatedId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isHandled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "pending_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_library" (
    "id" TEXT NOT NULL,
    "difficulty" "TaskDifficulty" NOT NULL,
    "content" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'BEHAVIOR',

    CONSTRAINT "task_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punishment_library" (
    "id" TEXT NOT NULL,
    "difficulty" "TaskDifficulty" NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "punishment_library_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "games_code_key" ON "games"("code");

-- CreateIndex
CREATE UNIQUE INDEX "players_gameId_openId_key" ON "players"("gameId", "openId");

-- CreateIndex
CREATE UNIQUE INDEX "declare_completions_taskId_key" ON "declare_completions"("taskId");

-- CreateIndex
CREATE INDEX "task_library_difficulty_idx" ON "task_library"("difficulty");

-- CreateIndex
CREATE INDEX "punishment_library_difficulty_idx" ON "punishment_library"("difficulty");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_tasks" ADD CONSTRAINT "player_tasks_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declare_completions" ADD CONSTRAINT "declare_completions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "player_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declare_completions" ADD CONSTRAINT "declare_completions_declarerId_fkey" FOREIGN KEY ("declarerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declare_completions" ADD CONSTRAINT "declare_completions_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challengedId_fkey" FOREIGN KEY ("challengedId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_hitTaskId_fkey" FOREIGN KEY ("hitTaskId") REFERENCES "player_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymous_tips" ADD CONSTRAINT "anonymous_tips_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_messages" ADD CONSTRAINT "pending_messages_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
