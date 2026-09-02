import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { uploadFile } from '@/lib/gdrive';

async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Lists all available Excel templates
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const templates = await prisma.template.findMany({
      orderBy: { uploadDate: 'desc' }
    });
    return NextResponse.json(templates);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * POST: Uploads a new .xlsx template file.
 * Receives file via multipart form data, validates it, and uploads to GDrive/Local.
 */
export async function POST(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const versionName = (formData.get('version') as string) || '1.0.0';

    if (!file) {
      return NextResponse.json({ error: 'Файл шаблона не прикреплен.' }, { status: 400 });
    }

    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json({ error: 'Поддерживаются только шаблоны в формате .xlsx (Excel)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // --- Validation (Block 6) ---
    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      if (workbook.worksheets.length === 0) {
        return NextResponse.json({ error: 'Шаблон не содержит листов.' }, { status: 400 });
      }

      let foundPlaceholder = false;
      workbook.eachSheet((sheet: any) => {
        sheet.eachRow((row: any) => {
          row.eachCell((cell: any) => {
            if (cell.value && typeof cell.value === 'string' && /\{[A-Z0-9_]+\}/.test(cell.value)) {
              foundPlaceholder = true;
            }
          });
        });
      });

      if (!foundPlaceholder) {
        return NextResponse.json({
          error: 'В шаблоне должен быть хотя бы один плейсхолдер в фигурных скобках (например, {CLIENT_NAME} или {SKU_NAME}).'
        }, { status: 400 });
      }
    } catch (parseErr: any) {
      return NextResponse.json({
        error: `Не удалось открыть шаблон Excel. Файл поврежден или имеет неверный формат: ${parseErr.message}`
      }, { status: 400 });
    }

    // Sync with Google Drive (or mock)
    const uploadResult = await uploadFile(
      file.name,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Templates'
    );

    const { getGDriveConfig } = await import('@/lib/gdrive');
    const gDriveConfig = await getGDriveConfig();

    if (!gDriveConfig.enabled) {
      // Save locally only in development mode fallback
      const templatesDir = path.join(process.cwd(), 'templates');
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }
      const localFilePath = path.join(templatesDir, file.name);
      fs.writeFileSync(localFilePath, buffer);
    }

    // Save record in database
    const newTemplate = await prisma.template.create({
      data: {
        name: file.name.replace('.xlsx', ''),
        fileId: uploadResult.fileId,
        isActive: false, // Uploaded templates are inactive by default
        version: versionName,
        isLocal: !gDriveConfig.enabled,
        filePath: gDriveConfig.enabled ? null : `templates/${file.name}`
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPLOAD_TEMPLATE',
        details: `Администратор загрузил новый шаблон Excel: ${file.name} (v${versionName})`
      }
    });

    return NextResponse.json({
      success: true,
      template: newTemplate,
      message: `Шаблон "${file.name}" загружен. ${uploadResult.message}`
    });
  } catch (error: any) {
    console.error('[Template Upload Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const body = await req.json();
    const { id, outputMode, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID шаблона не указан' }, { status: 400 });
    }

    const updateData: any = {};
    if (outputMode && ['COMMERCIAL', 'INVENTORY'].includes(outputMode)) {
      updateData.outputMode = outputMode;
    }

    if (isActive === true) {
      // 1. Deactivate all existing templates
      await prisma.template.updateMany({
        data: { isActive: false }
      });
      updateData.isActive = true;
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: updateData
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPDATE_TEMPLATE',
        details: `Администратор обновил шаблон ${updatedTemplate.name}: active=${updatedTemplate.isActive}, outputMode=${updatedTemplate.outputMode}`
      }
    });

    return NextResponse.json({
      success: true,
      template: updatedTemplate,
      message: `Шаблон "${updatedTemplate.name}" успешно обновлен.`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Purges an inactive template.
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get('id');

    if (!templateId) {
      return NextResponse.json({ error: 'ID не указан' }, { status: 400 });
    }

    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) {
      return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 });
    }

    if (template.isActive) {
      return NextResponse.json({ error: 'Вы не можете удалить активный шаблон. Сначала активируйте другой шаблон.' }, { status: 400 });
    }

    // Delete local file if it exists
    if (template.filePath) {
      const fullPath = path.join(process.cwd(), template.filePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {}
      }
    }

    // Delete from Google Drive if fileId is present
    if (template.fileId) {
      const { deleteFile } = await import('@/lib/gdrive');
      await deleteFile(template.fileId);
    }

    await prisma.template.delete({ where: { id: templateId } });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_TEMPLATE',
        details: `Администратор удалил шаблон Excel: ${template.name}`
      }
    });

    return NextResponse.json({ success: true, message: `Шаблон "${template.name}" удален.` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
