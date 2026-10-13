import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.name !== "Bugger" || manifest.manifest_version !== 3)
  throw new Error("Unexpected product manifest.");
if (
  JSON.stringify([...manifest.permissions].sort()) !==
  JSON.stringify(
    manifest.permissions.includes("identity")
      ? ["activeTab", "identity", "scripting", "storage"]
      : ["activeTab", "scripting", "storage"],
  )
)
  throw new Error("Review changed permissions before packaging.");
if (manifest.host_permissions?.length || manifest.content_scripts?.length)
  throw new Error("Unexpected persistent site access.");
if (
  manifest.optional_host_permissions?.some(
    (origin) => !/^https:\/\/[^/*]+\/\*$/.test(origin),
  )
)
  throw new Error("Cloud origins must use exact HTTPS hosts.");
if (
  manifest.permissions.includes("identity") &&
  !manifest.optional_host_permissions?.length
)
  throw new Error("Cloud identity needs configured origins.");
const zip = new JSZip();
const allowed = new Set([
  "background.js",
  "content.js",
  "ui.js",
  "ui.css",
  "popup.html",
  "issues.html",
  "manifest.json",
  "icon16.png",
  "icon48.png",
  "icon128.png",
]);
for (const name of (await readdir("dist")).sort()) {
  if (!allowed.has(name))
    throw new Error(`Unexpected distribution file: ${name}`);
  zip.file(name, await readFile(`dist/${name}`), {
    date: new Date("2026-10-12T00:00:00Z"),
  });
  allowed.delete(name);
}
if (allowed.size)
  throw new Error(`Missing distribution files: ${[...allowed]}`);
const bytes = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
const name = `bugger-${manifest.version}.zip`;
await mkdir("release", { recursive: true });
await writeFile(`release/${name}`, bytes);
const hash = createHash("sha256").update(bytes).digest("hex");
await writeFile(`release/${name}.sha256`, `${hash}  ${name}\n`);
console.log(`Created release/${name} (${bytes.length} bytes)\nSHA-256 ${hash}`);
