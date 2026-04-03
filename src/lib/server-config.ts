import { db, prisma } from '@/lib/prisma';
import { loadDefaultModelConfigs } from '@/lib/default-model-config';

export interface ModelConfig {
    id: string;
    name: string;
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

export interface UserSettings {
    activeConfigId: string | null;
    configs: ModelConfig[];
}

export async function getActiveConfig(user?: string | null): Promise<ModelConfig | null> {
    const settings = await getUserSettings(user);
    if (!settings || !settings.activeConfigId) return null;
    return settings.configs.find(c => c.id === settings.activeConfigId) || null;
}

export async function getUserSettings(user?: string | null): Promise<UserSettings> {
    if (!user) {
        return { activeConfigId: null, configs: [] };
    }

    const defaultConfigs = loadDefaultModelConfigs();
    
    let userConfigs: ModelConfig[] = [];
    let activeConfigId: string | null = null;
    
    try {
        const record = await db.findUserSettings(user);
        if (record?.settingsJson) {
            const settings = JSON.parse(record.settingsJson);
            userConfigs = settings.configs.filter((c: ModelConfig) => !c.id.startsWith('default_'));
            activeConfigId = settings.activeConfigId;
        }
    } catch (e) {
        console.error('Failed to load user settings:', e);
    }
    
    const mergedConfigs = [...defaultConfigs, ...userConfigs];
    
    if (!activeConfigId || !mergedConfigs.find(c => c.id === activeConfigId)) {
        activeConfigId = defaultConfigs.length > 0 ? defaultConfigs[0].id : null;
    }
    
    return {
        activeConfigId,
        configs: mergedConfigs
    };
}

export async function saveUserSettings(user: string, settings: UserSettings): Promise<void> {
    const userOnlyConfigs = settings.configs.filter((c: ModelConfig) => !c.id.startsWith('default_'));
    
    const settingsJson = JSON.stringify({
        activeConfigId: settings.activeConfigId,
        configs: userOnlyConfigs
    });
    
    await db.upsertUserSettings(user, settingsJson);
}
