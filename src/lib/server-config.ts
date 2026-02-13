import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';

const CONFIG_FILE = path.join(process.cwd(), 'data', 'server_settings.json');

export interface EvalConfigItem {
    id: string;
    name: string;
    provider: 'deepseek' | 'openai' | 'anthropic' | 'siliconflow' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

export interface ServerSettingsV2 {
    activeConfigId: string | null;
    configs: EvalConfigItem[];
}

// Old format for migration checking
interface LegacyServerSettings {
    evalProvider: string;
    evalApiKey?: string;
    evalBaseUrl?: string;
    evalModel?: string;
}

const DEFAULT_SETTINGS: ServerSettingsV2 = {
    activeConfigId: null,
    configs: []
};

/**
 * Migration helper: Read old file-based settings if they exist
 */
function getLegacyFileSettings(): ServerSettingsV2 | null {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (!data.configs && data.evalProvider) {
                const legacy = data as LegacyServerSettings;
                return {
                    activeConfigId: 'migrated_legacy',
                    configs: [{
                        id: 'migrated_legacy',
                        name: 'Migrated Config',
                        provider: legacy.evalProvider as any,
                        apiKey: legacy.evalApiKey,
                        baseUrl: legacy.evalBaseUrl,
                        model: legacy.evalModel
                    }]
                };
            }
            return { ...DEFAULT_SETTINGS, ...data };
        }
    } catch (e) {
        console.error("Failed to read legacy file settings", e);
    }
    return null;
}

export async function getServerSettings(user?: string | null): Promise<ServerSettingsV2> {
    if (!user) return DEFAULT_SETTINGS;

    try {
        const dbSettings = await prisma.userSettings.findUnique({
            where: { user }
        });

        if (dbSettings) {
            return JSON.parse(dbSettings.settingsJson);
        }

        // Check if we can migrate from legacy file (only if it matches or as a general fallback)
        const legacy = getLegacyFileSettings();
        if (legacy) return legacy;

    } catch (e) {
        console.error("Failed to read server settings from DB", e);
    }
    return DEFAULT_SETTINGS;
}

export async function saveServerSettings(settings: ServerSettingsV2, user: string) {
    try {
        const saved = await prisma.userSettings.upsert({
            where: { user },
            update: { settingsJson: JSON.stringify(settings) },
            create: { user, settingsJson: JSON.stringify(settings) }
        });
        return JSON.parse(saved.settingsJson);
    } catch (e) {
        console.error("Failed to save server settings to DB", e);
        throw e;
    }
}

export async function getActiveConfig(user?: string | null): Promise<EvalConfigItem | undefined> {
    const settings = await getServerSettings(user);
    return settings.configs.find(c => c.id === settings.activeConfigId);
}
