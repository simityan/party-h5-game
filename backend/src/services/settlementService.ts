import prisma from '../utils/prisma';
import { AppError } from '../utils/helpers';

// 勋章信息定义
const MEDAL_INFO: Record<string, { medalName: string; medalEmoji: string; medalDescription: string }> = {
  DRAMA: { medalName: '戏精勋章', medalEmoji: '🎭', medalDescription: '天生演员，每个眼神都是戏，你身边的朋友没有一个是安全的' },
  LIE_DETECTOR: { medalName: '测谎勋章', medalEmoji: '🛡️', medalDescription: '你的雷达永远在线，谁想害你一眼看穿' },
  PREY: { medalName: '猎物勋章', medalEmoji: '🐟', medalDescription: '全场最单纯的存在，鱼的记忆，神的信任' },
  SOCIAL_DEATH: { medalName: '社死勋章', medalEmoji: '💀', medalDescription: '社死的尽头是重生，下次还敢' },
  LURKER: { medalName: '潜伏勋章', medalEmoji: '🤫', medalDescription: '不怎么出手，但谁也别想骗你' },
  DESTINY: { medalName: '天命勋章', medalEmoji: '🍀', medalDescription: '命运总给你最离谱的牌，但你还活着' },
};

// ============================================
// 获取结算数据
// ============================================
export async function getSettlement(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { tasks: true },
        orderBy: { score: 'desc' },
      },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!game) throw new AppError(404, '游戏不存在');
  if (game.status !== 'ENDED') throw new AppError(400, '游戏尚未结束');

  const players = game.players;

  // ======= 1. 排名 =======
  const rankings = players.map((p, index) => ({
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
    rank: index + 1,
    isLowest: index === players.length - 1, // 最后一名
    tasksCompleted: p.tasksCompleted,
    challengesSucceeded: p.challengesSucceeded,
  }));

  // ======= 2. 未完成任务 =======
  const uncompletedTasks = players.map((p) => {
    // 未完成 = 还在手中的（ACTIVE）+ 被否认的（DENIED）+ 被质疑命中的（CHALLENGED）
    const unfinished = p.tasks.filter(
      (t) => t.status === 'ACTIVE' || t.status === 'DENIED' || t.status === 'CHALLENGED',
    );
    return {
      playerId: p.id,
      nickname: p.nickname,
      tasks: unfinished.map((t) => ({
        id: t.id,
        content: t.content,
        difficulty: t.difficulty,
        points: t.points,
        taskType: t.taskType,
        targetType: t.targetType,
        targetName: t.targetName,
        punishmentContent: t.punishmentContent,
        status: t.status,
      })),
    };
  });

  // ======= 3. 精彩回放（动态流事件） =======
  const events = game.events.map((event) => ({
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

  // ======= 4. 勋章颁发 =======
  const medals = computeMedals(players);

  // ======= 5. 能力图（最高分玩家） =======
  const abilityChart = computeAbilityChart(players, 0); // 第一名

  // ======= 6. 团队奖惩 =======
  return {
    rankings,
    uncompletedTasks,
    events,
    medals,
    abilityChart,
    teamRewards: game.teamRewards as string[],
    teamPunishments: game.teamPunishments as string[],
  };
}

// ============================================
// 勋章计算逻辑
// ============================================
function computeMedals(
  players: any[],
): { playerId: string; nickname: string; medalType: string; medalName: string; medalEmoji: string; medalDescription: string }[] {
  const medals: { playerId: string; nickname: string; medalType: string; medalName: string; medalEmoji: string; medalDescription: string }[] = [];

  // DRAMA — 完成任务最多
  const dramaWinner = findMax(players, (p) => p.tasksCompleted);
  if (dramaWinner) {
    const info = MEDAL_INFO.DRAMA;
    medals.push({
      playerId: dramaWinner.id,
      nickname: dramaWinner.nickname,
      medalType: 'DRAMA',
      ...info,
    });
  }

  // LIE_DETECTOR — 质疑成功最多
  const lieDetectorWinner = findMax(players, (p) => p.challengesSucceeded);
  if (lieDetectorWinner) {
    const info = MEDAL_INFO.LIE_DETECTOR;
    medals.push({
      playerId: lieDetectorWinner.id,
      nickname: lieDetectorWinner.nickname,
      medalType: 'LIE_DETECTOR',
      ...info,
    });
  }

  // PREY — 被指定为目标最多
  const preyWinner = findMax(players, (p) => p.timesTargeted);
  if (preyWinner) {
    const info = MEDAL_INFO.PREY;
    medals.push({
      playerId: preyWinner.id,
      nickname: preyWinner.nickname,
      medalType: 'PREY',
      ...info,
    });
  }

  // SOCIAL_DEATH — 被质疑命中最多
  const socialDeathWinner = findMax(players, (p) => p.challengesHit);
  if (socialDeathWinner) {
    const info = MEDAL_INFO.SOCIAL_DEATH;
    medals.push({
      playerId: socialDeathWinner.id,
      nickname: socialDeathWinner.nickname,
      medalType: 'SOCIAL_DEATH',
      ...info,
    });
  }

  // LURKER — 发起质疑最少且分数高于平均
  const avgScore = players.reduce((sum, p) => sum + p.score, 0) / Math.max(players.length, 1);
  const lurkerCandidates = players.filter((p) => p.score >= avgScore);
  const lurkerWinner = lurkerCandidates.length > 0
    ? findMin(lurkerCandidates, (p) => p.challengesMade)
    : null;
  if (lurkerWinner) {
    const info = MEDAL_INFO.LURKER;
    medals.push({
      playerId: lurkerWinner.id,
      nickname: lurkerWinner.nickname,
      medalType: 'LURKER',
      ...info,
    });
  }

  // DESTINY — 拿到极端任务最多
  const destinyWinner = findMax(players, (p) => p.extremeTasksDrawn);
  if (destinyWinner && destinyWinner.extremeTasksDrawn > 0) {
    const info = MEDAL_INFO.DESTINY;
    medals.push({
      playerId: destinyWinner.id,
      nickname: destinyWinner.nickname,
      medalType: 'DESTINY',
      ...info,
    });
  }

  return medals;
}

// ============================================
// 能力图计算（六维雷达图数据，0-100）
// ============================================
function computeAbilityChart(
  players: any[],
  playerIndex: number,
): { playerId: string; nickname: string; dimensions: Record<string, number> } {
  const player = players[playerIndex];
  if (!player) {
    return {
      playerId: '',
      nickname: '',
      dimensions: { wolfHeart: 0, eagleEye: 0, dramaBone: 0, magnetism: 0, ironSkin: 0, luck: 0 },
    };
  }

  // 计算所有玩家的各维度原始值
  const allWolfHeart = players.map((p) => p.tasksCompleted);
  const allEagleEye = players.map((p) => p.challengesMade > 0 ? p.challengesSucceeded / p.challengesMade : 0);
  const allDramaBone = players.map((p) => {
    const total = p.tasksCompleted + p.tasksDenied;
    return total > 0 ? p.tasksCompleted / total : 0.5;
  });
  const allMagnetism = players.map((p) => p.timesTargeted);
  const allIronSkin = players.map((p) => p.challengesReceived > 0 ? 1 - p.challengesHit / p.challengesReceived : 1);
  const allLuck = players.map((p) => {
    // 运气值：综合极端任务数 + 质疑成功 + 避免被命中
    let luck = 50;
    luck += p.extremeTasksDrawn * 8; // 拿到极端任务 = 命运的安排
    luck += p.challengesSucceeded * 5; // 质疑成功 = 运气好
    luck -= p.challengesHit * 10; // 被命中 = 运气差
    luck += p.tasksCompleted * 2; // 任务完成 = 手气好
    return luck;
  });

  // 归一化到 10-100 范围
  function normalize(value: number, allValues: number[]): number {
    const max = Math.max(...allValues, 1);
    return Math.round(10 + (value / max) * 90);
  }

  const idx = playerIndex;
  const dimensions = {
    wolfHeart: normalize(allWolfHeart[idx], allWolfHeart),
    eagleEye: normalize(allEagleEye[idx] * 100, allEagleEye.map((v) => v * 100)),
    dramaBone: normalize(allDramaBone[idx] * 100, allDramaBone.map((v) => v * 100)),
    magnetism: normalize(allMagnetism[idx], allMagnetism),
    ironSkin: normalize(allIronSkin[idx] * 100, allIronSkin.map((v) => v * 100)),
    luck: Math.max(10, Math.min(100, allLuck[idx])),
  };

  return {
    playerId: player.id,
    nickname: player.nickname,
    dimensions,
  };
}

// ============================================
// 辅助函数：找最大值对应玩家
// ============================================
function findMax<T extends { id: string; nickname: string }>(
  items: T[],
  selector: (item: T) => number,
): T | null {
  if (items.length === 0) return null;
  let maxVal = -Infinity;
  let winner: T | null = null;
  for (const item of items) {
    const val = selector(item);
    if (val > maxVal) {
      maxVal = val;
      winner = item;
    }
  }
  // 只在最大值 > 0 时颁发（避免全员0分也得勋章）
  return maxVal > 0 ? winner : null;
}

// ============================================
// 辅助函数：找最小值对应玩家
// ============================================
function findMin<T extends { id: string; nickname: string }>(
  items: T[],
  selector: (item: T) => number,
): T | null {
  if (items.length === 0) return null;
  let minVal = Infinity;
  let winner: T | null = null;
  for (const item of items) {
    const val = selector(item);
    if (val < minVal) {
      minVal = val;
      winner = item;
    }
  }
  return winner;
}
