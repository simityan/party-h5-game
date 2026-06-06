import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { List, Toast } from 'antd-mobile';
import { getGame } from '../api/game';
import type { GameInfo } from '../types/game';

/**
 * 大厅页 — 等待玩家到齐 → 游戏开始
 */
export default function LobbyPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 轮询游戏状态
  useEffect(() => {
    const fetchGame = async () => {
      try {
        const data = await getGame(gameId!);
        setGame(data as GameInfo);
        // 游戏已开始，跳转
        if ((data as GameInfo).status === 'PLAYING') {
          navigate(`/game/${gameId}`);
        }
        // 游戏已结束，跳转结算
        if ((data as GameInfo).status === 'ENDED') {
          navigate(`/settlement/${gameId}`);
        }
      } catch {
        Toast.show({ icon: 'fail', content: '获取游戏信息失败' });
      } finally {
        setLoading(false);
      }
    };

    fetchGame();
    const timer = setInterval(fetchGame, 3000);
    return () => clearInterval(timer);
  }, [gameId, navigate]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">加载中...</div>;
  }

  if (!game) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">游戏不存在</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto pt-8">
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-800">🎮 游戏大厅</h1>
          <p className="text-gray-500 text-sm mt-1">入场码: {game.code}</p>
        </div>

        {/* 等待动画 */}
        <div className="text-center mb-6">
          <div className="text-4xl animate-bounce">🎲</div>
          <p className="text-gray-500 text-sm mt-2">等待玩家加入...</p>
        </div>

        {/* 玩家列表 */}
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
          <div className="text-sm font-medium text-gray-700 mb-3">
            已加入 ({game.players.length}/{game.playerCount})
          </div>
          <div className="space-y-2">
            {game.players.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
                <span className="text-lg">👤</span>
                <span className="text-sm text-gray-700">{p.nickname}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 游戏配置 */}
        <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
          <List>
            <List.Item extra={`${game.playerCount}人`}>参与人数</List.Item>
            {game.startTime && (
              <List.Item extra={new Date(game.startTime).toLocaleString()}>开始时间</List.Item>
            )}
            <List.Item extra={new Date(game.endTime).toLocaleString()}>结束时间</List.Item>
          </List>
        </div>

        {/* 团队奖惩 */}
        {(game.teamRewards.length > 0 || game.teamPunishments.length > 0) && (
          <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
            {game.teamRewards.length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-medium text-green-600 mb-1">🎁 团队奖励</div>
                {game.teamRewards.map((r, i) => (
                  <div key={i} className="text-xs text-gray-500 pl-3">• {r}</div>
                ))}
              </div>
            )}
            {game.teamPunishments.length > 0 && (
              <div>
                <div className="text-sm font-medium text-red-600 mb-1">💀 团队惩罚</div>
                {game.teamPunishments.map((p, i) => (
                  <div key={i} className="text-xs text-gray-500 pl-3">• {p}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 分享提示 */}
        <div className="text-center text-xs text-gray-400 mt-4">
          分享入场码 <span className="font-bold text-purple-600">{game.code}</span> 给好友加入
        </div>
      </div>
    </div>
  );
}
