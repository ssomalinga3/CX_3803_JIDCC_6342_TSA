// Tooling only: these credentials are for the loopback-only Docker database.
// This module must never be imported by the Worker bundle.
export function localDatabaseUrl(env = process.env) {
  const port = env.CASCADE_DB_PORT ?? '55432';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('CASCADE_DB_PORT must be a port between 1 and 65535');
  }
  return (
    env.DATABASE_URL ?? `postgres://cascade:cascade_local_only@127.0.0.1:${port}/cascade_springs`
  );
}
