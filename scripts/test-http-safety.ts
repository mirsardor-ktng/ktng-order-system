/**
 * Fail-closed HTTP target safety barrier for test, benchmark, and diagnostic scripts.
 * Strictly prevents test scripts from targeting the production application
 * (e.g., `https://ktng-order-system.vercel.app`) or any remote cloud endpoint.
 *
 * Requirements:
 * - Requires a deliberate, validated non-production URL (e.g., `http://127.0.0.1:3000`).
 * - Fails closed if no URL is provided (never defaults or guesses a remote production target).
 * - Fails closed if any remote or production keywords are detected.
 * - Rejects embedded credentials (username/password) in URLs.
 * - Rejects reserved database and infrastructure ports (e.g., 5432, 6543, 22, 6379).
 * - Prevents silent redirect forwarding to remote hosts.
 */

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

const FORBIDDEN_PORTS = new Set(['5432', '6543', '22', '25', '6379', '27017']);

/**
 * Validates that an HTTP base URL strictly targets a local development/test server
 * on `127.0.0.1` or `localhost`.
 * Fails closed if missing, malformed, non-local, contains credentials, or points to production.
 */
export function validateNonProductionHttpTarget(
  rawUrl: string | undefined,
  sourceLabel = 'HTTP_TARGET'
): string {
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

  let parsed: URL;
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

  // Remove any trailing slashes to normalize base URL
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Validates a redirect Location header to ensure it does not redirect to a remote or forbidden host.
 * If location is a relative path (e.g. `/api/...`), resolves it against the safe local base URL.
 * If location is absolute, validates it via validateNonProductionHttpTarget.
 */
export function validateSafeRedirectLocation(
  location: string | undefined | null,
  baseUrl: string,
  sourceLabel = 'HTTP_REDIRECT'
): string {
  if (!location || typeof location !== 'string' || location.trim() === '') {
    throw new Error(`SAFETY HALT [${sourceLabel}]: Empty redirect Location header.`);
  }

  let resolvedUrl: string;
  try {
    resolvedUrl = new URL(location, baseUrl).toString();
  } catch (_err) {
    throw new Error(`SAFETY HALT [${sourceLabel}]: Malformed redirect Location: "${location}".`);
  }

  return validateNonProductionHttpTarget(resolvedUrl, sourceLabel);
}
