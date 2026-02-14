
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('开始刷新历史模型数据...');

  // 1. 更新 Execution 表
  const updateExecutions = await prisma.execution.updateMany({
    where: {
      OR: [
        { model: null },
        { model: '' },
        { model: 'unknown' },
        { model: 'Unknown' }
      ]
    },
    data: {
      model: 'deepseek-chat'
    }
  });
  console.log(`已刷新 ${updateExecutions.count} 条 Execution 记录。`);

  // 2. 更新 Session 表
  const updateSessions = await prisma.session.updateMany({
    where: {
      OR: [
        { model: null },
        { model: '' },
        { model: 'unknown' },
        { model: 'Unknown' }
      ]
    },
    data: {
      model: 'deepseek-chat'
    }
  });
  console.log(`已刷新 ${updateSessions.count} 条 Session 记录。`);

  // 3. 更新 User 表中的 defaultModel（防止旧的无效偏好干扰）
  const updateUsers = await prisma.user.updateMany({
    where: {
      OR: [
        { defaultModel: null },
        { defaultModel: '' },
        { defaultModel: 'unknown' },
        { defaultModel: 'Unknown' }
      ]
    },
    data: {
      defaultModel: 'deepseek-chat'
    }
  });
  console.log(`已重置 ${updateUsers.count} 个用户的默认模型偏好。`);

  console.log('数据刷新完成。');
}

main()
  .catch(e => {
    console.error('刷新失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
