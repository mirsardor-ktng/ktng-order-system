import { NextRequest, NextResponse } from 'next/server';
import { getSession, hasPermission } from '@/lib/auth';
import { ProductsService } from '@/lib/products/products.service';
import { ProductGroupService } from '@/lib/product-groups/product-groups.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const favoritesOnly = searchParams.get('favorites') === 'true';

    const canSeeRawProducts = session.role === 'ADMIN' || session.role === 'SELLER' ||
      hasPermission(session, 'products:manage') ||
      hasPermission(session, 'products:stock_update') ||
      hasPermission(session, 'orders:edit');

    if (!canSeeRawProducts) {
      const groups = await ProductGroupService.getCatalogGroups({ search, favoritesOnly });
      return NextResponse.json(groups);
    }

    const products = await ProductsService.getProducts({ search, favoritesOnly });
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
