import prisma from '../utils/prisma';
import { formatPlayerInfo, updateBottom2Status, AppError } from '../utils/helpers';

// ============================================
// 获取玩家状态（积分、后2名警告、任务列表）
// ============================================
export async function getPlayerStatus(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { tasks: true },
  });

  if (!player) throw new AppError(404, '玩家不存在');

  // 重新计算后2名状态
  await updateBottom2Status(player.gameId);

  // 重新获取更新后的玩家信息
  const updatedPlayer = await prisma.player.findUnique({
    where: { id: playerId },
  });

  const tasks = player.tasks
    .filter((t) => t.status === 'ACTIVE') // 只返回当前手牌
    .map((t) => ({
      id: t.id,
      content: t.content,
      difficulty: t.difficulty,
      points: t.points,
      taskType: t.taskType,
      targetType: t.targetType,
      targetName: t.targetName,
      punishmentContent: t.punishmentContent,
      status: t.status,
    }));

  return {
    player: formatPlayerInfo(updatedPlayer!),
    tasks,
  };
}

// ============================================
// 轮询获取待处理消息
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
    } else if (msg.type === 'CHALLENGE') {
      const challenge = await prisma.challenge.findUnique({
        where: { id: msg.relatedId },
        include: { challenger: true, challenged: true },
      });
      if (challenge) {
        content = {
          id: challenge.id,
          challengerId: challenge.challengerId,
          challengerNickname: challenge.challenger.nickname,
          challengedId: challenge.challengedId,
          challengedNickname: challenge.challenged.nickname,
          guessContent: challenge.guessContent,
          status: challenge.status,
        };
      }
    }

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
