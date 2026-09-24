/**
 * 「暂未开放」的项一律排在**最后**。
 *
 * 机构原话：「**在报价器和其他部分加一个小功能，自动排序，把暂未开放的内容自动往后排**」。
 *
 * ## 为什么单独成文件、而且只写一遍
 *
 * 网站有**两条取数路径**（连上后端用库、连不上用 `data/site/*.md`），
 * 后台还有服务层那条路。同一条规则在三个地方各写一遍 `.sort()` 的下场是
 * "网站上暂未开放的排到了最后、后台清单里却还夹在中间" —— 这种不一致没有任何
 * 自检能发现（两边都"能显示"）。因此规则只在这里写一次，各处只调用。
 *
 * ## 三条必须守住的边界
 *
 *   1. **稳定**：只把不可用的项**往后挪**，可用的项之间、不可用的项之间的**相对顺序一律不变**。
 *      不是"重新按名字排"—— 阶段 / 课程 / 卡片的顺序是机构自己排的（分区 `order`、
 *      卡片 `order`、内容文件里的出现顺序），二次排序会把它悄悄改掉；
 *   2. **不过滤**：暂未开放的项**照旧出现在列表里**（页面上本来就显示它们、
 *      只是灰掉或标注「暂未开放」）。"往后排"是**显示顺序**，不是"藏起来"——
 *      家长与机构都要能看到"这门课存在、只是还没开"；
 *   3. **不写数据**：这是**显示**规则。调用方一律在"要渲染的那一刻"套一层，
 *      绝不把结果存回数据库或内容文件（那样 `npm run site:export` 会把顺序写进
 *      `data/site/*.md`，等于把显示顺序变成了数据）。
 *
 * ## 为什么不用 `items.sort(...)`
 *
 * `Array#sort` 从 ES2019 起要求稳定，但"稳定"在这里是**语义的一部分**（见第 1 条），
 * 而比较函数里 `Number(a) - Number(b)` 这类差值一旦算出 `NaN`，
 * 顺序就会变成"看引擎实现"。这里用两趟收集（先可用的、后不可用的）显式写出稳定性，
 * 换引擎、换调用点都不会变。
 */

/** 判据：这一项算不算「暂未开放」（各处字段名不同，因此由调用方给）。 */
export type AvailabilityTest<T> = (item: T) => boolean;

/**
 * 稳定地把**不可用**的项排到最后。
 *
 * 入参用 `readonly`（不就地改调用方的数组）：就地 `sort` 会改到传进来的那一份，
 * 而调用方常常直接拿着数据层的数组往下走，改它就会把"显示顺序"漏进数据。
 */
export function stableByAvailability<T>(items: readonly T[], isAvailable: AvailabilityTest<T>): T[] {
  const available: T[] = [];
  const unavailable: T[] = [];
  for (const item of items) (isAvailable(item) ? available : unavailable).push(item);
  return [...available, ...unavailable];
}

/**
 * `stableByAvailability` 的**反向写法**：判据是"这项是不是暂未开放"。
 *
 * 两种写法都留着，是因为各处手上的字段不一样：报价 / 选修课 / 科目候选上是
 * `available`（正向），网站卡片上是 `unavailable`、课程行上是 `status === "开放"`
 * （反向）。让调用方照着现有字段写，比在每一处先取反可读得多。
 */
export function unavailableLast<T>(items: readonly T[], isUnavailable: AvailabilityTest<T>): T[] {
  return stableByAvailability(items, (item) => !isUnavailable(item));
}

/**
 * 一组「带 `items` 的分组」各自把暂未开放的排到**本组最后**（组与组之间的顺序不变）。
 *
 * 用在选修课列表、后台台账的分组清单这类"分组里还有一层列表"的地方：
 * 分组本身（栏目 / 学段 / 学科）的顺序来自机构排的分区表，不该动。
 */
export function unavailableLastInGroups<G, T>(
  groups: readonly G[],
  itemsOf: (group: G) => readonly T[],
  withItems: (group: G, items: T[]) => G,
  isUnavailable: AvailabilityTest<T>,
): G[] {
  return groups.map((group) => withItems(group, unavailableLast(itemsOf(group), isUnavailable)));
}
