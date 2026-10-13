import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  rm,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { readCloudConfig } from "./cloud-config.mjs";
const cloud = readCloudConfig();
const define = { __BUGGER_CLOUD__: JSON.stringify(cloud) };
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    bundle: true,
    define,
    format: "esm",
    target: "chrome120",
    minify: true,
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    bundle: true,
    define,
    format: "iife",
    target: "chrome120",
    minify: true,
  }),
  build({
    entryPoints: ["src/ui/index.tsx"],
    outfile: "dist/ui.js",
    bundle: true,
    define,
    format: "esm",
    target: "chrome120",
    minify: true,
  }),
]);
for (const file of await readdir("public"))
  await copyFile(`public/${file}`, `dist/${file}`);

if (cloud) {
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
  manifest.permissions.push("identity");
  manifest.optional_host_permissions = [
    ...new Set(
      [cloud.apiUrl, cloud.issuer, cloud.hostedDomain].map(
        (value) => new URL(value).origin + "/*",
      ),
    ),
  ];
  await writeFile(
    "dist/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
