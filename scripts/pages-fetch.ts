import fs from "node:fs";
import path from "node:path";
import { getBoardState } from "../src/lib/board";
import { getDb, latestFinishedRound, setMeta, useDatabase as resetDatabase } from "../src/lib/db";
import { runRefresh } from "../src/lib/refresh";

const PAGES_SCHEDULE_INTERVAL_MS = 60 * 60_000;
const MIN_SCHEDULE_GAP_MS = 50 * 60_000;

function writeGithubOutput(key: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `${key}=${value}\n`);
  }
}

async function main(): Promise<void> {
  const skipLiveFetch = process.env.SKIP_LIVE_FETCH === "1";
  const isScheduledRun = process.env.GITHUB_EVENT_NAME === "schedule";

  if (!skipLiveFetch && isScheduledRun) {
    getDb();
    const lastRound = latestFinishedRound();
    if (
      lastRound &&
      lastRound.status === "success" &&
      lastRound.finishedAt != null &&
      Date.now() - lastRound.finishedAt < MIN_SCHEDULE_GAP_MS
    ) {
      const existing = getBoardState();
      resetDatabase(null);
      if (existing.activeCount > 0) {
        writeGithubOutput("should_deploy", "false");
        console.log(
          JSON.stringify({
            skipped: true,
            reason: "recent_success_within_50m",
            lastUpdatedLabel: existing.lastUpdatedLabel,
            activeCount: existing.activeCount,
          }),
        );
        return;
      }
    }
  }

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
    writeGithubOutput("should_deploy", "false");
    console.error("所有来源均失败且数据库无可用历史条目，停止本次发布。");
    process.exitCode = 1;
    return;
  }

  writeGithubOutput("should_deploy", "true");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
