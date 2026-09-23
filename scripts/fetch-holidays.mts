/**
 * 抓取法定节假日与调休上班日（**命令行入口**）。
 *
 * ```bash
 * npm run holidays:fetch              # 今年 + 明年（默认）
 * npm run holidays:fetch -- 2024 2025 # 指定年份
 * npm run holidays:fetch -- --dry-run # 只抓、只校验、不落盘
 * ```
 *
 * ## 为什么还要一个命令行入口（界面上已经有按钮了）
 *
 *   1. **自动化**：每年 11 月国务院公布次年安排后，一条命令就能更新，不用等人去点界面；
 *   2. **排障**：界面按钮失败时，这里能把两个来源各自的原始结果与差异**打在终端上**，
 *      而界面只能显示一句话；
 *   3. **本机校验**：`--dry-run` 可以在不写任何文件的前提下确认"两个来源是否一致"。
 *
 * 它与后台那颗「重新抓取」按钮走的是**同一段代码**（`refreshHolidayYear`），
 * 因此不存在"命令行能过、界面过不了"这种不一致。
 */

import { defaultHolidayYears, holidaysDir, refreshHolidayYear } from "../server/holidays.mts";
import { summarizeHolidayYear } from "../lib/backend/holidays.ts";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const requested = argv.filter((item) => !item.startsWith("--"));

const years = requested.length > 0 ? requested.map((item) => Number(item)) : defaultHolidayYears();

console.log(dryRun ? "节假日抓取（**只校验，不写文件**）" : "节假日抓取");
console.log(`年份：${years.join("、")}`);
console.log(`写入目录：${holidaysDir()}`);
console.log("");

let failed = 0;
for (const year of years) {
  if (!Number.isInteger(year)) {
    console.log(`✗ ${year}：年份不是一个整数`);
    failed += 1;
    continue;
  }
  /*
   * 每年一个 `try/catch`：抓取链路上的意外（例如响应体读到一半断了）不该让整轮
   * **一个字都打不出来** —— 前面那些年份的结果同样重要，尤其是排障的时候。
   */
  let outcome;
  try {
    outcome = await refreshHolidayYear(year, { write: !dryRun });
  } catch (cause) {
    console.log(`✗ ${year}：抓取时出了意外：${cause instanceof Error ? cause.message : String(cause)}`);
    console.log("");
    failed += 1;
    continue;
  }

  const sources = outcome.status === "written" || outcome.status === "checked" ? outcome.value.sources : outcome.sources;
  for (const source of sources) {
    const mark = source.ok ? "✓" : "✗";
    console.log(`  ${mark} ${source.label}：${source.ok ? `${source.days} 天，指纹 ${source.fingerprint}` : source.note}`);
  }

  if (outcome.status === "not-published") {
    /*
     * **不算失败，也不计退出码**：一年里大部分时间"明年的安排还没公布"都是正常状态，
     * 让它报错退出会让"看退出码"的自动化每天报一次假警。
     */
    console.log(`· ${year}：${outcome.error}`);
    console.log("");
    continue;
  }

  if (outcome.status === "rejected") {
    console.log(`✗ ${year}：${outcome.error}`);
    if (outcome.verdict !== null) {
      for (const line of outcome.verdict.notes) console.log(`    · ${line}`);
    }
    console.log("");
    failed += 1;
    continue;
  }

  const summary = summarizeHolidayYear(outcome.value.days);
  console.log(
    `✓ ${year}：放假 ${summary.offDays} 天（最长连休 ${summary.longestOff} 天）、调休上班 ${summary.workDays} 天` +
      `　→　${outcome.status === "written" ? outcome.file : "（未写入，--dry-run）"}`,
  );
  for (const note of outcome.value.verdict.notes) console.log(`    · ${note}`);
  console.log("");
}

if (failed > 0) {
  console.log(`有 ${failed} 年没有通过（**没有写入任何东西**）。`);
  console.log("说明：");
  console.log("  · 「两个来源都没有这一年的数据」= 国务院通常在上一年 11 月公布，公布前本来就没有；");
  console.log("  · 「连不上某个来源」= 本机网络问题（每个来源都配了多个镜像地址、按顺序试），稍后重试即可；");
  console.log("  · 「两个来源对不上」= 请对照政府公告人工确认（这是本功能最该拦下的一类问题）。");
}
process.exit(failed > 0 ? 1 : 0);
