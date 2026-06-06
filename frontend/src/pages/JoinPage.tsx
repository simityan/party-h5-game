import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from 'antd-mobile';
import { joinGame } from '../api/game';

/**
 * 加入游戏页 — 扫码/输入入场码 → 输入昵称 → 进入大厅
 */
export default function JoinPage() {
  const navigate = useNavigate();
  const [gameCode, setGameCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  // 从 URL 参数获取 gameCode（扫码进入时）
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl && !gameCode) {
    setGameCode(codeFromUrl);
  }

  const handleJoin = async () => {
    if (!gameCode.trim()) {
      Toast.show({ icon: 'fail', content: '请输入入场码' });
      return;
    }
    if (!nickname.trim()) {
      Toast.show({ icon: 'fail', content: '请输入昵称' });
      return;
    }

    setLoading(true);
    try {
      // TODO: 微信 OpenID 获取，当前先用模拟值
      const openId = `mock_${Date.now()}`;
      const result = await joinGame({
        gameCode: gameCode.trim(),
        openId,
        nickname: nickname.trim(),
      });

      // 存储玩家信息
      localStorage.setItem('playerId', result.player.id);
      localStorage.setItem('nickname', nickname.trim());
      localStorage.setItem('gameCode', gameCode.trim());

      // 跳转到大厅
      navigate(`/lobby/${result.gameId}`);
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '加入失败，请重试' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto pt-12">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            🎭 害你在心口难开
          </h1>
          <p className="text-gray-500 text-sm">动作版 · 聚会H5游戏</p>
        </div>

        {/* 表单 */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">入场码</label>
            <Input
              value={gameCode}
              onChange={setGameCode}
              placeholder="请输入6位入场码"
              maxLength={6}
              clearable
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
            <Input
              value={nickname}
              onChange={setNickname}
              placeholder="给自己取个名字吧"
              maxLength={10}
              clearable
            />
          </div>

          <Button
            color="primary"
            block
            shape="rounded"
            loading={loading}
            onClick={handleJoin}
            size="large"
          >
            加入游戏
          </Button>
        </div>

        {/* 规则简介 */}
        <div className="mt-6 bg-white rounded-xl p-4 shadow-sm">
          <details>
            <summary className="text-sm font-medium text-gray-700 cursor-pointer">
              📜 游戏规则简介
            </summary>
            <div className="mt-3 text-xs text-gray-500 space-y-2">
              <p>1. 每人获得3条秘密任务（🟢简单 🟡中等 🔴困难）</p>
              <p>2. 线下引导他人做出指定行为，完成后声明得分</p>
              <p>3. 可以随时质疑对手，猜中对方任务即可反杀</p>
              <p>4. 积分最低的玩家接受团队惩罚！</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
