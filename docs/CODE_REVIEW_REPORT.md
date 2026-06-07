# 害你在心口难开·动作版 — 代码审查报告 v2

> 审查时间：2026-06-07 (第二次，代码更新后)  
> 仓库：simityan/party-h5-game  
> 对比基线：第一次审查报告中的4严重+8中等+7轻微  

---

## ✅ 已修复问题（12/19）

| # | 原等级 | 问题 | 修复方式 |
|---|--------|------|----------|
| 1 | 🔴严重 | 被质疑方未获得+1刷新 | challenge命中分支两方都加了 `refreshChances: increment: 1` |
| 2 | 🔴严重 | 多人质疑同一任务无并发控制 | `hitTaskId @unique` 约束 + P2002错误降级为409 |
| 3 | 🔴严重 | 游戏结束ACTIVE任务未处理 | endGame事务内 `updateMany status: CANCELED` |
| 5 | 🟡中等 | 困难次要玩家固定3人 | `SECONDARY_TARGET_COUNT.HARD=-2` + `Math.min(3, totalPlayers-2)` |
| 9 | 🟡中等 | 任务库JSON与v2不符 | 已替换为v2定稿 50/50/50/25+30/30/20/10，无targetType |
| 10 | 🟡中等 | 模板前缀不完整 | 补全全部8个前缀（含"们"和"分别"变体） |
| 11 | 🟡中等 | 轮询效率低 | 合并为 `pollGameData` 单请求，前端改用单接口轮询 |
| 12 | 🟡中等 | 数据库索引缺失 | `@@index([playerId, status])` + `@@index([gameId, status])` + 其他 |
| 14 | 🟢轻微 | 匿名爆料暴露原文 | 已实现 `generateFuzzyTip` 按难度生成模糊化提示 |
| 15 | 🟢轻微 | endGame投票逻辑矛盾 | 已统一为"全员同意结束"（`votedCount === totalPlayers`） |
| 17 | 🟢轻微 | package.json声明不符 | 已修正为 Express 5.x |
| 18 | 🟢轻微 | 前端错误处理不统一 | 添加了错误节流、loading状态、null guard等 |

### 额外修复（代码中标注但未在首次审查中列出）

- **H2**: 刷新次数扣减原子条件更新 `updateMany + gt:0` 防并发超扣
- **M7**: 刷新时ACTIVE任务读取移入事务+`deleteMany`批量删除，消除TOCTOU
- **M5**: endGame事务内重校验游戏状态，防并发重复结束
- **M8**: 质疑命中/确认/否认后检查所有任务是否resolve，是则+3刷新（内联到各事务中，避免TOCTOU）
- **Bug K**: 游戏结束时PENDING状态的DeclareComplete批量置DENIED
- **Bug I**: 结算时所有并列最低分标记isLowest（非仅最后一名）
- **Bug E/F**: 能力图计算边界修正（零活动玩家dramaBone=0，未被质疑玩家ironSkin=0.5）
- **Bug O**: 刷新后同步game/feed/tips/messages
- **H4**: updateBottom2Status用事务+批量更新
- **S1**: 防止并发轮询重叠（isPollingRef）
- **S2/S3**: 操作loading防重复点击
- **M10**: DATABASE_URL启动时校验
- **L1/L2/L3**: 前端鲁棒性修复（状态异常跳转、空内容提示、首次轮询失败）

---

## 🔴 仍存在的问题

### 🟡 P1 — 功能缺失（3个）

**A. 前端三卡并列布局未实现**
- 文件：`frontend/src/pages/GamePage.tsx`
- 问题：仍用 `space-y-3` 垂直排列三张卡牌，v2规则要求并列展示
- 建议：改为 `flex gap-3` 横向并列，移动端可横滑；或三列等宽网格

**B. 后2名警告UI未渲染**
- 文件：`frontend/src/pages/GamePage.tsx`
- 问题：`player.isBottom2` 字段存在但前端没有任何视觉提示
- 建议：在积分区域或玩家信息旁添加红色警告标记

**C. 卡牌翻转展示惩罚未实现**
- 文件：`frontend/src/pages/GamePage.tsx`
- 问题：任务CHALLENGED/CANCELED后，前端显示逻辑仅区分ACTIVE和非ACTIVE，没有翻转动画展示惩罚内容
- 建议：为CHALLENGED/CANCELED状态卡片添加翻转样式，背面展示惩罚内容

### 🟡 P2 — 安全（1个）

**D. API无鉴权**
- 文件：所有 `backend/src/routes/*.ts`
- 问题：所有API无认证，任何人可伪造playerId操作
- 建议：v1阶段最低限度加gameCode校验；上线前必须加JWT

### 🟢 P3 — 细节（2个）

**E. MEDIUM难度颜色与emoji不匹配**
- 文件：`frontend/src/pages/GamePage.tsx`
- 问题：emoji用🟡（黄色），但 `color: 'text-green-500'`（绿色），视觉不统一
- 建议：MEDIUM color 改为 `text-yellow-500` 或 `text-amber-500`

**F. OpenID仍为mock值**
- 问题：微信OpenID硬编码，上线前需替换
- 说明：这是已知的上线前置条件，不影响功能测试

---

## ❓ 待确认

1. **endGame投票逻辑**：当前实现为"全员同意结束"，请确认这是最终决策
2. **API鉴权**：v1是否需要实现，还是上线前补？
3. **三卡布局**：具体样式偏好？并列/横滑/网格？
4. **卡牌翻转**：是否需要CSS 3D翻转动画，还是简单的切换展示？

---

## 📊 总体评价

代码质量显著提升。上次4个严重问题已修3个（#1#2#3），8个中等问题已修5个（#5#9#10#11#12），7个轻微问题已修4个。额外还修复了10+个并发安全、边界处理和前端鲁棒性问题。

剩余问题主要是前端UI实现（三卡布局、翻转动画、后2名警告），属于体验层而非逻辑层。后端核心业务逻辑已比较健壮。
