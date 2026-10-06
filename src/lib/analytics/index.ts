import prisma from '../db';
import { hasPermission } from '../auth';
import { calculateSummary } from './summary';
import { calculateTrend } from './monthly';
import { calculateProductAnalytics } from './products';
import { calculateCustomerAnalytics } from './customers';
import { calculateCustomerInsights } from './customer';
import { calculateComparisonPeriod } from './helpers';

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role?: string;
  roleName?: string;
  permissions?: string[];
  companyId?: string | null;
}

export interface AnalyticsFilterOptions {
  startDate?: string | null;
  endDate?: string | null;
  companyIds?: string[] | null;
  monthKey?: string | null;
}

const VALID_STATUSES = ['NEW', 'ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED'];

export class AnalyticsService {
  static async getAnalyticsData(session: any, optionsOrMonth?: AnalyticsFilterOptions | string | null) {
    const isStaff = hasPermission(session, 'orders:view_all');

    const options: AnalyticsFilterOptions = typeof optionsOrMonth === 'string'
      ? { monthKey: optionsOrMonth }
      : (optionsOrMonth || {});

    let currentStart: Date | null = null;
    let currentEnd: Date | null = null;
    let prevStart: Date | null = null;
    let prevEnd: Date | null = null;
    let periodLength: number | null = null;
    let prevStartStr: string | null = null;
    let prevEndStr: string | null = null;

    if (options.monthKey) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(options.monthKey)) {
        const startStr = options.monthKey;
        const endStr = options.monthKey;

        const comp = calculateComparisonPeriod(startStr, endStr);
        prevStartStr = comp.prevStartStr;
        prevEndStr = comp.prevEndStr;
        periodLength = comp.periodLength;

        currentStart = new Date(`${startStr}T00:00:00.000Z`);
        currentEnd = new Date(`${endStr}T23:59:59.999Z`);
        prevStart = new Date(`${comp.prevStartStr}T00:00:00.000Z`);
        prevEnd = new Date(`${comp.prevEndStr}T23:59:59.999Z`);
      } else if (/^\d{4}-\d{2}$/.test(options.monthKey)) {
        const [y, m] = options.monthKey.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const startStr = `${options.monthKey}-01`;
        const endStr = `${options.monthKey}-${String(lastDay).padStart(2, '0')}`;

        const comp = calculateComparisonPeriod(startStr, endStr);
        prevStartStr = comp.prevStartStr;
        prevEndStr = comp.prevEndStr;
        periodLength = comp.periodLength;

        currentStart = new Date(`${startStr}T00:00:00.000Z`);
        currentEnd = new Date(`${endStr}T23:59:59.999Z`);
        prevStart = new Date(`${comp.prevStartStr}T00:00:00.000Z`);
        prevEnd = new Date(`${comp.prevEndStr}T23:59:59.999Z`);
      }
    } else if (options.startDate && options.endDate) {
      const comp = calculateComparisonPeriod(options.startDate, options.endDate);
      prevStartStr = comp.prevStartStr;
      prevEndStr = comp.prevEndStr;
      periodLength = comp.periodLength;

      currentStart = new Date(`${options.startDate}T00:00:00.000Z`);
      currentEnd = new Date(`${options.endDate}T23:59:59.999Z`);
      prevStart = new Date(`${comp.prevStartStr}T00:00:00.000Z`);
      prevEnd = new Date(`${comp.prevEndStr}T23:59:59.999Z`);
    }

    if (!isStaff) {
      // ── CUSTOMER ROLE ──
      // Security: Strictly enforce customer's own companyId
      const whereClause: any = { status: { in: VALID_STATUSES } };
      if (session.companyId) {
        whereClause.companyId = session.companyId;
      } else {
        whereClause.customerId = session.userId;
      }

      if (currentStart && currentEnd) {
        whereClause.createdAt = { gte: currentStart, lte: currentEnd };
      }

      const prevWhereClause: any = prevStart && prevEnd ? {
        status: { in: VALID_STATUSES },
        createdAt: { gte: prevStart, lte: prevEnd },
        ...(session.companyId ? { companyId: session.companyId } : { customerId: session.userId })
      } : null;

      const [customerOrders, prevOrders, allSystemOrders] = await Promise.all([
        prisma.order.findMany({
          where: whereClause,
          include: {
            items: { include: { product: true } }
          },
          orderBy: { createdAt: 'asc' }
        }),
        prevWhereClause ? prisma.order.findMany({
          where: prevWhereClause,
          include: {
            items: { include: { product: true } }
          },
          orderBy: { createdAt: 'asc' }
        }) : Promise.resolve([]),
        prisma.order.findMany({
          where: { status: { in: VALID_STATUSES } },
          select: {
            createdAt: true,
            items: {
              select: {
                productId: true,
                productNameSnapshot: true,
                itemTotalPrice: true,
                quantityPacks: true,
                price: true,
                product: { select: { name: true } }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        })
      ]);

      const summary = calculateSummary(customerOrders, prevWhereClause ? prevOrders : undefined);
      const trend = calculateTrend(customerOrders, options.startDate, options.endDate);
      const products = calculateProductAnalytics(customerOrders, prevWhereClause ? prevOrders : undefined, options.monthKey);
      const insights = calculateCustomerInsights(customerOrders, allSystemOrders);

      return {
        isCustomer: true,
        summary,
        monthlyTrend: trend.data,
        chartGranularity: trend.granularity,
        products,
        insights,
        period: {
          currentStart: options.startDate || null,
          currentEnd: options.endDate || null,
          previousStart: prevStartStr,
          previousEnd: prevEndStr,
          periodLength
        }
      };
    } else {
      // ── STAFF ROLES (Admin, Seller, Manager) ──
      const whereClause: any = { status: { in: VALID_STATUSES } };
      const prevWhereClause: any = prevStart && prevEnd ? {
        status: { in: VALID_STATUSES },
        createdAt: { gte: prevStart, lte: prevEnd }
      } : null;

      if (currentStart && currentEnd) {
        whereClause.createdAt = { gte: currentStart, lte: currentEnd };
      }

      if (options.companyIds && options.companyIds.length > 0) {
        whereClause.companyId = { in: options.companyIds };
        if (prevWhereClause) {
          prevWhereClause.companyId = { in: options.companyIds };
        }
      }

      const [allOrders, prevOrders, availableCompanies] = await Promise.all([
        prisma.order.findMany({
          where: whereClause,
          include: {
            customer: { select: { id: true, name: true, email: true } },
            company: { select: { id: true, name: true, code: true } },
            items: { include: { product: true } }
          },
          orderBy: { createdAt: 'asc' }
        }),
        prevWhereClause ? prisma.order.findMany({
          where: prevWhereClause,
          include: {
            customer: { select: { id: true, name: true, email: true } },
            company: { select: { id: true, name: true, code: true } },
            items: { include: { product: true } }
          },
          orderBy: { createdAt: 'asc' }
        }) : Promise.resolve([]),
        prisma.company.findMany({
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' }
        })
      ]);

      const summary = calculateSummary(allOrders, prevWhereClause ? prevOrders : undefined);
      const trend = calculateTrend(allOrders, options.startDate, options.endDate);
      const products = calculateProductAnalytics(allOrders, prevWhereClause ? prevOrders : undefined, options.monthKey);
      const customers = calculateCustomerAnalytics(allOrders);

      return {
        isCustomer: false,
        summary,
        monthlyTrend: trend.data,
        chartGranularity: trend.granularity,
        products,
        customers,
        companies: availableCompanies,
        period: {
          currentStart: options.startDate || null,
          currentEnd: options.endDate || null,
          previousStart: prevStartStr,
          previousEnd: prevEndStr,
          periodLength
        }
      };
    }
  }
}
