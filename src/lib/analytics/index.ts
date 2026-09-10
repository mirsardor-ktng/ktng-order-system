import prisma from '../db';
import { hasPermission } from '../auth';
import { calculateSummary } from './summary';
import { calculateMonthlyTrend } from './monthly';
import { calculateProductAnalytics } from './products';
import { calculateCustomerAnalytics } from './customers';
import { calculateCustomerInsights } from './customer';

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role?: string;
  roleName?: string;
  permissions?: string[];
  companyId?: string | null;
}

const VALID_STATUSES = ['NEW', 'ASSEMBLY', 'SHIPPED', 'COMPLETED'];

export class AnalyticsService {
  static async getAnalyticsData(session: any, selectedMonthKey?: string | null) {
    const isStaff = hasPermission(session, 'orders:view_all');

    if (!isStaff) {
      // 1. Fetch current customer company orders
      const whereClause: any = { status: { in: VALID_STATUSES } };
      if (session.companyId) {
        whereClause.companyId = session.companyId;
      } else {
        whereClause.customerId = session.userId;
      }

      const customerOrders = await prisma.order.findMany({
        where: whereClause,
        include: {
          items: { include: { product: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      // 2. Fetch system-wide orders (optimized select) to calculate top growing product across all clients
      const allSystemOrders = await prisma.order.findMany({
        where: {
          status: { in: VALID_STATUSES }
        },
        select: {
          createdAt: true,
          items: {
            select: {
              productId: true,
              productNameSnapshot: true,
              itemTotalPrice: true,
              quantityPacks: true,
              price: true,
              product: {
                select: { name: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      const summary = calculateSummary(customerOrders);
      const monthlyTrend = calculateMonthlyTrend(customerOrders);
      const products = calculateProductAnalytics(customerOrders, selectedMonthKey);
      const insights = calculateCustomerInsights(customerOrders, allSystemOrders);

      return {
        isCustomer: true,
        summary,
        monthlyTrend,
        products,
        insights
      };
    } else {
      // For Admin, Seller, Manager
      const allOrders = await prisma.order.findMany({
        where: {
          status: { in: VALID_STATUSES }
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          items: { include: { product: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      const summary = calculateSummary(allOrders);
      const monthlyTrend = calculateMonthlyTrend(allOrders);
      const products = calculateProductAnalytics(allOrders, selectedMonthKey);
      const customers = calculateCustomerAnalytics(allOrders);

      return {
        isCustomer: false,
        summary,
        monthlyTrend,
        products,
        customers
      };
    }
  }
}
