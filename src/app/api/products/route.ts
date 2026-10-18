import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync, hasPermission, isSuperAdmin } from '@/lib/auth';
import { ProductsService } from '@/lib/products/products.service';
import { ProductGroupService } from '@/lib/product-groups/product-groups.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = performance.now();
  try {
    const session = await requireAuthAsync(req);

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const favoritesOnly = searchParams.get('favorites') === 'true';

    const canSeeRawProducts = isSuperAdmin(session) ||
      hasPermission(session, 'products:read') ||
      hasPermission(session, 'products:manage') ||
      hasPermission(session, 'products:stock_update') ||
      hasPermission(session, 'orders:edit');

    if (!canSeeRawProducts) {
      const groups = await ProductGroupService.getCatalogGroups({ search, favoritesOnly });
      const durationMs = Math.round(performance.now() - start);
      console.log(`[PERF] GET /api/products durationMs: ${durationMs}`);
      return NextResponse.json(groups);
    }

    const products = await ProductsService.getProducts({ search, favoritesOnly });
    const durationMs = Math.round(performance.now() - start);
    console.log(`[PERF] GET /api/products durationMs: ${durationMs}`);
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
