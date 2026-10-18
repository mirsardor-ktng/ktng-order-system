import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from './db';

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 5;
const IP_LIMIT = 30;
const LOCK_MS = 10 * 60 * 1000;

interface AttemptState { windowStart: number; failures: number; lockedUntil?: number }

function keyFor(scope: string, value: string): string {
  const digest = crypto.createHash('sha256').update(`${scope}:${value}`).digest('hex');
  return `LOGIN_RATE_${digest}`;
}

function parseState(value?: string): AttemptState | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value) as AttemptState;
    if (typeof state.windowStart !== 'number' || typeof state.failures !== 'number') return null;
    return state;
  } catch { return null; }
}

async function locked<T>(keys: string[], operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  return prisma.$transaction(async (tx) => {
    for (const key of ordered) {
      // PostgreSQL advisory lock functions return the `void` pseudo-type, which
      // Prisma cannot deserialize from $queryRaw. Cast the result to text while
      // retaining the lock side effect for this transaction.
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_acquired
      `;
    }
    return operation(tx);
  });
}

/** Shared across serverless instances via PostgreSQL, with per-email and per-IP buckets. */
export async function isLoginRateLimited(email: string, ip: string): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const buckets = [
    { key: keyFor('email', email), limit: EMAIL_LIMIT },
    { key: keyFor('ip', ip), limit: IP_LIMIT }
  ];
  return locked(buckets.map((bucket) => bucket.key), async (tx) => {
    let retryAfterSeconds = 0;
    for (const bucket of buckets) {
      const row = await tx.systemSetting.findUnique({ where: { key: bucket.key }, select: { value: true } });
      const state = parseState(row?.value);
      if (state?.lockedUntil && state.lockedUntil > now) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((state.lockedUntil - now) / 1000));
      } else if (state && now - state.windowStart < WINDOW_MS && state.failures >= bucket.limit) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((state.windowStart + WINDOW_MS - now) / 1000));
      }
    }
    return { limited: retryAfterSeconds > 0, retryAfterSeconds };
  });
}

export async function recordFailedLogin(email: string, ip: string): Promise<void> {
  const now = Date.now();
  const buckets = [
    { key: keyFor('email', email), limit: EMAIL_LIMIT },
    { key: keyFor('ip', ip), limit: IP_LIMIT }
  ];
  await locked(buckets.map((bucket) => bucket.key), async (tx) => {
    for (const bucket of buckets) {
      const row = await tx.systemSetting.findUnique({ where: { key: bucket.key }, select: { value: true } });
      const old = parseState(row?.value);
      const state: AttemptState = old && now - old.windowStart < WINDOW_MS
        ? { ...old, failures: old.failures + 1 }
        : { windowStart: now, failures: 1 };
      if (state.failures >= bucket.limit) state.lockedUntil = now + LOCK_MS;
      const value = JSON.stringify(state);
      if (row) await tx.systemSetting.update({ where: { key: bucket.key }, data: { value } });
      else await tx.systemSetting.create({ data: { key: bucket.key, value } });
    }
  });
  if (Math.random() < 0.01) {
    await prisma.systemSetting.deleteMany({
      where: { key: { startsWith: 'LOGIN_RATE_' }, updatedAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } }
    });
  }
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const keys = [keyFor('email', email), keyFor('ip', ip)];
  await locked(keys, async (tx) => {
    await tx.systemSetting.deleteMany({ where: { key: { in: keys } } });
  });
}
