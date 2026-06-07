import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Popup, TextArea, Toast, Dialog, Badge } from 'antd-mobile';
import {
  pollGameData,
  declareComplete,
  challenge,
  confirmDeclare,
  refreshAllTasks,
  endGame,
} from '../api/game';
import type {
  PlayerInfo,
  PlayerTask,
  PendingMessage,
  GameEventItem,
  AnonymousTip,
  GameInfo,
  DeclareComplete as DeclareCompleteType,
  Challenge as ChallengeType,
} from '../types/game';

/**
 * 游戏主页 — V2 核心玩法页
 * V2 规则补充: 共享刷新池 + 难度目标分配 + 自动匹配质疑 + 否认→质疑 + 批量刷新 + 卡牌翻转
 */

// ========== 难度配置 ==========
const DIFFICULTY_CONFIG: Record<string, {
  emoji: string;
  color: string;
  points: string;
  rarityBg: string;
  rarityBorder: string;
  rarityLabel: string;
  glowShadow: string;
}> = {
  EASY: {
    emoji: '🟢',
    color: 'text-green-500',
    points: '+1',
    rarityBg: 'bg-white',
    rarityBorder: 'border-green-300',
    rarityLabel: '简单',
    glowShadow: 'shadow-sm',
  },
  MEDIUM: {
    emoji: '🟡',
    color: 'text-green-500',
    points: '+2',
    rarityBg: 'bg-green-50',
    rarityBorder: 'border-green-400',
    rarityLabel: '中等',
    glowShadow: 'shadow-sm',
  },
  HARD: {
    emoji: '🔴',
    color: 'text-orange-500',
    points: '+3',
    rarityBg: 'bg-white',
    rarityBorder: 'border-orange-400',
    rarityLabel: '困难',
    glowShadow: 'shadow-md',
  },
  EXTREME: {
    emoji: '💀',
    color: 'text-red-500',
    points: '+5',
    rarityBg: 'bg-white',
    rarityBorder: 'border-red-500',
    rarityLabel: '超难',
    glowShadow: 'shadow-lg',
  },
};

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const playerId = localStorage.getItem('playerId') || '';

  // ========== 状态（所有 Hook 必须在条件返回之前调用，遵守 React Rules of Hooks） ==========
  const [game, setGame] = useState<GameInfo | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [tasks, setTasks] = useState<PlayerTask[]>([]);
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [feed, setFeed] = useState<GameEventItem[]>([]);
  const [tips, setTips] = useState<AnonymousTip[]>([]);

  // 弹窗状态
  const [showDeclarePopup, setShowDeclarePopup] = useState(false);
  const [declareTaskId, setDeclareTaskId] = useState('');

  const [showChallengePopup, setShowChallengePopup] = useState(false);
  const [challengeTargetId, setChallengeTargetId] = useState('');
  const [challengeGuess, setChallengeGuess] = useState('');
  const [challengeResult, setChallengeResult] = useState<ChallengeType | null>(null);
  const [showChallengeResultPopup, setShowChallengeResultPopup] = useState(false);

  const [showMessagePopup, setShowMessagePopup] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<PendingMessage | null>(null);

  const [showMessageListPopup, setShowMessageListPopup] = useState(false);

  // 卡牌展开状态（点击卡片展开详情）
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const [showRules, setShowRules] = useState(false);

  // S1 FIX: 防止并发轮询重叠（前一次还没返回就触发下一次）
  const isPollingRef = useRef(false);

  // L3 FIX: 首次轮询失败时记录错误状态，避免永远卡在"加载中"
  const [loadError, setLoadError] = useState(false);

  // 错误提示节流：30秒内最多提示1次，避免轮询错误刷屏
  const lastErrorToastRef = useRef(0);
  const showErrorToast = useCallback((msg: string) => {
    const now = Date.now();
    if (now - lastErrorToastRef.current > 30000) {
      lastErrorToastRef.current = now;
      Toast.show({ icon: 'fail', content: msg });
    }
  }, []);

  // 合并轮询：单请求获取 game + player + tasks + messages + feed + tips
  const pollAll = useCallback(async () => {
    if (!playerId || isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const data = await pollGameData(playerId);
      setGame(data.game);
      setPlayer(data.player);
      setTasks(data.tasks);
      setMessages(data.messages.filter((m) => !m.isHandled));
      setFeed(data.feed);
      setTips(data.tips);
      setLoadError(false);
      // 游戏已结束 → 跳转结算页
      if (data.game?.status === 'ENDED' && gameId) {
        navigate(`/settlement/${gameId}`);
      }
      // L1 FIX: 游戏状态为 WAITING → 跳转大厅页（防止异常回退）
      if (data.game?.status === 'WAITING' && gameId) {
        navigate(`/lobby/${gameId}`, { replace: true });
      }
    } catch {
      setLoadError(true);
      showErrorToast('数据同步失败，请检查网络');
    } finally {
      isPollingRef.current = false;
    }
  }, [playerId, gameId, navigate, showErrorToast]);

  // playerId 缺失 → 跳转加入页
  useEffect(() => {
    if (!playerId) {
      navigate('/join', { replace: true });
    }
  }, [playerId, navigate]);

  // 主轮询：3秒一次
  useEffect(() => {
    if (!playerId) return;
    pollAll();
    const timer = setInterval(pollAll, 3000);
    return () => clearInterval(timer);
  }, [pollAll, playerId]);

  // 操作后手动刷新（复用合并轮询）
  const refreshAfterAction = useCallback(async () => {
    if (!playerId) return;
    try {
      const data = await pollGameData(playerId);
      setGame(data.game);
      setPlayer(data.player);
      setTasks(data.tasks);
      setMessages(data.messages.filter((m) => !m.isHandled));
      setFeed(data.feed);
      setTips(data.tips);
    } catch {
      // 操作后刷新失败不影响主流程，静默
    }
  }, [playerId]);

  // 其他玩家（不含自己）
  const otherPlayers = game?.players.filter((p) => p.id !== playerId) || [];

  // S2/S3 FIX: 操作中 loading 状态，防止重复点击
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ========== 操作 ==========

  // V2: 声明完成 — 不再需要选目标，由 task.primaryTargetId 自动获取
  const handleDeclare = async () => {
    if (actionLoading) return;
    setActionLoading('declare');
    try {
      await declareComplete(playerId, { taskId: declareTaskId });
      Toast.show({ icon: 'success', content: '已声明完成，等待目标确认' });
      setShowDeclarePopup(false);
      refreshAfterAction();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '声明失败' });
    } finally {
      setActionLoading(null);
    }
  };

  // V2: 质疑 — 自动匹配，即时返回结果
  const handleChallenge = async () => {
    if (!challengeTargetId) {
      Toast.show({ icon: 'fail', content: '请选择被质疑的玩家' });
      return;
    }
    if (!challengeGuess.trim()) {
      Toast.show({ icon: 'fail', content: '请输入你猜测的任务内容' });
      return;
    }
    if (actionLoading) return;
    setActionLoading('challenge');
    try {
      const result = await challenge(playerId, {
        challengedId: challengeTargetId,
        guessContent: challengeGuess.trim(),
      });
      setShowChallengePopup(false);
      setChallengeTargetId('');
      setChallengeGuess('');
      // V2: 直接展示自动匹配结果
      setChallengeResult(result);
      setShowChallengeResultPopup(true);
      refreshAfterAction();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '质疑失败' });
    } finally {
      setActionLoading(null);
    }
  };

  // V2: 批量刷新 — 替代弃牌换牌
  const handleRefresh = async () => {
    if (!player || player.refreshChances <= 0) {
      Toast.show({ icon: 'fail', content: '没有刷新次数了' });
      return;
    }
    // 检查是否有待确认的声明
    const hasPendingDeclare = tasks.some((t) => t.declaredAt && t.status === 'ACTIVE');
    if (hasPendingDeclare) {
      Toast.show({ icon: 'fail', content: '有待确认的声明，暂不能刷新' });
      return;
    }
    if (actionLoading) return;
    const result = await Dialog.confirm({
      title: '确认刷新全部手牌？',
      content: `剩余 ${player.refreshChances} 次刷新机会，刷新后消耗1次`,
    });
    if (result) {
      setActionLoading('refresh');
      try {
        const res = await refreshAllTasks(playerId);
        setTasks(res.tasks);
        setPlayer((prev) => prev ? { ...prev, refreshChances: res.refreshChances } : prev);
        Toast.show({ icon: 'success', content: `已刷新！剩余 ${res.refreshChances} 次` });
        // Bug O FIX: 刷新后同步 game/feed/tips/messages（直接更新只覆盖了 tasks 和 player）
        refreshAfterAction();
      } catch (err: any) {
        Toast.show({ icon: 'fail', content: err?.response?.data?.message || '刷新失败' });
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleEndGame = async () => {
    if (!gameId) {
      Toast.show({ icon: 'fail', content: '游戏信息异常' });
      return;
    }
    const result = await Dialog.confirm({
      title: '确认结束游戏？',
      content: '需要全员同意才会结算（所有玩家都点击结束）',
    });
    if (result) {
      try {
        const res = await endGame(gameId, playerId);
        if (res.allVoted) {
          Toast.show({ icon: 'success', content: '全员已结束，正在结算...' });
        } else {
          Toast.show({ icon: 'success', content: `已投票结束（${res.votedCount}/${res.totalPlayers}），等待其他玩家` });
        }
      } catch (err: any) {
        Toast.show({ icon: 'fail', content: err?.response?.data?.message || '操作失败' });
      }
    }
  };

  // 处理待确认消息
  const handleOpenMessage = (msg: PendingMessage) => {
    setCurrentMessage(msg);
    setShowMessagePopup(true);
  };

  const handleConfirmDeclare = async (confirmed: boolean) => {
    if (!currentMessage || actionLoading) return;
    setActionLoading('confirm');
    try {
      await confirmDeclare(playerId, {
        declareId: currentMessage.relatedId,
        confirmed,
      });
      Toast.show({ icon: 'success', content: confirmed ? '已确认' : '已否认' });
      setShowMessagePopup(false);
      setCurrentMessage(null);
      refreshAfterAction();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '操作失败' });
    } finally {
      setActionLoading(null);
    }
  };

  if (!player) {
    // L3 FIX: 首次轮询失败时提供重试按钮，而非永远卡在"加载中"
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen text-gray-400 gap-4">
          <div>加载失败，请检查网络</div>
          <Button
            size="small"
            color="primary"
            fill="outline"
            onClick={() => { setLoadError(false); pollAll(); }}
          >
            重新加载
          </Button>
        </div>
      );
    }
    return <div className="flex items-center justify-center min-h-screen text-gray-400">加载中...</div>;
  }

  // ========== 渲染 ==========

  // 按难度排序：EASY → MEDIUM → HARD → EXTREME
  const difficultyOrder: Record<string, number> = { EASY: 0, MEDIUM: 1, HARD: 2, EXTREME: 3 };
  // Bug P FIX: 未知难度回退到 99，避免 undefined - undefined = NaN
  const sortedTasks = [...tasks].sort((a, b) => (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99));

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <div className="max-w-md mx-auto">
        {/* ====== 顶部区域 ====== */}
        <div className="bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800">🎭 游戏进行中</h1>
            <div className="flex items-center gap-2">
              <Badge content={messages.length > 0 ? messages.length : undefined}>
                <Button size="small" onClick={() => { if (messages.length > 0) setShowMessageListPopup(true); }}>
                  📬 消息
                </Button>
              </Badge>
            </div>
          </div>

          {/* 积分 + 刷新次数 */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">🏆 当前积分</span>
            <span className="text-xl font-bold text-purple-600">{player.score}分</span>
          </div>

          {/* 后2名警告 */}
          {player.isBottom2 && (
            <div className="mt-2 bg-red-50 text-red-600 text-xs rounded-lg p-2 text-center">
              ⚠️ 你当前处于后2名，加油！
            </div>
          )}

          {/* 操作按钮行 */}
          <div className="mt-3 flex gap-2">
            <Button size="small" onClick={() => setShowRules(!showRules)}>
              📜 {showRules ? '收起规则' : '规则介绍'}
            </Button>
            <Button size="small" color="danger" fill="outline" onClick={handleEndGame}>
              结束游戏
            </Button>
          </div>

          {/* V2 规则折叠 */}
          {showRules && (
            <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
              <p>• 线下引导目标做出指定行为，完成后点击"声明完成"</p>
              <p>• 目标确认后你得分，目标受惩罚</p>
              <p>• 目标否认 → 自动触发质疑，双方各+1刷新机会</p>
              <p>• 随时可以质疑，输入猜测后系统自动匹配判定</p>
              <p>• 不满意手牌可批量刷新全部3张，初始3次机会</p>
              <p>• 3张手牌全部解决（完成或被质疑命中）时，+3刷新机会</p>
              <p>• 所有玩家共享任务池，已完成的任务不会再出现</p>
            </div>
          )}
        </div>

        {/* ====== 任务卡区域 — V2: 3张竖卡横排 + 卡牌翻转 ====== */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700">你的手牌</div>
            {/* V2: 统一刷新按钮 */}
            <Button
              size="small"
              fill="outline"
              onClick={handleRefresh}
              loading={actionLoading === 'refresh'}
              disabled={!player || player.refreshChances <= 0}
            >
              🔄 刷新全部 ({player?.refreshChances ?? 0})
            </Button>
          </div>

          {/* 三张卡横排 */}
          <div className="flex gap-3 justify-center">
            {sortedTasks.map((task) => {
              const dc = DIFFICULTY_CONFIG[task.difficulty] || DIFFICULTY_CONFIG.EASY;
              const isResolved = task.status === 'COMPLETED' || task.status === 'CHALLENGED' || task.status === 'CANCELED';
              const isExpanded = expandedTaskId === task.id;

              return (
                <div
                  key={task.id}
                  className="flex-1 min-w-0 max-w-[120px]"
                  style={{ perspective: '1000px' }}
                  onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                >
                  <div
                    className={`relative w-full transition-transform duration-500 ${isExpanded ? '' : ''}`}
                    style={{
                      transformStyle: 'preserve-3d',
                      transform: isResolved ? 'rotateY(180deg)' : 'none',
                      minHeight: '180px',
                    }}
                  >
                    {/* ===== 正面 — 活跃卡 ===== */}
                    <div
                      className={`absolute inset-0 rounded-xl border-2 ${dc.rarityBorder} ${dc.rarityBg} ${dc.glowShadow} p-3 flex flex-col justify-between cursor-pointer`}
                      style={{
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        touchAction: 'manipulation',
                      }}
                    >
                      {/* 顶部：难度 + 积分 */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm">{dc.emoji}</span>
                          <span className={`text-xs font-bold ${dc.color}`}>{dc.points}</span>
                        </div>
                        {/* 任务内容 */}
                        <div className="text-xs font-medium text-gray-800 leading-snug line-clamp-3">
                          {task.content}
                        </div>
                      </div>

                      {/* 底部：目标 + 惩罚 */}
                      <div className="mt-2">
                        <div className="text-[10px] text-gray-400 truncate">
                          → {task.primaryTargetName}
                          {task.secondaryTargetNames.length > 0 && (
                            <span className="text-gray-300"> +{task.secondaryTargetNames.length}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-300 truncate">
                          惩罚：???
                        </div>
                      </div>

                      {/* 展开时的操作按钮 */}
                      {isExpanded && !isResolved && (
                        <div className="mt-2">
                          <Button
                            size="mini"
                            color="primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeclareTaskId(task.id);
                              setShowDeclarePopup(true);
                            }}
                          >
                            ✅ 完成
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* ===== 背面 — 已解决卡（翻转后展示状态+惩罚） ===== */}
                    <div
                      className={`absolute inset-0 rounded-xl border-2 ${
                        task.status === 'COMPLETED'
                          ? 'border-green-400 bg-green-50'
                          : task.status === 'CANCELED'
                            ? 'border-gray-400 bg-gray-50'
                            : 'border-red-400 bg-red-50'
                      } p-3 flex flex-col items-center justify-center`}
                      style={{
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        touchAction: 'manipulation',
                      }}
                    >
                      <div className="text-2xl mb-1">
                        {task.status === 'COMPLETED' ? '✅' : task.status === 'CANCELED' ? '❌' : '🛡️'}
                      </div>
                      <div className="text-[10px] font-bold text-gray-700 text-center leading-tight">
                        {task.status === 'COMPLETED' ? '已完成' : task.status === 'CANCELED' ? '未完成' : '被质疑'}
                      </div>
                      {task.status !== 'CANCELED' && (
                        <div className="mt-2 w-full border-t border-dashed border-gray-300 pt-1">
                          <div className="text-[9px] text-gray-400 text-center">⚠️ 惩罚</div>
                          <div className="text-[10px] font-medium text-red-600 text-center leading-tight line-clamp-3">
                            {task.punishmentContent}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 展开详情面板 */}
          {expandedTaskId && (() => {
            const task = sortedTasks.find((t) => t.id === expandedTaskId);
            if (!task || task.status !== 'ACTIVE') return null;
            const dc = DIFFICULTY_CONFIG[task.difficulty] || DIFFICULTY_CONFIG.EASY;
            return (
              <div className={`mt-3 rounded-xl border-2 ${dc.rarityBorder} bg-white p-4 shadow-sm`}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{dc.emoji}</span>
                  <span className={`text-xs font-bold ${dc.color}`}>{dc.rarityLabel} {dc.points}</span>
                  <span className="text-xs text-gray-400 ml-auto">{task.taskType}</span>
                </div>
                <div className="text-sm font-medium text-gray-800 mb-2">{task.content}</div>
                <div className="space-y-1 text-xs text-gray-500">
                  <p>🎯 主目标：<span className="text-gray-700 font-medium">{task.primaryTargetName}</span></p>
                  {task.secondaryTargetNames.length > 0 && (
                    <p>👥 次要目标：<span className="text-gray-700 font-medium">{task.secondaryTargetNames.join('、')}</span></p>
                  )}
                  <p>⚠️ 惩罚：<span className="text-gray-700">{task.punishmentContent}</span></p>
                </div>
              </div>
            );
          })()}

          {/* 质疑按钮 */}
          <Button
            color="warning"
            block
            shape="rounded"
            className="mt-4"
            onClick={() => {
              setChallengeTargetId('');
              setChallengeGuess('');
              setChallengeResult(null);
              setShowChallengePopup(true);
            }}
          >
            🛡️ 质疑
          </Button>
        </div>

        {/* ====== 动态流 ====== */}
        <div className="bg-white mx-4 rounded-xl p-4 shadow-sm mb-3">
          <div className="text-sm font-medium text-gray-700 mb-2">📡 动态流</div>
          {feed.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-2">暂无动态</div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {feed.map((event) => (
                <div key={event.id} className="text-xs text-gray-600">
                  {event.type === 'COMPLETED' && (
                    <>
                      🎉 {event.content.declarerNickname} 让 {event.content.targetNickname} {event.content.taskContent} ✓
                      <br />
                      <span className="text-gray-400 pl-4">{event.content.targetNickname}惩罚：{event.content.punishmentContent}</span>
                    </>
                  )}
                  {event.type === 'CHALLENGED' && (
                    <>
                      🛡️ {event.content.challengerNickname} 质疑 {event.content.challengedNickname}「{event.content.taskContent}」✓
                      {event.content.denialTriggered && <span className="text-red-400 ml-1">(否认触发)</span>}
                      <br />
                      <span className="text-gray-400 pl-4">{event.content.challengedNickname}惩罚：{event.content.punishmentContent}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ====== 匿名爆料 ====== */}
        <div className="bg-white mx-4 rounded-xl p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-700 mb-2">💡 匿名爆料</div>
          {tips.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-2">暂无爆料</div>
          ) : (
            <div className="space-y-1">
              {tips.map((tip) => (
                <div key={tip.id} className="text-xs text-gray-500 py-1">
                  💡 {tip.content}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====== 弹窗：声明完成 — V2: 不再需要选目标 ====== */}
      <Popup
        visible={showDeclarePopup}
        onMaskClick={() => setShowDeclarePopup(false)}
        position="bottom"
        bodyStyle={{ maxHeight: '70vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-800 mb-2">✅ 声明完成</h3>
          {(() => {
            const task = tasks.find((t) => t.id === declareTaskId);
            if (!task) return null;
            return (
              <>
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <div className="text-sm font-medium text-gray-800 mb-1">{task.content}</div>
                  <div className="text-xs text-gray-500">
                    目标：{task.primaryTargetName}
                    {task.secondaryTargetNames.length > 0 && `、${task.secondaryTargetNames.join('、')}`}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">惩罚：{task.punishmentContent}</div>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  声明后目标玩家将收到确认请求。若目标否认，将自动触发质疑流程。
                </p>
                <Button color="primary" block shape="rounded" loading={actionLoading === 'declare'} onClick={handleDeclare}>
                  确认声明
                </Button>
              </>
            );
          })()}
        </div>
      </Popup>

      {/* ====== 弹窗：质疑 — V2: 输入猜测后自动匹配 ====== */}
      <Popup
        visible={showChallengePopup}
        onMaskClick={() => setShowChallengePopup(false)}
        position="bottom"
        bodyStyle={{ maxHeight: '70vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">🛡️ 质疑</h3>
          <p className="text-sm text-gray-500 mb-3">选择被质疑的玩家</p>
          {/* 玩家列表选择 */}
          <div className="space-y-2 mb-4">
            {otherPlayers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  challengeTargetId === p.id
                    ? 'bg-orange-50 border-2 border-orange-400'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
                onClick={() => setChallengeTargetId(p.id)}
              >
                <span className="text-lg">👤</span>
                <span className="text-sm font-medium text-gray-700">{p.nickname}</span>
                {challengeTargetId === p.id && <span className="ml-auto text-orange-500">✓</span>}
              </div>
            ))}
          </div>
          <div className="mb-4">
            <label className="block text-sm text-gray-500 mb-1">猜测的任务内容</label>
            <TextArea
              value={challengeGuess}
              onChange={setChallengeGuess}
              placeholder={'如"让他跟你碰杯"'}
              rows={2}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              系统将自动匹配对方手牌，相似度≥75%即判定命中
            </p>
          </div>
          <Button color="warning" block shape="rounded" loading={actionLoading === 'challenge'} onClick={handleChallenge}>
            发起质疑
          </Button>
        </div>
      </Popup>

      {/* ====== 弹窗：质疑结果 — V2 自动匹配 ====== */}
      <Popup
        visible={showChallengeResultPopup}
        onMaskClick={() => setShowChallengeResultPopup(false)}
        position="bottom"
        bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          {challengeResult && (
            <>
              {challengeResult.status === 'HIT' ? (
                <>
                  <div className="text-center mb-4">
                    <div className="text-4xl mb-2">🎯</div>
                    <h3 className="text-lg font-bold text-green-600">质疑命中！</h3>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 mb-4">
                    {/* T1/A1 FIX: hitTaskContent / hitPunishmentContent 可能为 null，加 null guard */}
                    <div className="text-sm text-gray-700 mb-1">
                      <span className="font-medium">匹配任务：</span>{challengeResult.hitTaskContent ?? '未知'}
                    </div>
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">惩罚：</span>{challengeResult.hitPunishmentContent ?? '未知'}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      相似度：{challengeResult.similarityScore != null ? `${Math.round(challengeResult.similarityScore * 100)}%` : '—'}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center">
                    你获得质疑得分，对方接受惩罚
                  </p>
                </>
              ) : (
                <>
                  <div className="text-center mb-4">
                    <div className="text-4xl mb-2">💨</div>
                    <h3 className="text-lg font-bold text-gray-500">未命中</h3>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <div className="text-xs text-gray-500 text-center">
                      相似度：{challengeResult.similarityScore != null ? `${Math.round(challengeResult.similarityScore * 100)}%` : '—'}（需≥75%才算命中）
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center">
                    质疑失败，无额外惩罚
                  </p>
                </>
              )}
              <Button
                block
                shape="rounded"
                className="mt-4"
                onClick={() => {
                  setShowChallengeResultPopup(false);
                  setChallengeResult(null);
                }}
              >
                知道了
              </Button>
            </>
          )}
        </div>
      </Popup>

      {/* ====== 弹窗：消息列表 ====== */}
      <Popup
        visible={showMessageListPopup}
        onMaskClick={() => setShowMessageListPopup(false)}
        position="bottom"
        bodyStyle={{ maxHeight: '70vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">📬 待处理消息 ({messages.length})</h3>
          {messages.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">暂无待处理消息</div>
          ) : (
            <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 cursor-pointer hover:bg-purple-50 transition-colors"
                  onClick={() => {
                    setShowMessageListPopup(false);
                    handleOpenMessage(msg);
                  }}
                >
                  <span className="text-lg">📋</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-700">声明完成确认</div>
                    <div className="text-xs text-gray-400 truncate">
                      {msg.content ? (msg.content as DeclareCompleteType).declarerNickname : '某玩家'} 声明完成任务
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Popup>

      {/* ====== 弹窗：消息确认（声明完成 确认/否认） ====== */}
      {showMessagePopup && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowMessagePopup(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[85vw] max-w-[400px]">
            {currentMessage && currentMessage.content ? (() => {
              const dc = currentMessage.content as DeclareCompleteType;
              return (
                <div className="p-6">
                  <h3 className="text-base font-bold text-gray-800 mb-3">📋 声明完成确认</h3>
                  <div className="space-y-2 text-sm mb-4">
                    <p><span className="text-gray-500">发起方：</span>{dc.declarerNickname}</p>
                    <p><span className="text-gray-500">任务内容：</span>{dc.taskContent}</p>
                    <p><span className="text-gray-500">惩罚内容：</span>{dc.punishmentContent}</p>
                  </div>
                  <p className="text-[10px] text-gray-400 mb-4">
                    否认将自动触发质疑流程，双方各获得+1刷新机会
                  </p>
                  <div className="flex gap-3">
                    <Button color="primary" className="flex-1" loading={actionLoading === 'confirm'} onClick={() => handleConfirmDeclare(true)}>
                      ✅ 确认
                    </Button>
                    <Button color="danger" fill="outline" className="flex-1" loading={actionLoading === 'confirm'} onClick={() => handleConfirmDeclare(false)}>
                      ❌ 否认
                    </Button>
                  </div>
                </div>
              );
            })() : (
              /* L2 FIX: content 为空时显示提示而非空白弹窗 */
              <div className="p-6 text-center text-gray-400">
                <p>消息内容加载失败</p>
                <Button size="small" fill="outline" className="mt-3" onClick={() => setShowMessagePopup(false)}>关闭</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
