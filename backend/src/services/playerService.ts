import prisma from '../utils/prisma';
import { formatPlayerInfo, formatGameInfo, AppError } from '../utils/helpers';

// ============================================
// 获取玩家状态（积分、后2名警告、任务列表）
// V2: 返回所有状态的任务（ACTIVE/COMPLETED/CHALLENGED），用于卡牌翻转展示
// ============================================
export async function getPlayerStatus(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { tasks: true },
  });

  if (!player) throw new AppError(404, '玩家不存在');

  // V2: 返回所有状态的任务（前端根据状态展示不同卡片样式）
  const tasks = player.tasks.map((t) => ({
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
  }));

  return {
    player: formatPlayerInfo(player),
    tasks,
  };
}

// ============================================
// 轮询获取待处理消息
// V2: 仅处理 DECLARE_COMPLETE 类型（质疑不再需要手动确认）
// ============================================
export async function getPendingMessages(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });

  if (!player) throw new AppError(404, '玩家不存在');

  const messages = await prisma.pendingMessage.findMany({
    where: {
      playerId,
      isHandled: false,
    },
    orderBy: { createdAt: 'asc' },
  });

  // 标记为已读
  if (messages.length > 0) {
    await prisma.pendingMessage.updateMany({
      where: {
        id: { in: messages.map((m) => m.id) },
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  // 组装消息内容
  const result = [];
  for (const msg of messages) {
    let content: any = null;

    if (msg.type === 'DECLARE_COMPLETE') {
      const declare = await prisma.declareComplete.findUnique({
        where: { id: msg.relatedId },
        include: { declarer: true, target: true },
      });
      if (declare) {
        content = {
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
    }
    // V2: CHALLENGE 类型消息已移除，质疑由系统自动判定

    result.push({
      id: msg.id,
      type: msg.type,
      relatedId: msg.relatedId,
      content,
      isRead: true, // 刚标记为已读
      isHandled: msg.isHandled,
      createdAt: new Date(msg.createdAt).toISOString(),
    });
  }

  return result;
}

// ============================================
// V2 合并轮询 — 单请求获取所有游戏数据
// 优化：5个独立API → 1个合并请求，减少HTTP开销
// ============================================
export async function pollGameData(playerId: string) {
  // 1. 获取玩家（含任务）
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { tasks: true },
  });

  if (!player) throw new AppError(404, '玩家不存在');

  const gameId = player.gameId;

  // 2. 并行获取：游戏信息 + 待处理消息 + 动态流 + 匿名爆料
  const [game, messages, events, tips] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      include: { players: true },
    }),
    prisma.pendingMessage.findMany({
      where: { playerId, isHandled: false },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.gameEvent.findMany({
      where: { gameId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.anonymousTip.findMany({
      where: { gameId, isActive: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // 3. 并行执行：更新后2名 + 标记消息已读 + 批量获取消息内容
  const declareIds = messages
    .filter((m) => m.type === 'DECLARE_COMPLETE')
    .map((m) => m.relatedId);

  const [, updatedPlayer, declares] = await Promise.all([
    // 标记消息为已读
    messages.length > 0
      ? prisma.pendingMessage.updateMany({
          where: {
            id: { in: messages.map((m) => m.id) },
            isRead: false,
          },
          data: { isRead: true },
        })
      : Promise.resolve({ count: 0 }),
    // 重新获取更新后的玩家信息
    prisma.player.findUnique({ where: { id: playerId } }),
    // 批量获取声明完成记录
    declareIds.length > 0
      ? prisma.declareComplete.findMany({
          where: { id: { in: declareIds } },
          include: { declarer: true, target: true },
        })
      : Promise.resolve([]),
  ]);

  // 4. 组装消息内容（从批量查询结果中匹配）
  const declareMap = new Map(declares.map((d) => [d.id, d]));
  const messageResults = messages.map((msg) => {
    let content: any = null;
    if (msg.type === 'DECLARE_COMPLETE') {
      const declare = declareMap.get(msg.relatedId);
      if (declare) {
        content = {
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
    }
    return {
      id: msg.id,
      type: msg.type,
      relatedId: msg.relatedId,
      content,
      isRead: true,
      isHandled: msg.isHandled,
      createdAt: new Date(msg.createdAt).toISOString(),
    };
  });

  // 5. 组装返回数据
  return {
    game: game ? formatGameInfo(game) : null,
    player: updatedPlayer ? formatPlayerInfo(updatedPlayer) : formatPlayerInfo(player),
    tasks: player.tasks.map((t) => ({
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
    messages: messageResults,
    feed: events.map((e) => ({
      id: e.id,
      type: e.type,
      content: e.content as {
        declarerNickname?: string;
        targetNickname?: string;
        challengerNickname?: string;
        challengedNickname?: string;
        taskContent: string;
        punishmentContent: string;
        denialTriggered?: boolean;
      },
      createdAt: new Date(e.createdAt).toISOString(),
    })),
    tips: tips.map((t) => ({
      id: t.id,
      content: t.content,
    })),
  };
}
