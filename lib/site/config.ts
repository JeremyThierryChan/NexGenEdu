/**
 * 站点级别的占位配置。
 *
 * 这里的内容最终都会迁移到 data/site/*.md（Phase 2）。
 * 集中放在一个文件里，是为了让 Phase 2 只需要替换这一个模块，
 * 而不必到各个组件里删除硬编码文本。
 */
export const SITE = {
  name: "NexGenEdu",
  nameZh: "新径教育",
  tagline: "小班教学 · 个性化辅导 · 持续反馈",
  contact: {
    phone: "021-6000 0000",
    wechat: "nexgenedu",
    email: "hello@nexgenedu.example",
    address: "上海市徐汇区示例路 88 号 3 楼",
    businessHours: "周一至周五 13:00–21:00 · 周六周日 09:00–20:00",
  },
} as const;
