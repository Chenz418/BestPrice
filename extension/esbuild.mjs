// Build the extension into dist/ so it can be loaded unpacked in Chrome
// (chrome://extensions → Load unpacked → pick extension/dist).
//
//   node esbuild.mjs            one-off build
//   node esbuild.mjs --watch    rebuild on change
//
// Two entry points are bundled (background service worker + side panel). zod and
// @bestprice/shared are bundled in — the browser can't resolve bare specifiers.
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// Static assets copied verbatim next to the bundles.
await cp("manifest.json", `${outdir}/manifest.json`);
await cp("src/ui/sidepanel.html", `${outdir}/sidepanel.html`);
await cp("src/ui/styles.css", `${outdir}/styles.css`);

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: "src/background/background.ts",
    sidepanel: "src/ui/sidepanel.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  outdir,
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
} else {
  await build(options);
  console.log("[esbuild] built extension → dist/");
}
