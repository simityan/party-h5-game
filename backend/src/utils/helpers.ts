import prisma from './prisma';

// ============================================
// 自定义错误类
// ============================================
export class AppError extends Error {
  public statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

// ============================================
// 生成6位游戏入场码（排除易混淆字符 O/0/I/1）
// ============================================
export async function generateGameCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  let exists = true;

  while (exists) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await prisma.game.findUnique({ where: { code } });
    exists = !!existing;
  }

  return code;
}

// ============================================
// 格式化玩家信息（匹配前端 PlayerInfo 类型）
// V2: 新增 refreshChances 字段
// ============================================
export function formatPlayerInfo(player: {
  id: string;
  nickname: string;
  avatar: string | null;
  score: number;
  isBottom2: boolean;
  votedEnd: boolean;
  refreshChances: number;
}) {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    isBottom2: player.isBottom2,
    votedEnd: player.votedEnd,
    refreshChances: player.refreshChances,
  };
}

// ============================================
// 格式化游戏信息（匹配前端 GameInfo 类型）
// ============================================
export function formatGameInfo(game: {
  id: string;
  code: string;
  status: string;
  playerCount: number;
  startTime: Date | null;
  endTime: Date;
  teamRewards: unknown;
  teamPunishments: unknown;
  players: ReturnType<typeof formatPlayerInfo>[];
}) {
  return {
    id: game.id,
    code: game.code,
    status: game.status,
    playerCount: game.playerCount,
    startTime: game.startTime ? new Date(game.startTime).toISOString() : null,
    endTime: new Date(game.endTime).toISOString(),
    teamRewards: game.teamRewards as string[],
    teamPunishments: game.teamPunishments as string[],
    players: (game.players || []).map((p) =>
      typeof p === 'object' && 'id' in p ? formatPlayerInfo(p as any) : p
    ),
  };
}

// ============================================
// 更新后2名状态（积分最低2人标记 isBottom2）
// H4 FIX: 使用事务 + 批量更新，消除逐条写入的竞态和不一致
// ============================================
export async function updateBottom2Status(gameId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const players = await tx.player.findMany({
      where: { gameId },
      orderBy: [{ score: 'asc' }, { joinedAt: 'asc' }],
      select: { id: true, isBottom2: true },
    });

    const bottom2Count = Math.min(2, players.length);

    // 需要标记为 bottom2 的（当前不是的）
    const needBottom2True = players
      .slice(0, bottom2Count)
      .filter((p) => !p.isBottom2)
      .map((p) => p.id);

    // 需要取消 bottom2 的（当前是但不应是的）
    const needBottom2False = players
      .slice(bottom2Count)
      .filter((p) => p.isBottom2)
      .map((p) => p.id);

    if (needBottom2True.length > 0) {
      await tx.player.updateMany({
        where: { id: { in: needBottom2True } },
        data: { isBottom2: true },
      });
    }

    if (needBottom2False.length > 0) {
      await tx.player.updateMany({
        where: { id: { in: needBottom2False } },
        data: { isBottom2: false },
      });
    }
  });
}
