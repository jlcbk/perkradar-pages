import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const boardJsonPath = path.join(rootDir, "public", "board.json");

if (!fs.existsSync(boardJsonPath)) {
  throw new Error("未找到 public/board.json，请先运行 `npm run pages:fetch` 生成看板快照。");
}

const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const basePath = rawBasePath && rawBasePath !== "/" ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";

const workDir = path.join(rootDir, ".pages-build");
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

try {
  // Copy project config files; Node/Next resolves ../node_modules from rootDir automatically.
  for (const file of ["package.json", "tsconfig.json", "postcss.config.mjs"]) {
    fs.copyFileSync(path.join(rootDir, file), path.join(workDir, file));
  }

  // Copy public assets (including board.json) and shared frontend/lib source
  fs.cpSync(path.join(rootDir, "public"), path.join(workDir, "public"), { recursive: true });
  fs.cpSync(path.join(rootDir, "src", "components"), path.join(workDir, "src", "components"), { recursive: true });
  fs.cpSync(path.join(rootDir, "src", "lib"), path.join(workDir, "src", "lib"), { recursive: true });

  // Copy static-compatible app shell files (omitting dynamic API routes, login, and middleware)
  const appDir = path.join(workDir, "src", "app");
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of ["layout.tsx", "globals.css", "favicon.ico", "error.tsx"]) {
    const src = path.join(rootDir, "src", "app", file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(appDir, file));
    }
  }

  // Write static export page entry reading the pre-generated board.json snapshot
  fs.writeFileSync(
    path.join(appDir, "page.tsx"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { DealBoard } from "@/components/deal-board";',
      'import type { BoardState } from "@/lib/types";',
      "",
      "export default function StaticHomePage() {",
      '  const raw = fs.readFileSync(path.join(process.cwd(), "public", "board.json"), "utf8");',
      "  const board = JSON.parse(raw) as BoardState;",
      "  return <DealBoard initial={board} authEnabled={false} />;",
      "}",
      "",
    ].join("\n"),
  );

  // Write static export Next.js config
  fs.writeFileSync(
    path.join(workDir, "next.config.mjs"),
    [
      "/** @type {import('next').NextConfig} */",
      "const nextConfig = {",
      '  output: "export",',
      `  basePath: ${JSON.stringify(basePath)},`,
      "  images: { unoptimized: true },",
      "};",
      "",
      "export default nextConfig;",
      "",
    ].join("\n"),
  );

  const nextBin = path.join(rootDir, "node_modules", ".bin", "next");
  execFileSync(nextBin, ["build"], {
    cwd: workDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DISABLE_SCHEDULER: "1",
      NEXT_PUBLIC_STATIC_EXPORT: "1",
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
  });

  const outDir = path.join(rootDir, "out");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(workDir, "out"), outDir, { recursive: true });
  // Ensure GitHub Pages serves `/_next/*` static bundles without Jekyll filtering
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
  console.log(`静态站点已生成至: ${outDir} (basePath=${basePath || "/"})`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
