import { GuideStep } from '@/components/UserGuide';

export const GUIDE_STEPS: GuideStep[] = [
    {
        id: 'welcome',
        target: '',
        title: '欢迎使用 Skill-insight',
        content: '这是智能体技能评估、分析与优化平台。接下来将引导您完成关键配置，帮助您快速上手使用。',
        position: 'center',
    },
    {
        id: 'eval-config',
        target: '.controls',
        title: '配置评测模型',
        content: '配置评测模型是使用平台核心分析能力的前提，用于：数据集数据项抽取、Skill执行分析、有效性分析。您可以选择 DeepSeek、OpenAI 等模型作为评测引擎。点击⚙️按钮可以配置评测模型的 API Key 和参数。',
        position: 'bottom',
        actionLabel: '配置模型',
    },
    {
        id: 'dataset-config',
        target: '.tabs .tab-btn:nth-child(2)',
        title: '配置数据集',
        content: '数据集用于定义测试问题和标准答案。配置数据集后，系统将使用刚才配置的评测模型自动评估 Agent 的回答质量。点击"数据集管理"标签页可以添加和管理您的测试数据集。',
        position: 'bottom',
        actionLabel: '前往配置',
    },
    {
        id: 'skill-upload',
        target: '.tabs .tab-btn:nth-child(3)',
        title: '上传技能包',
        content: 'Skill（技能包）是 Agent 执行特定任务的指导文档。上传技能包后，您可以评估其在 Agent 中的实际效果。点击"技能管理"标签页可以上传和管理技能包。',
        position: 'bottom',
        actionLabel: '前往上传',
    },
    {
        id: 'user-manual',
        target: '.title',
        title: '查看用户手册',
        content: '需要更详细的帮助？您可以查看用户使用手册获取完整的使用说明和最佳实践指南。',
        position: 'bottom',
        linkUrl: 'https://atomgit.com/openeuler/witty-skill-insight/wiki/%E7%94%A8%E6%88%B7%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C',
        linkText: '📖 查看用户使用手册',
    },
];

export function getFilteredSteps(completedSteps: string[], skippedSteps: string[]): GuideStep[] {
    return GUIDE_STEPS.filter(step => 
        !completedSteps.includes(step.id) && !skippedSteps.includes(step.id)
    );
}

export function getStepIndex(stepId: string): number {
    return GUIDE_STEPS.findIndex(step => step.id === stepId);
}
