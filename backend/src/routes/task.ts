import { Router, type Request, type Response } from 'express';
import * as taskService from '../services/taskService';

const router = Router();

// V2: 已移除 POST /:id/discard（弃牌换牌），由 POST /api/player/:id/refresh（批量刷新）替代

// GET /api/task/feed/:gameId — 获取动态流
router.get('/feed/:gameId', async (req: Request, res: Response) => {
  const gameId = req.params.gameId as string;
  const result = await taskService.getFeed(gameId);
  res.json(result);
});

// GET /api/task/tips/:gameId — 获取匿名爆料
router.get('/tips/:gameId', async (req: Request, res: Response) => {
  const gameId = req.params.gameId as string;
  const result = await taskService.getTips(gameId);
  res.json(result);
});

export default router;
