import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ProductGroupService } from '@/lib/product-groups/product-groups.service';

/**
 * POST /api/admin/migrate-groups
 * Wraps each ungrouped Product into its own ProductGroup.
 * Idempotent — safe to run multiple times.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const result = await ProductGroupService.migrateUngroupedProducts();

  return NextResponse.json({
    success: true,
    migrated: result.migrated,
    message: result.migrated > 0
      ? `Успешно создано ${result.migrated} групп товаров.`
      : 'Все товары уже находятся в группах.'
  });
}
