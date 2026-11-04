import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

/** Each request owns its client; Hyperdrive manages origin connection pooling. */
export async function withDatabase<T>(
  connectionString: string,
  operation: (db: NodePgDatabase) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });
  try {
    await client.connect();
    return await operation(drizzle(client));
  } finally {
    await client.end();
  }
}
