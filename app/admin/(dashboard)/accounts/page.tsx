"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel, SelectInput, TextField } from "@/components/admin/AdminFields";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { api, type Teacher } from "@/lib/backend/api";
import { ROLES, scopeForAccount, type Role } from "@/lib/auth/roles";
import { formatDayLabel } from "@/lib/backend/format";
import {
  createAccountRow,
  loadAccountTable,
  removeAccountRow,
  updateAccountRow,
  type AccountRow,
  type AccountTable,
} from "@/lib/auth/accounts";

/**
 * 账号管理（只有技术管理员能进）。
 *
 * ## 这一页解决的是什么
 *
 * 在它之前，加人 / 改角色 / 重置口令都要**手工编辑 `server/data/accounts.json`**
 * 再重启后端（见使用手册「账号怎么建、口令忘了去哪看」）。那件事有三个真实问题：
 *   1. 文件里有**明文口令与盐**，手工编辑容易写坏（少个逗号 → 下次启动谁也登不进来）；
 *   2. 改完必须重启后端 —— 而"忘了重启"的症状是"我明明加了账号，怎么登不上"；
 *   3. `teacherId` 要填**教师档案的 id**（`t_xxxxxx`），手抄必然会抄错，
 *      而抄错的后果是那位老师看到一片空白的后台。
 *
 * 现在：加人、选角色、从下拉里选教师、重置口令、停用、删除都在这里做，
 * **改完立刻生效**（服务端写完账号表会清掉内存缓存，下一次登录就重新读文件）。
 * 手工改文件**仍然可以**（是备用做法），只是那种改法要重启后端。
 *
 * ## 口令的纪律
 *
 * 口令只在**提交的那一刻**经过这里（发给服务端算 scrypt），服务端回给界面的任何东西里
 * 都**没有口令**（列表里也没有）—— 所以这一页上不会、也不该出现"看一眼他的口令"这种功能。
 * 谁忘了口令，就在这一页**重置**一个新的，当面告诉他。
 *
 * ## 权限说明
 *
 * 这一页的服务端接口是**技术管理员专属**（`server/index.mts` 的 `/api/accounts` 那一节，
 * 角色判定在 `accountsRouteDenial`）：其它角色调它一律 403。前端这边"导航里不显示入口"只是体验，
 * 而且直接敲网址进来时 `RoleGuard` 会拦在前面 —— 但这一页**自己也要能容忍 403**
 * （URL 是可以手写、可以转发的），那种情况下显示服务端那句"需要什么角色"，而不是白屏。
 */
export default function AdminAccountsPage() {
  const [table, setTable] = useState<AccountTable | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  /** 教师档案读不出来时的原因（只影响"绑定教师"下拉，不影响这一页别的功能）。 */
  const [teacherError, setTeacherError] = useState("");
  const [loading, setLoading] = useState(true);
  /** 读不出来时的原因（403 就是从这里显示出来的：**不白屏**）。 */
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** 正在改哪一条（改角色与教师）、正在重置哪一条的口令、新建表单是否展开。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /**
   * 点「重试」之后的在办标记。
   *
   * 为什么单独一个状态：重试走的是**安静刷新**（安静刷新不置 `loading` —— 理由见 load 的说明），
   * 而"正在读取账号表…"那句话是按 `loading` 写的。没有它，点重试就一点反馈都没有；
   * 有了它，标题照旧会说"正在读取"，同时**按钮不会消失**（`loading` 为真时整块按钮会被藏掉，
   * 那本身就是一次页高变化 —— 正是这次要消掉的东西）。
   */
  const [retrying, setRetrying] = useState(false);

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有账号表时**不进加载态** —— 这一页的加载态与
   * "读不出来"那一屏共用（`if (table === null)` 才换整页），刷新时把高度塌掉就可能让浏览器
   * 把滚动位置夹回顶部（§15.3）。首屏那一次仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    try {
      const accounts = await loadAccountTable();
      if (!accounts.ok) {
        /*
         * 账号表读不出来：**整页换成一句人话**（最常见的就是 403 —— 非技术管理员直接敲网址进来）。
         * 这里绝不能让异常冒出去，否则这一页在界面上就是一片空白（本项目最讨厌的那种失败）。
         */
        setLoadError(accounts.error);
        setTable(null);
        return;
      }
      setLoadError("");
      setTable(accounts.table);
    } catch (cause) {
      setLoadError(`读取账号表时出错：${cause instanceof Error ? cause.message : String(cause)}`);
      setTable(null);
    } finally {
      setLoading(false);
    }

    /*
     * 教师档案**单独读**，而且失败了也不把整页判死：它只影响"绑定教师"那个下拉
     * （账号列表、角色、口令都照常能改）。失败时把原因显示出来，而不是让下拉悄悄变空 ——
     * "下拉里怎么一个人都没有"必须有个解释。
     */
    try {
      setTeachers(await api.teachers.list());
      setTeacherError("");
    } catch (cause) {
      setTeachers([]);
      setTeacherError(
        `教师档案读不出来（${cause instanceof Error ? cause.message : String(cause)}）：` +
          "「绑定教师」下拉暂时是空的，其它功能不受影响。",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 所有写操作共用的收尾：把服务端的话显示出来、刷新列表、收起那几个小面板。 */
  async function run<T extends { ok: true } | { ok: false; error: string }>(
    action: () => Promise<T>,
    done: (result: T & { ok: true }) => { note: string; warnings?: string[] },
  ): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    setWarnings([]);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const info = done(result as T & { ok: true });
      setMessage(info.note);
      setWarnings(info.warnings ?? []);
      setEditing(null);
      setResetting(null);
      setCreating(false);
      // 安静刷新：写成功之后只重读数据，不把整页换成加载态（见 load 的说明）
      await load({ quiet: true });
    } catch (cause) {
      setError(`操作失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 读不出来时**不能白屏**：把服务端（或网络）那句原话显示出来。
   * 最常见的一种就是 403 —— 普通教师直接敲网址进来时会走到这里。
   */
  if (table === null) {
    return (
      <>
        <PageHeading
          title="账号"
          description="谁能登录后台、各是什么角色（只有技术管理员能改）。"
        />
        <Panel
          className="mt-6"
          title={loading || retrying ? "正在读取账号表…" : "这一页打不开"}
          description="账号管理是技术管理员专属：服务端会对其它角色返回 403，改成直接敲网址也一样进不来。"
        >
          <div className="space-y-3 px-4 py-4">
            {!loading && (
              <>
                <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                  {loadError === "" ? "账号表读不出来（原因未知）。" : loadError}
                </p>
                <p className="text-xs leading-relaxed text-ink-500">
                  如果你的角色里有
                  <strong className="font-medium text-ink-700">技术管理员</strong>
                  ，多半是登录过期或后端没在跑：登录状态可以在顶栏看到。
                  否则请回今日概览 —— 谁的账号、什么角色，见使用手册的「谁能做什么」。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || retrying}
                    onClick={() => {
                      // 安静刷新（不置 loading）：按钮因此不会在重试时消失，标题用 retrying 说话
                      setRetrying(true);
                      void load({ quiet: true }).finally(() => setRetrying(false));
                    }}
                  >
                    {retrying ? "重试中…" : "重试"}
                  </Button>
                  <Link
                    href="/admin"
                    className="rounded-md border border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
                  >
                    回今日概览
                  </Link>
                </div>
              </>
            )}
          </div>
        </Panel>
      </>
    );
  }

  const readOnly = table.readOnly;
  /** 停用的账号数（给标题上一句统计）。 */
  const disabledCount = table.accounts.filter((row) => row.disabled).length;

  return (
    <>
      <PageHeading
        title="账号"
        description="谁能登录后台、各是什么角色。加人、改角色、绑定教师、重置口令、停用都在这里做，改完立刻生效。"
      />

      {/* 权限那一句（任务要求写在页面上） */}
      <p className="mt-4 rounded-md border border-ink-200 bg-white px-3.5 py-2.5 text-xs leading-relaxed text-ink-500">
        <strong className="font-medium text-ink-700">谁的账号、什么角色</strong>
        ，见使用手册的「谁能做什么」一节；这一页本身
        <strong className="font-medium text-ink-700">只有技术管理员能进</strong>
        （服务端会拒其它角色）。
        「普通教师」账号必须绑定教师档案，否则他登录后什么都看不到。
      </p>

      {/* 只读钩子：来自环境变量的账号表不能改（改也不会生效），必须说清 */}
      {readOnly && (
        <p className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm leading-relaxed text-warning-600">
          {table.readOnlyReason === ""
            ? "本次账号表是只读的（环境变量提供的测试账号表），不能在这里改。"
            : table.readOnlyReason}
        </p>
      )}

      {message !== "" && (
        <p className="mt-4 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-600">
          {message}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm leading-relaxed text-warning-600">
          {warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {error !== "" && (
        <p role="alert" className="mt-4 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm leading-relaxed text-danger-600">
          {error}
        </p>
      )}

      {teacherError !== "" && (
        <p className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-600">
          {teacherError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-xs text-ink-500">
          {loading
            ? "加载中…"
            : `${table.accounts.length} 个账号${disabledCount > 0 ? `（其中 ${disabledCount} 个已停用）` : ""}`}
        </span>
        <div className="ml-auto">
          <Button size="sm" disabled={busy || readOnly} onClick={() => setCreating((value) => !value)}>
            {creating ? "收起表单" : "新建账号"}
          </Button>
        </div>
      </div>

      {creating && (
        <Panel className="mt-4" title="新建账号" description="口令请当面告诉他：系统不会发送口令，也不回显。">
          <AccountForm
            teachers={teachers}
            busy={busy}
            submitLabel="创建账号"
            onCancel={() => setCreating(false)}
            onSubmit={(draft) =>
              void run(
                () => createAccountRow(draft),
                (result) => ({
                  note: `已创建账号「${result.account.username}」（角色：${result.account.roles.join("、")}）。他现在就能登录，不需要重启后端。`,
                  warnings: result.warnings,
                }),
              )
            }
          />
        </Panel>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">账号</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">绑定教师</th>
              <th className="px-4 py-2.5 font-medium">备注</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {table.accounts.map((row) => {
              const note = scopeNote(row, teachers);
              return (
                <tr key={row.username} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink-900">{row.username}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-400">
                      {row.createdAt === "" ? "" : `建于 ${formatDayLabel(row.createdAt)}`}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">
                    {row.roles.length === 0 ? "（没有角色，什么都做不了）" : row.roles.join("、")}
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">
                    {row.teacherId === ""
                      ? "（不绑）"
                      : `${teacherName(teachers, row.teacherId)}${teacherName(teachers, row.teacherId) === "" ? "" : " · "}${row.teacherId}`}
                    {/* 空范围警告：与登录时顶部那句、服务端 scopeWarning 同一套口径 */}
                    {note !== "" && (
                      <span className="mt-1 block rounded-sm bg-warning-50 px-1.5 py-0.5 text-[11px] leading-relaxed text-warning-600">
                        {note}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-xs leading-relaxed text-ink-500">
                    {row.note === "" ? "—" : row.note}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        row.disabled
                          ? "rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500"
                          : "rounded-sm border border-success-100 bg-success-50 px-1.5 py-0.5 text-[11px] text-success-600"
                      }
                    >
                      {row.disabled ? "已停用" : "可登录"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                      <button
                        type="button"
                        disabled={busy || readOnly}
                        onClick={() => {
                          setResetting(null);
                          setEditing(editing === row.username ? null : row.username);
                        }}
                        className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-50"
                      >
                        {editing === row.username ? "收起" : "改角色与教师"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || readOnly}
                        onClick={() => {
                          setEditing(null);
                          setResetting(resetting === row.username ? null : row.username);
                        }}
                        className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-50"
                      >
                        重置口令
                      </button>
                      <button
                        type="button"
                        disabled={busy || readOnly}
                        onClick={() => void toggleDisabled(row)}
                        className="text-xs text-ink-600 transition-colors hover:text-brand-700 disabled:opacity-50"
                      >
                        {row.disabled ? "启用" : "停用"}
                      </button>
                      {(() => {
                        // 注定失败的动作不该让人走完两次确认：先算清"是不是最后一位管理员"
                        const lastAdmin =
                          row.roles.includes("技术管理员") && !row.disabled && activeAdmins <= 1;
                        return (
                          <button
                            type="button"
                            disabled={busy || readOnly || lastAdmin}
                            title={
                              lastAdmin
                                ? "这是最后一位还能登录的技术管理员，删掉就没人能进后台了 —— 先给接任的人加上这个角色"
                                : ""
                            }
                            onClick={() => void remove(row)}
                            className="text-xs text-ink-500 transition-colors hover:text-danger-600 disabled:opacity-50"
                          >
                            {lastAdmin ? "删除（最后一位管理员，先加接任的人）" : "删除"}
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && table.accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                  账号表里一个账号都没有 —— 这时候谁也登录不了，请先建一个技术管理员。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Panel
          className="mt-4"
          title={`改账号：${editing}`}
          description="角色可以多选（一个账号能兼多个角色）；绑定教师只有「普通教师」才需要。"
        >
          <AccountForm
            teachers={teachers}
            busy={busy}
            submitLabel="保存改动"
            initial={table.accounts.find((row) => row.username === editing)}
            onCancel={() => setEditing(null)}
            onSubmit={(draft) =>
              void run(
                () =>
                  updateAccountRow(editing, {
                    roles: draft.roles,
                    teacherId: draft.teacherId,
                    note: draft.note,
                  }),
                (result) => ({
                  note: `已保存「${result.account.username}」的角色与绑定：${result.account.roles.join("、")}。他重新登录后生效。`,
                  warnings: result.warnings,
                }),
              )
            }
          />
        </Panel>
      )}

      {resetting !== null && (
        <Panel
          className="mt-4"
          title={`重置口令：${resetting}`}
          description="旧口令立刻失效（他再登录就要用新的）。口令请当面告诉他，系统不回显、不发送。"
        >
          <ResetPasswordForm
            busy={busy}
            onCancel={() => setResetting(null)}
            onSubmit={(password) =>
              void run(
                () => updateAccountRow(resetting, { password }),
                (result) => ({ note: `已重置「${result.account.username}」的口令。请现在告诉他新口令。` }),
              )
            }
          />
        </Panel>
      )}

      {/* 账号表在哪：手工改文件是备用做法（那种改法要重启后端），也要说清它 0600 与含明文 */}
      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        账号表文件：<span className="font-mono text-ink-500">{table.file}</span>
        （权限 0600，里面有明文口令 —— 这份文件与数据库同目录，不进 git）。
        <strong className="font-medium text-ink-500">备用做法</strong>
        ：直接编辑它也能加人改角色，但那种改法要重启后端才生效；
        这一页上的改动则立刻生效。
        <br />
        当前后端如果是用 <span className="font-mono">NEXGENEDU_ADMIN_PASSWORD</span> 启动的，
        它会把那一条账号的口令同步回环境变量里的那个值：那种启动方式下，
        那条账号的口令在这里改不了（会被同步回去）、也删不掉（会被自动建回来）——
        要动它，就改用不带那个环境变量的方式启动后端。
      </p>
    </>
  );

  /** 停用 / 启用（危险操作走二次确认：停用会让对方立刻登不进来）。 */
  async function toggleDisabled(row: AccountRow) {
    const next = !row.disabled;
    const confirmed = window.confirm(
      next
        ? `停用账号「${row.username}」？他立刻不能再登录（已经登录的会话要到退出或过期才失效）。\n如果只是换人，停用比删除好 —— 日志里"某人改了什么"还对得上人。`
        : `启用账号「${row.username}」？他就能用原口令登录了。`,
    );
    if (!confirmed) return;
    await run(
      () => updateAccountRow(row.username, { disabled: next }),
      (result) => ({ note: `已${result.account.disabled ? "停用" : "启用"}账号「${result.account.username}」。` }),
    );
  }

  /** 删除（最危险的一个：删掉之后他再也登不进来，所以问两次）。 */
  /**
   * 还能登录的技术管理员有几位。
   *
   * 服务端本来就会拦住"删掉最后一位"（`server/accounts.mts` 的 `lockoutReason`），
   * 但界面上**连问两次确认之后才被拒** —— 审计说那是"白走两步"。
   * 这里先算出来，把按钮禁掉并写明原因：注定失败的动作不该让人走完确认流程。
   */
  const activeAdmins = (table?.accounts ?? []).filter(
    (row) => !row.disabled && row.roles.includes("技术管理员"),
  ).length;


  async function remove(row: AccountRow) {
    if (
      !window.confirm(
        `删除账号「${row.username}」？删掉之后他再也登不进来。\n如果只是不带课了、或者离职了，建议用「停用」—— 删除会让操作日志里的名字对不上人。`,
      )
    ) {
      return;
    }
    if (!window.confirm(`再确认一次：确定要永久删除账号「${row.username}」吗？`)) return;
    await run(
      () => removeAccountRow(row.username),
      () => ({ note: `已删除账号「${row.username}」。` }),
    );
  }
}

/* ── 小工具 ───────────────────────────────────────────────────────────── */

/** 把 id 换成教师姓名（找不到就空串，界面上会只显示 id）。 */
function teacherName(teachers: Teacher[], id: string): string {
  return teachers.find((teacher) => teacher.id === id)?.name ?? "";
}

/**
 * 这条账号的**范围提示**（空串 = 没问题）：与登录响应、`/api/session`、服务端那句
 * `scopeWarning` **同一套判定**（`scopeForAccount`）。
 *
 * 为什么在列表里也要显示：机构最常见的错是"给老师开了账号，忘了绑教师档案"，
 * 而那位老师登录后看到的是**一片空白**。技术管理员在这一页上就该一眼看出"谁会看不到数据"。
 *
 * 角色名先按 `ROLES` 过滤再用（与服务端读账号表时的规范化一致：认不出来的角色名被丢掉，
 * 于是"普通教师 + 一个拼错的角色名"算**纯教师**，会被范围限制 —— 两边必须同一个结论）。
 */
function scopeNote(row: AccountRow, teachers: Teacher[]): string {
  const roles = row.roles.filter((item): item is Role => ROLES.includes(item as Role));
  const scope = scopeForAccount(roles, row.teacherId);
  if (scope.warning !== "") return scope.warning;
  if (scope.kind === "own" && scope.teacherId !== "" && !teachers.some((t) => t.id === scope.teacherId)) {
    return `绑定的教师档案找不到（teacherId = ${scope.teacherId}）：他会看到空的后台，请在下拉里重新选一位。`;
  }
  return "";
}

/** 表单提交的内容（新建与"改角色与教师"共用）。 */
type AccountDraft = { username: string; password: string; roles: string[]; teacherId: string; note: string };

/**
 * 账号表单：新建时给用户名与初始口令，改的时候只给角色 / 教师 / 备注。
 *
 * 为什么密码框不用 `type="password"` 存草稿、也不做"再看一眼"：这一页的口令是**一次性**的
 * （提交之后服务端只存 salt + hash，界面拿不回来）。所以做法是"填 → 提交 → 当面告诉本人"，
 * 而不是让人在这里反复查看一个口令。
 */
function AccountForm({
  teachers,
  busy,
  submitLabel,
  initial,
  onCancel,
  onSubmit,
}: {
  teachers: Teacher[];
  busy: boolean;
  submitLabel: string;
  initial?: AccountRow;
  onCancel: () => void;
  onSubmit: (draft: AccountDraft) => void;
}) {
  const editing = initial !== undefined;
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? []);
  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  /*
   * 教师下拉只列出**在职**教师（离职教师保留档案但不再排课，不该再绑新账号）；
   * 但如果这条账号绑的正是某位已离职教师，要把那一项补进来 —— 否则表单会显示成"不绑"，
   * 一保存就把绑定关系弄丢了（数据被静默改掉，是这一页最不能出的错）。
   */
  const options = teacherOptions(teachers, teacherId);

  /** 纯普通教师 + 没绑教师 → 提前说清后果（服务端也会回一句同样的 warning）。 */
  const plainTeacherWithoutTeacher =
    roles.length > 0 && roles.every((role) => role === "普通教师") && teacherId === "";

  return (
    <div className="space-y-4 px-4 py-4">
      {!editing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="账号名（登录名）"
            value={username}
            maxLength={40}
            placeholder="例如 王老师"
            hint="不能重名；它是日志里「谁改的」那个名字，用真名比用 abc 好。"
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label="初始口令"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="至少 8 位"
            hint="至少 8 位。提交之后系统只保留哈希与明文一份找回用，界面不再回显。"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      )}

      {editing && (
        <p className="text-xs leading-relaxed text-ink-500">
          账号名不在这里改（它是登录名，也是日志里的名字）：要改名就新建一条、把旧的停用。
        </p>
      )}

      <MultiSelect
        label="角色"
        hint="可多选：一个账号能兼多个角色（例如校长既是财务管理员又是技术管理员）"
        options={ROLES.map((role) => ({ value: role }))}
        value={roles}
        onChange={setRoles}
        placeholder="点击选择角色…"
      />

      <SelectInput
        label="绑定教师（只有「普通教师」需要）"
        options={options}
        value={teacherId}
        onChange={(event) => setTeacherId(event.target.value)}
        hint="要选教师档案里的那一行（不是填姓名）。不绑的普通教师登录后看不到任何学生与排课。"
      />

      <TextField
        label="备注"
        value={note}
        placeholder="这个人是谁、什么时候开的（给人看）"
        hint="例如：2026-09 入职，带初中数学。"
        onChange={(event) => setNote(event.target.value)}
      />

      {plainTeacherWithoutTeacher && (
        <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-600">
          这个账号是<strong className="font-medium">普通教师</strong>
          但没绑教师档案：他登录后看不到任何学生与排课（登录时顶部会显示同一句提示）。
          先去「教师」页确认那位老师有档案，再回来绑定。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onSubmit({ username: username.trim(), password, roles, teacherId, note })}
        >
          {busy ? "提交中…" : submitLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

/** 教师下拉的选项：在职教师 + （如果当前绑的是一位不在职教师）把那一项补回来。 */
function teacherOptions(teachers: Teacher[], current: string): Array<{ value: string; label: string }> {
  const active = teachers.filter((teacher) => teacher.active);
  const options = active.map((teacher) => ({
    value: teacher.id,
    label: `${teacher.name}（${teacher.id}）`,
  }));
  if (current !== "" && !options.some((option) => option.value === current)) {
    const bound = teachers.find((teacher) => teacher.id === current);
    options.unshift({
      value: current,
      label:
        bound === undefined
          ? `${current}（教师档案里找不到这个 id）`
          : `${bound.name}（${current}，已离职）`,
    });
  }
  return [{ value: "", label: "（不绑定）" }, ...options];
}

/** 重置口令的小表单：一个口令框 + 确认（旧口令立刻失效，所以提交前再问一次）。 */
function ResetPasswordForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <div className="space-y-4 px-4 py-4">
      <TextField
        label="新口令"
        type="password"
        value={password}
        autoComplete="new-password"
        placeholder="至少 8 位"
        hint="至少 8 位。旧口令会立刻失效；请现在把这个新口令当面告诉他。"
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || password === ""}
          onClick={() => {
            if (!window.confirm("重置口令？他现在用的那个口令会立刻失效（改完请把新口令告诉他）。")) return;
            onSubmit(password);
          }}
        >
          {busy ? "提交中…" : "重置口令"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
