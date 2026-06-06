import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Popup, TextArea, Toast, Dialog, Badge } from 'antd-mobile';
import { getPlayerStatus, getPendingMessages, getFeed, getTips, declareComplete, challenge, confirmDeclare, confirmChallenge, discardTask, endGame, getGame } from '../api/game';
import type { PlayerInfo, PlayerTask, PendingMessage, GameEventItem, AnonymousTip, GameInfo, DeclareComplete as DeclareCompleteType, Challenge as ChallengeType } from '../types/game';

/**
 * 游戏主页 — 核心玩法页
 * 规则介绍 + 积分 + 后2名警告 + 任务卡 + 质疑 + 动态流 + 匿名爆料
 */
export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const playerId = localStorage.getItem('playerId') || '';

  // 状态
  const [game, setGame] = useState<GameInfo | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [tasks, setTasks] = useState<PlayerTask[]>([]);
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [feed, setFeed] = useState<GameEventItem[]>([]);
  const [tips, setTips] = useState<AnonymousTip[]>([]);

  // 弹窗状态
  const [showDeclarePopup, setShowDeclarePopup] = useState(false);
  const [declareTaskId, setDeclareTaskId] = useState('');
  const [declareTargetId, setDeclareTargetId] = useState('');

  const [showChallengePopup, setShowChallengePopup] = useState(false);
  const [challengeTargetId, setChallengeTargetId] = useState('');
  const [challengeGuess, setChallengeGuess] = useState('');

  const [showMessagePopup, setShowMessagePopup] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<PendingMessage | null>(null);

  // 消息列表弹窗：点击邮箱先展示所有待处理消息
  const [showMessageListPopup, setShowMessageListPopup] = useState(false);

  // 质疑命中选任务弹窗
  const [showHitTaskPopup, setShowHitTaskPopup] = useState(false);
  const [hitChallengeId, setHitChallengeId] = useState('');

  const [showRules, setShowRules] = useState(false);

  // 其他玩家（不含自己）
  const otherPlayers = game?.players.filter((p) => p.id !== playerId) || [];

  // 难度显示
  const difficultyLabel: Record<string, { emoji: string; color: string; points: string }> = {
    EASY: { emoji: '🟢', color: 'text-green-500', points: '+1' },
    MEDIUM: { emoji: '🟡', color: 'text-yellow-500', points: '+2' },
    HARD: { emoji: '🔴', color: 'text-red-500', points: '+3' },
    EXTREME: { emoji: '💀', color: 'text-purple-500', points: '+5' },
  };

  // ========== 轮询 ==========

  const fetchGameInfo = useCallback(async () => {
    if (!gameId) return;
    try {
      const data = await getGame(gameId);
      setGame(data);
      // 游戏已结束，跳转结算
      if (data.status === 'ENDED') {
        navigate(`/settlement/${gameId}`);
      }
    } catch {
      // 静默失败
    }
  }, [gameId, navigate]);

  const fetchStatus = useCallback(async () => {
    if (!playerId) return;
    try {
      const data = await getPlayerStatus(playerId);
      setPlayer(data.player);
      setTasks(data.tasks);
    } catch {
      // 静默失败
    }
  }, [playerId]);

  const fetchMessages = useCallback(async () => {
    if (!playerId) return;
    try {
      const data = await getPendingMessages(playerId);
      setMessages(data.filter((m) => !m.isHandled));
    } catch {
      // 静默失败
    }
  }, [playerId]);

  const fetchFeed = useCallback(async () => {
    if (!gameId) return;
    try {
      const data = await getFeed(gameId);
      setFeed(data);
    } catch {
      // 静默失败
    }
  }, [gameId]);

  const fetchTips = useCallback(async () => {
    if (!gameId) return;
    try {
      const data = await getTips(gameId);
      setTips(data);
    } catch {
      // 静默失败
    }
  }, [gameId]);

  // 主轮询：3秒一次
  useEffect(() => {
    fetchGameInfo();
    fetchStatus();
    fetchMessages();
    fetchFeed();
    fetchTips();

    const timer = setInterval(() => {
      fetchGameInfo();
      fetchStatus();
      fetchMessages();
      fetchFeed();
      fetchTips();
    }, 3000);

    return () => clearInterval(timer);
  }, [fetchGameInfo, fetchStatus, fetchMessages, fetchFeed, fetchTips]);

  // ========== 操作 ==========

  const handleDeclare = async () => {
    if (!declareTargetId) {
      Toast.show({ icon: 'fail', content: '请选择目标玩家' });
      return;
    }
    try {
      await declareComplete(playerId, { taskId: declareTaskId, targetId: declareTargetId });
      Toast.show({ icon: 'success', content: '已声明完成，等待目标确认' });
      setShowDeclarePopup(false);
      setDeclareTargetId('');
      fetchStatus();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '声明失败' });
    }
  };

  const handleChallenge = async () => {
    if (!challengeTargetId) {
      Toast.show({ icon: 'fail', content: '请选择被质疑的玩家' });
      return;
    }
    if (!challengeGuess.trim()) {
      Toast.show({ icon: 'fail', content: '请输入你猜测的任务内容' });
      return;
    }
    try {
      await challenge(playerId, {
        challengedId: challengeTargetId,
        guessContent: challengeGuess.trim(),
      });
      Toast.show({ icon: 'success', content: '已发起质疑' });
      setShowChallengePopup(false);
      setChallengeTargetId('');
      setChallengeGuess('');
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '质疑失败' });
    }
  };

  const handleDiscard = async (taskId: string) => {
    const result = await Dialog.confirm({
      title: '确认换牌？',
      content: '弃牌后刷新同难度新任务',
    });
    if (result) {
      try {
        await discardTask(taskId);
        Toast.show({ icon: 'success', content: '已换牌' });
        fetchStatus();
      } catch (err: any) {
        Toast.show({ icon: 'fail', content: err?.response?.data?.message || '换牌失败' });
      }
    }
  };

  const handleEndGame = async () => {
    const result = await Dialog.confirm({
      title: '确认结束游戏？',
      content: '需要超过半数玩家点击结束才会结算',
    });
    if (result) {
      try {
        const res = await endGame(gameId!, playerId);
        if (res.allVoted) {
          Toast.show({ icon: 'success', content: '全员已结束，正在结算...' });
        } else {
          Toast.show({ icon: 'success', content: '已投票结束，等待其他玩家' });
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
    if (!currentMessage) return;
    try {
      await confirmDeclare(playerId, {
        declareId: currentMessage.relatedId,
        confirmed,
      });
      Toast.show({ icon: 'success', content: confirmed ? '已确认' : '已否认' });
      setShowMessagePopup(false);
      setCurrentMessage(null);
      fetchMessages();
      fetchStatus();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '操作失败' });
    }
  };

  // 质疑确认：猜中 → 弹出选任务弹窗
  const handleChallengeHit = () => {
    if (!currentMessage) return;
    setHitChallengeId(currentMessage.relatedId);
    setShowMessagePopup(false);
    setShowHitTaskPopup(true);
  };

  // 选择命中任务后提交
  const handleHitTaskConfirm = async (hitTaskId: string) => {
    try {
      await confirmChallenge(playerId, {
        challengeId: hitChallengeId,
        hit: true,
        hitTaskId,
      });
      Toast.show({ icon: 'success', content: '已确认猜中' });
      setShowHitTaskPopup(false);
      setCurrentMessage(null);
      fetchMessages();
      fetchStatus();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '操作失败' });
    }
  };

  // 质疑确认：没猜中
  const handleChallengeMiss = async () => {
    if (!currentMessage) return;
    try {
      await confirmChallenge(playerId, {
        challengeId: currentMessage.relatedId,
        hit: false,
      });
      Toast.show({ icon: 'success', content: '已否认' });
      setShowMessagePopup(false);
      setCurrentMessage(null);
      fetchMessages();
      fetchStatus();
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '操作失败' });
    }
  };

  if (!player) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <div className="max-w-md mx-auto">
        {/* 顶部区域 */}
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

          {/* 积分 */}
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

          {/* 规则折叠 */}
          {showRules && (
            <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
              <p>• 线下引导目标做出指定行为，完成后点击"声明完成"</p>
              <p>• 目标确认后你得分，目标受惩罚</p>
              <p>• 随时可以质疑，猜中对方任务可反杀得分</p>
              <p>• 不满意任务可以换牌，无冷却</p>
              <p>• 每条任务只能声明一次，否认后不可重试</p>
            </div>
          )}
        </div>

        {/* 任务卡区域 */}
        <div className="p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700">你的任务</div>
          {tasks.map((task) => {
            const dl = difficultyLabel[task.difficulty] || difficultyLabel.EASY;
            return (
              <div
                key={task.id}
                className={`bg-white rounded-xl p-4 shadow-sm difficulty-${task.difficulty.toLowerCase()}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{dl.emoji}</span>
                      <span className={`text-xs font-bold ${dl.color}`}>{dl.points}</span>
                    </div>
                    <div className="text-sm font-medium text-gray-800">{task.content}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      → {task.targetName || (task.targetType === 'ANYONE' ? '任意' : '指定')}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      惩罚：{task.punishmentContent}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="small"
                    color="primary"
                    onClick={() => {
                      setDeclareTaskId(task.id);
                      setDeclareTargetId('');
                      setShowDeclarePopup(true);
                    }}
                  >
                    ✅ 声明完成
                  </Button>
                  <Button
                    size="small"
                    fill="outline"
                    onClick={() => handleDiscard(task.id)}
                  >
                    🔄 换牌
                  </Button>
                </div>
              </div>
            );
          })}

          {/* 质疑按钮 */}
          <Button
            color="warning"
            block
            shape="rounded"
            className="mt-2"
            onClick={() => {
              setChallengeTargetId('');
              setChallengeGuess('');
              setShowChallengePopup(true);
            }}
          >
            🛡️ 质疑
          </Button>
        </div>

        {/* 动态流 */}
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
                      <br />
                      <span className="text-gray-400 pl-4">{event.content.challengedNickname}惩罚：{event.content.punishmentContent}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 匿名爆料 */}
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

      {/* ========== 弹窗：声明完成 ========== */}
      <Popup
        visible={showDeclarePopup}
        onMaskClick={() => setShowDeclarePopup(false)}
        position="bottom"
        bodyStyle={{ maxHeight: '70vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">声明完成</h3>
          <p className="text-sm text-gray-500 mb-3">选择目标玩家（不可选自己）</p>
          {/* 玩家列表选择 */}
          <div className="space-y-2 mb-4">
            {otherPlayers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  declareTargetId === p.id
                    ? 'bg-purple-50 border-2 border-purple-400'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
                onClick={() => setDeclareTargetId(p.id)}
              >
                <span className="text-lg">👤</span>
                <span className="text-sm font-medium text-gray-700">{p.nickname}</span>
                {declareTargetId === p.id && <span className="ml-auto text-purple-500">✓</span>}
              </div>
            ))}
          </div>
          <Button color="primary" block shape="rounded" onClick={handleDeclare}>
            确认声明
          </Button>
        </div>
      </Popup>

      {/* ========== 弹窗：质疑 ========== */}
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
            <label className="block text-sm text-gray-500 mb-1">猜测的任务</label>
            <TextArea
              value={challengeGuess}
              onChange={setChallengeGuess}
              placeholder={'如"让我跟他碰杯"'}
              rows={2}
            />
          </div>
          <Button color="warning" block shape="rounded" onClick={handleChallenge}>
            发起质疑
          </Button>
        </div>
      </Popup>

      {/* ========== 弹窗：消息列表 ========== */}
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
                  <span className="text-lg">{msg.type === 'DECLARE_COMPLETE' ? '📋' : '🛡️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-700">
                      {msg.type === 'DECLARE_COMPLETE' ? '声明完成确认' : '质疑确认'}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {msg.type === 'DECLARE_COMPLETE'
                        ? `${(msg.content as DeclareCompleteType).declarerNickname} 声明完成任务`
                        : `${(msg.content as ChallengeType).challengerNickname} 质疑你`}
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

      {/* ========== 弹窗：消息确认（自定义居中遮罩） ========== */}
      {showMessagePopup && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowMessagePopup(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[85vw] max-w-[400px]">
            {currentMessage && (
              <div className="p-6">
                {currentMessage.type === 'DECLARE_COMPLETE' && (() => {
                  const dc = currentMessage.content as DeclareCompleteType;
                  return (
                    <>
                      <h3 className="text-base font-bold text-gray-800 mb-3">📋 声明完成确认</h3>
                      <div className="space-y-2 text-sm mb-4">
                        <p><span className="text-gray-500">发起方：</span>{dc.declarerNickname}</p>
                        <p><span className="text-gray-500">任务内容：</span>{dc.taskContent}</p>
                        <p><span className="text-gray-500">惩罚内容：</span>{dc.punishmentContent}</p>
                      </div>
                      <div className="flex gap-3">
                        <Button color="primary" className="flex-1" onClick={() => handleConfirmDeclare(true)}>
                          ✅ 确认
                        </Button>
                        <Button color="danger" fill="outline" className="flex-1" onClick={() => handleConfirmDeclare(false)}>
                          ❌ 否认
                        </Button>
                      </div>
                    </>
                  );
                })()}

                {currentMessage.type === 'CHALLENGE' && (() => {
                  const ch = currentMessage.content as ChallengeType;
                  return (
                    <>
                      <h3 className="text-base font-bold text-gray-800 mb-3">🛡️ 质疑确认</h3>
                      <div className="space-y-2 text-sm mb-4">
                        <p><span className="text-gray-500">质疑方：</span>{ch.challengerNickname}</p>
                        <p><span className="text-gray-500">猜测内容：</span>{ch.guessContent}</p>
                      </div>
                      <div className="flex gap-3">
                        <Button color="primary" className="flex-1" onClick={handleChallengeHit}>
                          ✅ 猜中了
                        </Button>
                        <Button color="danger" fill="outline" className="flex-1" onClick={handleChallengeMiss}>
                          ❌ 没猜中
                        </Button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== 弹窗：选择被命中的任务 ========== */}
      <Popup
        visible={showHitTaskPopup}
        onMaskClick={() => setShowHitTaskPopup(false)}
        position="bottom"
        bodyStyle={{ maxHeight: '70vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">🎯 选择被猜中的任务</h3>
          <p className="text-sm text-gray-500 mb-3">选择与质疑方猜测内容匹配的任务</p>
          <div className="space-y-2 mb-4">
            {tasks.filter((t) => t.status === 'ACTIVE').map((task) => {
              const dl = difficultyLabel[task.difficulty] || difficultyLabel.EASY;
              return (
                <div
                  key={task.id}
                  className="bg-gray-50 rounded-lg p-3 cursor-pointer hover:bg-purple-50 transition-colors"
                  onClick={() => handleHitTaskConfirm(task.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{dl.emoji}</span>
                    <span className="text-sm font-medium text-gray-800">{task.content}</span>
                  </div>
                  <div className="text-xs text-gray-400">→ {task.targetName || '任意'} | 惩罚：{task.punishmentContent}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Popup>
    </div>
  );
}
