import prisma from '../db';

export class ProductsService {
  /**
   * Returns individual products (used by admin/seller views).
   */
  static async getProducts(filters: { search?: string; favoritesOnly?: boolean } = {}) {
    const { search, favoritesOnly } = filters;
    const whereClause: any = {
      isActive: true,
    };

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (favoritesOnly) {
      whereClause.isFavorite = true;
    }

    return await prisma.product.findMany({
      where: whereClause,
      include: {
        tags: true,
        group: { select: { id: true, displayName: true } }
      },
      orderBy: [
        { isFavorite: 'desc' },
        { name: 'asc' }
      ]
    });
  }

  static async getProductById(id: string) {
    return await prisma.product.findUnique({
      where: { id },
      include: {
        tags: true,
        group: { select: { id: true, displayName: true } }
      },
    });
  }

  /**
   * Update product — SELLER may only change stockPacks.
   */
  static async updateProduct(
    productId: string,
    data: Record<string, any>,
    callerRole: 'ADMIN' | 'SELLER' | 'CUSTOMER' | string
  ) {
    if (callerRole === 'SELLER') {
      const allowedKeys = new Set(['stockPacks']);
      const forbidden = Object.keys(data).filter(k => !allowedKeys.has(k));
      if (forbidden.length > 0) {
        throw new Error(
          `Роль SELLER не имеет права изменять: ${forbidden.join(', ')}.`
        );
      }
      // Validate stockPacks is a non-negative integer
      if (data.stockPacks !== undefined) {
        const v = parseInt(String(data.stockPacks));
        if (isNaN(v) || v < 0) throw new Error('Остаток должен быть неотрицательным числом.');
        data = { stockPacks: v };
      }
    }

    return await prisma.product.update({
      where: { id: productId },
      data,
      include: { tags: true, group: { select: { id: true, displayName: true } } }
    });
  }

  static async updateProductStock(tx: any, productId: string, packsCount: number, action: 'increment' | 'decrement') {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error(`Товар не найден: ${productId}`);

    if (action === 'decrement' && product.stockPacks < packsCount) {
      throw new Error(`Недостаточно товара на складе для позиции: ${product.name}`);
    }

    return await tx.product.update({
      where: { id: productId },
      data: {
        stockPacks: {
          [action]: packsCount,
        },
      },
    });
  }
}
