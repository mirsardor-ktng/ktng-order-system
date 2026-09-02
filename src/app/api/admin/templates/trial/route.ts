import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateExcelOrder } from '@/lib/excel';
import { downloadFile } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Compiles a mock B2B order using the currently active spreadsheet template,
 * allowing administrators to verify layouts, formulas, and placeholder replacements instantly.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Verify admin permissions
    await requireAdmin(req);

    // 2. Locate active template
    const activeTemplate = await prisma.template.findFirst({
      where: { isActive: true }
    });

    let templateBuffer: Buffer;
    let templateName = 'default_order_template.xlsx';

    if (activeTemplate && !activeTemplate.isLocal && activeTemplate.fileId) {
      const fileName = activeTemplate.name.endsWith('.xlsx') ? activeTemplate.name : `${activeTemplate.name}.xlsx`;
      templateBuffer = await downloadFile(activeTemplate.fileId, fileName, 'Templates');
      templateName = fileName;
    } else {
      const localPath = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
      if (fs.existsSync(localPath)) {
        templateBuffer = fs.readFileSync(localPath);
      } else {
        return NextResponse.json({ error: 'Базовый шаблон не найден на сервере.' }, { status: 404 });
      }
    }

    // 3. Compile mock B2B trial order data (UZS So'm pricing)
    const mockTrialData = {
      clientName: 'СП ООО "ASIA-TOBACCO-TRADE" (ТЕСТ)',
      orderDate: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }),
      orderNumber: 'TRIAL-ORDER-UZS',
      totalBlocks: 65,
      totalCases: 1.3,
      totalPrice: 15705000, // Total price in UZS
      items: [
        {
          sku: 'ESSE-CHANGE',
          name: 'ESSE Change',
          packs: 500, // 50 blocks = 1 case
          blocks: 50,
          cases: 1,
          price: 25800, // UZS per pack
          itemTotalPrice: 12900000
        },
        {
          sku: 'BHM-CVNBR',
          name: 'BOHEM Cavana Brown',
          packs: 150, // 15 blocks = 0.3 cases
          blocks: 15,
          cases: 0.3,
          price: 18700,
          itemTotalPrice: 2805000
        }
      ]
    };

    // 4. Generate trial Excel sheet
    const compiledBuffer = await generateExcelOrder(templateBuffer, mockTrialData);

    const trialFileName = `TRIAL_PREVIEW_${templateName}`;

    // 5. Stream spreadsheet download
    return new NextResponse(compiledBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(trialFileName)}`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    console.error('[Trial Excel Generate failed]', error);
    return NextResponse.json({ error: `Сбой тестовой генерации: ${error.message}` }, { status: 500 });
  }
}
