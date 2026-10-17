import { PrismaClient } from '@prisma/client';
export { validateNonProductionHttpTarget, validateSafeRedirectLocation } from './test-http-safety';

const defaultTestUser = process.env.TEST_DB_USER || 'ktng_test';
const defaultTestPass = process.env.TEST_DB_PASSWORD || process.env.PGPASSWORD;

/**
 * Default local PostgreSQL 15 test database URL (`b2b-test-postgres` container).
 * Uses local test credentials from environment. Does not hardcode default passwords.
 */
export const DEFAULT_LOCAL_TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  (defaultTestPass
    ? `postgresql://${defaultTestUser}:${defaultTestPass}@127.0.0.1:5432/ktng_test?schema=public`
    : `postgresql://${defaultTestUser}@127.0.0.1:5432/ktng_test?schema=public`);

const FORBIDDEN_HOST_SUBSTRINGS = [
  'supabase',
  'pooler',
  'amazonaws',
  'neon.tech',
  'railway',
  'render.com',
  'vercel',
  'azure',
  'gcp',
  'elephantsql',
  'cockroachlabs',
  'timescale'
];

export interface DatabaseSafetyVerification {
  database: string;
  user: string;
  serverAddr: string;
  serverPort: number;
  version: string;
  urlHost: string;
  urlPort: string;
}

/**
 * Validates that a connection URL string points exclusively to the local `ktng_test`
 * PostgreSQL database on 127.0.0.1/localhost:5432 with user `ktng_test`.
 * Fails closed on missing, malformed, remote, pooler, or unexpected values.
 * Never prints database passwords or secrets in error messages.
 */
export function validateLocalTestUrl(rawUrl: string | undefined, sourceLabel = 'DATABASE_URL'): string {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Database connection URL is missing or empty. Refusing to proceed.`
    );
  }

  const lower = rawUrl.toLowerCase();
  for (const forbidden of FORBIDDEN_HOST_SUBSTRINGS) {
    if (lower.includes(forbidden)) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Disallowed remote/cloud keyword "${forbidden}" detected in database URL. Refusing to connect.`
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (_err) {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Failed to parse database URL (invalid URL syntax).`
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected protocol "${parsed.protocol}". Expected postgresql:.`
    );
  }

  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Non-local database host "${parsed.hostname}". Only 127.0.0.1 or localhost is permitted.`
    );
  }

  if (parsed.port !== '5432') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected database port "${parsed.port}". Expected 5432.`
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName !== 'ktng_test') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected target database "${dbName}". Only "ktng_test" is permitted.`
    );
  }

  if (decodeURIComponent(parsed.username) !== 'ktng_test') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected database user "${parsed.username}". Expected "ktng_test".`
    );
  }

  return rawUrl;
}

/**
 * Executes immediately on module import (before `src/lib/db.ts` is evaluated):
 * - If `TEST_DATABASE_URL` or `DATABASE_URL` is already set in the environment,
 *   validates that it strictly targets local `ktng_test` (failing closed if it points
 *   to Supabase, a pooler, or any non-test database).
 * - If `DATABASE_URL` is unset in the shell, binds `process.env.DATABASE_URL` to the
 *   local `ktng_test` database so Prisma never falls back to reading `.env` on disk.
 */
export function enforceLocalTestDatabaseEnv(): string {
  const explicitTestUrl = process.env.TEST_DATABASE_URL;
  const existingEnvUrl = process.env.DATABASE_URL;

  if (explicitTestUrl !== undefined) {
    validateLocalTestUrl(explicitTestUrl, 'TEST_DATABASE_URL');
  }

  if (existingEnvUrl !== undefined) {
    validateLocalTestUrl(existingEnvUrl, 'DATABASE_URL');
    return existingEnvUrl;
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'local_test_jwt_secret_safe_default_32_chars';
  }

  const resolvedUrl = explicitTestUrl || DEFAULT_LOCAL_TEST_DB_URL;
  validateLocalTestUrl(resolvedUrl, 'RESOLVED_TEST_DB_URL');
  process.env.DATABASE_URL = resolvedUrl;
  return resolvedUrl;
}

// Run immediately at module load time so subsequent imports of `src/lib/db.ts`
// always receive the validated local `ktng_test` connection URL.
export const LOCAL_TEST_DB_URL = enforceLocalTestDatabaseEnv();

function isAllowedLocalServerAddress(addr: string | null | undefined): boolean {
  if (!addr) {
    // Unix domain socket or local loopback where inet_server_addr() is null
    return true;
  }
  const clean = addr.replace(/\/\d+$/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') {
    return true;
  }
  // Local Docker bridge network (172.16.0.0/12) mapped to 127.0.0.1:5432
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Positively verifies the live PostgreSQL connection by querying the server catalog
 * before any test creates, updates, or deletes records.
 * Fails closed and disconnects the client if any invariant is violated.
 */
export async function assertSafeLocalTestDatabase(
  client: PrismaClient,
  scriptName = 'test-script'
): Promise<DatabaseSafetyVerification> {
  const currentEnvUrl = process.env.DATABASE_URL;
  validateLocalTestUrl(currentEnvUrl, `${scriptName}:DATABASE_URL`);
  const parsed = new URL(currentEnvUrl!);

  try {
    await client.$connect();
    const rows = await client.$queryRaw<
      Array<{
        db: string;
        usr: string;
        server_addr: string | null;
        server_port: number | null;
        pg_version: string;
      }>
    >`
      SELECT
        current_database() AS db,
        current_user AS usr,
        inet_server_addr()::text AS server_addr,
        inet_server_port() AS server_port,
        version() AS pg_version
    `;

    if (!rows || rows.length !== 1) {
      throw new Error('SAFETY HALT: Live PostgreSQL identity query returned unexpected row count.');
    }

    const info = rows[0];
    if (info.db !== 'ktng_test') {
      throw new Error(
        `SAFETY HALT: Connected PostgreSQL database is "${info.db}", expected "ktng_test".`
      );
    }

    if (info.usr !== 'ktng_test') {
      throw new Error(
        `SAFETY HALT: Connected PostgreSQL user is "${info.usr}", expected "ktng_test".`
      );
    }

    const serverPort = Number(info.server_port ?? 5432);
    if (serverPort !== 5432) {
      throw new Error(
        `SAFETY HALT: Connected PostgreSQL server port is "${serverPort}", expected 5432.`
      );
    }

    if (!isAllowedLocalServerAddress(info.server_addr)) {
      throw new Error(
        `SAFETY HALT: Connected PostgreSQL server address "${info.server_addr}" is not a recognized local/Docker interface.`
      );
    }

    const verification: DatabaseSafetyVerification = {
      database: info.db,
      user: info.usr,
      serverAddr: info.server_addr || '127.0.0.1',
      serverPort,
      version: (info.pg_version || '').split(' ').slice(0, 2).join(' '),
      urlHost: parsed.hostname,
      urlPort: parsed.port
    };

    console.log(
      `[DB SAFETY BARRIER] PASSED (${scriptName}) -> db="${verification.database}" user="${verification.user}" host="${verification.urlHost}:${verification.urlPort}" serverAddr="${verification.serverAddr}:${verification.serverPort}" engine="${verification.version}"`
    );

    return verification;
  } catch (err) {
    try {
      await client.$disconnect();
    } catch (_) {
      // ignore disconnect error during safety halt
    }
    throw err;
  }
}
