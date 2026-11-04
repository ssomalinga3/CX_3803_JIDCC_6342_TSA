import { sql } from 'drizzle-orm';
import { withDatabase } from './client.js';

/** Exercise Drizzle, the database connection, and the PostGIS extension. */
export async function checkDatabase(connectionString: string): Promise<void> {
  await withDatabase(connectionString, async (db) => {
    const result = await db.execute<{ ready: boolean }>(sql`
      SELECT ST_SRID(ST_SetSRID(ST_MakePoint(0, 0), 4326)) = 4326 AS ready
    `);
    if (result.rows[0]?.ready !== true) {
      throw new Error('Database readiness check failed');
    }
  });
}
