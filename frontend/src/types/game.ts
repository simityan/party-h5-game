// 游戏状态枚举
export type GameStatus = 'WAITING' | 'PLAYING' | 'ENDED';
export type TaskDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
// V2: 移除 TargetType，目标由难度自动分配
export type PlayerTaskStatus = 'ACTIVE' | 'COMPLETED' | 'CHALLENGED' | 'CANCELED'; // V2: CANCELED = 游戏结束时仍ACTIVE的任务
export type ConfirmStatus = 'PENDING' | 'CONFIRMED' | 'DENIED';
export type ChallengeStatus = 'HIT' | 'MISS'; // V2: 移除 PENDING，自动判定
export type MessageType = 'DECLARE_COMPLETE'; // V2: 仅声明完成，质疑不再需要消息确认

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
  refreshChances: number; // V2: 剩余刷新次数
}

// 玩家任务（手牌）— V2 目标体系
export interface PlayerTask {
  id: string;
  content: string;
  difficulty: TaskDifficulty;
  points: number;
  taskType: string;
  // V2: 按难度自动分配目标
  primaryTargetId: string;
  primaryTargetName: string;
  secondaryTargetIds: string[];
  secondaryTargetNames: string[];
  punishmentContent: string;
  status: PlayerTaskStatus;
  declaredAt: string | null; // 声明完成的时间
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

// 质疑 — V2 自动匹配结果
export interface Challenge {
  id: string;
  challengerId: string;
  challengerNickname: string;
  challengedId: string;
  challengedNickname: string;
  guessContent: string;
  status: ChallengeStatus; // HIT | MISS
  // V2: 自动匹配信息
  similarityScore: number | null; // 相似度分数 (0-1)
  hitTaskId: string | null; // 自动匹配到的任务ID
  hitTaskContent: string | null; // 被命中的任务内容
  hitPunishmentContent: string | null; // 被命中的惩罚内容
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
    denialTriggered?: boolean; // V2: 否认触发质疑标记
  };
  createdAt: string;
}

// 匿名爆料
export interface AnonymousTip {
  id: string;
  content: string;
}

// 待处理消息 — V2: 仅声明完成
export interface PendingMessage {
  id: string;
  type: MessageType;
  relatedId: string;
  content: DeclareComplete | null; // V2: 后端找不到关联记录时返回 null
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
  abilityCharts: AbilityChart[];
  teamRewards: string[];
  teamPunishments: string[];
}

// V2 合并轮询数据（单请求获取全部游戏数据）
export interface PollData {
  game: GameInfo | null;
  player: PlayerInfo;
  tasks: PlayerTask[];
  messages: PendingMessage[];
  feed: GameEventItem[];
  tips: AnonymousTip[];
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
