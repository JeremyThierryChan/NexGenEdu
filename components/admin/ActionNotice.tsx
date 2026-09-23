"use client";

import type { ActionNotice } from "@/components/admin/useActionNotice";

/**
 * 把 `useActionNotice` 的两条提示画出来（失败红、成功绿）。
 *
 * ## 为什么单独一个组件
 *
 * 审计发现"点了没反应"在七八个页面/面板里都存在，而它们各自都**没有**任何显示失败的地方。
 * 与其在每个文件里各写一遍（样式必然漂移、也一定会有人漏掉 `role="alert"`），
 * 不如一处定了：**只要用了 `useActionNotice`，就把这个组件放在表单/按钮附近**。
 *
 * ## 一条纪律：`role` 不能省
 *
 * 失败用 `role="alert"`（读屏会立刻念出来），成功用 `role="status"`（等它念完当前内容）。
 * 这不是锦上添花：这一批改动解决的正是"用户根本不知道发生了什么"，
 * 而当时没在看屏幕的那位同事同样需要知道。
 *
 * 高度会变（从无到一条）—— 因此它**放在动作按钮旁边、表单内部**，
 * 而不是页面最顶上那块固定版式里：那样它出现/消失只会影响按钮下方的内容，
 * 不会把上方的固定内容抽走（§15.3 那条纪律，自检第 13/14 节守着）。
 */
export function ActionNoticeView({
  notice,
  className = "",
}: {
  notice: Pick<ActionNotice, "error" | "message">;
  className?: string;
}) {
  if (notice.error === "" && notice.message === "") return null;
  return notice.error !== "" ? (
    <p
      role="alert"
      className={`rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm leading-relaxed text-danger-600 ${className}`}
    >
      {notice.error}
    </p>
  ) : (
    <p
      role="status"
      className={`rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-800 ${className}`}
    >
      {notice.message}
    </p>
  );
}
