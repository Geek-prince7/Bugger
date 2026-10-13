import http from "node:http";
import { readFile } from "node:fs/promises";
http
  .createServer(async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await readFile(new URL("../tests/fixture.html", import.meta.url)));
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Bugger fixture: http://127.0.0.1:4173"),
  );
