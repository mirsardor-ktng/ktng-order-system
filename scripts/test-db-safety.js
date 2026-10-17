// CommonJS safety barrier module for Node.js test and seed scripts
const defaultTestUser = process.env.TEST_DB_USER || 'ktng_test';
const defaultTestPass = process.env.TEST_DB_PASSWORD || process.env.PGPASSWORD;

const DEFAULT_LOCAL_TEST_DB_URL =
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

function validateLocalTestUrl(rawUrl, sourceLabel = 'DATABASE_URL') {
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

  let parsed;
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

function enforceLocalTestDatabaseEnv() {
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

const LOCAL_TEST_DB_URL = enforceLocalTestDatabaseEnv();

function isAllowedLocalServerAddress(addr) {
  if (!addr) {
    return true;
  }
  const clean = addr.replace(/\/\d+$/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') {
    return true;
  }
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/.test(clean)) {
    return true;
  }
  return false;
}

async function assertSafeLocalTestDatabase(client, scriptName = 'test-script') {
  const currentEnvUrl = process.env.DATABASE_URL;
  validateLocalTestUrl(currentEnvUrl, `${scriptName}:DATABASE_URL`);
  const parsed = new URL(currentEnvUrl);

  try {
    await client.$connect();
    const rows = await client.$queryRaw`
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

    const serverPort = Number(info.server_port || 5432);
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

    const verification = {
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
      // ignore disconnect error
    }
    throw err;
  }
}

const FORBIDDEN_HTTP_SUBSTRINGS = [
  'vercel.app',
  'ktng-order-system',
  'supabase',
  'amazonaws',
  'azure',
  'gcp',
  'railway',
  'render.com',
  'neon.tech',
  'fly.dev',
  'herokuapp.com',
  'production',
  'prod-'
];

function validateNonProductionHttpTarget(rawUrl, sourceLabel = 'HTTP_TARGET') {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: No HTTP test target specified. A deliberate local URL (e.g. "http://127.0.0.1:3000") must be provided via TEST_HTTP_BASE_URL. Refusing to run.`
    );
  }

  const clean = rawUrl.trim();
  const lower = clean.toLowerCase();

  for (const forbidden of FORBIDDEN_HTTP_SUBSTRINGS) {
    if (lower.includes(forbidden)) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Disallowed production/cloud keyword "${forbidden}" detected in HTTP target URL. Remote HTTP requests to production are strictly forbidden.`
      );
    }
  }

  let parsed;
  try {
    parsed = new URL(clean);
  } catch (_err) {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Failed to parse HTTP target URL (invalid URL syntax).`
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected protocol "${parsed.protocol}". Expected http: or https:.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Embedded credentials (username/password) in HTTP test target URL are forbidden.`
    );
  }

  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Non-local HTTP host "${parsed.hostname}". Only 127.0.0.1 or localhost is permitted as a test target.`
    );
  }

  const FORBIDDEN_PORTS = new Set(['5432', '6543', '22', '25', '6379', '27017']);
  if (parsed.port) {
    if (FORBIDDEN_PORTS.has(parsed.port)) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Port "${parsed.port}" is a reserved service/database port. Refusing to send HTTP requests to database port.`
      );
    }
    const portNum = Number(parsed.port);
    if (isNaN(portNum) || portNum < 80 || portNum > 65535) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Invalid port "${parsed.port}". Must be a valid port number.`
      );
    }
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function validateSafeRedirectLocation(location, baseUrl, sourceLabel = 'HTTP_REDIRECT') {
  if (!location || typeof location !== 'string' || location.trim() === '') {
    throw new Error(`SAFETY HALT [${sourceLabel}]: Empty redirect Location header.`);
  }

  let resolvedUrl;
  try {
    resolvedUrl = new URL(location, baseUrl).toString();
  } catch (_err) {
    throw new Error(`SAFETY HALT [${sourceLabel}]: Malformed redirect Location: "${location}".`);
  }

  return validateNonProductionHttpTarget(resolvedUrl, sourceLabel);
}

module.exports = {
  DEFAULT_LOCAL_TEST_DB_URL,
  validateLocalTestUrl,
  enforceLocalTestDatabaseEnv,
  assertSafeLocalTestDatabase,
  validateNonProductionHttpTarget,
  validateSafeRedirectLocation,
  LOCAL_TEST_DB_URL
};
