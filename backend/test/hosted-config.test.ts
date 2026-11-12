import { hostedEnvironment } from '../scripts/hosted-config.mjs';

const direct =
  'postgresql://owner:test@database.example.invalid/cascade-springs?sslmode=verify-full';
const pooled = direct.replace('database.', 'database-pooler.');

describe('explicit hosted database configuration', () => {
  it('uses Neon unpooled credentials for migrations without changing the source env', () => {
    const source = { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct };
    const env = hostedEnvironment(source, {});
    expect(env.DATABASE_URL).toBe(direct);
    expect(source.DATABASE_URL).toBe(pooled);
  });

  it('requires certificate and hostname verification for hosted connections', () => {
    const env = hostedEnvironment(
      { DATABASE_URL_UNPOOLED: direct.replace('verify-full', 'require') },
      {},
    );
    expect(env.DATABASE_URL).toBe(direct);
  });

  it('preserves shell precedence and supplies the runtime login to local Wrangler', () => {
    const runtime = direct.replace('owner:', 'runtime:');
    const env = hostedEnvironment(
      { DATABASE_URL_UNPOOLED: direct, CASCADE_RUNTIME_DB_URL: runtime, OTHER: 'file' },
      { OTHER: 'shell' },
    );
    expect(env.OTHER).toBe('shell');
    expect(env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE).toBe(runtime);
  });

  it.each([
    {},
    { DATABASE_URL: pooled },
    { DATABASE_URL: direct.replace('database.example.invalid', '127.0.0.1') },
    { DATABASE_URL: direct.replace('?sslmode=verify-full', '') },
    { DATABASE_URL: direct.replace('verify-full', 'disable') },
  ])('rejects missing, local, pooled and insecure URLs without leaking credentials', (source) => {
    expect(() => hostedEnvironment(source, {})).toThrow();
    try {
      hostedEnvironment(source, {});
    } catch (error) {
      expect(String(error)).not.toContain('owner:test');
    }
  });
});
