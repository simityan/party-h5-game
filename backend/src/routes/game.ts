import { Router, type Request, type Response } from 'express';
import * as gameService from '../services/gameService';
import * as settlementService from '../services/settlementService';
import { AppError } from '../utils/helpers';

const router = Router();

// POST /api/game — 创建游戏
router.post('/', async (req: Request, res: Response) => {
  const result = await gameService.createGame(req.body);
  res.json(result);
});

// GET /api/game/:id — 获取游戏信息
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await gameService.getGame(id);
  res.json(result);
});

// POST /api/game/:id/start — 开始游戏
router.post('/:id/start', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await gameService.startGame(id);
  res.json(result);
});

// POST /api/game/:id/end — 玩家点击结束游戏
router.post('/:id/end', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { playerId } = req.body;
  if (!playerId) throw new AppError(400, '缺少 playerId');
  const result = await gameService.endGame(id, playerId);
  res.json(result);
});

// GET /api/game/:id/settlement — 结算数据
router.get('/:id/settlement', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await settlementService.getSettlement(id);
  res.json(result);
});

export default router;
