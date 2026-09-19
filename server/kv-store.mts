/**
 * 服务端的 KeyValueStore：把伪后端的那份 JSON 快照存进 SQLite。
 *
 * ## 为什么这么做（而不是把每个实体拆成 SQL 表）
 *
 * `api.ts` 本来就与存储解耦：它只认 `KeyValueStore`（`read/write/remove`），
 * 浏览器里给的是 localStorage、自检里给的是内存实现。服务端只要**再给一个实现**，
 * 真实后端就成立了 —— 而所有业务口径（课时、金额、请假、冲突判定、报价…）
 * **一行都不用重写**，因为跑的还是同一份 `api.ts`。
 *
 * 这是刻意的取舍：换来的"口径天然只有一份"比"按行查询"重要得多 ——
 * 把口径写第二遍，两边迟早分叉，而分叉只在期末对账或家长投诉时才暴露。
 * 代价写在 docs/后端开发方案.md §5.3：没有按行查询与并发控制。
 * 将来数据量或并发真成问题时，再逐表迁到 SQL（接口形状不变，页面永远不动）。
 *
 * 一个顺带的便利：better-sqlite3 是**同步** API，正好与 KeyValueStore 的同步签名吻合，
 * 不需要把接口改成异步。
 */

import type Database from "better-sqlite3";
import type { KeyValueStore } from "../lib/backend/storage.ts";

const TABLE = "kv";

/** 建表（幂等）。放在这里而不是迁移脚本里：它是存储实现的内部细节。 */
export function ensureKvTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

/** 用 SQLite 表实现的键值存储：写入即落盘（WAL 模式下性能足够，本机构是 KB 级数据）。 */
export function createSqliteStore(db: Database.Database): KeyValueStore {
  ensureKvTable(db);
  const read = db.prepare(`SELECT value FROM ${TABLE} WHERE key = ?`);
  const write = db.prepare(`INSERT OR REPLACE INTO ${TABLE} (key, value) VALUES (?, ?)`);
  const remove = db.prepare(`DELETE FROM ${TABLE} WHERE key = ?`);

  return {
    read(key) {
      const row = read.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    write(key, value) {
      write.run(key, value);
    },
    remove(key) {
      remove.run(key);
    },
  };
}

/** 当前快照的字节数（/health 用来显示"库里有多少数据"）。 */
export function snapshotSize(db: Database.Database, key: string): number {
  ensureKvTable(db);
  const row = db.prepare(`SELECT LENGTH(value) AS n FROM ${TABLE} WHERE key = ?`).get(key) as
    | { n: number | null }
    | undefined;
  return row?.n ?? 0;
}
