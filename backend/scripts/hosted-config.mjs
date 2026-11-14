import { URL } from 'node:url';
// Hosted tooling is opt-in. Local commands continue to use their Docker defaults.
function validateDirectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Hosted database URL is missing or invalid');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.hostname.includes('-pooler') ||
    !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))
  ) {
    throw new Error('Hosted database commands require a direct PostgreSQL URL with TLS');
  }
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export function hostedEnvironment(fileEnv, shellEnv = process.env) {
  const env = { ...fileEnv, ...shellEnv };
  const databaseUrl = validateDirectUrl(
    env.DATABASE_URL_UNPOOLED?.trim() || env.DATABASE_URL?.trim(),
  );
  const runtimeUrl = env.CASCADE_RUNTIME_DB_URL?.trim();
  return {
    ...env,
    DATABASE_URL: databaseUrl,
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: runtimeUrl
      ? validateDirectUrl(runtimeUrl)
      : databaseUrl,
  };
}
