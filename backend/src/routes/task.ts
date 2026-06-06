import { Router, type Request, type Response } from 'express';
import * as taskService from '../services/taskService';

const router = Router();

// POST /api/task/:id/discard — 弃牌换牌
router.post('/:id/discard', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await taskService.discardTask(id);
  res.json(result);
});

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
