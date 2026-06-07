# 害你在心口难开·动作版 — 代码审查报告

> 审查时间：2026-06-07  
> 审查范围：全量后端+前端源码、数据库Schema、任务库数据  
> 仓库：simityan/party-h5-game  

---

## 🔴 严重问题（4个）

### 1. 被质疑命中后，被质疑方未获得+1刷新次数
- **文件**：`backend/src/services/taskService.ts` — `challenge()` 函数
- **问题**：质疑命中分支只给质疑者加了统计，漏了被质疑者 `refreshChances: { increment: 1 }`
- **规则依据**：v2规则「质疑命中→执行者受罚，双方各+1刷新」
- **修复**：质疑命中分支补充被质疑者刷新次数+1

### 2. 多人同时质疑同一任务无并发控制
- **文件**：`backend/src/services/taskService.ts` — `challenge()` 函数
- **问题**：无锁无状态检查，可能同一任务被两条Challenge同时命中，产生重复惩罚
- **修复**：增加任务状态前置检查（是否已有命中Challenge），或用DB事务+唯一约束

### 3. 游戏结束时ACTIVE任务未处理
- **文件**：`backend/src/services/gameService.ts` — `endGame()` 函数
- **问题**：只改 `game.status=ENDED`，未将ACTIVE任务标记为EXPIRED/CANCELLED
- **影响**：游戏结束后仍有未处理任务，结算可能异常
- **修复**：endGame时批量将ACTIVE任务置为CANCELED

### 4. API无鉴权
- **文件**：所有 `backend/src/routes/*.ts`
- **问题**：所有route无验证，前端localStorage存playerId，后端直接信任
- **影响**：任何人可伪造playerId操作任意玩家数据
- **修复**：引入JWT/Session鉴权，或在gameCode维度做简单校验

---

## 🟡 中等问题（8个）

### 5. 困难次要玩家固定3人，未动态调整
- **文件**：`backend/src/services/taskService.ts`
- **问题**：`HARD: 3` 固定3人次要玩家，v2规则为「少于5人=在场人数-2」
- **修复**：改为 `Math.min(3, totalPlayers - 2)`

### 6. 前端三卡垂直列表，未实现并列布局
- **文件**：`frontend/src/pages/GamePage.tsx`
- **问题**：用 `space-y-3` 垂直排列，v2规则要求三卡并列展示
- **修复**：改为flex横向并列，适配移动端可考虑横滑

### 7. 后2名警告UI未渲染
- **文件**：`frontend/src/pages/GamePage.tsx`
- **问题**：类型定义有 `isBottom2` 但前端没渲染警告提示
- **修复**：添加后2名红色警告UI

### 8. 卡牌翻面展示惩罚未实现
- **文件**：`frontend/src/pages/GamePage.tsx`
- **问题**：任务失败后应翻面展示惩罚内容，当前未实现
- **修复**：添加翻面动画+惩罚内容展示

### 9. 任务库JSON数据与v2定稿完全不符
- **文件**：`task-db/` 目录下8个JSON文件
- **问题**：数量为100/100/100/30 vs v2定稿50/50/50/25+惩罚30/30/20/10；内容为旧版，含废弃targetType
- **修复**：按v2定稿重新生成全部8个JSON文件

### 10. 模板前缀匹配不完整
- **文件**：`backend/src/services/taskService.ts`
- **问题**：`TEMPLATE_PREFIXES` 与v2定稿模板不完全一致（缺"让目标玩家及次要玩家们""让所有玩家分别"等）
- **修复**：补全v2全部模板前缀

### 11. 轮询效率低
- **文件**：`frontend/src/pages/GamePage.tsx`
- **问题**：每3秒5个独立请求轮询，浪费资源
- **修复**：合并为单接口，或改用WebSocket

### 12. 数据库索引缺失
- **文件**：`backend/prisma/schema.prisma`
- **问题**：`player_tasks` 缺 `(playerId, status)` 等常用查询索引
- **修复**：补充 `@@index([playerId, status])` 等索引

---

## 🟢 轻微问题（7个）

### 13. MEDIUM难度卡牌颜色与v2不一致
- 代码黄色 vs 规则绿色，需统一

### 14. 匿名爆料直接暴露任务原文
- 违反v2模糊化规则，应做脱敏处理

### 15. endGame投票逻辑矛盾
- v1写"全员结束"，代码用"超过半数"，需确认

### 16. OpenID用mock值
- `wechatService.ts` 硬编码mock，上线前需替换

### 17. package.json写Hono实际用Express
- 依赖声明与实际不符，需修正

### 18. 前端错误处理不统一
- 部分API调用无错误提示

### 19. TypeScript类型导出不完整
- 部分service返回值缺类型声明

---

## 📋 修复优先级建议

| 优先级 | 问题编号 | 说明 |
|--------|----------|------|
| P0 紧急 | #1 #2 #3 | 业务逻辑bug，影响游戏核心流程 |
| P1 重要 | #4 #9 #10 | 安全+数据问题 |
| P2 一般 | #5 #6 #7 #8 #11 #12 | 功能完善+性能 |
| P3 低优 | #13-#19 | 体验优化+代码规范 |

---

## ❓ 待确认项

1. **endGame投票逻辑**：v1规则"全员同意结束"，代码实现"超过半数"，请确认最终逻辑
2. **API鉴权方案**：是否需要在v1实现，还是先上线后补？
3. **任务库JSON替换**：确认后我直接按v2定稿生成全部8个文件
