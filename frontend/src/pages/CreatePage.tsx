import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast, Stepper } from 'antd-mobile';
import { createGame, joinGame } from '../api/game';

/**
 * 创建游戏页 — 房主设置游戏参数 → 创建并加入 → 进入大厅
 */
export default function CreatePage() {
  const navigate = useNavigate();
  const [playerCount, setPlayerCount] = useState(6);
  const [endTime, setEndTime] = useState('');
  const [teamRewards, setTeamRewards] = useState('');
  const [teamPunishments, setTeamPunishments] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!nickname.trim()) {
      Toast.show({ icon: 'fail', content: '请输入你的昵称' });
      return;
    }
    if (!endTime) {
      Toast.show({ icon: 'fail', content: '请选择结束时间' });
      return;
    }

    // 结束时间必须在未来
    if (new Date(endTime).getTime() <= Date.now()) {
      Toast.show({ icon: 'fail', content: '结束时间必须在当前时间之后' });
      return;
    }

    setLoading(true);
    try {
      // 1. 创建游戏
      const game = await createGame({
        playerCount,
        endTime: new Date(endTime).toISOString(),
        teamRewards: teamRewards.trim()
          ? teamRewards.trim().split('\n').filter(Boolean)
          : undefined,
        teamPunishments: teamPunishments.trim()
          ? teamPunishments.trim().split('\n').filter(Boolean)
          : undefined,
      });

      // 2. 创建者自动加入游戏
      // TODO: 微信 OpenID 获取，当前先用模拟值
      const openId = `mock_${Date.now()}`;
      const result = await joinGame({
        gameCode: game.code,
        openId,
        nickname: nickname.trim(),
      });

      // 3. 存储玩家信息
      localStorage.setItem('playerId', result.player.id);
      localStorage.setItem('nickname', nickname.trim());
      localStorage.setItem('gameCode', game.code);
      localStorage.setItem('isHost', 'true');

      // 4. 跳转到大厅
      navigate(`/lobby/${game.id}`);
    } catch (err: any) {
      Toast.show({ icon: 'fail', content: err?.response?.data?.message || '创建失败，请重试' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto pt-8">
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-800">🎮 创建游戏</h1>
          <p className="text-gray-500 text-sm mt-1">设置参数，成为房主</p>
        </div>

        {/* 表单 */}
        <div className="bg-white rounded-xl p-6 shadow-sm space-y-5">
          {/* 昵称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">你的昵称</label>
            <Input
              value={nickname}
              onChange={setNickname}
              placeholder="给自己取个名字吧"
              maxLength={10}
              clearable
            />
          </div>

          {/* 参与人数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">参与人数</label>
            <Stepper
              value={playerCount}
              onChange={(val) => setPlayerCount(val as number)}
              min={4}
              max={8}
            />
            <p className="text-xs text-gray-400 mt-1">4-8人</p>
          </div>

          {/* 结束时间 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">游戏结束时间</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <p className="text-xs text-gray-400 mt-1">到达时间后仍需投票结束</p>
          </div>

          {/* 团队奖励（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              🎁 团队奖励 <span className="text-gray-400 font-normal">（可选，每行一条）</span>
            </label>
            <textarea
              value={teamRewards}
              onChange={(e) => setTeamRewards(e.target.value)}
              placeholder={'海马体四人闺蜜套餐\n免单一次'}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          {/* 团队惩罚（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              💀 团队惩罚 <span className="text-gray-400 font-normal">（可选，每行一条）</span>
            </label>
            <textarea
              value={teamPunishments}
              onChange={(e) => setTeamPunishments(e.target.value)}
              placeholder={'合唱一首歌\n真心话大冒险'}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          <Button
            color="primary"
            block
            shape="rounded"
            loading={loading}
            onClick={handleCreate}
            size="large"
          >
            创建游戏
          </Button>
        </div>
      </div>
    </div>
  );
}
