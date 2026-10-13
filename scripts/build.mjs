import { build } from "esbuild";
import { mkdir, copyFile, rm, readdir } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    bundle: true,
    format: "esm",
    target: "chrome120",
    minify: true,
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    bundle: true,
    format: "iife",
    target: "chrome120",
    minify: true,
  }),
  build({
    entryPoints: ["src/ui/index.tsx"],
    outfile: "dist/ui.js",
    bundle: true,
    format: "esm",
    target: "chrome120",
    minify: true,
  }),
]);
for (const file of await readdir("public"))
  await copyFile(`public/${file}`, `dist/${file}`);
