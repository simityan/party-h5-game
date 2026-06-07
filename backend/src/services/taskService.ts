import prisma from '../utils/prisma';
import { updateBottom2Status, AppError } from '../utils/helpers';
import { distance } from 'fastest-levenshtein';
import type { TaskDifficulty } from '../generated/prisma/enums';

// ============================================
// 常量
// ============================================

// 积分映射
const POINTS_MAP: Record<string, number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
  EXTREME: 5,
};

// V2 难度对应次要目标数量（-1 = 全员次要目标）
const SECONDARY_TARGET_COUNT: Record<string, number> = {
  EASY: 0,
  MEDIUM: 1,
  HARD: 3,
  EXTREME: -1,
};

// 文本相似度阈值
const SIMILARITY_THRESHOLD = 0.75;

// 短文本阈值（≤5字符时使用编辑距离判定）
const SHORT_TEXT_MAX_LENGTH = 5;
const SHORT_TEXT_MAX_DISTANCE = 1;

// 模板前缀列表（最长优先，用于去除任务内容中的模板词）
const TEMPLATE_PREFIXES = [
  '让目标玩家及所有次要目标',
  '让目标玩家及次要目标',
  '让目标玩家及',
  '让目标玩家',
  '让次要目标',
  '对目标玩家',
  '在目标玩家',
  '让所有人',
];

// ============================================
// 文本相似度工具函数
// ============================================

/** 去除任务内容中的模板前缀（最长匹配优先） */
function stripTemplatePrefix(text: string): string {
  for (const prefix of TEMPLATE_PREFIXES) {
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length).trim();
    }
  }
  return text.trim();
}

/** 计算两个文本的相似度（Levenshtein 距离 + 归一化） */
function calculateSimilarity(
  text1: string,
  text2: string,
): { similarity: number; editDistance: number } {
  const clean1 = stripTemplatePrefix(text1);
  const clean2 = stripTemplatePrefix(text2);

  const editDist = distance(clean1, clean2);
  const maxLen = Math.max(clean1.length, clean2.length);

  if (maxLen === 0) return { similarity: 1, editDistance: 0 };

  const similarity = 1 - editDist / maxLen;
  return { similarity, editDistance: editDist };
}

/** 判断猜测是否命中任务（V2 自动匹配） */
function isHit(
  guessContent: string,
  taskContent: string,
): { hit: boolean; similarity: number } {
  const clean1 = stripTemplatePrefix(guessContent);
  const clean2 = stripTemplatePrefix(taskContent);

  const editDist = distance(clean1, clean2);
  const maxLen = Math.max(clean1.length, clean2.length);
  const minLen = Math.min(clean1.length, clean2.length);

  if (maxLen === 0) return { hit: true, similarity: 1 };

  const similarity = 1 - editDist / maxLen;

  // 短文本特殊处理：较短文本 ≤5 字符时，允许 1 个编辑距离
  if (minLen <= SHORT_TEXT_MAX_LENGTH && editDist <= SHORT_TEXT_MAX_DISTANCE) {
    return { hit: true, similarity };
  }

  return { hit: similarity >= SIMILARITY_THRESHOLD, similarity };
}

// ============================================
// V2 目标分配（按难度决定目标数量）
// Easy: 1主目标; Medium: 1主+1次; Hard: 1主+3次; Extreme: 1主+全员次
// ============================================
function assignTargets(
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME',
  otherPlayers: { id: string; nickname: string }[],
): {
  primaryTarget: { id: string; nickname: string };
  secondaryTargets: { id: string; nickname: string }[];
} {
  if (otherPlayers.length === 0) {
    throw new AppError(500, '没有其他玩家可指定为目标');
  }

  // 随机选择主目标
  const primaryIndex = Math.floor(Math.random() * otherPlayers.length);
  const primaryTarget = otherPlayers[primaryIndex];

  // 剩余玩家（排除主目标）作为次要目标候选
  const remainingPlayers = otherPlayers.filter((_, i) => i !== primaryIndex);

  let secondaryTargets: { id: string; nickname: string }[] = [];
  const secondaryCount = SECONDARY_TARGET_COUNT[difficulty];

  if (secondaryCount === -1) {
    // Extreme: 全员次要目标
    secondaryTargets = [...remainingPlayers];
  } else if (secondaryCount > 0) {
    // Medium/Hard: 随机选择指定数量
    const shuffled = [...remainingPlayers].sort(() => Math.random() - 0.5);
    secondaryTargets = shuffled.slice(0, Math.min(secondaryCount, remainingPlayers.length));
  }

  return { primaryTarget, secondaryTargets };
}

// ============================================
// 为单个任务绑定惩罚（从惩罚库随机抽取同难度）
// ============================================
async function bindPunishment(difficulty: TaskDifficulty): Promise<string> {
  const punishmentCount = await prisma.punishmentLibrary.count({
    where: { difficulty },
  });

  if (punishmentCount === 0) return '做10个深蹲';

  const pSkip = Math.floor(Math.random() * punishmentCount);
  const punishment = await prisma.punishmentLibrary.findFirst({
    where: { difficulty },
    skip: pSkip,
  });
  return punishment?.content ?? '做10个深蹲';
}

// ============================================
// 获取本局已使用的任务内容集合（V2 共享卡池）
// 已完成 + 已被质疑的 不再出现
// ============================================
async function getUsedContentSet(gameId: string): Promise<Set<string>> {
  const existingTasks = await prisma.playerTask.findMany({
    where: {
      gameId,
      status: { in: ['COMPLETED', 'CHALLENGED'] },
    },
    select: { content: true },
  });
  return new Set(existingTasks.map((t) => t.content));
}

// ============================================
// 为玩家抽取3个任务（V2: 共享卡池 + 难度决定目标）
// ============================================
export async function drawTasksForPlayer(
  playerId: string,
  gameId: string,
  allPlayers: { id: string; nickname: string }[],
) {
  const difficulties: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
  const otherPlayers = allPlayers.filter((p) => p.id !== playerId);
  let extremeCount = 0;

  // V2: 共享卡池 — 已完成或被质疑的任务不再出现
  const usedContentSet = await getUsedContentSet(gameId);

  for (const difficulty of difficulties) {
    // HARD 难度有 20% 概率变成 EXTREME
    let actualDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME' = difficulty;
    if (difficulty === 'HARD' && Math.random() < 0.2) {
      actualDifficulty = 'EXTREME';
      extremeCount++;
    }

    // V2: 排除已使用的内容
    const usedContentArray = [...usedContentSet];
    const whereClause = usedContentArray.length > 0
      ? { difficulty: actualDifficulty, content: { notIn: usedContentArray } }
      : { difficulty: actualDifficulty };

    const taskCount = await prisma.taskLibrary.count({ where: whereClause });

    let task;
    if (taskCount === 0) {
      // 排除后无可用任务，回退到全量（避免卡死）
      const fallbackCount = await prisma.taskLibrary.count({
        where: { difficulty: actualDifficulty },
      });
      if (fallbackCount === 0) continue;
      const skip = Math.floor(Math.random() * fallbackCount);
      task = await prisma.taskLibrary.findFirst({
        where: { difficulty: actualDifficulty },
        skip,
      });
    } else {
      const skip = Math.floor(Math.random() * taskCount);
      task = await prisma.taskLibrary.findFirst({ where: whereClause, skip });
    }

    if (!task) continue;

    // 加入已使用集合，防止后续玩家抽到同一任务
    usedContentSet.add(task.content);

    // 绑定惩罚
    const punishmentContent = await bindPunishment(actualDifficulty);

    // V2: 按难度分配目标
    const { primaryTarget, secondaryTargets } = assignTargets(actualDifficulty, otherPlayers);

    // 创建玩家手牌
    const playerTask = await prisma.playerTask.create({
      data: {
        playerId,
        gameId,
        content: task.content,
        difficulty: actualDifficulty,
        points: POINTS_MAP[actualDifficulty],
        taskType: task.taskType,
        primaryTargetId: primaryTarget.id,
        primaryTargetName: primaryTarget.nickname,
        secondaryTargetIds: secondaryTargets.map((t) => t.id),
        secondaryTargetNames: secondaryTargets.map((t) => t.nickname),
        punishmentContent,
      },
    });

    // 创建匿名爆料
    await prisma.anonymousTip.create({
      data: {
        gameId,
        content: `🔍 有人正在策划：「${task.content}」`,
        sourceTaskId: playerTask.id,
        isActive: true,
      },
    });
  }

  // 更新玩家统计
  const tasksDrawn = await prisma.playerTask.count({
    where: { playerId, gameId },
  });
  await prisma.player.update({
    where: { id: playerId },
    data: {
      totalTasksDrawn: tasksDrawn,
      extremeTasksDrawn: extremeCount,
    },
  });
}

// ============================================
// 声明完成（V2: targetId 来自任务的 primaryTargetId）
// ============================================
export async function declareComplete(
  playerId: string,
  data: { taskId: string },
) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

  // 检查游戏状态
  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
  });
  if (!game || game.status !== 'PLAYING') {
    throw new AppError(400, '游戏不在进行中');
  }

  // 检查任务归属和状态
  const task = await prisma.playerTask.findUnique({
    where: { id: data.taskId },
  });
  if (!task) throw new AppError(404, '任务不存在');
  if (task.playerId !== playerId) throw new AppError(403, '这不是你的任务');
  if (task.status !== 'ACTIVE') throw new AppError(400, '该任务已无法声明完成');

  // 检查是否已声明（一条任务只能声明一次）
  const existingDeclare = await prisma.declareComplete.findUnique({
    where: { taskId: data.taskId },
  });
  if (existingDeclare) throw new AppError(400, '该任务已声明完成，不能重复声明');

  // V2: targetId 来自任务的 primaryTargetId（不再由用户选择）
  const targetId = task.primaryTargetId;

  // 防御性校验：主目标不应是自己
  if (targetId === playerId) {
    throw new AppError(400, '任务目标异常，不能指定自己为目标');
  }

  // 检查目标玩家是否在同一游戏中
  const target = await prisma.player.findUnique({
    where: { id: targetId },
  });
  if (!target || target.gameId !== player.gameId) {
    throw new AppError(400, '目标玩家不在同一游戏中');
  }

  // 创建声明完成记录
  const declare = await prisma.declareComplete.create({
    data: {
      gameId: player.gameId,
      taskId: data.taskId,
      declarerId: playerId,
      targetId,
      taskContent: task.content,
      punishmentContent: task.punishmentContent,
      status: 'PENDING',
    },
    include: { declarer: true, target: true },
  });

  // 更新任务声明时间
  await prisma.playerTask.update({
    where: { id: data.taskId },
    data: { declaredAt: new Date() },
  });

  // 给目标方发送待处理消息
  await prisma.pendingMessage.create({
    data: {
      playerId: targetId,
      gameId: player.gameId,
      type: 'DECLARE_COMPLETE',
      relatedId: declare.id,
      content: {
        declarerNickname: declare.declarer.nickname,
        targetNickname: declare.target.nickname,
        taskContent: declare.taskContent,
        punishmentContent: declare.punishmentContent,
      },
    },
  });

  return {
    id: declare.id,
    declarerId: declare.declarerId,
    declarerNickname: declare.declarer.nickname,
    targetId: declare.targetId,
    targetNickname: declare.target.nickname,
    taskContent: declare.taskContent,
    punishmentContent: declare.punishmentContent,
    status: declare.status,
  };
}

// ============================================
// 确认/否认声明完成（V2: 否认触发质疑流程）
// ============================================
export async function confirmDeclare(
  playerId: string,
  data: { declareId: string; confirmed: boolean },
) {
  const declare = await prisma.declareComplete.findUnique({
    where: { id: data.declareId },
    include: { task: true },
  });

  if (!declare) throw new AppError(404, '声明记录不存在');
  if (declare.status !== 'PENDING') throw new AppError(400, '该声明已处理');
  if (declare.targetId !== playerId) {
    throw new AppError(403, '只有目标方才能确认/否认');
  }

  if (data.confirmed) {
    // ======= 目标方确认 → 声明方得分 =======

    await prisma.$transaction(async (tx) => {
      // 更新声明状态
      await tx.declareComplete.update({
        where: { id: data.declareId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });

      // 更新任务状态为已完成
      await tx.playerTask.update({
        where: { id: declare.taskId },
        data: { status: 'COMPLETED' },
      });

      // 声明方加分
      const points = declare.task.points;
      await tx.player.update({
        where: { id: declare.declarerId },
        data: {
          score: { increment: points },
          tasksCompleted: { increment: 1 },
        },
      });

      // 目标方统计
      await tx.player.update({
        where: { id: declare.targetId },
        data: { timesTargeted: { increment: 1 } },
      });

      // 创建动态流事件
      const declarer = await tx.player.findUnique({ where: { id: declare.declarerId } });
      const target = await tx.player.findUnique({ where: { id: declare.targetId } });
      await tx.gameEvent.create({
        data: {
          gameId: declare.gameId,
          type: 'COMPLETED',
          content: {
            declarerNickname: declarer?.nickname,
            targetNickname: target?.nickname,
            taskContent: declare.taskContent,
            punishmentContent: declare.punishmentContent,
          },
        },
      });

      // 移除对应匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: declare.taskId },
        data: { isActive: false },
      });

      // 标记待处理消息为已处理
      await tx.pendingMessage.updateMany({
        where: { relatedId: data.declareId, type: 'DECLARE_COMPLETE' },
        data: { isHandled: true, handledAt: new Date() },
      });
    });

    // V2: 检查声明方是否所有任务都已 resolve → 是则 +3 刷新次数
    await checkAndAwardRefreshOnAllResolved(declare.declarerId, declare.gameId);

    await updateBottom2Status(declare.gameId);
  } else {
    // ======= V2: 目标方否认 → 触发质疑流程 =======
    // 否认 = 执行者（声明方）接受惩罚，任务标记 CHALLENGED，双方各 +1 刷新次数

    await prisma.$transaction(async (tx) => {
      // 更新声明状态
      await tx.declareComplete.update({
        where: { id: data.declareId },
        data: { status: 'DENIED', confirmedAt: new Date() },
      });

      // V2: 任务标记为 CHALLENGED（否认视为质疑命中）
      await tx.playerTask.update({
        where: { id: declare.taskId },
        data: { status: 'CHALLENGED', removedAt: new Date() },
      });

      // 声明方统计 + 刷新
      await tx.player.update({
        where: { id: declare.declarerId },
        data: {
          tasksDenied: { increment: 1 },
          punishmentsReceived: { increment: 1 },
          refreshChances: { increment: 1 }, // V2: 否认双方各 +1 刷新
        },
      });

      // 目标方统计 + 刷新
      await tx.player.update({
        where: { id: declare.targetId },
        data: {
          refreshChances: { increment: 1 }, // V2: 否认双方各 +1 刷新
        },
      });

      // 创建动态流事件（标记为否认触发）
      const declarer = await tx.player.findUnique({ where: { id: declare.declarerId } });
      const target = await tx.player.findUnique({ where: { id: declare.targetId } });
      await tx.gameEvent.create({
        data: {
          gameId: declare.gameId,
          type: 'CHALLENGED',
          content: {
            declarerNickname: declarer?.nickname,
            targetNickname: target?.nickname,
            taskContent: declare.taskContent,
            punishmentContent: declare.punishmentContent,
            denialTriggered: true, // V2 标记：由否认触发
          },
        },
      });

      // 移除对应匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: declare.taskId },
        data: { isActive: false },
      });

      // 标记待处理消息为已处理
      await tx.pendingMessage.updateMany({
        where: { relatedId: data.declareId, type: 'DECLARE_COMPLETE' },
        data: { isHandled: true, handledAt: new Date() },
      });
    });

    // V2: 检查声明方是否所有任务都已 resolve
    await checkAndAwardRefreshOnAllResolved(declare.declarerId, declare.gameId);

    await updateBottom2Status(declare.gameId);
  }

  return { success: true };
}

// ============================================
// V2: 检查玩家是否所有任务都已 resolve → 是则 +3 刷新次数
// ============================================
async function checkAndAwardRefreshOnAllResolved(playerId: string, gameId: string) {
  const activeCount = await prisma.playerTask.count({
    where: { playerId, gameId, status: 'ACTIVE' },
  });
  if (activeCount === 0) {
    await prisma.player.update({
      where: { id: playerId },
      data: { refreshChances: { increment: 3 } },
    });
  }
}

// ============================================
// 发起质疑（V2: 自动匹配，立即返回结果）
// ============================================
export async function challenge(
  playerId: string,
  data: { challengedId: string; guessContent: string },
) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

  // 检查游戏状态
  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
  });
  if (!game || game.status !== 'PLAYING') {
    throw new AppError(400, '游戏不在进行中');
  }

  // 不能质疑自己
  if (data.challengedId === playerId) {
    throw new AppError(400, '不能质疑自己');
  }

  // 检查被质疑玩家是否在同一游戏中
  const challenged = await prisma.player.findUnique({
    where: { id: data.challengedId },
  });
  if (!challenged || challenged.gameId !== player.gameId) {
    throw new AppError(400, '被质疑玩家不在同一游戏中');
  }

  // V2: 获取被质疑方的所有 ACTIVE 任务
  const challengedActiveTasks = await prisma.playerTask.findMany({
    where: {
      playerId: data.challengedId,
      gameId: player.gameId,
      status: 'ACTIVE',
    },
  });

  if (challengedActiveTasks.length === 0) {
    throw new AppError(400, '该玩家没有可被质疑的任务');
  }

  // V2: 自动匹配 — 遍历所有 ACTIVE 任务，找到最相似的命中
  let bestMatch: {
    task: (typeof challengedActiveTasks)[number];
    similarity: number;
  } | null = null;

  for (const task of challengedActiveTasks) {
    const result = isHit(data.guessContent, task.content);
    if (result.hit && (!bestMatch || result.similarity > bestMatch.similarity)) {
      bestMatch = { task, similarity: result.similarity };
    }
  }

  const isHitResult = bestMatch !== null;

  // 创建质疑记录（V2: 创建时即确定结果，不再需要手动确认）
  const challengeRecord = await prisma.$transaction(async (tx) => {
    const record = await tx.challenge.create({
      data: {
        gameId: player.gameId,
        challengerId: playerId,
        challengedId: data.challengedId,
        guessContent: data.guessContent,
        status: isHitResult ? 'HIT' : 'MISS',
        similarityScore: bestMatch?.similarity ?? null,
        hitTaskId: bestMatch?.task.id ?? null,
        hitTaskContent: bestMatch?.task.content ?? null,
        hitPunishmentContent: bestMatch?.task.punishmentContent ?? null,
        resolvedAt: new Date(),
      },
      include: { challenger: true, challenged: true },
    });

    // 更新发起方统计
    await tx.player.update({
      where: { id: playerId },
      data: { challengesMade: { increment: 1 } },
    });

    // 更新被质疑方统计
    await tx.player.update({
      where: { id: data.challengedId },
      data: { challengesReceived: { increment: 1 } },
    });

    if (isHitResult && bestMatch) {
      // ======= 质疑命中 =======

      // 更新被命中任务状态
      await tx.playerTask.update({
        where: { id: bestMatch.task.id },
        data: { status: 'CHALLENGED', removedAt: new Date() },
      });

      // 质疑方得分
      await tx.player.update({
        where: { id: playerId },
        data: {
          score: { increment: bestMatch.task.points },
          challengesSucceeded: { increment: 1 },
        },
      });

      // 被质疑方统计
      await tx.player.update({
        where: { id: data.challengedId },
        data: {
          challengesHit: { increment: 1 },
          punishmentsReceived: { increment: 1 },
        },
      });

      // 创建动态流事件
      await tx.gameEvent.create({
        data: {
          gameId: player.gameId,
          type: 'CHALLENGED',
          content: {
            challengerNickname: record.challenger.nickname,
            challengedNickname: record.challenged.nickname,
            taskContent: bestMatch.task.content,
            punishmentContent: bestMatch.task.punishmentContent,
          },
        },
      });

      // 移除对应匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: bestMatch.task.id },
        data: { isActive: false },
      });
    }
    // V2: 质疑不再发送待处理消息（自动判定，无 PENDING 状态）

    return record;
  });

  // 更新后2名状态
  await updateBottom2Status(player.gameId);

  // V2: 命中时检查被质疑方是否所有任务都已 resolve
  if (isHitResult) {
    await checkAndAwardRefreshOnAllResolved(data.challengedId, player.gameId);
  }

  return {
    id: challengeRecord.id,
    challengerId: challengeRecord.challengerId,
    challengerNickname: challengeRecord.challenger.nickname,
    challengedId: challengeRecord.challengedId,
    challengedNickname: challengeRecord.challenged.nickname,
    guessContent: challengeRecord.guessContent,
    status: challengeRecord.status,
    similarityScore: challengeRecord.similarityScore,
    hitTaskId: challengeRecord.hitTaskId,
    hitTaskContent: challengeRecord.hitTaskContent,
    hitPunishmentContent: challengeRecord.hitPunishmentContent,
  };
}

// ============================================
// V2: 批量刷新（消耗1次刷新机会，替换所有 ACTIVE 任务）
// ============================================
export async function refreshAllTasks(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

  if (player.refreshChances <= 0) {
    throw new AppError(400, '刷新次数已用完');
  }

  // 检查游戏状态
  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
  });
  if (!game || game.status !== 'PLAYING') {
    throw new AppError(400, '游戏不在进行中');
  }

  // 检查是否有正在等待确认的声明（有的话不能刷新）
  const pendingDeclares = await prisma.declareComplete.count({
    where: {
      declarerId: playerId,
      status: 'PENDING',
    },
  });
  if (pendingDeclares > 0) {
    throw new AppError(400, '有待确认的声明完成，请等待后再刷新');
  }

  // 获取当前 ACTIVE 任务
  const activeTasks = await prisma.playerTask.findMany({
    where: { playerId, gameId: player.gameId, status: 'ACTIVE' },
  });

  // 获取同游戏所有玩家
  const allPlayers = await prisma.player.findMany({
    where: { gameId: player.gameId },
    select: { id: true, nickname: true },
  });

  // 使用事务：删除旧牌 + 扣减刷新次数 + 抽新牌
  await prisma.$transaction(async (tx) => {
    // 扣减刷新次数
    await tx.player.update({
      where: { id: playerId },
      data: { refreshChances: { decrement: 1 } },
    });

    // 删除旧的 ACTIVE 任务（刷新 = 替换，不计入任何完成/质疑状态）
    for (const task of activeTasks) {
      // 失活对应的匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: task.id },
        data: { isActive: false },
      });
      // 删除任务记录（ACTIVE 且无 DeclareComplete 关联，安全删除）
      await tx.playerTask.delete({ where: { id: task.id } });
    }

    // 抽新任务（使用 V2 共享卡池逻辑）
    const difficulties: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
    const otherPlayers = allPlayers.filter((p) => p.id !== playerId);
    let extremeCount = 0;

    // 获取本局已使用的任务内容
    const existingTasks = await tx.playerTask.findMany({
      where: {
        gameId: player.gameId,
        status: { in: ['COMPLETED', 'CHALLENGED'] },
      },
      select: { content: true },
    });
    const usedContentSet = new Set(existingTasks.map((t) => t.content));

    for (const difficulty of difficulties) {
      let actualDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME' = difficulty;
      if (difficulty === 'HARD' && Math.random() < 0.2) {
        actualDifficulty = 'EXTREME';
        extremeCount++;
      }

      // 排除已使用的内容
      const usedContentArray = [...usedContentSet];
      const whereClause = usedContentArray.length > 0
        ? { difficulty: actualDifficulty, content: { notIn: usedContentArray } }
        : { difficulty: actualDifficulty };

      const taskCount = await tx.taskLibrary.count({ where: whereClause });

      let task;
      if (taskCount === 0) {
        // 回退到全量
        const fallbackCount = await tx.taskLibrary.count({
          where: { difficulty: actualDifficulty },
        });
        if (fallbackCount === 0) continue;
        const skip = Math.floor(Math.random() * fallbackCount);
        task = await tx.taskLibrary.findFirst({
          where: { difficulty: actualDifficulty },
          skip,
        });
      } else {
        const skip = Math.floor(Math.random() * taskCount);
        task = await tx.taskLibrary.findFirst({ where: whereClause, skip });
      }

      if (!task) continue;

      usedContentSet.add(task.content);

      // 绑定惩罚
      const punishmentCount = await tx.punishmentLibrary.count({
        where: { difficulty: actualDifficulty },
      });
      let punishmentContent = '做10个深蹲';
      if (punishmentCount > 0) {
        const pSkip = Math.floor(Math.random() * punishmentCount);
        const punishment = await tx.punishmentLibrary.findFirst({
          where: { difficulty: actualDifficulty },
          skip: pSkip,
        });
        if (punishment) punishmentContent = punishment.content;
      }

      // V2 目标分配
      const { primaryTarget, secondaryTargets } = assignTargets(actualDifficulty, otherPlayers);

      const newTask = await tx.playerTask.create({
        data: {
          playerId,
          gameId: player.gameId,
          content: task.content,
          difficulty: actualDifficulty,
          points: POINTS_MAP[actualDifficulty],
          taskType: task.taskType,
          primaryTargetId: primaryTarget.id,
          primaryTargetName: primaryTarget.nickname,
          secondaryTargetIds: secondaryTargets.map((t) => t.id),
          secondaryTargetNames: secondaryTargets.map((t) => t.nickname),
          punishmentContent,
        },
      });

      // 创建匿名爆料
      await tx.anonymousTip.create({
        data: {
          gameId: player.gameId,
          content: `🔍 有人换了新牌，正在策划：「${task.content}」`,
          sourceTaskId: newTask.id,
          isActive: true,
        },
      });
    }

    // 更新玩家极端任务统计
    if (extremeCount > 0) {
      await tx.player.update({
        where: { id: playerId },
        data: { extremeTasksDrawn: { increment: extremeCount } },
      });
    }
  });

  // 重新获取玩家信息和新任务
  const updatedPlayer = await prisma.player.findUnique({
    where: { id: playerId },
  });
  const newTasks = await prisma.playerTask.findMany({
    where: { playerId, gameId: player.gameId, status: 'ACTIVE' },
  });

  return {
    refreshChances: updatedPlayer!.refreshChances,
    tasks: newTasks.map((t) => ({
      id: t.id,
      content: t.content,
      difficulty: t.difficulty,
      points: t.points,
      taskType: t.taskType,
      primaryTargetId: t.primaryTargetId,
      primaryTargetName: t.primaryTargetName,
      secondaryTargetIds: t.secondaryTargetIds as string[],
      secondaryTargetNames: t.secondaryTargetNames as string[],
      punishmentContent: t.punishmentContent,
      status: t.status,
    })),
  };
}

// ============================================
// 获取动态流
// ============================================
export async function getFeed(gameId: string) {
  const events = await prisma.gameEvent.findMany({
    where: { gameId },
    orderBy: { createdAt: 'asc' },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    content: event.content as {
      declarerNickname?: string;
      targetNickname?: string;
      challengerNickname?: string;
      challengedNickname?: string;
      taskContent: string;
      punishmentContent: string;
      denialTriggered?: boolean;
    },
    createdAt: new Date(event.createdAt).toISOString(),
  }));
}

// ============================================
// 获取匿名爆料
// ============================================
export async function getTips(gameId: string) {
  const tips = await prisma.anonymousTip.findMany({
    where: { gameId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  return tips.map((tip) => ({
    id: tip.id,
    content: tip.content,
  }));
}
