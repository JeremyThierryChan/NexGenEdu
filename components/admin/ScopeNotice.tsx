"use client";

import { useAuth } from "@/components/admin/AuthContext";

/**
 * **范围提示横条**（Phase B）：只在服务端说"这个账号的行级范围不正常"时出现。
 *
 * ## 它解决的是什么
 *
 * 普通教师账号没填（或填错）`teacherId` 时，服务端**刻意**不拒绝登录 ——
 * 那是一个数据配置问题，把人挡在门外只会让他在机构现场彻底用不了系统。
 * 代价是：他进来后看到的是一个**空后台**（学生 0 人、课表空、今日概览全 0），
 * 而"账号少填了一个字段"这件事界面上没有任何地方说得出来 —— 那种"页面能打开、
 * 但什么都查不到"的状态最难排查（会先怀疑后端坏了、数据丢了）。
 *
 * 所以服务端在登录响应与会话里都回一句话（`scopeWarning`），这里把它显示在
 * 后台最上方，内容包含**原因**与**怎么修**（填哪个字段、改哪个文件、重启后端）。
 *
 * 正常账号（技术管理员 / 财务 / 招生 / 教师账号填对了）永远看不到这条 ——
 * 它不是一个"每次登录都弹的说明"，而是出错时才出现的提示。
 */
export function ScopeNotice() {
  const auth = useAuth();
  if (auth === null || auth.scopeWarning === "") return null;

  return (
    <div
      role="alert"
      className="border-b border-warning-100 bg-warning-50 px-4 py-2.5 text-sm leading-relaxed text-warning-600 sm:px-6"
    >
      <strong className="font-medium">你的账号还没有绑定教师档案，因此现在什么都看不到。</strong>
      <span className="ml-1">{auth.scopeWarning}</span>
    </div>
  );
}
