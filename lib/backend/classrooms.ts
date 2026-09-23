/**
 * 教室的两件"只有一处口径"的事：**怎么显示**与**怎么把「校区·教室名」拆开**。
 *
 * ## 为什么单独一个模块（与 `courses.ts` 放 `normalizeCourse` 同一个理由）
 *
 * 机构在加了「校区」字段之后给了一条口径（原话）：
 *
 * > 「**沐阳教育·教室1**，现在这个显示格式就是校区·教室名，现在添加了校区字段，
 * > 也就意味着我需要这个**卡片显示格式不变**，但**输入的时候校区和教室名称要单独输入**」
 *
 * 也就是说「·」这个间隔号在教室这件事上是**有含义的**：它是校区与教室名的连接符。
 * 于是有两处必须全仓库共用一个实现，否则迟早会出现"这个页面显示合并名、那个页面只显示房间号"：
 *
 *   1. **显示**：`classroomLabel(room)` —— 唯一一处拼教室名的地方。所有给用户看的地方
 *      （排课 / 批量排课 / 课表 / 今日概览 / 教室页卡片 / 冲突与拒绝文案 / 导出的 ICS 地点…）
 *      都必须走它。`scripts/check.mts` 有一节源码级断言盯着这件事。
 *   2. **拆分**：`normalizeClassroom`（内含 `splitCampusFromName`）—— 迁移（v30 → v31）、
 *      收尾归一、批量导入、服务层写入**共用这一处**：`campus` 为空且名字里含「·」时，
 *      按**第一个**「·」拆成 `campus` + `name`。
 *
 * ## 拆分为什么可以放在"读时"与"写时"都会经过的归一里
 *
 * 因为它**不改变用户看到的东西**：拆开之后 `classroomLabel` 拼回来与原文一模一样
 * （`沐阳教育·教室1` → 校区「沐阳教育」+ 教室名「教室1」→ 显示仍是「沐阳教育·教室1」）。
 * 换句话说这一步只是把同一串信息**换一种存法**，不是改内容 —— 与"把 A 改成 B"那种
 * 静默改动有本质区别。代价写在下面 `splitCampusFromName` 的说明里（名字里本来就有「·」
 * 且没填校区时会被当成合并写法），机构的口径已经认可这个含义。
 *
 * ## 一条纪律：`campus` 一旦非空**绝不再拆**
 *
 * 拆分只在 `campus === ""` 时发生，因此它是**幂等**的（连跑两次结果一样），
 * 也不会把机构已经分开填的「校区 + 教室名」再动一遍。
 * 唯一的例外是"两边都写了校区"（`campus` 有值、名字里还带着同一个前缀）——
 * 那时只去掉名字里那段**重复**的前缀，仍然不动 `campus`（见 `splitCampusFields` 的表）。
 *
 * ## v31 收紧：**校区必填**（拆完之后不能还是空的）
 *
 * 机构回答了那个"要不要加开关"的问题（原话）：「**校区必须填**」。
 *
 * 也就是说：歧义（名字里带「·」而校区空着，到底算不算合并写法）**不靠开关解决，
 * 靠让那个状态不再出现**。判据落在**拆完之后**：
 *
 *   | 交上来的一行 | 结果 |
 *   | --- | --- |
 *   | `campus=""`、`name="教室1"` | **拒绝**（拆不出校区） |
 *   | `campus="  "`、`name="教室1"` | **拒绝**（`trim` 之后仍是空的） |
 *   | `campus=""`、`name="沐阳教育·教室1"` | 通过：先拆成 `campus=沐阳教育` + `name=教室1`（**先拆后判**） |
 *
 * 最后一行就是"先拆后判"：它与**批量导入**是同一条口径（`import.ts` 的行归一也是拆在前、
 * 判在后）。为什么不在拆分之前判：那份"名称列里写着「沐阳教育·教室1」"的旧名单 /
 * 旧调用方**本来是能导、能建的**，判在拆分之前会把它们整份拒掉 —— 收紧要收的是
 * "校区空着"这个状态，不是把旧写法一起废掉。
 *
 * 三条**必须一起成立**才叫"校区必填"：写入闸（服务层 create / update）、批量导入的行校验、
 * 以及**界面表单**（`required` + 提交前那一句 JS 校验）。少一处就会出现
 * "换个入口就能建出一间没校区的房"，那正是这条口径要消灭的状态。
 *
 * 为什么**读取与迁移不判**：老库里可能真的躺着"名字里没有「·」"的教室（例如「自习区」），
 * 拆不出校区。在那里抛错等于**整库读不出来** —— 比"有一间房待补校区"坏得多。
 * 那种记录照常读出来、照常显示，只是在教室页卡片上挂一个**待补提示**，
 * 真要保存时才被必填拦住（`docs/使用手册.md` 与 `PROJECT.md` E11 都写了这条）。
 */

import type { Classroom } from "./types";

/** 校区与教室名之间的连接符。中文间隔号，**前后不加空格** —— 现有数据就是「沐阳教育·教室1」。 */
const CAMPUS_SEPARATOR = "·";

/** 去掉前后空白；非字符串一律当空串（不是 `String(value)` —— 那会把 null 变成 "null"）。 */
function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * **给用户看的教室名**（唯一一处显示口径，v31 起）。
 *
 * `campus` 非空 → `校区·教室名`（机构要的"卡片显示格式不变"，例如「沐阳教育·教室1」）；
 * 为空 → 就是教室名本身（例如「教室1」）。
 *
 * 刻意**不加空格**、也不用别的字符：机构那份数据的既有写法就是「沐阳教育·教室1」，
 * 换成「沐阳教育 · 教室1」等于把界面上每个教室名都改一遍（卡片、课表、导出、日历地点…）。
 */
export function classroomLabel(room: { campus: string; name: string }): string {
  const campus = trimText(room.campus);
  const name = trimText(room.name);
  if (campus === "") return name;
  if (name === "") return campus;
  return `${campus}${CAMPUS_SEPARATOR}${name}`;
}

/**
 * 把「校区·教室名」这种**合并写法**拆成两段（唯一的拆分实现）。
 *
 * 规则：按**第一个**「·」拆（`沐阳教育·落地房四楼·大` → 校区「沐阳教育」+ 教室名「落地房四楼·大」，
 * 拼接回去与原文一致）。
 *
 * 两种**不拆**的情形，都是为了不把数据弄坏：
 *   1. 拆出来有一段是空的（`·301` / `沐阳教育·`）—— 教室名不能是空串，
 *      这种名字只好原样留着（它本来就不是"校区·教室名"的写法）；
 *   2. 名字里没有「·」—— 没什么可拆的。
 *
 * ⚠️ 已知含义（机构口径认可）：教室名里**本来就带「·」**、而校区那一格是空的记录，
 * 会被当成合并写法拆开。显示一模一样（见 `classroomLabel`），因此用户看不出差别；
 * 但它确实会让「校区」多出一个值（例如把「自检·限时教室」拆成校区「自检」+ 教室名「限时教室」）。
 * 反过来定（只在迁移里拆）会让"表单一提交就变回合并名"，两边对不上，因此选了这条路。
 *
 * v31 收紧「校区必填」之后，这条含义**只剩"绕开表单"的入口**（批量导入一份旧名单、
 * 直接调用 `/api/call`）：页面表单的校区那一格已经是必填，所以正常用法再也走不到这里。
 * 上面那段"先拆后判"的表把这条含义写成了三条具体结果。
 */
export function splitCampusFromName(name: string): { campus: string; name: string } {
  const text = trimText(name);
  const at = text.indexOf(CAMPUS_SEPARATOR);
  if (at === -1) return { campus: "", name: text };
  const campus = text.slice(0, at).trim();
  const rest = text.slice(at + 1).trim();
  // 有一段是空的就不是「校区·教室名」的写法（教室名不能是空串），原样返回
  if (campus === "" || rest === "") return { campus: "", name: text };
  return { campus, name: rest };
}

/**
 * **这两个格子该是什么** —— 拆分规则的唯一入口（纯函数，只碰这两格）。
 *
 * 给两类调用方共用：
 *   - `normalizeClassroom`（`Classroom` 对象：迁移 / 收尾归一 / 服务层写入）；
 *   - 批量导入的行归一（手上是 `Record<string, unknown>`，不是 `Classroom` 对象）。
 * 合成一个"只算这两格"的函数，是为了让"校区空着就按第一个「·」拆"这条规则
 * **只写一次** —— 两边各写一遍的话，导入判重与迁移修出来的形状迟早会不一样。
 *
 * 三种情形（后两种都是 v31 补出来的，因为真实数据里确实出现了）：
 *
 * | 进来的一行 | 出去 |
 * | --- | --- |
 * | `campus=""`、`name="沐阳教育·教室1"` | 校区沐阳教育 + 教室名教室1（**按第一个「·」拆**） |
 * | `campus="沐阳教育"`、`name="沐阳教育·教室1"` | 校区沐阳教育 + 教室名教室1（**去掉名字里那段重复的校区前缀，只剥一次**） |
 * | `campus="沐阳教育"`、`name="教室1"` | 原样（**幂等**，绝不覆盖机构分开填的内容） |
 *
 * 第二行那种"两边都写了校区"的数据**真的会出现**：机构先在表单里填了校区，
 * 又把老表里那串「沐阳教育·教室1」粘进了教室名称那一格（或者拿旧导出的 CSV 再导一次）。
 * 不管的话显示会变成「沐阳教育·沐阳教育·教室1」（拼两遍）—— 而那样看起来像界面坏了，
 * 不像数据问题。去掉之后显示仍是原来那一串，因此这一步同样不改变用户看到的东西。
 */
export function splitCampusFields(input: {
  campus?: unknown;
  name?: unknown;
}): { campus: string; name: string } {
  const campus = trimText(input.campus);
  const name = trimText(input.name);
  if (campus === "") return splitCampusFromName(name);

  const prefix = `${campus}${CAMPUS_SEPARATOR}`;
  /*
   * **只剥一次**（机构口径里明确写了这一条，而且它是对的 —— 别改成 while 循环）。
   *
   * 因为剥离这一段**不改变显示**：`campus="沐阳教育"` + `name="沐阳教育·教室9"` 与
   * `name="教室9"` 拼出来都是「沐阳教育·教室9」。但若名字里**粘了两遍**校区
   * （`沐阳教育·沐阳教育·教室9`，粘贴两回才会出现），剥一次之后名字是
   * `沐阳教育·教室9`、显示仍是原来那串（不变）；而**循环剥到干净**就会把它变成
   * 「沐阳教育·教室9」——**显示被改短了**，那正是这一整套规则一直在避免的事。
   * 也就是说：一次是"把重复的那段去掉、显示不动"，多次就变成"替用户改名字"了。
   */
  if (name.startsWith(prefix)) {
    const rest = name.slice(prefix.length).trim();
    // 去掉前缀之后剩下的不能是空（教室名不能是空串），否则原样留着
    if (rest !== "") return { campus, name: rest };
  }
  return { campus, name };
}

/**
 * 这条记录的**校区有值吗** —— 「校区必填」这条口径的**唯一判据**（v31 收紧）。
 *
 * 判据就是"trim 之后非空"，只看 `campus` 那一格。服务层的写入闸直接调它；
 * 批量导入的行校验用的是**同一个判据**（`import.ts` 里那句通用的必填判，判的也是
 * "trim 之后是否为空"，而那里的值已经被 `normalizeClassroomRow` 去过空白，因此两处等价）。
 *
 * 刻意**不**在这里顺手看名字能不能拆：要判的是**拆完之后**的 `campus`，
 * 而调用方本来就应该先把记录过一遍 `normalizeClassroom`（服务层是 `normalizeClassroomStrict`，
 * 导入是 `normalizeClassroomRow`）—— 把"拆"这一步藏进这个判断里，
 * 等于"要不要拆"这件事有了两个入口，两边的结果迟早不一样。
 */
export function hasCampus(room: { campus?: unknown }): boolean {
  return trimText(room.campus) !== "";
}

/**
 * 服务层（以及照抄它的表单）那句「校区必填」的**唯一一处文案**。
 *
 * 机构原话（v31 收紧的由来）：问它"名字里真带「·」而校区空着会被当成合并写法拆开、
 * 要不要加个开关"时，机构答「**校区必须填**」。因此这里不是加开关，而是要求一定有校区 ——
 * 那句提示要把"为什么非填不可"讲出来（决定显示口径 + 用来按校区筛），
 * 否则用户只会觉得"又是一格必填"。
 *
 * 批量导入**另有一句**（`import.ts` 里那个 `emptyReason`）：它要指出的是"哪一行、
 * 少了哪一列"，因此说的是「缺少必填列：校区（…）」。两句都不是随口写的：
 * 一条记录从表单进来得到的说法与从 CSV 进来得到的说法**不该长成同一句**
 * （一个面向"你这一格没填"，一个面向"这一行缺列"），但**必须指的是同一条规则** ——
 * 判据因此共用 `hasCampus`。
 *
 * 零宽空格之类的写法不去管（`trim` 只按空白字符算），这与仓库里其它必填字段同一档：
 * 想绕过校验的人永远能绕过，要防的是**没注意**而不是**故意**。
 */
export function campusRequiredProblem(): string {
  return "校区必填 —— 它决定教室在列表与排课里显示成「校区·教室名」，也用来按校区筛。";
}

/**
 * 这条记录**需要**拆吗（`campus` 空着 + 名字是「校区·教室名」的写法）。
 *
 * 单独一个函数是为了不让"要不要拆"这个判据散成两处：迁移要**数**拆了几条（写日志用），
 * 归一要**做**拆分，两者必须用同一个判据 —— 否则日志里的数字与实际拆开的条数会不一样。
 */
export function needsCampusSplit(room: { campus: string; name: string }): boolean {
  return trimText(room.campus) === "" && splitCampusFields(room).campus !== "";
}

/**
 * 名字里**重复写了校区**吗（`campus` 已有值，而 `name` 还带着同一个校区的前缀）。
 *
 * 与 `needsCampusSplit` 分开是为了让迁移的日志把两种情形分别说清：
 * 一种是"拆成两个字段"，另一种是"去掉重复的前缀" —— 混成一句会让人以为
 * 后者也丢了一份信息。
 */
export function hasRedundantCampusPrefix(room: { campus: string; name: string }): boolean {
  const campus = trimText(room.campus);
  if (campus === "") return false;
  const name = trimText(room.name);
  const rest = name.startsWith(`${campus}${CAMPUS_SEPARATOR}`)
    ? name.slice(campus.length + CAMPUS_SEPARATOR.length).trim()
    : "";
  return rest !== "";
}

/**
 * 教室归一：去空白 + 把合并写法拆开（v31 起）。
 *
 * 调用点有**四处**，都走这一处实现（这是"口径只有一份"的关键）：
 *   1. `migrate()` 的 v30 → v31 那一步（把老库那些「沐阳教育·教室1」拆开）；
 *   2. `migrate()` 的**收尾归一**（一份"自称 v31"却还是合并写法的导入）；
 *   3. 批量导入（`import.ts` 的 `finalize`）；
 *   4. 服务层的 create / update（`versionedCollection` 的 `normalize` 钩子）。
 *
 * 与 `normalizeCourse` 同一条做法（展开原对象、只覆盖要归一的那几个字段）：
 * 因此**不会顺手丢掉调用方带的其他字段**（`id` / `version` 都在其中 —— 服务层要靠它们维持乐观锁）。
 *
 * `kind` / `capacity` / `availability` **刻意不在这里归一**：它们已经各有一处口径
 * （表单用 `Math.max(1, …)` 保证容量 ≥ 1，导入用 number 列校验），再归一一次就是两套口径。
 */
export function normalizeClassroom(
  input: Omit<Classroom, "id" | "version"> | Classroom,
): Classroom {
  const room = input as Classroom;
  // 两格走**唯一那条拆分规则**（`splitCampusFields`），其余字段原样带过
  const parts = splitCampusFields(room);
  return {
    ...room,
    name: parts.name,
    campus: parts.campus,
    note: trimText(room.note),
  };
}
