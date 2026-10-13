import pg from "pg";
import { readFileSync } from "node:fs";
export const poolFor = (url: string) =>
  new pg.Pool({
    connectionString: url,
    ...(process.env.DATABASE_CA_FILE
      ? {
          ssl: {
            ca: readFileSync(process.env.DATABASE_CA_FILE, "utf8"),
            rejectUnauthorized: true,
          },
        }
      : {}),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734629105)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const versions = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    if (versions.rows.some((r) => ![1, 2].includes(r.version)))
      throw new Error("Unsupported database migration version");
    if (!versions.rows.length) {
      await client.query(
        `CREATE TABLE licenses(id uuid PRIMARY KEY,key_hash text UNIQUE NOT NULL,status text NOT NULL CHECK(status IN ('active','revoked')),created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE activations(license_id uuid NOT NULL REFERENCES licenses(id),installation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(license_id,installation_id));INSERT INTO schema_migrations(version) VALUES(1)`,
      );
    }
    if (!versions.rows.some((r) => r.version === 2)) {
      await client.query(
        `CREATE TABLE report_accounts(owner uuid PRIMARY KEY);CREATE TABLE reports(owner uuid NOT NULL REFERENCES report_accounts(owner),id uuid NOT NULL,issue jsonb NOT NULL,object_key text,bytes bigint NOT NULL CHECK(bytes>=0),version bigint NOT NULL CHECK(version>0),PRIMARY KEY(owner,id));INSERT INTO schema_migrations(version) VALUES(2)`,
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
