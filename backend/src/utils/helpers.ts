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
// ============================================
export function formatPlayerInfo(player: {
  id: string;
  nickname: string;
  avatar: string | null;
  score: number;
  isBottom2: boolean;
  votedEnd: boolean;
}) {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    isBottom2: player.isBottom2,
    votedEnd: player.votedEnd,
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
// ============================================
export async function updateBottom2Status(gameId: string): Promise<void> {
  const players = await prisma.player.findMany({
    where: { gameId },
    orderBy: [{ score: 'asc' }, { joinedAt: 'asc' }],
  });

  for (let i = 0; i < players.length; i++) {
    const isBottom2 = i < Math.min(2, players.length);
    if (players[i].isBottom2 !== isBottom2) {
      await prisma.player.update({
        where: { id: players[i].id },
        data: { isBottom2 },
      });
    }
  }
}
