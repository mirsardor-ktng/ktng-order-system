import { NextRequest } from 'next/server';
import prisma from '../db';

export interface AuditLogOptions {
  userId: string | null;
  action: string;
  details: string;
  oldValue?: string | null;
  newValue?: string | null;
  req?: NextRequest;
}

export class AuditService {
  static async log(options: AuditLogOptions) {
    const { userId, action, details, oldValue, newValue, req } = options;

    let ipAddress: string | null = null;
    let userAgent: string | null = null;

    if (req) {
      // Extract IP address safely in Next.js Edge / Node environment
      ipAddress = req.headers.get('x-forwarded-for') || req.ip || null;
      if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
      userAgent = req.headers.get('user-agent') || null;
    }

    try {
      return await prisma.auditLog.create({
        data: {
          userId,
          action,
          details,
          oldValue,
          newValue,
          ipAddress,
          userAgent,
        },
      });
    } catch (err) {
      console.error('[AuditService Error] Failed to create audit log:', err);
    }
  }

  /**
   * Helper to format diff between order items for audit logging
   */
  static formatItemsDiff(oldItems: Array<{ name: string; quantity: number }>, newItems: Array<{ name: string; quantity: number }>) {
    const oldStr = oldItems.map(i => `${i.name}: ${i.quantity}`).join(', ');
    const newStr = newItems.map(i => `${i.name}: ${i.quantity}`).join(', ');
    return {
      oldValue: oldStr || 'Пусто',
      newValue: newStr || 'Пусто'
    };
  }
}
