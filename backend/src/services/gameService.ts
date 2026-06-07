import prisma from '../utils/prisma';
import { generateGameCode, formatGameInfo, formatPlayerInfo, updateBottom2Status, AppError } from '../utils/helpers';
import { drawTasksForPlayer } from './taskService';
import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace';

// ============================================
// 创建游戏
// ============================================
export async function createGame(data: {
  playerCount: number;
  startTime?: string;
  endTime: string;
  teamRewards?: string[];
  teamPunishments?: string[];
}) {
  // 校验人数范围
  if (data.playerCount < 4 || data.playerCount > 8) {
    throw new AppError(400, '参与人数需在4-8人之间');
  }

  const code = await generateGameCode();

  const game = await prisma.game.create({
    data: {
      code,
      playerCount: data.playerCount,
      startTime: data.startTime ? new Date(data.startTime) : null,
      endTime: new Date(data.endTime),
      teamRewards: data.teamRewards || [],
      teamPunishments: data.teamPunishments || [],
    },
    include: { players: true },
  });

  return formatGameInfo(game);
}

// ============================================
// 获取游戏信息
// ============================================
export async function getGame(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true },
  });

  if (!game) throw new AppError(404, '游戏不存在');

  return formatGameInfo(game);
}

// ============================================
// 开始游戏 — 分配任务 + 创建匿名爆料
// H5 FIX: 状态校验+更新放入同一事务，防止并发重复开始
// ============================================
export async function startGame(gameId: string) {
  // 事务：原子校验 + 状态切换 + 初始化刷新次数
  const game = await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: { players: true },
    });

    if (!game) throw new AppError(404, '游戏不存在');
    if (game.status !== 'WAITING') throw new AppError(400, '当前游戏状态不允许开始');
    if (game.players.length < 4) throw new AppError(400, '至少需要4名玩家才能开始');

    // 更新游戏状态
    const updated = await tx.game.update({
      where: { id: gameId },
      data: {
        status: 'PLAYING',
        startedAt: new Date(),
      },
      include: { players: true },
    });

    // V2: 初始化所有玩家 refreshChances 为 3
    await tx.player.updateMany({
      where: { gameId },
      data: { refreshChances: 3 },
    });

    return updated;
  });

  // 为每个玩家抽取3个任务（drawTasksForPlayer 有自己的事务，无法嵌套）
  for (const player of game.players) {
    await drawTasksForPlayer(player.id, game.id, game.players);
  }

  // 初始化后2名状态
  await updateBottom2Status(game.id);

  return formatGameInfo(game);
}

// ============================================
// 结束游戏（V2: 全员点击结束）
// Bug J FIX: 将投票+判定+游戏结束放入同一事务，消除 TOCTOU 竞态
// ============================================
export async function endGame(gameId: string, playerId: string) {
  // 前置校验（事务外快速失败）
  const game = await prisma.game.findUnique({
    where: { id: gameId },
  });
  if (!game) throw new AppError(404, '游戏不存在');
  if (game.status !== 'PLAYING') throw new AppError(400, '当前游戏不在进行中');

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.gameId !== gameId) throw new AppError(403, '你不是该游戏的玩家');
  if (player.votedEnd) throw new AppError(400, '你已经投过票了');

  // 事务内：投票 + 判定全员 + 游戏结束（原子操作）
  const result = await prisma.$transaction(async (tx) => {
    // 1. 投票
    await tx.player.update({
      where: { id: playerId },
      data: { votedEnd: true },
    });

    // 2. 在事务内重新读取最新投票状态
    const players = await tx.player.findMany({
      where: { gameId },
      select: { id: true, votedEnd: true },
    });

    const votedCount = players.filter((p) => p.votedEnd).length;
    const totalPlayers = players.length;

    let allVoted = false;

    if (votedCount === totalPlayers) {
      // M5 FIX: 事务内重新校验游戏状态，防止并发 endGame 重复执行
      const currentGame = await tx.game.findUnique({
        where: { id: gameId },
        select: { status: true },
      });
      if (currentGame?.status === 'PLAYING') {
        // 3. 全员同意 → 结束游戏
        await tx.game.update({
          where: { id: gameId },
          data: {
            status: 'ENDED',
            endedAt: new Date(),
          },
        });

        // SEVERE #3 FIX: 批量将 ACTIVE 任务标记为 CANCELED
        await tx.playerTask.updateMany({
          where: { gameId, status: 'ACTIVE' },
          data: { status: 'CANCELED', removedAt: new Date() },
        });

        // Bug K FIX: 处理 PENDING 状态的 DeclareComplete（游戏结束，未确认的声明视为否认）
        const pendingDeclares = await tx.declareComplete.findMany({
          where: { gameId, status: 'PENDING' },
        });
        if (pendingDeclares.length > 0) {
          await tx.declareComplete.updateMany({
            where: { gameId, status: 'PENDING' },
            data: { status: 'DENIED', confirmedAt: new Date() },
          });
          // 标记对应的消息为已处理
          await tx.pendingMessage.updateMany({
            where: {
              gameId,
              type: 'DECLARE_COMPLETE',
              relatedId: { in: pendingDeclares.map((d) => d.id) },
              isHandled: false,
            },
            data: { isHandled: true, handledAt: new Date() },
          });
        }

        // 失活所有匿名爆料
        await tx.anonymousTip.updateMany({
          where: { gameId, isActive: true },
          data: { isActive: false },
        });

        // M5 FIX: allVoted = true 必须在内部 if 内，确保只在游戏实际被结束时才返回 true
        allVoted = true;
      }
    }

    return { allVoted, votedCount, totalPlayers };
  });

  return result;
}

// ============================================
// 加入游戏（事务内校验+创建，防止并发重复加入和超员）
// ============================================
export async function joinGame(data: {
  gameCode: string;
  openId: string;
  nickname: string;
}) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({
        where: { code: data.gameCode },
        include: { players: true },
      });

      if (!game) throw new AppError(404, '游戏不存在，请检查入场码');
      if (game.status !== 'WAITING') throw new AppError(400, '游戏已开始或已结束，无法加入');
      if (game.players.length >= game.playerCount) {
        throw new AppError(400, '游戏人数已满');
      }

      // 检查同一 openId 是否已加入
      const existing = game.players.find((p) => p.openId === data.openId);
      if (existing) {
        return { player: formatPlayerInfo(existing), gameId: game.id };
      }

      // 创建玩家
      const player = await tx.player.create({
        data: {
          gameId: game.id,
          openId: data.openId,
          nickname: data.nickname,
        },
      });

      return { player: formatPlayerInfo(player), gameId: game.id };
    });

    return result;
  } catch (err) {
    // P2002: gameId+openId 唯一约束冲突（并发加入）
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(400, '你已经加入该游戏');
    }
    throw err;
  }
}
