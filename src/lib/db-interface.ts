
import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { Pool, PoolClient, QueryResult } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export interface DatabaseAdapter {
    // Session operations
    createSession(data: any): Promise<any>;
    updateSession(taskId: string, data: any): Promise<any>;
    upsertSession(taskId: string, createData: any, updateData: any): Promise<any>;
    findSessionByTaskId(taskId: string): Promise<any>;

    // User operations
    findUserByApiKey(apiKey: string): Promise<any>;
    findUserByUsername(username: string): Promise<any>;
    createUser(data: any): Promise<any>;

    // Skill operations
    findSkill(name: string, user: string | null): Promise<any>;
    findSkillById(id: string): Promise<any>;
    createSkill(data: any): Promise<any>;
    updateSkill(id: string, data: any): Promise<any>;
    deleteSkill(id: string): Promise<any>;
    findSkills(where: any): Promise<any[]>;

    // Skill Version operations
    findLatestSkillVersion(skillId: string): Promise<any>;
    createSkillVersion(data: any): Promise<any>;

    // Config operations
    findConfigs(where: any): Promise<any[]>;
    findConfigById(id: string): Promise<any>;
    createConfig(data: any): Promise<any>;
    updateConfig(id: string, data: any): Promise<any>;

    // Execution operations
    findExecutionById(id: string): Promise<any>;
    findExecutions(where: any, orderBy?: any): Promise<any[]>;
    upsertExecution(data: any): Promise<any>;
    deleteExecution(id: string): Promise<boolean>;
    deleteExecutions(where: any): Promise<number>;

    // UserSettings operations
    findUserSettings(user: string): Promise<any>;
    upsertUserSettings(user: string, settingsJson: string): Promise<any>;

    // Raw access if needed (use sparingly)
    getClient(): PrismaClient | Pool;
}

class PrismaAdapter implements DatabaseAdapter {
    private client: PrismaClient;

    constructor(client: PrismaClient) {
        this.client = client;
    }

    getClient() {
        return this.client;
    }

    async createSession(data: any) {
        return this.client.session.create({ data });
    }

    async updateSession(taskId: string, data: any) {
        if (data.id) {
            return this.client.session.update({ where: { id: data.id }, data });
        }
        return this.client.session.update({ where: { taskId }, data });
    }

    async upsertSession(taskId: string, createData: any, updateData: any) {
        return this.client.session.upsert({
            where: { taskId },
            create: createData,
            update: updateData
        });
    }

    async findSessionByTaskId(taskId: string) {
        return this.client.session.findUnique({ where: { taskId } });
    }

    async findUserByApiKey(apiKey: string) {
        return this.client.user.findUnique({ where: { apiKey } });
    }
    
    async findUserByUsername(username: string) {
        return this.client.user.findUnique({ where: { username } });
    }

    async createUser(data: any) {
        return this.client.user.create({ data });
    }

    async findSkill(name: string, user: string | null) {
        return this.client.skill.findFirst({
            where: { name, user }
        });
    }

    async findSkillById(id: string) {
        return this.client.skill.findUnique({ 
            where: { id },
            include: {
                versions: {
                    orderBy: { version: 'desc' }
                }
            }
        });
    }

    async createSkill(data: any) {
        return this.client.skill.create({ data });
    }

    async updateSkill(id: string, data: any) {
        return this.client.skill.update({ where: { id }, data });
    }

    async deleteSkill(id: string) {
        return this.client.skill.delete({ where: { id } });
    }

    async findSkills(where: any) {
        return this.client.skill.findMany({
            where,
            include: {
                versions: {
                    orderBy: { version: 'desc' }
                }
            }
        });
    }

    async findLatestSkillVersion(skillId: string) {
        return this.client.skillVersion.findFirst({
            where: { skillId },
            orderBy: { version: 'desc' }
        });
    }

    async createSkillVersion(data: any) {
        return this.client.skillVersion.create({ data });
    }
    
    async findConfigs(where: any) {
        return this.client.config.findMany({
            where,
            orderBy: { id: 'desc' }
        });
    }

    async findConfigById(id: string) {
        return this.client.config.findUnique({ where: { id } });
    }

    async createConfig(data: any) {
        return this.client.config.create({ data });
    }

    async updateConfig(id: string, data: any) {
        return this.client.config.update({ where: { id }, data });
    }

    async findExecutionById(id: string) {
        return this.client.execution.findUnique({ where: { id } });
    }

    async findExecutions(where: any, orderBy?: any) {
        return this.client.execution.findMany({
            where,
            orderBy
        });
    }

    async upsertExecution(data: any) {
        return this.client.execution.upsert(data);
    }

    async deleteExecution(id: string) {
        try {
            await this.client.execution.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }

    async deleteExecutions(where: any) {
        const result = await this.client.execution.deleteMany({ where });
        return result.count;
    }

    async findUserSettings(user: string) {
        return this.client.userSettings.findUnique({ where: { user } });
    }

    async upsertUserSettings(user: string, settingsJson: string) {
        return this.client.userSettings.upsert({
            where: { user },
            update: { settingsJson },
            create: { user, settingsJson }
        });
    }
}

class OpenGaussAdapter implements DatabaseAdapter {
    private pool: Pool;

    constructor(config: any) {
        this.pool = new Pool(config);
    }

    getClient() {
        return this.pool;
    }

    private async query(text: string, params?: any[]): Promise<QueryResult> {
        return this.pool.query(text, params);
    }
    
    async createSession(data: any) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(k => `"${k}"`).join(', ');
        
        const id = data.id || uuidv4();
        const sql = `INSERT INTO "Session" (${columns}, id) VALUES (${placeholders}, $${keys.length + 1}) RETURNING *`;
        const res = await this.query(sql, [...values, id]);
        return res.rows[0];
    }

    async updateSession(taskId: string, data: any) {
        const keys = Object.keys(data).filter(k => k !== 'id' && k !== 'taskId');
        if (keys.length === 0) return null;

        const setClause = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
        const values = keys.map(k => data[k]);
        
        let whereClause = 'WHERE "taskId" = $1';
        let param1 = taskId;
        
        if (data.id) {
             whereClause = 'WHERE id = $1';
             param1 = data.id;
        }

        const sql = `UPDATE "Session" SET ${setClause} ${whereClause} RETURNING *`;
        const res = await this.query(sql, [param1, ...values]);
        return res.rows[0];
    }

    async upsertSession(taskId: string, createData: any, updateData: any) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const checkRes = await client.query('SELECT * FROM "Session" WHERE "taskId" = $1', [taskId]);
            
            let result;
            if (checkRes.rows.length > 0) {
                const filteredUpdate: Record<string, any> = {};
                for (const [key, value] of Object.entries(updateData)) {
                    if (value !== undefined) {
                        filteredUpdate[key] = value;
                    }
                }
                
                const uKeys = Object.keys(filteredUpdate);
                if (uKeys.length > 0) {
                    const uSet = uKeys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
                    const uVals = uKeys.map(k => filteredUpdate[k]);
                    const uSql = `UPDATE "Session" SET ${uSet} WHERE "taskId" = $1 RETURNING *`;
                    const uRes = await client.query(uSql, [taskId, ...uVals]);
                    result = uRes.rows[0];
                } else {
                    result = checkRes.rows[0];
                }
            } else {
                if (!createData.taskId) createData.taskId = taskId;
                
                const filteredCreate: Record<string, any> = {};
                for (const [key, value] of Object.entries(createData)) {
                    if (value !== undefined) {
                        filteredCreate[key] = value;
                    }
                }
                
                const cKeys = Object.keys(filteredCreate);
                const cVals = Object.values(filteredCreate);
                const cCols = cKeys.map(k => `"${k}"`).join(', ');
                const cPlc = cKeys.map((_, i) => `$${i + 1}`).join(', ');
                const id = uuidv4();
                const cSql = `INSERT INTO "Session" (${cCols}, id) VALUES (${cPlc}, $${cKeys.length + 1}) RETURNING *`;
                const cRes = await client.query(cSql, [...cVals, id]);
                result = cRes.rows[0];
            }
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async findSessionByTaskId(taskId: string) {
        const res = await this.query('SELECT * FROM "Session" WHERE "taskId" = $1', [taskId]);
        return res.rows[0] || null;
    }

    async findUserByApiKey(apiKey: string) {
        const res = await this.query('SELECT * FROM "User" WHERE "apiKey" = $1', [apiKey]);
        return res.rows[0] || null;
    }
    
    async findUserByUsername(username: string) {
        const res = await this.query('SELECT * FROM "User" WHERE username = $1', [username]);
        return res.rows[0] || null;
    }

    async createUser(data: any) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(k => `"${k}"`).join(', ');
        
        const id = data.id || uuidv4();
        const sql = `INSERT INTO "User" (${columns}, id) VALUES (${placeholders}, $${keys.length + 1}) RETURNING *`;
        const res = await this.query(sql, [...values, id]);
        return res.rows[0];
    }

    async findSkill(name: string, user: string | null) {
        let sql = 'SELECT * FROM "Skill" WHERE name = $1';
        const params: any[] = [name];
        
        if (user) {
            sql += ' AND "user" = $2';
            params.push(user);
        } else {
            sql += ' AND "user" IS NULL';
        }
        
        const res = await this.query(sql, params);
        return res.rows[0] || null;
    }

    async findSkillById(id: string) {
        const res = await this.query('SELECT * FROM "Skill" WHERE id = $1', [id]);
        const skill = res.rows[0] || null;
        
        if (skill) {
            const vRes = await this.query('SELECT * FROM "SkillVersion" WHERE "skillId" = $1 ORDER BY version DESC', [skill.id]);
            skill.versions = vRes.rows;
        }
        
        return skill;
    }

    async createSkill(data: any) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(k => `"${k}"`).join(', ');
        
        const id = data.id || uuidv4();
        const sql = `INSERT INTO "Skill" (${columns}, id) VALUES (${placeholders}, $${keys.length + 1}) RETURNING *`;
        const res = await this.query(sql, [...values, id]);
        return res.rows[0];
    }

    async updateSkill(id: string, data: any) {
        const keys = Object.keys(data).filter(k => k !== 'id');
        if (keys.length === 0) return null;

        const setClause = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
        const values = keys.map(k => data[k]);
        
        const sql = `UPDATE "Skill" SET ${setClause} WHERE id = $1 RETURNING *`;
        const res = await this.query(sql, [id, ...values]);
        return res.rows[0];
    }

    async deleteSkill(id: string) {
        const res = await this.query('DELETE FROM "Skill" WHERE id = $1 RETURNING *', [id]);
        return res.rows[0] || null;
    }

    async findSkills(where: any) {
        let sql = 'SELECT * FROM "Skill"';
        const params: any[] = [];
        const conditions: string[] = [];

        if (where.isUploaded !== undefined) {
            conditions.push(`"isUploaded" = $${params.length + 1}`);
            params.push(where.isUploaded);
        }

        if (where.OR) {
            const orConditions: string[] = [];
            for (const cond of where.OR) {
                if (cond.user !== undefined) {
                    if (cond.user === null) {
                        orConditions.push('"user" IS NULL');
                    } else {
                        orConditions.push(`"user" = $${params.length + 1}`);
                        params.push(cond.user);
                    }
                }
                if (cond.visibility) {
                     orConditions.push(`"visibility" = $${params.length + 1}`);
                     params.push(cond.visibility);
                }
            }
            if (orConditions.length > 0) {
                conditions.push(`(${orConditions.join(' OR ')})`);
            }
        } else if (where.name && where.user) {
             conditions.push(`name = $${params.length + 1}`);
             params.push(where.name);
             conditions.push(`"user" = $${params.length + 1}`);
             params.push(where.user);
        }

        if (where.category) {
            conditions.push(`category = $${params.length + 1}`);
            params.push(where.category);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const res = await this.query(sql, params);
        const skills = res.rows;

        for (const skill of skills) {
            const vRes = await this.query('SELECT * FROM "SkillVersion" WHERE "skillId" = $1 ORDER BY version DESC', [skill.id]);
            skill.versions = vRes.rows;
        }

        return skills;
    }

    async findLatestSkillVersion(skillId: string) {
        const sql = 'SELECT * FROM "SkillVersion" WHERE "skillId" = $1 ORDER BY version DESC LIMIT 1';
        const res = await this.query(sql, [skillId]);
        return res.rows[0] || null;
    }

    async createSkillVersion(data: any) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(k => `"${k}"`).join(', ');
        
        const id = data.id || uuidv4();
        const sql = `INSERT INTO "SkillVersion" (${columns}, id) VALUES (${placeholders}, $${keys.length + 1}) RETURNING *`;
        const res = await this.query(sql, [...values, id]);
        return res.rows[0];
    }
    
    async findConfigs(where: any) {
        let sql = 'SELECT * FROM "Config"';
        const params: any[] = [];
        const conditions: string[] = [];
        
        if (where.OR) {
             const orConditions: string[] = [];
             for (const cond of where.OR) {
                 if (cond.user !== undefined) {
                     if (cond.user === null) {
                         orConditions.push('"user" IS NULL');
                     } else {
                         orConditions.push(`"user" = $${params.length + 1}`);
                         params.push(cond.user);
                     }
                 }
             }
             if (orConditions.length > 0) {
                 conditions.push(`(${orConditions.join(' OR ')})`);
             }
        }
        
        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        
        sql += ' ORDER BY id DESC';
        const res = await this.query(sql, params);
        return res.rows;
    }

    async findConfigById(id: string) {
        const res = await this.query('SELECT * FROM "Config" WHERE id = $1', [id]);
        return res.rows[0] || null;
    }

    async createConfig(data: any) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(k => `"${k}"`).join(', ');
        
        const id = data.id || uuidv4();
        const sql = `INSERT INTO "Config" (${columns}, id) VALUES (${placeholders}, $${keys.length + 1}) RETURNING *`;
        const res = await this.query(sql, [...values, id]);
        return res.rows[0];
    }

    async updateConfig(id: string, data: any) {
        const keys = Object.keys(data).filter(k => k !== 'id');
        if (keys.length === 0) return null;

        const setClause = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
        const values = keys.map(k => data[k]);
        
        const sql = `UPDATE "Config" SET ${setClause} WHERE id = $1 RETURNING *`;
        const res = await this.query(sql, [id, ...values]);
        return res.rows[0];
    }

    async findExecutionById(id: string) {
        const res = await this.query('SELECT * FROM "Execution" WHERE id = $1', [id]);
        return res.rows[0] || null;
    }

    async findExecutions(where: any, orderBy?: any) {
        let sql = 'SELECT * FROM "Execution"';
        const params: any[] = [];
        const conditions: string[] = [];

        if (where.OR) {
            const orConditions: string[] = [];
            for (const cond of where.OR) {
                if (cond.user !== undefined) {
                    if (cond.user === null) {
                        orConditions.push('"user" IS NULL');
                    } else {
                        orConditions.push(`"user" = $${params.length + 1}`);
                        params.push(cond.user);
                    }
                }
            }
            if (orConditions.length > 0) {
                conditions.push(`(${orConditions.join(' OR ')})`);
            }
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        if (orderBy?.timestamp === 'desc') {
            sql += ' ORDER BY "timestamp" DESC';
        }

        const res = await this.query(sql, params);
        return res.rows;
    }

    async upsertExecution(data: any) {
        const { where, create, update } = data;
        const id = where.id;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const checkRes = await client.query('SELECT * FROM "Execution" WHERE id = $1', [id]);

            let result;
            if (checkRes.rows.length > 0) {
                const filteredUpdate: Record<string, any> = {};
                for (const [key, value] of Object.entries(update)) {
                    if (value !== undefined) {
                        filteredUpdate[key] = value;
                    }
                }
                
                const uKeys = Object.keys(filteredUpdate);
                if (uKeys.length > 0) {
                    const uSet = uKeys.map((k, idx) => `"${k}" = $${idx + 2}`).join(', ');
                    const uVals = uKeys.map(k => filteredUpdate[k]);
                    const uSql = `UPDATE "Execution" SET ${uSet} WHERE id = $1 RETURNING *`;
                    const uRes = await client.query(uSql, [id, ...uVals]);
                    result = uRes.rows[0];
                } else {
                    result = checkRes.rows[0];
                }
            } else {
                const filteredCreate: Record<string, any> = {};
                for (const [key, value] of Object.entries(create)) {
                    if (value !== undefined) {
                        filteredCreate[key] = value;
                    }
                }
                
                const cKeys = Object.keys(filteredCreate);
                const cVals = Object.values(filteredCreate);
                const cCols = cKeys.map(k => `"${k}"`).join(', ');
                const cPlc = cKeys.map((_, idx) => `$${idx + 1}`).join(', ');
                const cSql = `INSERT INTO "Execution" (${cCols}) VALUES (${cPlc}) RETURNING *`;
                const cRes = await client.query(cSql, cVals);
                result = cRes.rows[0];
            }
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async deleteExecution(id: string) {
        try {
            const res = await this.query('DELETE FROM "Execution" WHERE id = $1', [id]);
            return (res.rowCount ?? 0) > 0;
        } catch {
            return false;
        }
    }

    async deleteExecutions(where: any) {
        let sql = 'DELETE FROM "Execution"';
        const params: any[] = [];
        const conditions: string[] = [];

        if (where.taskId) {
            conditions.push(`"taskId" = $${params.length + 1}`);
            params.push(where.taskId);
        }

        if (where.timestamp && where.framework && where.query) {
            conditions.push(`"timestamp" = $${params.length + 1}`);
            params.push(where.timestamp);
            conditions.push(`framework = $${params.length + 1}`);
            params.push(where.framework);
            conditions.push(`query = $${params.length + 1}`);
            params.push(where.query);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const res = await this.query(sql, params);
        return res.rowCount ?? 0;
    }

    async findUserSettings(user: string) {
        const res = await this.query('SELECT * FROM "UserSettings" WHERE "user" = $1', [user]);
        return res.rows[0] || null;
    }

    async upsertUserSettings(user: string, settingsJson: string) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const checkRes = await client.query('SELECT * FROM "UserSettings" WHERE "user" = $1', [user]);
            
            let result;
            if (checkRes.rows.length > 0) {
                const uRes = await client.query(
                    'UPDATE "UserSettings" SET "settingsJson" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "user" = $2 RETURNING *',
                    [settingsJson, user]
                );
                result = uRes.rows[0];
            } else {
                const id = uuidv4();
                const cRes = await client.query(
                    'INSERT INTO "UserSettings" (id, "user", "settingsJson") VALUES ($1, $2, $3) RETURNING *',
                    [id, user, settingsJson]
                );
                result = cRes.rows[0];
            }
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

export function getDatabaseAdapter(): DatabaseAdapter {
    console.log('[DatabaseAdapter] DB_HOST:', process.env.DB_HOST);
    if (process.env.DB_HOST) {
        console.log('[DatabaseAdapter] Using OpenGauss Adapter');
        return new OpenGaussAdapter({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME || 'postgres',
            user: process.env.DB_USER || 'omm',
            password: process.env.DB_PASSWORD,
        });
    }

    console.log('[DatabaseAdapter] Using Prisma Adapter');
    const globalForPrisma = global as unknown as { prisma: PrismaClient };
    const prismaClient = globalForPrisma.prisma || new PrismaClient();
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClient;
    
    return new PrismaAdapter(prismaClient);
}
