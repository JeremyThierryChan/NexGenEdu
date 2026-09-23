/**
 * id 生成：**全项目只有这一处实现**。
 *
 * 为什么单独成文件而不是留在 `api.ts` 里：id 的生成方不止一个了 ——
 * 服务层的通用集合（`collection` / `versionedCollection`）、课程分区的补建
 * （`course-partitions.ts` 的 `ensurePartitions`，它在"空库起步"与"种子数据"里也要用，
 * 那两处走的是 `initial.ts` / `seed.ts`，都不经过 `api.ts` 的对象）。
 * 各写一份 `Date.now() + random` 迟早会出现两种格式，而 id 是要写进备份、
 * 写进日志 `targetId`、还要在恢复时对得上的东西。
 *
 * 格式：`<前缀>_<时间戳36进制><随机4位>`。刻意不用自增数字：将来换成真实服务端时，
 * 自增要依赖数据库序列，而这个格式在哪儿都生成得出来（浏览器、脚本、服务）。
 */
export function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
