import prisma from '../db';
import { calculateSummary } from './summary';
import { calculateMonthlyTrend } from './monthly';
import { calculateProductAnalytics } from './products';
import { calculateCustomerAnalytics } from './customers';
import { calculateCustomerInsights } from './customer';

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SELLER' | 'CUSTOMER' | 'MANAGER';
}

const VALID_STATUSES = ['NEW', 'ASSEMBLY', 'SHIPPED', 'COMPLETED'];

export class AnalyticsService {
  static async getAnalyticsData(session: JWTPayload, selectedMonthKey?: string | null) {
    const isCustomer = session.role === 'CUSTOMER';

    if (isCustomer) {
      // 1. Fetch current customer orders
      const customerOrders = await prisma.order.findMany({
        where: {
          customerId: session.userId,
          status: { in: VALID_STATUSES }
        },
        include: {
          items: { include: { product: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      // 2. Fetch all system orders to calculate system-wide top growing product
      const allSystemOrders = await prisma.order.findMany({
        where: {
          status: { in: VALID_STATUSES }
        },
        include: {
          items: { include: { product: true } }
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
