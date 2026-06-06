import { Router, type Request, type Response } from 'express';
import * as gameService from '../services/gameService';
import * as playerService from '../services/playerService';
import * as taskService from '../services/taskService';
import { AppError } from '../utils/helpers';

const router = Router();

// POST /api/player/join — 玩家加入游戏
router.post('/join', async (req: Request, res: Response) => {
  const { gameCode, openId, nickname } = req.body;
  if (!gameCode || !openId || !nickname) {
    throw new AppError(400, '缺少必要参数: gameCode, openId, nickname');
  }
  const result = await gameService.joinGame({ gameCode, openId, nickname });
  res.json(result);
});

// GET /api/player/:id/status — 获取玩家状态
router.get('/:id/status', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await playerService.getPlayerStatus(id);
  res.json(result);
});

// GET /api/player/:id/messages — 轮询获取待处理消息
router.get('/:id/messages', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await playerService.getPendingMessages(id);
  res.json(result);
});

// POST /api/player/:id/declare-complete — 声明完成
router.post('/:id/declare-complete', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { taskId, targetId } = req.body;
  if (!taskId || !targetId) {
    throw new AppError(400, '缺少必要参数: taskId, targetId');
  }
  const result = await taskService.declareComplete(id, { taskId, targetId });
  res.json(result);
});

// POST /api/player/:id/challenge — 发起质疑
router.post('/:id/challenge', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { challengedId, guessContent } = req.body;
  if (!challengedId || !guessContent) {
    throw new AppError(400, '缺少必要参数: challengedId, guessContent');
  }
  const result = await taskService.challenge(id, { challengedId, guessContent });
  res.json(result);
});

// POST /api/player/:id/confirm-declare — 确认/否认声明完成
router.post('/:id/confirm-declare', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { declareId, confirmed } = req.body;
  if (!declareId || typeof confirmed !== 'boolean') {
    throw new AppError(400, '缺少必要参数: declareId, confirmed');
  }
  const result = await taskService.confirmDeclare(id, { declareId, confirmed });
  res.json(result);
});

// POST /api/player/:id/confirm-challenge — 确认质疑结果
router.post('/:id/confirm-challenge', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { challengeId, hit, hitTaskId } = req.body;
  if (!challengeId || typeof hit !== 'boolean') {
    throw new AppError(400, '缺少必要参数: challengeId, hit');
  }
  const result = await taskService.confirmChallenge(id, {
    challengeId,
    hit,
    hitTaskId,
  });
  res.json(result);
});

export default router;
