"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { api } from "@/lib/backend/api";
import { downloadTextFile, stampForFilename } from "@/lib/backend/backup";
import {
  csvTemplate,
  detectFormat,
  ENTITY_SPECS,
  IMPORT_ENTITIES,
  jsonTemplate,
  parseImport,
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
export function BulkImport({
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

  const onImport = useCallback(async () => {
    if (text.trim() === "") return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await api.imports.apply({
        entity,
        text,
        format: format === "auto" ? undefined : format,
        fileName,
      });
      setResult({
        ok: outcome.ok,
        message: outcome.ok ? outcome.summary : (outcome.error ?? "导入失败。"),
        added: outcome.added,
        skipped: outcome.skipped,
        problems: outcome.problems,
        unknownHeaders: outcome.unknownHeaders,
      });
      if (outcome.ok) onImported?.();
    } catch (cause) {
      setResult({
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        added: 0,
        skipped: [],
        problems: [],
        unknownHeaders: [],
      });
    } finally {
      setBusy(false);
    }
  }, [text, entity, format, fileName, onImported]);

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

        {/* ② 模板 + 文件 */}
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
            {busy ? "导入中…" : `导入${spec.label}`}
          </Button>
          <span className="text-xs text-ink-400">
            导入前会自动留一份快照；同名记录跳过，不会覆盖已有数据。
          </span>
        </div>

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
