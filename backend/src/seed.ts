/**
 * 将 task-db/ 下的 JSON 文件导入 TaskLibrary 和 PunishmentLibrary 表
 * V2: 移除 targetType 字段（由难度自动决定目标分配）
 * 用法: npm run db:seed
 */
import 'dotenv/config';
import prisma from './utils/prisma';
import fs from 'fs';
import path from 'path';

interface TaskItem {
  content: string;
  taskType?: string;
  // V2: targetType 已移除，不再从JSON读取
}

interface PunishmentItem {
  content: string;
}

const DB_DIR = path.resolve(__dirname, '../../task-db');

const DIFFICULTY_MAP: Record<string, 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME'> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
  extreme: 'EXTREME',
};

async function main() {
  console.log('[Seed] 开始导入任务库和惩罚库...');

  // 清空现有数据
  await prisma.punishmentLibrary.deleteMany();
  await prisma.taskLibrary.deleteMany();

  const taskCount = { EASY: 0, MEDIUM: 0, HARD: 0, EXTREME: 0 };
  const punishmentCount = { EASY: 0, MEDIUM: 0, HARD: 0, EXTREME: 0 };

  for (const [key, difficulty] of Object.entries(DIFFICULTY_MAP)) {
    // 导入任务
    const taskFile = path.join(DB_DIR, `tasks-${key}.json`);
    if (fs.existsSync(taskFile)) {
      const tasks: TaskItem[] = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      if (tasks.length > 0) {
        await prisma.taskLibrary.createMany({
          data: tasks.map((t) => ({
            difficulty,
            content: t.content,
            taskType: t.taskType || 'BEHAVIOR',
            // V2: 不再设置 targetType，由难度决定目标分配
          })),
        });
        taskCount[difficulty as keyof typeof taskCount] = tasks.length;
        console.log(`[Seed] 任务 ${difficulty}: ${tasks.length} 条`);
      } else {
        console.log(`[Seed] 任务 ${difficulty}: 文件为空，跳过`);
      }
    } else {
      console.log(`[Seed] 任务 ${difficulty}: 文件不存在，跳过`);
    }

    // 导入惩罚
    const punishmentFile = path.join(DB_DIR, `punishments-${key}.json`);
    if (fs.existsSync(punishmentFile)) {
      const punishments: PunishmentItem[] = JSON.parse(fs.readFileSync(punishmentFile, 'utf-8'));
      if (punishments.length > 0) {
        await prisma.punishmentLibrary.createMany({
          data: punishments.map((p) => ({
            difficulty,
            content: p.content,
          })),
        });
        punishmentCount[difficulty as keyof typeof punishmentCount] = punishments.length;
        console.log(`[Seed] 惩罚 ${difficulty}: ${punishments.length} 条`);
      } else {
        console.log(`[Seed] 惩罚 ${difficulty}: 文件为空，跳过`);
      }
    } else {
      console.log(`[Seed] 惩罚 ${difficulty}: 文件不存在，跳过`);
    }
  }

  console.log('\n[Seed] 导入完成！');
  console.log(`[Seed] 任务总计: ${Object.values(taskCount).reduce((a, b) => a + b, 0)} 条`);
  console.log(`[Seed] 惩罚总计: ${Object.values(punishmentCount).reduce((a, b) => a + b, 0)} 条`);
}

main()
  .catch((e) => {
    console.error('[Seed] 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
