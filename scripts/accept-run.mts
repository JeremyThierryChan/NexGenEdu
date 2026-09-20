/**
 * 逐页验收的运行器：**自己起临时后端**，再跑 `accept-check.mts`。
 *
 * ## 为什么要有这一层
 *
 * `accept-check.mts` 的整套价值在于"对着**真实后端**做真实写操作"。但它自己是
 * 一个普通脚本：忘了设 `NEXT_PUBLIC_API_BASE` 时，`createKeyValueStore()` 会在
 * Node 里退化成**内存存储**，于是它安静地测了伪后端，还照样打印
 * 「43/43 通过（逐页验收全部通过）」—— 这是一份**假证据**，比不跑更糟。
 *
 * 所以把"起服务 + 指对地址 + 收尾"都收进这一层，`npm run accept` 一条命令就能给出
 * 可信结论；`accept-check.mts` 里再留一道"没指向服务端就直接退出"的闸。
 *
 * 用法：`npm run accept`
 */

import { run, withTempServer } from "./temp-server.mts";

const ACCEPT_ARGS = [
  "--experimental-strip-types",
  "--import",
  "./server/loader.mjs",
  "scripts/accept-check.mts",
];

console.log("=== 逐页验收（真实服务端 + 临时 SQLite 库，真实读写）===");
let exitCode = 1;
try {
  exitCode = await withTempServer(async (base, info) => {
    console.log(`✓ 服务端就绪：${base}（临时库 ${info.dbPath}，不碰真实数据）\n`);
    const result = await run(process.execPath, ACCEPT_ARGS, {
      env: {
        NEXT_PUBLIC_API_BASE: base,
        // 第 6 步之后接口要登录：把本次测试账号交给验收脚本
        NEXGENEDU_ADMIN_USER: info.username,
        NEXGENEDU_ADMIN_PASSWORD: info.password,
      },
    });
    process.stdout.write(result.output);
    return result.code;
  });
} catch (cause) {
  console.error(`✗ 起临时服务端失败：${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
}

if (exitCode !== 0) {
  console.error("\n✗ 逐页验收未通过 —— 上面是它的完整输出。");
}
process.exit(exitCode);
