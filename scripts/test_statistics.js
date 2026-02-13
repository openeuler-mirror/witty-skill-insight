// 测试脚本 - 完整统计功能测试
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const SKILLS_FILE = path.join(DATA_DIR, 'skills.jsonl');
const SKILL_STATS_FILE = path.join(DATA_DIR, 'skill-stats.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 生成技能ID
function generateSkillId(name) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').substr(0, 20);
  return `${cleanName}-${timestamp}-${random}`;
}

// 创建测试技能数据
function createTestSkills() {
  const timestamp = new Date().toISOString();
  const skills = [
    {
      id: generateSkillId('Code Review Assistant'),
      name: 'Code Review Assistant',
      version: '1.0.0',
      description: '自动代码审查助手，帮助检查代码质量和潜在问题',
      category: 'Development',
      tags: ['code-review', 'quality', 'development'],
      inputFormat: { type: 'json', schema: { code: 'string', language: 'string' } },
      outputFormat: { type: 'json', schema: { issues: 'array', suggestions: 'array' } },
      dependencies: [],
      executionEnvironment: 'default',
      configuration: {},
      author: 'test-team',
      maintainer: 'test-team',
      createdAt: timestamp,
      updatedAt: timestamp,
      visibility: 'public',
      allowedTeams: [],
      qualityScore: 85,
      usageCount: 156,
      successRate: 92.5,
      avgExecutionTime: 2.3,
      avgTokenUsage: 1250,
      changelog: [{ version: '1.0.0', timestamp, changes: ['Initial release'], breakingChanges: false }],
      relatedExecutions: []
    },
    {
      id: generateSkillId('Documentation Generator'),
      name: 'Documentation Generator',
      version: '1.0.0',
      description: '自动生成技术文档和代码注释',
      category: 'Documentation',
      tags: ['documentation', 'generator', 'writing'],
      inputFormat: { type: 'json', schema: { code: 'string', format: 'string' } },
      outputFormat: { type: 'json', schema: { documentation: 'string' } },
      dependencies: [],
      executionEnvironment: 'default',
      configuration: {},
      author: 'test-team',
      maintainer: 'test-team',
      createdAt: timestamp,
      updatedAt: timestamp,
      visibility: 'team',
      allowedTeams: ['team-alpha'],
      qualityScore: 78,
      usageCount: 89,
      successRate: 88.2,
      avgExecutionTime: 3.1,
      avgTokenUsage: 2100,
      changelog: [{ version: '1.0.0', timestamp, changes: ['Initial release'], breakingChanges: false }],
      relatedExecutions: []
    },
    {
      id: generateSkillId('Bug Analyzer'),
      name: 'Bug Analyzer',
      version: '1.0.0',
      description: '分析和诊断软件缺陷的智能助手',
      category: 'Testing',
      tags: ['debugging', 'analysis', 'testing'],
      inputFormat: { type: 'json', schema: { error: 'string', context: 'string' } },
      outputFormat: { type: 'json', schema: { rootCause: 'string', solution: 'string' } },
      dependencies: [],
      executionEnvironment: 'default',
      configuration: {},
      author: 'test-team',
      maintainer: 'test-team',
      createdAt: timestamp,
      updatedAt: timestamp,
      visibility: 'public',
      allowedTeams: [],
      qualityScore: 92,
      usageCount: 234,
      successRate: 95.8,
      avgExecutionTime: 1.8,
      avgTokenUsage: 980,
      changelog: [{ version: '1.0.0', timestamp, changes: ['Initial release'], breakingChanges: false }],
      relatedExecutions: []
    },
    {
      id: generateSkillId('Test Case Generator'),
      name: 'Test Case Generator',
      version: '1.0.0',
      description: '基于需求自动生成测试用例',
      category: 'Testing',
      tags: ['testing', 'automation', 'qa'],
      inputFormat: { type: 'json', schema: { requirements: 'string', type: 'string' } },
      outputFormat: { type: 'json', schema: { testCases: 'array' } },
      dependencies: [],
      executionEnvironment: 'default',
      configuration: {},
      author: 'qa-team',
      maintainer: 'qa-team',
      createdAt: timestamp,
      updatedAt: timestamp,
      visibility: 'public',
      allowedTeams: [],
      qualityScore: 88,
      usageCount: 178,
      successRate: 91.3,
      avgExecutionTime: 2.7,
      avgTokenUsage: 1560,
      changelog: [{ version: '1.0.0', timestamp, changes: ['Initial release'], breakingChanges: false }],
      relatedExecutions: []
    },
    {
      id: generateSkillId('API Tester'),
      name: 'API Tester',
      version: '1.0.0',
      description: '自动化API测试和验证工具',
      category: 'Testing',
      tags: ['api', 'testing', 'automation'],
      inputFormat: { type: 'json', schema: { endpoint: 'string', method: 'string', payload: 'object' } },
      outputFormat: { type: 'json', schema: { results: 'object', status: 'string' } },
      dependencies: [],
      executionEnvironment: 'default',
      configuration: {},
      author: 'qa-team',
      maintainer: 'qa-team',
      createdAt: timestamp,
      updatedAt: timestamp,
      visibility: 'team',
      allowedTeams: ['team-beta'],
      qualityScore: 82,
      usageCount: 145,
      successRate: 89.5,
      avgExecutionTime: 1.5,
      avgTokenUsage: 720,
      changelog: [{ version: '1.0.0', timestamp, changes: ['Initial release'], breakingChanges: false }],
      relatedExecutions: []
    }
  ];

  return skills;
}

// 创建测试统计数据
function createTestStats(skills) {
  const stats = {};
  
  skills.forEach(skill => {
    const successfulInvocations = Math.floor(skill.usageCount * (skill.successRate / 100));
    const failedInvocations = skill.usageCount - successfulInvocations;
    
    stats[skill.id] = {
      skillId: skill.id,
      totalInvocations: skill.usageCount,
      successfulInvocations: successfulInvocations,
      failedInvocations: failedInvocations,
      avgLatency: skill.avgExecutionTime,
      avgTokens: skill.avgTokenUsage,
      lastUsed: new Date().toISOString(),
      usageByTeam: {
        'team-alpha': Math.floor(skill.usageCount * 0.4),
        'team-beta': Math.floor(skill.usageCount * 0.35),
        'team-gamma': skill.usageCount - Math.floor(skill.usageCount * 0.75)
      },
      usageByUser: {
        'user-001': Math.floor(skill.usageCount * 0.25),
        'user-002': Math.floor(skill.usageCount * 0.20),
        'user-003': Math.floor(skill.usageCount * 0.15),
        'user-004': skill.usageCount - Math.floor(skill.usageCount * 0.60)
      },
      // 时间序列数据（模拟过去30天）
      dailyStats: generateDailyStats(skill.usageCount, skill.successRate)
    };
  });
  
  return stats;
}

// 生成每日统计数据
function generateDailyStats(totalUsage, successRate) {
  const dailyStats = [];
  const now = new Date();
  const avgDailyUsage = Math.floor(totalUsage / 30);
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    const dailyUsage = Math.max(1, avgDailyUsage + Math.floor(Math.random() * 10) - 5);
    const dailySuccess = Math.floor(dailyUsage * (successRate / 100 + (Math.random() * 0.1 - 0.05)));
    const dailyFailed = dailyUsage - dailySuccess;
    
    dailyStats.push({
      date: date.toISOString().split('T')[0],
      invocations: dailyUsage,
      successful: dailySuccess,
      failed: dailyFailed,
      avgLatency: 1.5 + Math.random() * 2,
      avgTokens: 500 + Math.floor(Math.random() * 1500)
    });
  }
  
  return dailyStats;
}

// 测试统计功能
async function runStatisticsTest() {
  console.log('🧪 开始测试完整统计功能 (第3部分)\n');
  
  ensureDataDir();
  
  // 1. 创建测试数据
  console.log('📊 步骤1: 创建测试技能数据...');
  const skills = createTestSkills();
  const skillsContent = skills.map(s => JSON.stringify(s)).join('\n');
  fs.writeFileSync(SKILLS_FILE, skillsContent);
  console.log(`   ✓ 已创建 ${skills.length} 个测试技能\n`);
  
  // 2. 创建统计数据
  console.log('📈 步骤2: 创建详细使用统计...');
  const stats = createTestStats(skills);
  fs.writeFileSync(SKILL_STATS_FILE, JSON.stringify(stats, null, 2));
  console.log(`   ✓ 已创建 ${Object.keys(stats).length} 个技能的详细统计\n`);
  
  // 3. 输出统计摘要
  console.log('📋 步骤3: 统计摘要报告');
  console.log('=' .repeat(60));
  
  // 3.1 总体统计
  const totalInvocations = skills.reduce((sum, s) => sum + (s.usageCount || 0), 0);
  const avgQualityScore = skills.reduce((sum, s) => sum + (s.qualityScore || 0), 0) / skills.length;
  const avgSuccessRate = skills.reduce((sum, s) => sum + (s.successRate || 0), 0) / skills.length;
  
  console.log('\n📊 总体统计:');
  console.log(`   • 技能总数: ${skills.length}`);
  console.log(`   • 总调用次数: ${totalInvocations}`);
  console.log(`   • 平均质量评分: ${avgQualityScore.toFixed(1)}/100`);
  console.log(`   • 平均成功率: ${avgSuccessRate.toFixed(1)}%`);
  
  // 3.2 分类统计
  const categoryStats = {};
  skills.forEach(skill => {
    categoryStats[skill.category] = (categoryStats[skill.category] || 0) + 1;
  });
  
  console.log('\n📁 分类统计:');
  Object.entries(categoryStats).forEach(([category, count]) => {
    console.log(`   • ${category}: ${count} 个技能`);
  });
  
  // 3.3 热门技能排名
  console.log('\n🔥 热门技能TOP3:');
  const sortedByUsage = [...skills].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 3);
  sortedByUsage.forEach((skill, index) => {
    console.log(`   ${index + 1}. ${skill.name} (${skill.usageCount} 次调用, 成功率: ${skill.successRate}%)`);
  });
  
  // 3.4 质量评分排名
  console.log('\n⭐ 质量评分TOP3:');
  const sortedByQuality = [...skills].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0)).slice(0, 3);
  sortedByQuality.forEach((skill, index) => {
    console.log(`   ${index + 1}. ${skill.name} (${skill.qualityScore} 分)`);
  });
  
  // 3.5 团队使用情况
  console.log('\n👥 团队使用统计:');
  const teamStats = { 'team-alpha': 0, 'team-beta': 0, 'team-gamma': 0 };
  Object.values(stats).forEach((stat) => {
    Object.entries(stat.usageByTeam).forEach(([team, count]) => {
      teamStats[team] = (teamStats[team] || 0) + count;
    });
  });
  Object.entries(teamStats).forEach(([team, count]) => {
    console.log(`   • ${team}: ${count} 次调用`);
  });
  
  // 3.6 用户使用统计
  console.log('\n👤 用户使用统计TOP3:');
  const userStats = {};
  Object.values(stats).forEach((stat) => {
    Object.entries(stat.usageByUser).forEach(([user, count]) => {
      userStats[user] = (userStats[user] || 0) + count;
    });
  });
  Object.entries(userStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([user, count], index) => {
      console.log(`   ${index + 1}. ${user}: ${count} 次调用`);
    });
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 统计功能测试完成!\n');
  
  // 4. 验证数据完整性
  console.log('🔍 步骤4: 数据完整性验证');
  let allValid = true;
  
  skills.forEach(skill => {
    if (!stats[skill.id]) {
      console.log(`   ❌ 技能 ${skill.name} 缺少统计数据`);
      allValid = false;
    }
  });
  
  if (allValid) {
    console.log('   ✓ 所有技能都有完整的统计数据');
  }
  
  console.log(`   ✓ 数据文件位置:`);
  console.log(`     - 技能数据: ${SKILLS_FILE}`);
  console.log(`     - 统计数据: ${SKILL_STATS_FILE}`);
  
  console.log('\n🎉 测试完成！现在可以运行应用查看统计图表。');
}

// 运行测试
runStatisticsTest().catch(console.error);
