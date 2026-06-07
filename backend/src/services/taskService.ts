import prisma from '../utils/prisma';
import { updateBottom2Status, AppError } from '../utils/helpers';
import { distance } from 'fastest-levenshtein';
import type { TaskDifficulty } from '../generated/prisma/enums';
import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace';

// ============================================
// 常量
// ============================================

// 积分映射
const POINTS_MAP: Record<TaskDifficulty, number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
  EXTREME: 5,
};

// V2 难度对应次要目标数量（-1 = 全员次要目标）
// HARD: 少于5人时按实际人数调整：Math.min(3, totalPlayers - 2)
const SECONDARY_TARGET_COUNT: Record<TaskDifficulty, number> = {
  EASY: 0,
  MEDIUM: 1,
  HARD: -2, // 特殊标记：动态计算
  EXTREME: -1,
};

// Fisher-Yates 洗牌（无偏随机）
function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 文本相似度阈值
const SIMILARITY_THRESHOLD = 0.75;

// 短文本阈值（≤5字符时使用编辑距离判定）
const SHORT_TEXT_MAX_LENGTH = 5;
const SHORT_TEXT_MAX_DISTANCE = 1;

// 模板前缀列表（V2定稿，最长优先，用于去除任务内容中的模板词）
const TEMPLATE_PREFIXES = [
  '让目标玩家及次要玩家们',
  '让目标玩家及次要玩家',
  '让目标玩家',
  '让所有玩家分别',
  '让所有玩家',
  '阻止目标玩家及次要玩家们',
  '阻止目标玩家及次要玩家',
  '阻止目标玩家',
];

// ============================================
// V2 匿名爆料模糊化生成
// ============================================

/** 根据任务内容和难度生成模糊化的匿名爆料文案 */
function generateFuzzyTip(taskContent: string, difficulty: TaskDifficulty): string {
  // 去除模板前缀，提取核心动作
  const core = stripTemplatePrefix(taskContent);

  // 按难度生成不同风格的模糊提示
  const templates: Record<string, string[]> = {
    EASY: [
      '💡 有人在偷偷想办法让你做一件事……',
      '💡 有人正在打你的主意，小心哦~',
      '💡 刚才那个互动，可能没你想的那么自然……',
      '💡 有人想让别人配合一个小动作……',
    ],
    MEDIUM: [
      '💡 有人正在策划让你和另一个人一起做某件事……',
      '💡 有两个人的互动可能是一场设计好的局……',
      '💡 有人想让两个人同时做某件事，小心被安排~',
      '💡 有人正在策划一个小圈子的行动……',
    ],
    HARD: [
      '💡 有人想让好几个人一起做同一件事，场面有点大……',
      '💡 有人正在策划一个需要多人配合的局，注意观察~',
      '💡 有人拿到了一个涉及多人的任务，留意身边人的举动……',
      '💡 有人正在试图让一群人做某件事……',
    ],
    EXTREME: [
      '💡 有人拿到了一个值5分的危险任务……',
      '💡 有人手上的任务极其离谱，全员注意！',
      '💡 有人正在策划一个涉及所有人的大行动……',
      '💡 有人拿到了超难任务，所有人都是目标……',
    ],
  };

  // 基于核心内容关键词做轻微定制
  const pool = templates[difficulty] || templates.EASY;

  // 使用核心内容长度做简单的确定性选择（避免随机导致不同步）
  const index = core.length % pool.length;
  return pool[index];
}

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
  } else if (secondaryCount === -2) {
    // HARD: 动态计算 — Math.min(3, totalPlayers - 2)
    // totalPlayers = 主目标 + 次要候选 + 自己(不参与) = otherPlayers.length + 1
    const totalPlayers = otherPlayers.length + 1;
    const dynamicCount = Math.min(3, totalPlayers - 2);
    const shuffled = fisherYatesShuffle(remainingPlayers);
    secondaryTargets = shuffled.slice(0, Math.min(dynamicCount, remainingPlayers.length));
  } else if (secondaryCount > 0) {
    // Medium: 随机选择指定数量
    const shuffled = fisherYatesShuffle(remainingPlayers);
    secondaryTargets = shuffled.slice(0, Math.min(secondaryCount, remainingPlayers.length));
  }

  return { primaryTarget, secondaryTargets };
}

// ============================================
// 为玩家抽取3个任务（V2: 共享卡池 + 难度决定目标）
// 使用事务确保原子性：要么全部创建成功，要么全部回滚
// ============================================
export async function drawTasksForPlayer(
  playerId: string,
  gameId: string,
  allPlayers: { id: string; nickname: string }[],
) {
  const difficulties: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
  const otherPlayers = allPlayers.filter((p) => p.id !== playerId);
  let extremeCount = 0;

  await prisma.$transaction(async (tx) => {
    // V2: 共享卡池 — 已完成或被质疑的任务不再出现
    const existingTasks = await tx.playerTask.findMany({
      where: { gameId, status: { in: ['COMPLETED', 'CHALLENGED'] } },
      select: { content: true },
    });
    const usedContentSet = new Set(existingTasks.map((t) => t.content));

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

      const taskCount = await tx.taskLibrary.count({ where: whereClause });

      let task;
      if (taskCount === 0) {
        // 排除后无可用任务，回退到全量（避免卡死）
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

      // 加入已使用集合，防止后续玩家抽到同一任务
      usedContentSet.add(task.content);

      // 绑定惩罚（从惩罚库随机抽取同难度）
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

      // V2: 按难度分配目标
      const { primaryTarget, secondaryTargets } = assignTargets(actualDifficulty, otherPlayers);

      // 创建玩家手牌
      const playerTask = await tx.playerTask.create({
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

      // V2: 创建匿名爆料（模糊化处理，不暴露任务原文）
      await tx.anonymousTip.create({
        data: {
          gameId,
          content: generateFuzzyTip(task.content, actualDifficulty),
          sourceTaskId: playerTask.id,
          isActive: true,
        },
      });
    }

    // 更新玩家统计
    const tasksDrawn = await tx.playerTask.count({
      where: { playerId, gameId },
    });
    await tx.player.update({
      where: { id: playerId },
      data: {
        totalTasksDrawn: tasksDrawn,
        extremeTasksDrawn: { increment: extremeCount },
      },
    });
  });
}

// ============================================
// 声明完成（V2: targetId 来自任务的 primaryTargetId）
// H3 FIX: 3个写操作（create declare + update task + create message）放入同一事务
// ============================================
export async function declareComplete(
  playerId: string,
  data: { taskId: string },
) {
  // 前置校验（快速失败，非关键路径）
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
  });
  if (!game || game.status !== 'PLAYING') {
    throw new AppError(400, '游戏不在进行中');
  }

  const task = await prisma.playerTask.findUnique({
    where: { id: data.taskId },
  });
  if (!task) throw new AppError(404, '任务不存在');
  if (task.playerId !== playerId) throw new AppError(403, '这不是你的任务');
  if (task.status !== 'ACTIVE') throw new AppError(400, '该任务已无法声明完成');

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

  // 事务内：创建声明 + 更新任务 + 发送消息（原子操作，防止部分写入）
  let declare;
  try {
    declare = await prisma.$transaction(async (tx) => {
      // 事务内重新校验任务状态（防止并发操作）
      const currentTask = await tx.playerTask.findUnique({
        where: { id: data.taskId },
      });
      if (!currentTask || currentTask.status !== 'ACTIVE') {
        throw new AppError(400, '该任务已无法声明完成');
      }

      const created = await tx.declareComplete.create({
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
      await tx.playerTask.update({
        where: { id: data.taskId },
        data: { declaredAt: new Date() },
      });

      // 给目标方发送待处理消息
      await tx.pendingMessage.create({
        data: {
          playerId: targetId,
          gameId: player.gameId,
          type: 'DECLARE_COMPLETE',
          relatedId: created.id,
          content: {
            declarerNickname: created.declarer.nickname,
            targetNickname: created.target.nickname,
            taskContent: created.taskContent,
            punishmentContent: created.punishmentContent,
          },
        },
      });

      return created;
    });
  } catch (err) {
    // P2002: taskId 唯一约束冲突（并发重复声明）
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(400, '该任务已被声明完成，请勿重复操作');
    }
    throw err;
  }

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

      // M8 FIX: 事务内检查声明方是否所有任务都已 resolve → 是则 +3 刷新次数
      const activeCount = await tx.playerTask.count({
        where: { playerId: declare.declarerId, gameId: declare.gameId, status: 'ACTIVE' },
      });
      if (activeCount === 0) {
        await tx.player.update({
          where: { id: declare.declarerId },
          data: { refreshChances: { increment: 3 } },
        });
      }
    });

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

      // M8 FIX: 事务内检查声明方是否所有任务都已 resolve → 是则 +3 刷新次数
      const activeCount = await tx.playerTask.count({
        where: { playerId: declare.declarerId, gameId: declare.gameId, status: 'ACTIVE' },
      });
      if (activeCount === 0) {
        await tx.player.update({
          where: { id: declare.declarerId },
          data: { refreshChances: { increment: 3 } },
        });
      }
    });

    await updateBottom2Status(declare.gameId);
  }

  return { success: true };
}

// M8 FIX: checkAndAwardRefreshOnAllResolved 已内联到各父事务中
// （独立调用存在 TOCTOU 竞态：并发确认可导致 +6 而非 +3）

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
  // SEVERE #2 FIX: 应用层状态检查 + DB 层 hitTaskId @unique 约束，双重防护并发重复命中
  let challengeRecord;
  try {
    challengeRecord = await prisma.$transaction(async (tx) => {
      // SEVERE #2 FIX: 并发控制 — 在事务内重新检查命中任务状态
      // 防止同一任务被多个质疑同时命中
      if (isHitResult && bestMatch) {
        const currentTask = await tx.playerTask.findUnique({
          where: { id: bestMatch.task.id },
        });
        if (!currentTask || currentTask.status !== 'ACTIVE') {
          // 任务已被其他质疑先命中，本次质疑自动失败
          const record = await tx.challenge.create({
            data: {
              gameId: player.gameId,
              challengerId: playerId,
              challengedId: data.challengedId,
              guessContent: data.guessContent,
              status: 'MISS',
              similarityScore: bestMatch.similarity,
              hitTaskId: null,
              hitTaskContent: null,
              hitPunishmentContent: null,
              resolvedAt: new Date(),
            },
            include: { challenger: true, challenged: true },
          });

          await tx.player.update({
            where: { id: playerId },
            data: { challengesMade: { increment: 1 } },
          });

          await tx.player.update({
            where: { id: data.challengedId },
            data: { challengesReceived: { increment: 1 } },
          });

          return record;
        }
      }
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

        // 质疑方得分 + 刷新（V2: 质疑命中→双方各+1刷新）
        await tx.player.update({
          where: { id: playerId },
          data: {
            score: { increment: bestMatch.task.points },
            challengesSucceeded: { increment: 1 },
            refreshChances: { increment: 1 },
          },
        });

        // 被质疑方统计 + 刷新（V2: 质疑命中→双方各+1刷新）
        await tx.player.update({
          where: { id: data.challengedId },
          data: {
            challengesHit: { increment: 1 },
            punishmentsReceived: { increment: 1 },
            refreshChances: { increment: 1 },
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

        // M8 FIX: 事务内检查被质疑方是否所有任务都已 resolve → 是则 +3 刷新次数
        const activeCount = await tx.playerTask.count({
          where: { playerId: data.challengedId, gameId: player.gameId, status: 'ACTIVE' },
        });
        if (activeCount === 0) {
          await tx.player.update({
            where: { id: data.challengedId },
            data: { refreshChances: { increment: 3 } },
          });
        }
      }
      // V2: 质疑不再发送待处理消息（自动判定，无 PENDING 状态）

      return record;
    });
  } catch (err) {
    // P2002: hitTaskId @unique 约束冲突 — 极端并发下两个事务同时通过 ACTIVE 检查
    // 第二个事务提交时 DB 层拒绝，降级为"该任务已被质疑"提示
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, '该任务已被其他玩家质疑命中，请刷新后再试');
    }
    throw err;
  }

  // 更新后2名状态
  await updateBottom2Status(player.gameId);

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
// H2 FIX: 刷新次数扣减移入事务，使用条件更新（updateMany + gt:0）防止并发超扣
// M7 FIX: activeTasks 读取移入事务，使用 deleteMany 批量删除替代逐条删除
// ============================================
export async function refreshAllTasks(playerId: string) {
  // 前置校验（快速失败，非关键路径）
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

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

  // 获取同游戏所有玩家（事务外读取，此数据不因刷新而改变）
  const allPlayers = await prisma.player.findMany({
    where: { gameId: player.gameId },
    select: { id: true, nickname: true },
  });

  // 事务：原子扣减 + 删除旧牌 + 抽新牌
  await prisma.$transaction(async (tx) => {
    // H2 FIX: 原子条件扣减刷新次数（单条 SQL，防止并发超扣）
    const decrementResult = await tx.player.updateMany({
      where: { id: playerId, refreshChances: { gt: 0 } },
      data: { refreshChances: { decrement: 1 } },
    });
    if (decrementResult.count === 0) {
      throw new AppError(400, '刷新次数已用完');
    }

    // M7 FIX: 事务内读取 ACTIVE 任务，消除 TOCTOU 竞态
    const activeTasks = await tx.playerTask.findMany({
      where: { playerId, gameId: player.gameId, status: 'ACTIVE' },
      select: { id: true },
    });

    if (activeTasks.length > 0) {
      const taskIds = activeTasks.map((t) => t.id);
      // 批量失活匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: { in: taskIds } },
        data: { isActive: false },
      });
      // M7 FIX: 批量删除旧任务（替代逐条删除，减少 DB 往返）
      await tx.playerTask.deleteMany({
        where: { id: { in: taskIds } },
      });
    }

    // 抽新任务（使用 V2 共享卡池逻辑）
    const difficulties: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
    const otherPlayers = allPlayers.filter((p) => p.id !== playerId);
    let extremeCount = 0;

    // M9: V2 共享卡池仅排除 COMPLETED/CHALLENGED，允许不同玩家持有相同内容的 ACTIVE 任务（设计如此）
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

      // V2: 创建匿名爆料
      await tx.anonymousTip.create({
        data: {
          gameId: player.gameId,
          content: generateFuzzyTip(task.content, actualDifficulty),
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
    refreshChances: updatedPlayer ? updatedPlayer.refreshChances : player.refreshChances - 1,
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
      declaredAt: t.declaredAt ? new Date(t.declaredAt).toISOString() : null,
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
