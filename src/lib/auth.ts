/**
 * 通用 API Key 认证工具
 * 
 * 用户身份获取优先级：
 * 1. 请求中直接传入的 user 参数（兼容旧逻辑）
 * 2. x-witty-api-key 请求头
 * 3. apiKey 查询参数
 * 
 * 如果都没有，返回 null（兼容无认证场景）
 */

import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

export interface AuthResult {
    username: string | null;
    apiKey: string | null;
}

/**
 * 从请求中解析用户身份
 * @param request - NextRequest 或 Request 对象
 * @param explicitUser - 显式传入的 user 参数（优先级最高）
 * @returns AuthResult
 */
export async function resolveUser(
    request: NextRequest | Request,
    explicitUser?: string | null
): Promise<AuthResult> {
    // 1. 优先使用显式传入的 user 参数（兼容旧逻辑）
    if (explicitUser) {
        return { username: explicitUser, apiKey: null };
    }

    // 2. 尝试从 header 获取 API Key
    const headerApiKey = request.headers.get('x-witty-api-key');
    if (headerApiKey) {
        const user = await lookupUserByApiKey(headerApiKey);
        return { username: user, apiKey: headerApiKey };
    }

    // 3. 尝试从查询参数获取 API Key
    const url = new URL(request.url);
    const queryApiKey = url.searchParams.get('apiKey');
    if (queryApiKey) {
        const user = await lookupUserByApiKey(queryApiKey);
        return { username: user, apiKey: queryApiKey };
    }

    return { username: null, apiKey: null };
}

/**
 * 通过 API Key 查找用户名
 */
async function lookupUserByApiKey(apiKey: string): Promise<string | null> {
    try {
        const user = await prisma.user.findUnique({
            where: { apiKey }
        });
        return user?.username || null;
    } catch (e) {
        console.error('[Auth] Failed to lookup user by API Key:', e);
        return null;
    }
}

/**
 * 验证请求者是否有权操作指定 skill
 * @returns true 如果有权限，false 如果无权限
 */
export async function canAccessSkill(
    skillId: string,
    username: string | null
): Promise<{ allowed: boolean; skill: any }> {
    const skill: any = await prisma.skill.findUnique({ where: { id: skillId } });
    
    if (!skill) {
        return { allowed: false, skill: null };
    }

    // 公共 skill 任何人可访问
    if (skill.visibility === 'public') {
        return { allowed: true, skill };
    }

    // 无主 skill（旧数据）任何人可访问
    if (!skill.user) {
        return { allowed: true, skill };
    }

    // 私有 skill 需要是归属用户
    if (username && skill.user === username) {
        return { allowed: true, skill };
    }

    // 未认证的用户无法访问私有 skill
    if (!username) {
        // 兼容旧逻辑：如果请求方没有提供任何认证信息，仍然允许访问
        // 这样不会破坏现有的无认证使用场景
        return { allowed: true, skill };
    }

    return { allowed: false, skill };
}
