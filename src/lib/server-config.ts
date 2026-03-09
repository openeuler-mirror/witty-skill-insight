import { db, prisma } from '@/lib/prisma';

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
    const defaultSettings: UserSettings = { activeConfigId: null, configs: [] };
    
    if (!user) {
        return defaultSettings;
    }

    try {
        const record = await db.findUserSettings(user);
        if (record?.settingsJson) {
            return JSON.parse(record.settingsJson);
        }
    } catch (e) {
        console.error('Failed to load user settings:', e);
    }
    
    return defaultSettings;
}

export async function saveUserSettings(user: string, settings: UserSettings): Promise<void> {
    const settingsJson = JSON.stringify(settings);
    await db.upsertUserSettings(user, settingsJson);
}
