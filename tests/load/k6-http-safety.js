/**
 * k6 runtime HTTP safety validator.
 * Compatible with k6 Goja runtime (no Node.js standard library dependencies).
 * Enforces local loopback targets and rejects missing targets, production domains,
 * credentials in URLs, and reserved database ports.
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

const FORBIDDEN_PORTS = [':5432', ':6543', ':22', ':25', ':6379', ':27017'];

export function validateK6Target(rawUrl, sourceLabel = 'k6') {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: No HTTP test target specified. A deliberate local URL (e.g. "http://127.0.0.1:3000") must be provided via TARGET_URL or TEST_HTTP_BASE_URL. Refusing to run.`
    );
  }

  const clean = rawUrl.trim();
  const lower = clean.toLowerCase();

  for (let i = 0; i < FORBIDDEN_HTTP_SUBSTRINGS.length; i++) {
    const forbidden = FORBIDDEN_HTTP_SUBSTRINGS[i];
    if (lower.indexOf(forbidden) !== -1) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Disallowed production/cloud keyword "${forbidden}" detected in HTTP target URL. Remote HTTP requests to production are strictly forbidden.`
      );
    }
  }

  // Enforce protocol
  const isHttp = lower.indexOf('http://') === 0;
  const isHttps = lower.indexOf('https://') === 0;
  if (!isHttp && !isHttps) {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Unexpected protocol in URL "${clean}". Expected http:// or https://.`
    );
  }

  // Enforce local loopback host
  const withoutProto = clean.replace(/^https?:\/\//i, '');
  const hostAndPort = withoutProto.split('/')[0];

  if (hostAndPort.indexOf('@') !== -1) {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Embedded credentials (username/password) in HTTP test target URL are forbidden.`
    );
  }

  const hostParts = hostAndPort.split(':');
  const host = hostParts[0].toLowerCase();
  const port = hostParts[1];

  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `SAFETY HALT [${sourceLabel}]: Non-local HTTP host "${host}". Only 127.0.0.1 or localhost is permitted as a test target.`
    );
  }

  if (port) {
    for (let i = 0; i < FORBIDDEN_PORTS.length; i++) {
      if (':' + port === FORBIDDEN_PORTS[i]) {
        throw new Error(
          `SAFETY HALT [${sourceLabel}]: Port "${port}" is a reserved service/database port. Refusing to send HTTP requests to database port.`
        );
      }
    }
    const portNum = Number(port);
    if (isNaN(portNum) || portNum < 80 || portNum > 65535) {
      throw new Error(
        `SAFETY HALT [${sourceLabel}]: Invalid port "${port}". Must be a valid port number.`
      );
    }
  }

  // Remove trailing slashes
  return clean.replace(/\/+$/, '');
}
