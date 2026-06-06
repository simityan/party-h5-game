// 游戏状态枚举
export type GameStatus = 'WAITING' | 'PLAYING' | 'ENDED';
export type TaskDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
export type TargetType = 'ANYONE' | 'SPECIFIC_ONE' | 'SPECIFIC_MULTI';
export type PlayerTaskStatus = 'ACTIVE' | 'COMPLETED' | 'DENIED' | 'CHALLENGED' | 'DISCARDED';
export type ConfirmStatus = 'PENDING' | 'CONFIRMED' | 'DENIED';
export type ChallengeStatus = 'PENDING' | 'HIT' | 'MISS';
export type MessageType = 'DECLARE_COMPLETE' | 'CHALLENGE';

// 游戏信息
export interface GameInfo {
  id: string;
  code: string;
  status: GameStatus;
  playerCount: number;
  startTime: string | null;
  endTime: string;
  teamRewards: string[];
  teamPunishments: string[];
  players: PlayerInfo[];
}

// 玩家信息
export interface PlayerInfo {
  id: string;
  nickname: string;
  avatar: string | null;
  score: number;
  isBottom2: boolean;
  votedEnd: boolean;
}

// 玩家任务（手牌）
export interface PlayerTask {
  id: string;
  content: string;
  difficulty: TaskDifficulty;
  points: number;
  taskType: string;
  targetType: TargetType;
  targetName: string | null;
  punishmentContent: string;
  status: PlayerTaskStatus;
}

// 声明完成
export interface DeclareComplete {
  id: string;
  declarerId: string;
  declarerNickname: string;
  targetId: string;
  targetNickname: string;
  taskContent: string;
  punishmentContent: string;
  status: ConfirmStatus;
}

// 质疑
export interface Challenge {
  id: string;
  challengerId: string;
  challengerNickname: string;
  challengedId: string;
  challengedNickname: string;
  guessContent: string;
  status: ChallengeStatus;
}

// 动态流事件
export interface GameEventItem {
  id: string;
  type: 'COMPLETED' | 'CHALLENGED';
  content: {
    declarerNickname?: string;
    targetNickname?: string;
    challengerNickname?: string;
    challengedNickname?: string;
    taskContent: string;
    punishmentContent: string;
  };
  createdAt: string;
}

// 匿名爆料
export interface AnonymousTip {
  id: string;
  content: string;
}

// 待处理消息
export interface PendingMessage {
  id: string;
  type: MessageType;
  relatedId: string;
  content: DeclareComplete | Challenge;
  isRead: boolean;
  isHandled: boolean;
  createdAt: string;
}

// 结算数据
export interface SettlementData {
  rankings: RankingItem[];
  uncompletedTasks: UncompletedTaskItem[];
  events: GameEventItem[];
  medals: MedalItem[];
  abilityChart: AbilityChart;
  teamRewards: string[];
  teamPunishments: string[];
}

export interface RankingItem {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
  isLowest: boolean;
  tasksCompleted: number;
  challengesSucceeded: number;
}

export interface UncompletedTaskItem {
  playerId: string;
  nickname: string;
  tasks: PlayerTask[];
}

export interface MedalItem {
  playerId: string;
  nickname: string;
  medalType: string; // DRAMA | LIE_DETECTOR | PREY | SOCIAL_DEATH | LURKER | DESTINY
  medalName: string;
  medalEmoji: string;
  medalDescription: string;
}

export interface AbilityChart {
  playerId: string;
  nickname: string;
  dimensions: {
    wolfHeart: number;     // ⚔️ 狼性
    eagleEye: number;      // 👁️ 鹰眼
    dramaBone: number;     // 🎭 戏骨
    magnetism: number;     // 🧲 磁场
    ironSkin: number;      // 🛡️ 铁皮
    luck: number;          // 🎰 手气
  };
}
