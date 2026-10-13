import { poolFor, migrate } from "./db.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = poolFor(process.env.DATABASE_URL);
try {
  await migrate(pool);
  console.log("Schema version 1 ready");
} finally {
  await pool.end();
}
