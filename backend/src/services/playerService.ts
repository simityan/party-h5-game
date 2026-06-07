import prisma from '../utils/prisma';
import { formatPlayerInfo, updateBottom2Status, AppError } from '../utils/helpers';

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

  // 重新计算后2名状态
  await updateBottom2Status(player.gameId);

  // 重新获取更新后的玩家信息
  const updatedPlayer = await prisma.player.findUnique({
    where: { id: playerId },
  });

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
    player: formatPlayerInfo(updatedPlayer!),
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
