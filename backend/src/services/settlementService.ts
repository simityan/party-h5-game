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
  // Bug I FIX: 所有并列最低分的玩家都标记 isLowest
  const minScore = players.length > 0 ? players[players.length - 1].score : 0;
  const rankings = players.map((p, index) => ({
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
    rank: index + 1,
    isLowest: p.score === minScore, // 所有最低分玩家
    tasksCompleted: p.tasksCompleted,
    challengesSucceeded: p.challengesSucceeded,
  }));

  // ======= 2. 未完成任务 =======
  // V2: ACTIVE + CANCELED 算未完成；CHALLENGED 表示惩罚已执行，不算未完成
  const uncompletedTasks = players.map((p) => {
    const unfinished = p.tasks.filter(
      (t) => t.status === 'ACTIVE' || t.status === 'CANCELED',
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
        primaryTargetId: t.primaryTargetId,
        primaryTargetName: t.primaryTargetName,
        secondaryTargetIds: t.secondaryTargetIds as string[],
        secondaryTargetNames: t.secondaryTargetNames as string[],
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
      denialTriggered?: boolean;
    },
    createdAt: new Date(event.createdAt).toISOString(),
  }));

  // ======= 4. 勋章颁发 =======
  const medals = computeMedals(players);

  // ======= 5. 能力图（所有玩家） =======
  const abilityCharts = players.map((_, index) => computeAbilityChart(players, index));

  // ======= 6. 团队奖惩 =======
  return {
    rankings,
    uncompletedTasks,
    events,
    medals,
    abilityCharts,
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

  // LURKER — 完成任务最少但质疑成功最多（V2: 不怎么出手，但谁也别想骗你）
  // 先找完成任务最少的玩家集合，再从中找质疑成功最多的
  const minCompleted = Math.min(...players.map((p) => p.tasksCompleted));
  const lurkerCandidates = players.filter((p) => p.tasksCompleted === minCompleted);
  const lurkerWinner = lurkerCandidates.length > 0
    ? findMax(lurkerCandidates, (p) => p.challengesSucceeded)
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
    // Bug E FIX: 零活动玩家 dramaBone = 0（从没声明完成过，不是50/50）
    return total > 0 ? p.tasksCompleted / total : 0;
  });
  const allMagnetism = players.map((p) => p.timesTargeted);
  // Bug F FIX: 未被质疑过的玩家 ironSkin = 0.5（未经考验，而非满分1.0）
  const allIronSkin = players.map((p) => p.challengesReceived > 0 ? 1 - p.challengesHit / p.challengesReceived : 0.5);
  const allLuck = players.map((p) => {
    // V2: 手气 = 手上出现过超难任务的比例
    // totalTasksDrawn 已包含所有抽到的任务数
    if (p.totalTasksDrawn > 0) {
      return (p.extremeTasksDrawn / p.totalTasksDrawn) * 100;
    }
    return 0;
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
    luck: normalize(allLuck[idx], allLuck),
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
