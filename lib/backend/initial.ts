import { catalogFromSeed } from "./catalog-seed";
import { materializeSiteCourses } from "./courses";
import { pricingConfigFromContent } from "./pricing";
import { siteContentFromContent } from "./site-content";
import { CURRENT_VERSION } from "./version";
import type { Database } from "./types";

/**
 * **空库起步**：系统真正的初始状态（业务表全空）。
 *
 * ## 为什么它与 `seed.ts` 分开
 *
 * `seed.ts` 造的是**示例数据**（8 位示例学生、示例排课、示例收款），它的用途现在只剩两个：
 * 自检与演示要在上面跑断言、以及 `NEXGENEDU_ALLOW_SEED=1` 时给人看界面。
 * 而机构真正开始用时，起点必须是**一张白纸** —— 空库自动灌入示例学生的后果很严重：
 * 员工会以为那是自己录的数据，或者要花时间一条条删掉，删错一条就动了真数据。
 *
 * 因此两者必须分开：**初始状态是空库**（本文件），示例数据是夹具（`seed.ts`）。
 * 早期 `load()` 在存储为空时灌示例数据，正是"初始状态与夹具混在一起"的后果。
 *
 * ## 保留什么、清空什么
 *
 * | 项 | 初始状态 | 为什么 |
 * | --- | --- | --- |
 * | 学生 / 教师 / 教室 / 排课 / 收款 / 课时流水 / 咨询 / 日志 | **空** | 这些是机构要一条条真实录进去的东西 |
 * | 课程库 | **网站课程**（`coursesFromSite()`） | 网站上的课程是已确定的公开信息，不需要人工重录一遍 |
 * | 网站课程正文 | **站点内容初始化**（`siteContentFromContent()`） | 同上：网站已经写好的介绍，没必要让机构再录一遍 |
 * | 报价配置 | **站点内容初始化**（`pricingConfigFromContent()`） | 价格是算钱的依据，且公开报价已定；空着会导致报价页算不出价 |
 * | 版本号 | `CURRENT_VERSION` | 必须是当前版本，否则新数据下次读取时会被迁移逻辑改写 |
 *
 * `updatedAt` 取当前时刻：它表示"这份库最后一次改动的时间"，空库也应有起始时间。
 */
export function createEmptyDatabase(now: Date = new Date()): Database {
  /*
   * 课程库与分区**一起**落定：网站卡片说的是分区名字（栏目 / 子栏目），而库里存 id，
   * 转换只有一处实现（`materializeSiteCourses`）—— 这里传空分区表起步，
   * 它会按内容文件的顺序把 6 个栏目与它们的子栏目录出来。
   */
  /*
   * 空库起步也把课程挂到维度上（传种子维度表）—— 否则新建的库一开就是
   * "32 门课全都没挂维度"，而机构根本没有老库可迁移。
   */
  const coursesFromContent = materializeSiteCourses([], undefined, catalogFromSeed());
  return {
    version: CURRENT_VERSION,
    students: [],
    teachers: [],
    classrooms: [],
    lessons: [],
    lessonRecords: [],
    homeworkRecords: [],
    assessments: [],
    transactions: [],
    payments: [],
    logs: [],
    inquiries: [],
    // 课程库与报价配置**不是"示例数据"**：它们来自网站内容，是真实的初始值
    courses: coursesFromContent.courses,
    coursePartitions: coursesFromContent.partitions,
    // 课程类型的维度表（学段/学科/模块/班型/交付形态）：照种子灌一份
    catalog: catalogFromSeed(),
    /*
     * 开放组合（v24）：**空表起步**。
     *
     * 与课程类型不同，这里刻意不灌任何种子：哪些组合开放是**机构的经营决定**，
     * 拼一份「看起来很像」的初值只会让人以为那是自己设的（而矩阵上一眼看不出来）。
     * 空表在矩阵里的表现是「还没人设过」—— 后台那一页会把每个学段的格子数出来，
     * 机构照着勾就行。
     */
    offers: [],
    /*
     * 寒暑假段（v27）：**空表起步**。
     *
     * 起止日期每年手动录入（不猜、不按农历算），因此这里不预置任何一段：
     * 拼一份"看起来很像"的日期，机构会以为那是系统算出来的。
     */
    vacations: [],
    pricing: pricingConfigFromContent(),
    siteContent: siteContentFromContent(),
    updatedAt: now.toISOString(),
  };
}
