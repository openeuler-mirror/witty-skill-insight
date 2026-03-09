import { readRecords, saveExecutionRecord } from '@/lib/data-service';
import { db } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user') || undefined;

    const data = await readRecords(user);
    if (data.length > 0) {
        console.log(`[Data-API] 📤 Sending ${data.length} records. Top record skills: ${JSON.stringify(data[0].skills)}`);
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Read Data Error:', error);
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
    try {
        const target = await request.json();
        
        let deleteCount = 0;

        if (target.upload_id) {
            const success = await db.deleteExecution(target.upload_id);
            deleteCount = success ? 1 : 0;
        } else if (target.task_id) {
             deleteCount = await db.deleteExecutions({ taskId: target.task_id });
        } else {
             if (target.timestamp && target.framework && target.query) {
                 deleteCount = await db.deleteExecutions({
                     timestamp: new Date(target.timestamp),
                     framework: target.framework,
                     query: target.query
                 });
             }
        }
        
        return NextResponse.json({ success: true, count: deleteCount });

    } catch (error) {
        console.error('Delete Error:', error);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { task_id, upload_id, query: newQuery, user_feedback, label: newLabel, final_result: newFinalResult } = body;

        if (!task_id && !upload_id) {
            return NextResponse.json({ error: 'task_id or upload_id is required' }, { status: 400 });
        }

        if (user_feedback !== undefined) {
            const result = await saveExecutionRecord({
                task_id: task_id || undefined,
                upload_id: upload_id || undefined,
                user_feedback,
                force_judgment: false
            });
             return NextResponse.json({
                success: result.success,
                record: result.record,
                message: '用户反馈已更新'
            });
        }

        if (newLabel !== undefined) {
            const result = await saveExecutionRecord({
                task_id: task_id || undefined,
                upload_id: upload_id || undefined,
                label: newLabel,
                force_judgment: false
            });
             return NextResponse.json({
                success: result.success,
                record: result.record,
                message: 'Label 已更新'
            });
        }

        if (typeof newQuery === 'string') {
            if (!newQuery.trim()) {
                return NextResponse.json({ error: 'query must be a non-empty string' }, { status: 400 });
            }
            
            const result = await saveExecutionRecord({
                task_id: task_id || undefined,
                upload_id: upload_id || undefined,
                query: newQuery.trim(),
                skip_evaluation: true
            });

            return NextResponse.json({
                success: result.success,
                record: result.record,
                message: 'Query 已更新'
            });
        }

        if (typeof newFinalResult === 'string') {
            const result = await saveExecutionRecord({
                task_id: task_id || undefined,
                upload_id: upload_id || undefined,
                final_result: newFinalResult.trim(),
                force_judgment: true
            });

            return NextResponse.json({
                success: result.success,
                record: result.record,
                message: 'Final Result 已更新'
            });
        }

        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

    } catch (error) {
        console.error('Patch/Update Data Error:', error);
        return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
    }
}
