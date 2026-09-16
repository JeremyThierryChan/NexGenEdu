/**
 * 开发模式：监听 data/site/*.md，改动后自动同步为 .ts 模块，并运行 next dev。
 *
 * 为什么需要它：
 *   内容以 .md 维护，但 Next 无法可靠地直接把 .md 当字符串 import
 *   （内置处理会把 `·` 序列化成非法的 `\xb7`），因此 .md 会先生成同名的 .ts 模块。
 *   本脚本把「生成」这一步自动化，并跟随 next dev 一起退出。
 *
 * 用 Node 内置的 fs.watch，不引入额外依赖。
 * 手工同步：npm run sync-content
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data", "site");

/** 同步一次内容（同步执行，避免并发写同一文件）。返回值表示是否成功。 */
function sync() {
  const result = spawn(process.execPath, [path.join(root, "scripts", "sync-content.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  return new Promise((resolve) => result.on("exit", (code) => resolve(code === 0)));
}

await sync();

// 启动 next dev，继承标准输入输出
const nextBin = path.join(root, "node_modules", ".bin", "next");
const dev = spawn(nextBin, ["dev"], { cwd: root, stdio: "inherit" });

let timer = null;
let syncing = false;
let pending = false;

/**
 * 防抖：编辑器保存常常连续触发多次事件。
 * 同步进行中再次触发时记为 pending，结束后补跑一次，避免漏掉最后一次改动。
 */
function scheduleSync() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    console.log("[content] 检测到 Markdown 改动，正在同步…");
    await sync();
    syncing = false;
    if (pending) {
      pending = false;
      scheduleSync();
    }
  }, 120);
}

try {
  watch(dataDir, (_event, filename) => {
    if (filename !== null && filename.endsWith(".md")) scheduleSync();
  });
  console.log(`[content] 已监听 ${path.relative(root, dataDir)}/*.md，修改后会自动同步`);
} catch (error) {
  // 监听失败不影响开发，只是需要手工执行 npm run sync-content
  console.warn("[content] 无法监听 Markdown 改动，请手动执行 npm run sync-content：", error);
}

const shutdown = () => {
  dev.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
dev.on("exit", (code) => process.exit(code ?? 0));
