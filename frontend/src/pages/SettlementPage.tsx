import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { List, Toast } from 'antd-mobile';
import { getSettlement } from '../api/game';
import RadarChart from '../components/RadarChart';
import type { SettlementData, MedalItem, AbilityChart } from '../types/game';

/**
 * 结算页 — 排名 + 未完成任务 + 精彩回放 + 勋章 + 能力图 + 奖惩
 */
export default function SettlementPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SettlementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0); // 0-5 对应六步
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState(0); // 能力图玩家选择

  useEffect(() => {
    const fetchSettlement = async () => {
      try {
        const result = await getSettlement(gameId!) as SettlementData;
        setData(result);
      } catch {
        Toast.show({ icon: 'fail', content: '获取结算数据失败' });
      } finally {
        setLoading(false);
      }
    };
    fetchSettlement();
  }, [gameId]);

  // 步骤自动推进动画
  useEffect(() => {
    if (!data || currentStep >= 5) return;
    const timer = setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
    }, 4000);
    return () => clearTimeout(timer);
  }, [data, currentStep]);

  const steps = ['排名公布', '未完成任务', '精彩回放', '勋章颁发', '能力图', '奖惩执行'];

  // 手动切换步骤时重置自动推进
  const handleStepClick = useCallback((idx: number) => {
    setCurrentStep(idx);
  }, []);

  // 勋章映射
  const medalInfo: Record<string, Omit<MedalItem, 'playerId' | 'nickname'>> = {
    DRAMA: { medalType: 'DRAMA', medalName: '戏精勋章', medalEmoji: '🎭', medalDescription: '天生演员，每个眼神都是戏，你身边的朋友没有一个是安全的' },
    LIE_DETECTOR: { medalType: 'LIE_DETECTOR', medalName: '测谎勋章', medalEmoji: '🛡️', medalDescription: '你的雷达永远在线，谁想害你一眼看穿' },
    PREY: { medalType: 'PREY', medalName: '猎物勋章', medalEmoji: '🐟', medalDescription: '全场最单纯的存在，鱼的记忆，神的信任' },
    SOCIAL_DEATH: { medalType: 'SOCIAL_DEATH', medalName: '社死勋章', medalEmoji: '💀', medalDescription: '社死的尽头是重生，下次还敢' },
    LURKER: { medalType: 'LURKER', medalName: '潜伏勋章', medalEmoji: '🤫', medalDescription: '不怎么出手，但谁也别想骗你' },
    DESTINY: { medalType: 'DESTINY', medalName: '天命勋章', medalEmoji: '🍀', medalDescription: '命运总给你最离谱的牌，但你还活着' },
  };

  // 能力维度中文映射
  const dimensionLabels: Record<string, { name: string; emoji: string; desc: string }> = {
    wolfHeart: { name: '狼性', emoji: '⚔️', desc: '你有多能套路朋友' },
    eagleEye: { name: '鹰眼', emoji: '👁️', desc: '你有多能看穿套路' },
    dramaBone: { name: '戏骨', emoji: '🎭', desc: '你骗人的时候有多自然' },
    magnetism: { name: '磁场', emoji: '🧲', desc: '你有多容易成为目标' },
    ironSkin: { name: '铁皮', emoji: '🛡️', desc: '你有多能躲过惩罚' },
    luck: { name: '手气', emoji: '🎰', desc: '你的命有多离谱' },
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">结算中...</div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">结算数据加载失败</div>;
  }

  // 当前选中的能力图
  const currentChart: AbilityChart | undefined = data.abilityCharts?.[selectedPlayerIdx];

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="max-w-md mx-auto">
        {/* 标题 */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-center p-6">
          <h1 className="text-2xl font-bold">🎊 游戏结束</h1>
          <p className="text-sm opacity-80 mt-1">害你在心口难开 · 动作版</p>
        </div>

        {/* 步骤导航 */}
        <div className="flex overflow-x-auto bg-white p-2 shadow-sm gap-1">
          {steps.map((step, i) => (
            <button
              key={i}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors duration-300 ${
                currentStep === i
                  ? 'bg-purple-600 text-white'
                  : i < currentStep
                  ? 'bg-purple-100 text-purple-600'
                  : 'bg-gray-100 text-gray-500'
              }`}
              onClick={() => handleStepClick(i)}
            >
              {step}
            </button>
          ))}
        </div>

        {/* 进度条 */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-purple-600 transition-all duration-1000 ease-out"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* 第一步：排名公布 */}
        {currentStep === 0 && (
          <div className="p-4 space-y-2">
            {data.rankings.map((r) => (
              <div
                key={r.playerId}
                className={`bg-white rounded-xl p-4 shadow-sm transition-all duration-500 ${
                  r.isLowest ? 'ring-2 ring-red-400' : ''
                } ${r.rank === 1 ? 'ring-2 ring-yellow-400' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${
                      r.rank === 1 ? 'text-yellow-500' : r.rank === 2 ? 'text-gray-400' : r.rank === 3 ? 'text-orange-400' : 'text-gray-300'
                    }`}>
                      {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`}
                    </span>
                    <div>
                      <div className="font-medium text-gray-800">{r.nickname}</div>
                      <div className="text-xs text-gray-400">
                        完成 {r.tasksCompleted} 个任务 · 质疑成功 {r.challengesSucceeded} 次
                      </div>
                    </div>
                  </div>
                  <span className="text-xl font-bold text-purple-600">{r.score}分</span>
                </div>
                {r.isLowest && (
                  <div className="text-xs text-red-500 mt-2">🔻 最低分</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 第二步：未完成任务 */}
        {currentStep === 1 && (
          <div className="p-4 space-y-3">
            <div className="text-sm text-gray-500 mb-2">那些没能完成的"阴谋"…</div>
            {data.uncompletedTasks.map((ut) => (
              <div key={ut.playerId} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="font-medium text-gray-700 mb-2">👤 {ut.nickname}</div>
                {ut.tasks.length === 0 ? (
                  <div className="text-xs text-gray-400">全部完成！👏</div>
                ) : (
                  <div className="space-y-1">
                    {ut.tasks.map((t) => (
                      <div key={t.id} className="text-xs text-gray-600 pl-3">
                        {t.difficulty === 'EASY' ? '🟢' : t.difficulty === 'MEDIUM' ? '🟡' : t.difficulty === 'HARD' ? '🔴' : '💀'} {t.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 第三步：精彩回放 */}
        {currentStep === 2 && (
          <div className="p-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              {data.events.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无记录</div>
              ) : (
                <div className="space-y-3">
                  {data.events.map((event, i) => (
                    <div key={event.id} className="relative pl-6">
                      {/* 时间轴点 */}
                      <div className="absolute left-0 top-1 w-3 h-3 rounded-full bg-purple-400" />
                      {i < data.events.length - 1 && (
                        <div className="absolute left-1.5 top-4 w-0.5 h-full bg-purple-100" />
                      )}
                      <div className="text-xs text-gray-600">
                        {event.type === 'COMPLETED' && (
                          <>
                            🎉 {event.content.declarerNickname} 让 {event.content.targetNickname} {event.content.taskContent}
                          </>
                        )}
                        {event.type === 'CHALLENGED' && (
                          <>
                            🛡️ {event.content.challengerNickname} 质疑 {event.content.challengedNickname}「{event.content.taskContent}」
                          </>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 第四步：勋章颁发 */}
        {currentStep === 3 && (
          <div className="p-4 space-y-3">
            {data.medals.length === 0 ? (
              <div className="text-center text-gray-400 py-8">暂无勋章</div>
            ) : (
              data.medals.map((m, i) => {
                const info = medalInfo[m.medalType];
                return (
                  <div key={i} className="bg-white rounded-xl p-4 shadow-sm text-center">
                    <div className="text-4xl mb-2">{info?.medalEmoji || '🏅'}</div>
                    <div className="font-bold text-gray-800">{info?.medalName || m.medalType}</div>
                    <div className="text-sm text-purple-600 mt-1">{m.nickname}</div>
                    <div className="text-xs text-gray-400 mt-2">{info?.medalDescription}</div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 第五步：能力图 */}
        {currentStep === 4 && (
          <div className="p-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              {/* 玩家选择器 */}
              {data.abilityCharts && data.abilityCharts.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4 justify-center">
                  {data.abilityCharts.map((chart, idx) => (
                    <button
                      key={chart.playerId}
                      className={`px-3 py-1 rounded-full text-xs transition-colors ${
                        selectedPlayerIdx === idx
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                      onClick={() => setSelectedPlayerIdx(idx)}
                    >
                      {chart.nickname}
                    </button>
                  ))}
                </div>
              )}

              {/* 雷达图 */}
              {currentChart && (
                <>
                  <div className="text-center font-bold text-gray-800 mb-2">
                    {currentChart.nickname} 的能力图
                  </div>
                  <RadarChart
                    dimensions={currentChart.dimensions}
                    nickname={currentChart.nickname}
                    size={300}
                  />
                </>
              )}

              {/* 维度详情列表 */}
              {currentChart && (
                <div className="mt-4 space-y-2">
                  {Object.entries(currentChart.dimensions).map(([key, value]) => {
                    const dim = dimensionLabels[key];
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-sm w-8">{dim?.emoji}</span>
                        <span className="text-sm w-12 text-gray-600">{dim?.name}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-purple-500 h-2 rounded-full transition-all duration-700"
                            style={{ width: `${value}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-500 w-10 text-right">{value}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 第六步：奖惩执行 */}
        {currentStep === 5 && (
          <div className="p-4 space-y-4">
            {data.teamRewards.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="text-center text-lg font-bold text-green-600 p-4 pb-2">🎁 团队奖励</div>
                <List>
                  {data.teamRewards.map((r, i) => (
                    <List.Item key={i}>{r}</List.Item>
                  ))}
                </List>
              </div>
            )}
            {data.teamPunishments.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="text-center text-lg font-bold text-red-600 p-4 pb-2">💀 团队惩罚</div>
                <List>
                  {data.teamPunishments.map((p, i) => (
                    <List.Item key={i}>{p}</List.Item>
                  ))}
                </List>
                <div className="text-xs text-gray-400 text-center p-3 pt-1">
                  最低分玩家线下执行 👆
                </div>
              </div>
            )}

            {/* 再来一局按钮 */}
            <div className="mt-6 space-y-3">
              <button
                className="w-full py-3 rounded-full bg-purple-600 text-white font-medium text-base shadow-lg active:bg-purple-700 transition-colors"
                onClick={() => {
                  localStorage.removeItem('playerId');
                  localStorage.removeItem('nickname');
                  localStorage.removeItem('gameCode');
                  localStorage.removeItem('isHost');
                  navigate('/create');
                }}
              >
                🎮 再来一局
              </button>
              <button
                className="w-full py-3 rounded-full bg-white text-purple-600 font-medium text-base border border-purple-200 shadow-sm active:bg-purple-50 transition-colors"
                onClick={() => {
                  localStorage.removeItem('playerId');
                  localStorage.removeItem('nickname');
                  localStorage.removeItem('gameCode');
                  localStorage.removeItem('isHost');
                  navigate('/join');
                }}
              >
                🔗 加入其他游戏
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
