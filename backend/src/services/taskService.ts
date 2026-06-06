import prisma from '../utils/prisma';
import { updateBottom2Status, AppError } from '../utils/helpers';

// 积分映射
const POINTS_MAP: Record<string, number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
  EXTREME: 5,
};

// ============================================
// 为玩家抽取3个任务（1简单 1中等 1困难/超难）
// ============================================
export async function drawTasksForPlayer(
  playerId: string,
  gameId: string,
  allPlayers: { id: string; nickname: string }[],
) {
  const difficulties: ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];
  const otherPlayers = allPlayers.filter((p) => p.id !== playerId);
  let extremeCount = 0;

  for (const difficulty of difficulties) {
    // HARD 难度有 20% 概率变成 EXTREME
    let actualDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME' = difficulty;
    if (difficulty === 'HARD' && Math.random() < 0.2) {
      actualDifficulty = 'EXTREME';
      extremeCount++;
    }

    // 从任务库随机抽取
    const taskCount = await prisma.taskLibrary.count({
      where: { difficulty: actualDifficulty },
    });

    if (taskCount === 0) {
      // 任务库为空则跳过（同事正在录入）
      continue;
    }

    const skip = Math.floor(Math.random() * taskCount);
    const task = await prisma.taskLibrary.findFirst({
      where: { difficulty: actualDifficulty },
      skip,
    });

    if (!task) continue;

    // 从惩罚库随机绑定同难度惩罚
    const punishmentCount = await prisma.punishmentLibrary.count({
      where: { difficulty: actualDifficulty },
    });

    let punishmentContent = '做10个深蹲';
    if (punishmentCount > 0) {
      const pSkip = Math.floor(Math.random() * punishmentCount);
      const punishment = await prisma.punishmentLibrary.findFirst({
        where: { difficulty: actualDifficulty },
        skip: pSkip,
      });
      if (punishment) punishmentContent = punishment.content;
    }

    // 如果目标类型为 SPECIFIC_ONE，随机指定一个其他玩家
    let targetName: string | null = null;
    if (task.targetType === 'SPECIFIC_ONE' && otherPlayers.length > 0) {
      const randomOther = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
      targetName = randomOther.nickname;
    }

    // 创建玩家手牌
    const playerTask = await prisma.playerTask.create({
      data: {
        playerId,
        gameId,
        content: task.content,
        difficulty: actualDifficulty,
        points: POINTS_MAP[actualDifficulty],
        taskType: task.taskType,
        targetType: task.targetType,
        targetName,
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
// 声明完成
// ============================================
export async function declareComplete(
  playerId: string,
  data: { taskId: string; targetId: string },
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

  // 不能指定自己为目标
  if (data.targetId === playerId) throw new AppError(400, '不能指定自己为目标');

  // 检查目标玩家是否在同一游戏中
  const target = await prisma.player.findUnique({
    where: { id: data.targetId },
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
      targetId: data.targetId,
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
      playerId: data.targetId,
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
// 发起质疑
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

  // 创建质疑记录
  const challengeRecord = await prisma.challenge.create({
    data: {
      gameId: player.gameId,
      challengerId: playerId,
      challengedId: data.challengedId,
      guessContent: data.guessContent,
      status: 'PENDING',
    },
    include: { challenger: true, challenged: true },
  });

  // 更新发起方统计
  await prisma.player.update({
    where: { id: playerId },
    data: { challengesMade: { increment: 1 } },
  });

  // 更新被质疑方统计
  await prisma.player.update({
    where: { id: data.challengedId },
    data: { challengesReceived: { increment: 1 } },
  });

  // 给被质疑方发送待处理消息
  await prisma.pendingMessage.create({
    data: {
      playerId: data.challengedId,
      gameId: player.gameId,
      type: 'CHALLENGE',
      relatedId: challengeRecord.id,
      content: {
        challengerNickname: challengeRecord.challenger.nickname,
        challengedNickname: challengeRecord.challenged.nickname,
        guessContent: challengeRecord.guessContent,
      },
    },
  });

  return {
    id: challengeRecord.id,
    challengerId: challengeRecord.challengerId,
    challengerNickname: challengeRecord.challenger.nickname,
    challengedId: challengeRecord.challengedId,
    challengedNickname: challengeRecord.challenged.nickname,
    guessContent: challengeRecord.guessContent,
    status: challengeRecord.status,
  };
}

// ============================================
// 确认/否认声明完成（目标方操作）
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

    // 使用事务保证原子性
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

    // 更新后2名状态
    await updateBottom2Status(declare.gameId);
  } else {
    // ======= 目标方否认 → 声明方不得分 =======

    await prisma.$transaction(async (tx) => {
      // 更新声明状态
      await tx.declareComplete.update({
        where: { id: data.declareId },
        data: { status: 'DENIED', confirmedAt: new Date() },
      });

      // 更新任务状态为被否认
      await tx.playerTask.update({
        where: { id: declare.taskId },
        data: { status: 'DENIED' },
      });

      // 声明方统计
      await tx.player.update({
        where: { id: declare.declarerId },
        data: { tasksDenied: { increment: 1 } },
      });

      // 标记待处理消息为已处理
      await tx.pendingMessage.updateMany({
        where: { relatedId: data.declareId, type: 'DECLARE_COMPLETE' },
        data: { isHandled: true, handledAt: new Date() },
      });
    });
  }

  return { success: true };
}

// ============================================
// 确认质疑结果（被质疑方操作：承认/否认）
// ============================================
export async function confirmChallenge(
  playerId: string,
  data: { challengeId: string; hit: boolean; hitTaskId?: string },
) {
  const challengeRecord = await prisma.challenge.findUnique({
    where: { id: data.challengeId },
  });

  if (!challengeRecord) throw new AppError(404, '质疑记录不存在');
  if (challengeRecord.status !== 'PENDING') throw new AppError(400, '该质疑已处理');
  if (challengeRecord.challengedId !== playerId) {
    throw new AppError(403, '只有被质疑方才能确认质疑结果');
  }

  if (data.hit) {
    // ======= 质疑命中 → 被质疑方任务暴露 =======

    if (!data.hitTaskId) throw new AppError(400, '命中时需指定被命中的任务ID');

    const hitTask = await prisma.playerTask.findUnique({
      where: { id: data.hitTaskId },
    });

    if (!hitTask) throw new AppError(404, '命中的任务不存在');
    if (hitTask.playerId !== playerId) throw new AppError(403, '该任务不属于你');
    if (hitTask.status !== 'ACTIVE') throw new AppError(400, '该任务已不在手牌中');

    await prisma.$transaction(async (tx) => {
      // 更新质疑状态
      await tx.challenge.update({
        where: { id: data.challengeId },
        data: {
          status: 'HIT',
          hitTaskId: data.hitTaskId,
          hitTaskContent: hitTask.content,
          hitPunishmentContent: hitTask.punishmentContent,
          resolvedAt: new Date(),
        },
      });

      // 更新被命中任务状态
      await tx.playerTask.update({
        where: { id: data.hitTaskId },
        data: { status: 'CHALLENGED' },
      });

      // 质疑方得分（获得被命中任务的积分）
      await tx.player.update({
        where: { id: challengeRecord.challengerId },
        data: {
          score: { increment: hitTask.points },
          challengesSucceeded: { increment: 1 },
        },
      });

      // 被质疑方统计
      await tx.player.update({
        where: { id: playerId },
        data: {
          challengesHit: { increment: 1 },
          punishmentsReceived: { increment: 1 },
        },
      });

      // 创建动态流事件
      const challenger = await tx.player.findUnique({ where: { id: challengeRecord.challengerId } });
      const challenged = await tx.player.findUnique({ where: { id: playerId } });
      await tx.gameEvent.create({
        data: {
          gameId: challengeRecord.gameId,
          type: 'CHALLENGED',
          content: {
            challengerNickname: challenger?.nickname,
            challengedNickname: challenged?.nickname,
            taskContent: hitTask.content,
            punishmentContent: hitTask.punishmentContent,
          },
        },
      });

      // 移除对应匿名爆料
      await tx.anonymousTip.updateMany({
        where: { sourceTaskId: data.hitTaskId },
        data: { isActive: false },
      });

      // 标记待处理消息为已处理
      await tx.pendingMessage.updateMany({
        where: { relatedId: data.challengeId, type: 'CHALLENGE' },
        data: { isHandled: true, handledAt: new Date() },
      });
    });

    // 更新后2名状态
    await updateBottom2Status(challengeRecord.gameId);
  } else {
    // ======= 质疑未命中 → 质疑方失败 =======

    await prisma.$transaction(async (tx) => {
      // 更新质疑状态
      await tx.challenge.update({
        where: { id: data.challengeId },
        data: {
          status: 'MISS',
          resolvedAt: new Date(),
        },
      });

      // 标记待处理消息为已处理
      await tx.pendingMessage.updateMany({
        where: { relatedId: data.challengeId, type: 'CHALLENGE' },
        data: { isHandled: true, handledAt: new Date() },
      });
    });
  }

  return { success: true };
}

// ============================================
// 弃牌换牌
// ============================================
export async function discardTask(taskId: string) {
  const task = await prisma.playerTask.findUnique({
    where: { id: taskId },
  });

  if (!task) throw new AppError(404, '任务不存在');
  if (task.status !== 'ACTIVE') throw new AppError(400, '只能弃掉当前手牌');

  const player = await prisma.player.findUnique({
    where: { id: task.playerId },
  });
  if (!player) throw new AppError(404, '玩家不存在');

  // 获取同游戏所有玩家（用于指定目标）
  const allPlayers = await prisma.player.findMany({
    where: { gameId: task.gameId },
    select: { id: true, nickname: true },
  });

  // 使用事务：弃掉旧牌 + 抽新牌
  const newTask = await prisma.$transaction(async (tx) => {
    // 标记旧任务为已弃
    await tx.playerTask.update({
      where: { id: taskId },
      data: { status: 'DISCARDED', removedAt: new Date() },
    });

    // 失活对应的匿名爆料
    await tx.anonymousTip.updateMany({
      where: { sourceTaskId: taskId },
      data: { isActive: false },
    });

    // 抽新任务：同难度，HARD有20%变EXTREME
    let newDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME' = task.difficulty as any;
    if (task.difficulty === 'HARD' && Math.random() < 0.2) {
      newDifficulty = 'EXTREME';
    }

    const taskCount = await tx.taskLibrary.count({
      where: { difficulty: newDifficulty },
    });

    if (taskCount === 0) {
      // 任务库为空，创建一个默认任务
      const newPlayerTask = await tx.playerTask.create({
        data: {
          playerId: task.playerId,
          gameId: task.gameId,
          content: `[${newDifficulty}] 默认任务（任务库暂无数据）`,
          difficulty: newDifficulty,
          points: POINTS_MAP[newDifficulty],
          taskType: task.taskType,
          targetType: task.targetType,
          targetName: task.targetName,
          punishmentContent: '做10个深蹲',
        },
      });

      await tx.anonymousTip.create({
        data: {
          gameId: task.gameId,
          content: `🔍 有人换了新牌，正在策划：「${newPlayerTask.content}」`,
          sourceTaskId: newPlayerTask.id,
          isActive: true,
        },
      });

      // 更新极端任务统计
      if (newDifficulty === 'EXTREME') {
        await tx.player.update({
          where: { id: task.playerId },
          data: {
            extremeTasksDrawn: { increment: 1 },
          },
        });
      }

      return newPlayerTask;
    }

    const skip = Math.floor(Math.random() * taskCount);
    const newLibTask = await tx.taskLibrary.findFirst({
      where: { difficulty: newDifficulty },
      skip,
    });

    // 绑定惩罚
    const punishmentCount = await tx.punishmentLibrary.count({
      where: { difficulty: newDifficulty },
    });
    let punishmentContent = '做10个深蹲';
    if (punishmentCount > 0) {
      const pSkip = Math.floor(Math.random() * punishmentCount);
      const punishment = await tx.punishmentLibrary.findFirst({
        where: { difficulty: newDifficulty },
        skip: pSkip,
      });
      if (punishment) punishmentContent = punishment.content;
    }

    // 指定目标
    let targetName = task.targetName;
    if (newLibTask!.targetType === 'SPECIFIC_ONE') {
      const otherPlayers = allPlayers.filter((p) => p.id !== task.playerId);
      if (otherPlayers.length > 0) {
        targetName = otherPlayers[Math.floor(Math.random() * otherPlayers.length)].nickname;
      }
    }

    const newPlayerTask = await tx.playerTask.create({
      data: {
        playerId: task.playerId,
        gameId: task.gameId,
        content: newLibTask!.content,
        difficulty: newDifficulty,
        points: POINTS_MAP[newDifficulty],
        taskType: newLibTask!.taskType,
        targetType: newLibTask!.targetType,
        targetName,
        punishmentContent,
      },
    });

    // 创建新匿名爆料
    await tx.anonymousTip.create({
      data: {
        gameId: task.gameId,
        content: `🔍 有人换了新牌，正在策划：「${newLibTask!.content}」`,
        sourceTaskId: newPlayerTask.id,
        isActive: true,
      },
    });

    // 更新极端任务统计
    if (newDifficulty === 'EXTREME') {
      await tx.player.update({
        where: { id: task.playerId },
        data: {
          extremeTasksDrawn: { increment: 1 },
        },
      });
    }

    return newPlayerTask;
  });

  return {
    id: newTask.id,
    content: newTask.content,
    difficulty: newTask.difficulty,
    points: newTask.points,
    taskType: newTask.taskType,
    targetType: newTask.targetType,
    targetName: newTask.targetName,
    punishmentContent: newTask.punishmentContent,
    status: newTask.status,
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
