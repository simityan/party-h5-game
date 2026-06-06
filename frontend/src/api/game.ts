import request from '../utils/request';
import type {
  GameInfo,
  PlayerInfo,
  PlayerTask,
  GameEventItem,
  AnonymousTip,
  PendingMessage,
  SettlementData,
  DeclareComplete,
  Challenge,
} from '../types/game';

// ==================== 游戏相关 ====================

/** 创建游戏 */
export function createGame(data: {
  playerCount: number;
  startTime?: string;
  endTime: string;
  teamRewards?: string[];
  teamPunishments?: string[];
}) {
  return request.post<unknown, GameInfo>('/game', data);
}

/** 获取游戏信息 */
export function getGame(gameId: string) {
  return request.get<unknown, GameInfo>(`/game/${gameId}`);
}

/** 开始游戏 */
export function startGame(gameId: string) {
  return request.post<unknown, GameInfo>(`/game/${gameId}/start`);
}

/** 结束游戏（玩家投票） */
export function endGame(gameId: string, playerId: string) {
  return request.post<unknown, { allVoted: boolean }>(`/game/${gameId}/end`, { playerId });
}

/** 获取结算数据 */
export function getSettlement(gameId: string) {
  return request.get<unknown, SettlementData>(`/game/${gameId}/settlement`);
}

// ==================== 玩家相关 ====================

/** 加入游戏 */
export function joinGame(data: { gameCode: string; openId: string; nickname: string }) {
  return request.post<unknown, { player: PlayerInfo; gameId: string }>('/player/join', data);
}

/** 获取玩家状态（积分、后2名、任务列表） */
export function getPlayerStatus(playerId: string) {
  return request.get<unknown, {
    player: PlayerInfo;
    tasks: PlayerTask[];
  }>(`/player/${playerId}/status`);
}

/** 轮询获取待处理消息 */
export function getPendingMessages(playerId: string) {
  return request.get<unknown, PendingMessage[]>(`/player/${playerId}/messages`);
}

/** 声明完成 */
export function declareComplete(playerId: string, data: {
  taskId: string;
  targetId: string;
}) {
  return request.post<unknown, DeclareComplete>(`/player/${playerId}/declare-complete`, data);
}

/** 发起质疑 */
export function challenge(playerId: string, data: {
  challengedId: string;
  guessContent: string;
}) {
  return request.post<unknown, Challenge>(`/player/${playerId}/challenge`, data);
}

/** 确认/否认声明完成 */
export function confirmDeclare(playerId: string, data: {
  declareId: string;
  confirmed: boolean;
}) {
  return request.post<unknown, { success: boolean }>(`/player/${playerId}/confirm-declare`, data);
}

/** 确认质疑（猜中/没猜中） */
export function confirmChallenge(playerId: string, data: {
  challengeId: string;
  hit: boolean;
  hitTaskId?: string;
}) {
  return request.post<unknown, { success: boolean }>(`/player/${playerId}/confirm-challenge`, data);
}

// ==================== 任务相关 ====================

/** 弃牌换牌 */
export function discardTask(taskId: string) {
  return request.post<unknown, PlayerTask>(`/task/${taskId}/discard`);
}

/** 获取动态流 */
export function getFeed(gameId: string) {
  return request.get<unknown, GameEventItem[]>(`/task/feed/${gameId}`);
}

/** 获取匿名爆料 */
export function getTips(gameId: string) {
  return request.get<unknown, AnonymousTip[]>(`/task/tips/${gameId}`);
}
