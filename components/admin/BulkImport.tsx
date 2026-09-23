"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { api } from "@/lib/backend/api";
import { runTwoPhaseImport } from "@/lib/backend/import-flow";
import { useAuth, rolesOrAll } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { downloadTextFile, stampForFilename } from "@/lib/backend/backup";
import {
  csvTemplate,
  detectFormat,
  ENTITY_SPECS,
  IMPORT_ENTITIES,
  jsonTemplate,
  parseImport,
  type Conflict,
  type ConflictStrategy,
  type ImportEntity,
  type ImportFormat,
} from "@/lib/backend/import";

/**
 * **批量导入**面板：把 CSV / JSON 里的成批记录一次导进来（学生 / 教师 / 教室 / 课程）。
 *
 * ## 这个面板的每一步都是为了"别把数据导坏"
 *
 * 1. **模板可下载**：表头由 `lib/backend/import.ts` 的字段规格生成，与本面板的解析
 *    用的是同一份定义 —— 不会出现"模板里的列名解析器不认识"这种事。
 * 2. **先预览、再导入**：预览会说明"解析到几条、哪些行不通过（带行号）、哪些列没认出来"。
 *    批量写入是不可逆的，因此这一步是默认路径，而不是可选项。
 * 3. **只新增、不覆盖**：同名记录跳过并逐条报告；想改已有数据请到对应页面改。
 * 4. **导入前自动留一份**：服务端的 `imports.apply` 在写之前先存一份快照，
 *    出差错可以到本页的「恢复导入前的数据」回来。
 * 5. **报课与收款不在这里导入**：那些牵动账本（实收、已用课时），必须走页面流程。
 *    面板上明写这一点，免得有人导完名单以为账也进去了。
 */

/**
 * **权限外壳**：批量导入只有技术管理员能做（`imports.apply` / `imports.fromSite` 属于
 * "运维与审计"分组）。这个面板挂在五个页面上，因此把判定放在**这里一次**，
 * 而不是让每个页面各写一遍（审计实测：财务与招生点「批量导入」必然 403 并逐行报错）。
 *
 * 写成外壳而不是在组件内部早退：早退会让下面的 Hook 顺序随角色变化，
 * React 的规则不允许（`react-hooks/rules-of-hooks` 当场报错）。
 */
export function BulkImport(props: {
  onImported?: () => void;
  fixedEntity?: ImportEntity;
}) {
  const roles = rolesOrAll(useAuth());
  if (!canCallMethod(roles, "imports.apply")) {
    return (
      <Panel className="mt-4" title="批量导入" description="把 CSV / JSON 里的成批记录一次导进来。">
        <p className="px-4 py-3 text-sm leading-relaxed text-ink-600">
          你的角色（{roles.join(" · ")}）不能批量导入 —— 这件事归 {methodOwnerText("imports.apply")}。
          需要的话请让技术管理员来导，或者用页面上的「新增」一条一条录（那些动作你的角色有）。
        </p>
      </Panel>
    );
  }
  return <BulkImportPanel {...props} />;
}

function BulkImportPanel({
  onImported,
  fixedEntity,
}: {
  onImported?: () => void;
  /**
   * 锁定导入对象（在"学生/教师/教室/课程"各自的页面上用）。
   *
   * 这些页面已经知道你要导什么，因此不必再让人选一次 —— 面板更短、出错更少。
   * 不传则在面板里显示对象切换（「数据与备份」页那种"批量数据操作"的用法）。
   */
  fixedEntity?: ImportEntity;
}) {
  const [entity, setEntity] = useState<ImportEntity>(fixedEntity ?? "students");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<ImportFormat | "auto">("auto");
  const [busy, setBusy] = useState(false);
  /*
   * 冲突处理（对应「复制文件遇到同名」那三个选择）：
   *   - `conflicts`：服务端体检回来的冲突行（含库里那条长什么样）；
   *   - `choices`：逐行选择，键是行号；`globalChoice` 是"一键应用"的默认值。
   * 体检（onConflict: "ask"）阶段**什么都没写**，所以人可以放心比较、改主意。
   */
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  /** 待处理的冲突来自哪条路（文件 / 网站）—— 点「按以上选择导入」时要用对接口。 */
  const [pendingSource, setPendingSource] = useState<"file" | "site">("file");
  /** 站点导入的即时反馈：就显示在按钮旁边，不用滚到面板下面看。 */
  const [siteNotice, setSiteNotice] = useState("");
  const [globalChoice, setGlobalChoice] = useState<ConflictStrategy>("skip");
  const [choices, setChoices] = useState<Record<string, ConflictStrategy>>({});
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    added: number;
    skipped: { line: number; reason: string }[];
    problems: { line: number; reason: string }[];
    unknownHeaders: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = ENTITY_SPECS[entity];

  /** 预览：纯函数解析（与点"导入"时服务端跑的是同一份实现）。 */
  const preview = useMemo(() => {
    if (text.trim() === "") return null;
    const resolved = format === "auto" ? detectFormat(text) : format;
    return parseImport(entity, text, resolved);
  }, [text, format, entity]);

  const onPickFile = useCallback(async (file: File | undefined) => {
    if (file === undefined) return;
    setFileName(file.name);
    setText(await file.text());
    setResult(null);
    // 按扩展名先猜一次格式，用户仍可手动改
    setFormat(/\.json$/i.test(file.name) ? "json" : /\.csv$/i.test(file.name) ? "csv" : "auto");
  }, []);

  /** 把服务端返回的报告转成面板上的结果提示。 */
  const showReport = useCallback((outcome: {
    ok: boolean; error?: string; summary: string; added: number;
    overwritten: number; duplicated: number;
    skipped: { line: number; reason: string }[];
    problems: { line: number; reason: string }[];
    unknownHeaders: string[];
  }) => {
    setResult({
      ok: outcome.ok,
      message: outcome.ok ? outcome.summary : (outcome.error ?? "导入失败。"),
      added: outcome.added,
      skipped: outcome.skipped,
      problems: outcome.problems,
      unknownHeaders: outcome.unknownHeaders,
    });
  }, []);

  /**
   * 第一步：**体检**（onConflict: "ask"）。
   *
   * 有冲突就展示出来让人选（覆盖 / 跳过 / 保留两份），**此时一个字节都没写**；
   * 没冲突就直接按 skip 写入。
   */
  const onImport = useCallback(async () => {
    if (text.trim() === "") return;
    setBusy(true);
    setResult(null);
    setConflicts([]);
    setSiteNotice("");
    const call = (onConflict: "ask" | "skip") =>
      api.imports.apply({
        entity,
        text,
        format: format === "auto" ? undefined : format,
        fileName,
        onConflict,
      });
    try {
      const outcome = await runTwoPhaseImport({ ask: () => call("ask"), write: () => call("skip") });
      if (outcome.status === "needs-decision") {
        setPendingSource("file");
        setConflicts(outcome.conflicts);
        setChoices({});
        setGlobalChoice("skip");
        return;
      }
      showReport(outcome.report);
      if (outcome.report.ok) onImported?.();
    } catch (cause) {
      setResult({
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        added: 0, skipped: [], problems: [], unknownHeaders: [],
      });
    } finally {
      setBusy(false);
    }
  }, [text, entity, format, fileName, onImported, showReport]);

  /** 第二步：按人选的策略真正写入（逐行选择优先于全局）。 */
  const onConfirm = useCallback(async () => {
    setBusy(true);
    try {
      const perRow: Record<string, ConflictStrategy> = {};
      for (const conflict of conflicts) {
        perRow[String(conflict.line)] = choices[String(conflict.line)] ?? globalChoice;
      }
      const outcome = pendingSource === "site" && fixedEntity !== undefined
        ? await api.imports.fromSite({
            entity: fixedEntity as "teachers" | "classrooms",
            onConflict: globalChoice,
            perRow,
          })
        : await api.imports.apply({
            entity,
            text,
            format: format === "auto" ? undefined : format,
            fileName,
            onConflict: globalChoice,
            perRow,
          });
      setConflicts([]);
      showReport(outcome);
      setSiteNotice(pendingSource === "site" && outcome.ok ? outcome.summary : "");
      if (outcome.ok) onImported?.();
    } catch (cause) {
      setResult({
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        added: 0, skipped: [], problems: [], unknownHeaders: [],
      });
    } finally {
      setBusy(false);
    }
  }, [conflicts, choices, globalChoice, entity, text, format, fileName, onImported, showReport, pendingSource, fixedEntity]);

  /**
   * 从**网站内容**导入（教师资料 / 场地名）。
   *
   * 走与文件导入**同一套**两阶段流程：先体检 → 有冲突就让人选 → 没冲突就**接着写入**。
   *
   * 踩过的坑：这条路径最初只做了体检那一步，于是"点了没反应、库里也没数据"
   * （体检在没有冲突时会如实报告"都能导入"，但它并没有导入）。
   * 现在这段流程由 `runTwoPhaseImport` 统一负责，两条路不可能再各漏一步。
   */
  const onFromSite = useCallback(async () => {
    if (fixedEntity !== "teachers" && fixedEntity !== "classrooms") return;
    setBusy(true);
    setResult(null);
    setConflicts([]);
    setSiteNotice("正在检查网站内容…");
    const call = (onConflict: "ask" | "skip") =>
      api.imports.fromSite({ entity: fixedEntity, onConflict });
    try {
      const outcome = await runTwoPhaseImport({ ask: () => call("ask"), write: () => call("skip") });
      if (outcome.status === "needs-decision") {
        setPendingSource("site");
        setConflicts(outcome.conflicts);
        setChoices({});
        setGlobalChoice("skip");
        setSiteNotice(`有 ${outcome.conflicts.length} 条同名，请在下面选择怎么处理`);
        return;
      }
      showReport(outcome.report);
      // 即时反馈**就放在按钮旁边**：面板很长，把结果放到底部等于"没反应"
      setSiteNotice(
        outcome.report.ok
          ? outcome.report.summary
          : (outcome.report.error ?? "导入失败，请把下面的提示发给我们。"),
      );
      if (outcome.report.ok) onImported?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSiteNotice(`导入失败：${message}`);
    } finally {
      setBusy(false);
    }
  }, [fixedEntity, onImported, showReport]);


  const reset = useCallback(() => {
    setText("");
    setFileName("");
    setResult(null);
    setFormat("auto");
    if (fileRef.current !== null) fileRef.current.value = "";
  }, []);

  return (
    <Panel
      className="mt-6"
      title={`批量导入${spec.label}（CSV / JSON）`}
      description="把 Excel / 表格里的名单一次录进来。只新增，不覆盖已有记录。"
    >
      <div className="space-y-4 px-4 py-4">
        {/* ① 选对象（实体页上由页面锁定，不显示这一行） */}
        {fixedEntity === undefined && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-500">导入对象</span>
            {IMPORT_ENTITIES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setEntity(key);
                  setResult(null);
                }}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  key === entity
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"
                }`}
              >
                {ENTITY_SPECS[key].label}
              </button>
            ))}
          </div>
        )}

        <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-600">
          {spec.warning}
        </p>

        {/* ② 从网站（前端内容）导入：网站上有现成的教师名单与场地名 */}
        {(entity === "teachers" || entity === "classrooms") && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
            <span className="text-xs leading-relaxed text-ink-600">
              网站内容里已有这份名单（
              {entity === "teachers" ? "教师页的真实教师，AI 智能体不算" : "首页「教室照片格位」里的场地名"}
              ），可以一键拉进来：
            </span>
            <Button size="sm" variant="outline" onClick={() => void onFromSite()} disabled={busy}>
              {busy ? "处理中…" : "从网站导入"}
            </Button>
            {siteNotice !== "" && (
              <span className="text-xs leading-relaxed text-ink-700">{siteNotice}</span>
            )}
          </div>
        )}

        {/* ③ 模板 + 文件 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadTextFile(
                `nexgenedu-导入模板-${spec.label}-${stampForFilename()}.csv`,
                csvTemplate(entity),
                "text/csv",
              )
            }
          >
            下载 CSV 模板
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadTextFile(
                `nexgenedu-导入模板-${spec.label}-${stampForFilename()}.json`,
                jsonTemplate(entity),
                "application/json",
              )
            }
          >
            下载 JSON 模板
          </Button>
          <label className="inline-flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json"
              onChange={(event) => void onPickFile(event.target.files?.[0])}
              className="block w-full max-w-xs text-xs text-ink-600 file:mr-2 file:rounded-md file:border file:border-ink-300 file:bg-white file:px-2 file:py-1 file:text-xs"
            />
          </label>
          {fileName !== "" && <span className="font-mono text-xs text-ink-400">{fileName}</span>}
        </div>

        {/* ③ 文本域（也可以直接粘贴，或手动改） */}
        <label className="block">
          <span className="text-xs text-ink-500">
            内容（可直接粘贴；表格软件里复制整列/整表粘进来也行）
          </span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
            rows={8}
            spellCheck={false}
            placeholder={`${spec.fields.map((field) => field.header).join(",")}\n${spec.fields.map((field) => field.example).join(",")}`}
            className="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 font-mono text-xs text-ink-900 outline-none focus:border-brand-500"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            格式
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ImportFormat | "auto")}
              className="rounded-md border border-ink-300 bg-white px-2 py-1 text-xs"
            >
              <option value="auto">自动识别</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={reset} disabled={text === "" && result === null}>
            清空
          </Button>
        </div>

        {/* ④ 预览：先把"会发生什么"说清楚 */}
        {preview !== null && (
          <div className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
            <p className="font-medium text-ink-700">
              预览：识别到 {preview.headers.length} 列
              {preview.unknownHeaders.length > 0 && (
                <span className="font-normal text-warning-600">
                  （其中 {preview.unknownHeaders.length} 列不认识：{preview.unknownHeaders.join("、")} —— 会被忽略）
                </span>
              )}
            </p>
            {preview.missingRequiredHeaders.length > 0 ? (
              <p className="mt-1 text-danger-600">
                缺少必填列：<strong className="font-medium">{preview.missingRequiredHeaders.join("、")}</strong>
                （对照模板的表头改名即可；这份内容不会被导入）
              </p>
            ) : (
              <p className="mt-1">
                可导入 <strong className="font-medium text-ink-800">{preview.records.length}</strong> 条；
                {preview.problems.length === 0
                  ? "没有发现错误。"
                  : <span className="text-danger-600">{preview.problems.length} 行没通过校验（见下）。</span>}
              </p>
            )}
            {preview.problems.length > 0 && (
              <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto">
                {preview.problems.slice(0, 20).map((problem, index) => (
                  <li key={`${problem.line}-${index}`} className="text-danger-600">
                    第 {problem.line} 行：{problem.reason}
                  </li>
                ))}
                {preview.problems.length > 20 && (
                  <li className="text-ink-400">…另有 {preview.problems.length - 20} 行同类问题</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* ⑤ 导入 */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void onImport()}
            disabled={busy || text.trim() === "" || (preview?.missingRequiredHeaders.length ?? 0) > 0}
          >
            {busy ? "处理中…" : `检查并导入${spec.label}`}
          </Button>
          <span className="text-xs text-ink-400">
            先**体检**：有重名会列出来让你选（覆盖 / 跳过 / 保留两份），选之前不会写入。
            导入前会自动留一份快照。
          </span>
        </div>

        {/* ⑥ 冲突处理：先看清会动到哪些记录，再决定 */}
        {conflicts.length > 0 && (
          <div className="rounded-md border border-warning-100 bg-warning-50 px-3 py-3 text-xs leading-relaxed">
            <p className="font-medium text-ink-800">
              有 {conflicts.length} 条与现有记录同名
              <span className="ml-1 font-normal text-ink-500">
                （还没写入任何东西 —— 先选好怎么处理，再点下面的按钮）
              </span>
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-ink-600">全部这样处理：</span>
              {(
                [
                  ["skip", "跳过（保留库里那条）"],
                  ["overwrite", "覆盖（用文件里的值更新）"],
                  ["duplicate", "保留两份（第二条加序号）"],
                ] as Array<[ConflictStrategy, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGlobalChoice(value)}
                  className={`rounded-md border px-2.5 py-1 transition-colors ${
                    globalChoice === value
                      ? "border-brand-500 bg-white font-medium text-brand-800"
                      : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 max-h-64 overflow-auto rounded border border-ink-200 bg-white">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink-100 text-ink-500">
                    <th className="px-2 py-1.5 font-medium">行</th>
                    <th className="px-2 py-1.5 font-medium">文件里</th>
                    <th className="px-2 py-1.5 font-medium">库里已有</th>
                    <th className="px-2 py-1.5 font-medium">这条怎么处理</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.slice(0, 100).map((conflict) => {
                    const current = choices[String(conflict.line)] ?? globalChoice;
                    return (
                      <tr key={`${conflict.line}-${conflict.key}`} className="border-b border-ink-50 last:border-0">
                        <td className="px-2 py-1.5 text-ink-500">{conflict.line}</td>
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-ink-800">{String(conflict.incoming.name ?? "")}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="text-ink-700">{conflict.existing.name}</span>
                          {conflict.existing.summary !== "" && (
                            <span className="ml-1 text-ink-400">（{conflict.existing.summary}）</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {(
                              [
                                ["skip", "跳过"],
                                ["overwrite", "覆盖"],
                                ["duplicate", "两份"],
                              ] as Array<[ConflictStrategy, string]>
                            ).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setChoices((prev) => ({ ...prev, [String(conflict.line)]: value }))
                                }
                                className={`rounded border px-1.5 py-0.5 transition-colors ${
                                  current === value
                                    ? "border-brand-500 bg-brand-50 font-medium text-brand-800"
                                    : "border-ink-200 text-ink-500 hover:border-brand-300"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {conflicts.length > 100 && (
                <p className="px-2 py-1.5 text-ink-400">
                  只列出前 100 条；其余按上面的「全部这样处理」执行。
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void onConfirm()} disabled={busy}>
                {busy ? "导入中…" : "按以上选择导入"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConflicts([])} disabled={busy}>
                取消
              </Button>
              <span className="text-ink-400">「保留两份」对教师/教室/课程会加序号后缀，学生按原样两条都留。</span>
            </div>
          </div>
        )}

        {result !== null && (
          <div
            className={`rounded-md border px-3 py-2.5 text-xs leading-relaxed ${
              result.ok
                ? "border-brand-200 bg-brand-50 text-brand-800"
                : "border-danger-100 bg-danger-50 text-danger-600"
            }`}
            role="status"
          >
            <p className="font-medium">{result.message}</p>
            {result.unknownHeaders.length > 0 && (
              <p className="mt-1 text-ink-500">被忽略的列：{result.unknownHeaders.join("、")}</p>
            )}
            {result.skipped.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">跳过的 {result.skipped.length} 条（点开看原因）</summary>
                <ul className="mt-1 space-y-0.5 text-ink-600">
                  {result.skipped.slice(0, 30).map((item, index) => (
                    <li key={`${item.line}-${index}`}>第 {item.line} 行：{item.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.problems.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">没通过校验的 {result.problems.length} 行</summary>
                <ul className="mt-1 space-y-0.5 text-ink-600">
                  {result.problems.slice(0, 30).map((item, index) => (
                    <li key={`${item.line}-${index}`}>第 {item.line} 行：{item.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
