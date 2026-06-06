import prisma from '../utils/prisma';
import { generateGameCode, formatGameInfo, formatPlayerInfo, updateBottom2Status, AppError } from '../utils/helpers';
import { drawTasksForPlayer } from './taskService';

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
// ============================================
export async function startGame(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true },
  });

  if (!game) throw new AppError(404, '游戏不存在');
  if (game.status !== 'WAITING') throw new AppError(400, '当前游戏状态不允许开始');
  if (game.players.length < 4) throw new AppError(400, '至少需要4名玩家才能开始');

  // 为每个玩家抽取3个任务
  for (const player of game.players) {
    await drawTasksForPlayer(player.id, game.id, game.players);
  }

  // 更新游戏状态
  const updated = await prisma.game.update({
    where: { id: gameId },
    data: {
      status: 'PLAYING',
      startedAt: new Date(),
    },
    include: { players: true },
  });

  // 初始化后2名状态
  await updateBottom2Status(gameId);

  return formatGameInfo(updated);
}

// ============================================
// 结束游戏（玩家投票）
// ============================================
export async function endGame(gameId: string, playerId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true },
  });

  if (!game) throw new AppError(404, '游戏不存在');
  if (game.status !== 'PLAYING') throw new AppError(400, '当前游戏不在进行中');

  // 检查玩家是否在游戏中
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new AppError(403, '你不是该游戏的玩家');
  if (player.votedEnd) throw new AppError(400, '你已经投过票了');

  // 标记投票
  await prisma.player.update({
    where: { id: playerId },
    data: { votedEnd: true },
  });

  // 统计投票数（当前玩家已在上方更新为 votedEnd=true，但 game 对象是更新前查的，
  // 所以 filter 里对当前玩家直接算 true，对其他玩家看 votedEnd 字段）
  const votedCount = game.players.filter((p) => p.id === playerId ? true : p.votedEnd).length;
  const majority = Math.ceil(game.players.length / 2);

  let allVoted = false;

  // 超过半数投票则结束游戏
  if (votedCount > majority) {
    await prisma.game.update({
      where: { id: gameId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });
    allVoted = true;
  }

  return { allVoted };
}

// ============================================
// 加入游戏
// ============================================
export async function joinGame(data: {
  gameCode: string;
  openId: string;
  nickname: string;
}) {
  const game = await prisma.game.findUnique({
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
    // 已加入，返回已有玩家信息
    return {
      player: formatPlayerInfo(existing),
      gameId: game.id,
    };
  }

  // 创建玩家
  const player = await prisma.player.create({
    data: {
      gameId: game.id,
      openId: data.openId,
      nickname: data.nickname,
    },
  });

  return {
    player: formatPlayerInfo(player),
    gameId: game.id,
  };
}
