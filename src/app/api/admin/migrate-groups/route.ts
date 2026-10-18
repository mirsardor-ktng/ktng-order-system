import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync } from '@/lib/auth';
import { ProductGroupService } from '@/lib/product-groups/product-groups.service';

/**
 * POST /api/admin/migrate-groups
 * Wraps each ungrouped Product into its own ProductGroup.
 * Idempotent — safe to run multiple times.
 */
export async function POST(req: NextRequest) {
  await requirePermissionAsync(req, 'product_groups:manage');

  const result = await ProductGroupService.migrateUngroupedProducts();

  return NextResponse.json({
    success: true,
    migrated: result.migrated,
    message: result.migrated > 0
      ? `Успешно создано ${result.migrated} групп товаров.`
      : 'Все товары уже находятся в группах.'
  });
}
