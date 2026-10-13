import { poolFor } from "./db.js";
import { provision } from "./licensing.js";
import { z } from "zod";
const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    LICENSE_KEY_PEPPER: z.string().min(32),
  })
  .parse(process.env);
const pool = poolFor(env.DATABASE_URL);
try {
  const [action, id, installationId] = process.argv.slice(2);
  if (action === "provision") {
    if (!process.stdout.isTTY && !process.env.ALLOW_LICENSE_STDOUT)
      throw new Error(
        "Use an interactive terminal or explicitly set ALLOW_LICENSE_STDOUT=1; output includes the raw secret.",
      );
    console.log(JSON.stringify(await provision(pool, env.LICENSE_KEY_PEPPER)));
  } else if (action === "revoke") {
    z.uuid().parse(id);
    const r = await pool.query(
      "UPDATE licenses SET status='revoked' WHERE id=$1 RETURNING id",
      [id],
    );
    if (!r.rowCount) throw new Error("License not found");
    console.log("License revoked");
  } else if (action === "release-device") {
    z.uuid().parse(id);
    z.uuid().parse(installationId);
    await pool.query(
      "DELETE FROM activations WHERE license_id=$1 AND installation_id=$2",
      [id, installationId],
    );
    console.log("Device released");
  } else
    throw new Error(
      "Usage: operator provision | revoke LICENSE_UUID | release-device LICENSE_UUID INSTALLATION_UUID",
    );
} finally {
  await pool.end();
}
