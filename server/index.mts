/**
 * 后端骨架（开发阶段）。
 *
 * 现在只有一个 `GET /health`：它要能回答「服务活着、数据库能读、结构版本是多少、
 * 各表有多少行」—— 这比「返回 200 OK」有用得多，因为启动失败最常见的原因是
 * 迁移没跑或数据库文件不对。
 *
 * 路由与业务实现按 docs/后端开发方案.md 的 7 步走：先只读接口，再写接口，
 * 最后把 lib/backend/api.ts 的实现从 localStorage 换成 fetch（页面代码不动）。
 */

import { createServer } from "node:http";
import { openDatabase, DB_PATH } from "./db.mts";
import { currentVersion, migrate } from "./migrate.mts";

const PORT = Number(process.env.PORT ?? 4000);

/** 骨架阶段先统计这几张表；加表时同步加进这里（health 就是给人看的）。 */
const COUNTED_TABLES = ["students", "teachers", "classrooms", "lessons", "courses", "site_content"];

function tableCounts(db: ReturnType<typeof openDatabase>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      counts[table] = row.n;
    } catch {
      counts[table] = -1; // -1 = 表还不存在（迁移还没跑到那一步）
    }
  }
  return counts;
}

const db = openDatabase();
const migration = migrate(db);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    const payload = {
      ok: true,
      service: "nexgenedu-server",
      stage: "skeleton",
      db: DB_PATH,
      schemaVersion: currentVersion(db),
      migration: { from: migration.from, to: migration.to, applied: migration.applied },
      counts: tableCounts(db),
      time: new Date().toISOString(),
    };
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload, null, 2));
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "还没有这个接口（骨架阶段只有 /health）" }));
});

server.listen(PORT, () => {
  console.log(`后端骨架已启动：http://localhost:${PORT}/health`);
  console.log(`数据库：${DB_PATH}（结构版本 v${currentVersion(db)}）`);
});

/** Ctrl+C 时先关服务再关数据库，避免留下 -wal/-shm 的中间状态。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
