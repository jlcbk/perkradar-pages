import fs from "node:fs";
import path from "node:path";
import { getBoardState } from "../src/lib/board";
import { getDb, setMeta, useDatabase as resetDatabase } from "../src/lib/db";
import { runRefresh } from "../src/lib/refresh";

const PAGES_SCHEDULE_INTERVAL_MS = 60 * 60_000;

async function main(): Promise<void> {
  const skipLiveFetch = process.env.SKIP_LIVE_FETCH === "1";

  if (!skipLiveFetch) {
    await runRefresh({ trigger: "schedule" });
    setMeta("next_refresh_at", String(Date.now() + PAGES_SCHEDULE_INTERVAL_MS));
  } else {
    getDb();
  }

  const board = getBoardState();
  const target = path.join(process.cwd(), "public", "board.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(board, null, 2)}\n`);

  // Flush WAL frames into deals.db before closing so GitHub Actions cache stores a single clean file.
  try {
    getDb().exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    resetDatabase(null);
  }

  console.log(
    JSON.stringify(
      {
        roundStatus: board.roundStatus,
        sourceHealth: board.sourceHealth,
        activeCount: board.activeCount,
        newCount: board.newCount,
        failures: board.failures,
        boardJson: target,
      },
      null,
      2,
    ),
  );

  if (!skipLiveFetch && board.roundStatus === "failed" && board.activeCount === 0) {
    console.error("所有来源均失败且数据库无可用历史条目，停止本次发布。");
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
