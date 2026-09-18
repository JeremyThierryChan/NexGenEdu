/**
 * 伪后端的持久化层：一个最小的键值存储抽象。
 *
 * 为什么要有这层抽象，而不是直接写 localStorage：
 *   1. **服务端渲染安全**：静态导出时这些模块也会在 Node 里被加载，
 *      直接访问 localStorage 会抛错；这里在拿不到浏览器存储时退化为内存存储。
 *   2. **可测试**：自检脚本在 Node 里用一个内存实现跑完整套增删改查，
 *      不需要浏览器环境。
 *   3. **将来换真后端**：这一层连同 api.ts 一起被替换成 fetch，页面不受影响。
 */
export type KeyValueStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
};

/** localStorage 的封装；不可用时（Node / 隐私模式）自动退化为内存存储。 */
export function createKeyValueStore(
  backing?: KeyValueStore,
): KeyValueStore {
  if (backing !== undefined) return backing;

  try {
    if (typeof window !== "undefined" && window.localStorage !== undefined) {
      const local = window.localStorage;
      // 隐私模式下 setItem 可能直接抛错，这里先探一次
      const probe = "__nexgenedu_probe__";
      local.setItem(probe, "1");
      local.removeItem(probe);
      return {
        read: (key) => local.getItem(key),
        write: (key, value) => local.setItem(key, value),
        remove: (key) => local.removeItem(key),
      };
    }
  } catch {
    // 落到下面的内存实现
  }

  const memory = new Map<string, string>();
  return {
    read: (key) => memory.get(key) ?? null,
    write: (key, value) => {
      memory.set(key, value);
    },
    remove: (key) => {
      memory.delete(key);
    },
  };
}

/** 内存存储：自检与测试用。 */
export function createMemoryStore(): KeyValueStore {
  const memory = new Map<string, string>();
  return {
    read: (key) => memory.get(key) ?? null,
    write: (key, value) => {
      memory.set(key, value);
    },
    remove: (key) => {
      memory.delete(key);
    },
  };
}
