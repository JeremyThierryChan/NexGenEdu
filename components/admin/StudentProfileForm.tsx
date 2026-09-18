"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, type Student } from "@/lib/backend/api";
import {
  PROFILE_SECTIONS,
  emptyProfileTable,
  profileList,
  profileTable,
  profileText,
  type ProfileField,
  type ProfileValue,
  type StudentProfile,
} from "@/lib/backend/student-profile";
import { cn } from "@/lib/utils/cn";

/**
 * 学生信息采集表（表单）。
 *
 * 按 PROFILE_SECTIONS 的定义渲染，因此**改采集表只改那一个字段定义文件**：
 * 加字段、改选项、调整顺序都不需要动这里，也不需要数据迁移
 * （档案是键值对，老数据读不到新字段就是空）。
 *
 * 六节内容较长，因此每一节是可折叠的；心理与情绪健康一节带敏感标记，
 * 默认折叠并提示「仅限指定人员查看」。
 */
export function StudentProfileForm({
  student,
  onSaved,
  onCancel,
}: {
  student: Student;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [profile, setProfile] = useState<StudentProfile>(() => structuredClone(student.profile));
  const [openSections, setOpenSections] = useState<string[]>(["basic"]);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState("");

  function setValue(key: string, value: ProfileValue) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function toggleSection(id: string) {
    setOpenSections((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function save() {
    setPending(true);
    await api.students.saveProfile(student.id, profile);
    setPending(false);
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    await onSaved();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-xs text-ink-500">
          按采集表逐节填写；不确定的可以先留空，之后随时补。
          {savedAt !== "" && <span className="ml-2 text-success-600">已保存（{savedAt}）</span>}
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void save()}>
            {pending ? "保存中…" : "保存采集表"}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            收起
          </Button>
        </div>
      </div>

      <div className="divide-y divide-ink-100">
        {PROFILE_SECTIONS.map((section) => {
          const open = openSections.includes(section.id);
          return (
            <section key={section.id}>
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink-900">{section.title}</span>
                  {section.sensitive === true && (
                    <span className="ml-2 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                      敏感 · 仅限指定人员查看
                    </span>
                  )}
                  {section.description !== undefined && (
                    <span className="mt-0.5 block text-xs text-ink-500">{section.description}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-ink-400">{open ? "收起 ▲" : "展开 ▼"}</span>
              </button>

              {open && (
                <div className="px-4 pb-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {section.fields.map((field) =>
                      field.type === "table" ? (
                        <div key={field.key} className="sm:col-span-2 lg:col-span-3">
                          <ProfileTableField
                            field={field}
                            value={profileTable(profile, field.key)}
                            onChange={(rows) => setValue(field.key, rows)}
                          />
                        </div>
                      ) : (
                        <ProfileFieldInput
                          key={field.key}
                          field={field}
                          value={profileText(profile, field.key)}
                          list={profileList(profile, field.key)}
                          onChange={(value) => setValue(field.key, value)}
                        />
                      ),
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const CONTROL =
  "block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 " +
  "outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/** 单值 / 多选字段。 */
function ProfileFieldInput({
  field,
  value,
  list,
  onChange,
}: {
  field: ProfileField;
  value: string;
  list: string[];
  onChange: (value: ProfileValue) => void;
}) {
  return (
    <label className={cn("block", field.type === "longtext" && "sm:col-span-2 lg:col-span-3")}>
      <span className="text-xs font-medium text-ink-600">{field.label}</span>
      {field.hint !== undefined && (
        <span className="ml-1.5 text-xs text-ink-400">{field.hint}</span>
      )}
      <div className="mt-1">
        {field.type === "select" ? (
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={CONTROL}
          >
            <option value="">未填写</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.type === "multi" ? (
          <div className="flex flex-wrap gap-1.5">
            {(field.options ?? []).map((option) => {
              const checked = list.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    onChange(
                      checked ? list.filter((item) => item !== option) : [...list, option],
                    )
                  }
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    checked
                      ? "border-brand-200 bg-brand-50 text-brand-700"
                      : "border-ink-200 text-ink-600 hover:bg-ink-50",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : field.type === "longtext" ? (
          <textarea
            rows={2}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={CONTROL}
          />
        ) : (
          <input
            type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={CONTROL}
          />
        )}
      </div>
    </label>
  );
}

/** 表格型字段（各科成绩 / 可上课时间）。 */
function ProfileTableField({
  field,
  value,
  onChange,
}: {
  field: ProfileField;
  value: Array<Record<string, string>>;
  onChange: (rows: Array<Record<string, string>>) => void;
}) {
  // 固定行的表格（如「周一…周日」）按定义补足行数，避免用户没填就没有输入框
  const rows =
    field.rows !== undefined && value.length !== field.rows.length
      ? emptyProfileTable(field).map((empty, index) => ({ ...empty, ...(value[index] ?? {}) }))
      : value;

  const labelOf = (index: number) => field.rows?.[index] ?? `第 ${index + 1} 行`;

  function updateRow(index: number, columnKey: string, cell: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [columnKey]: cell } : row));
    onChange(next);
  }

  return (
    <div>
      <p className="text-xs font-medium text-ink-600">{field.label}</p>
      <div className="mt-1 overflow-x-auto rounded-md border border-ink-200 bg-white">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-3 py-2 font-medium">{field.rows !== undefined ? "" : "行"}</th>
              {(field.columns ?? []).map((column) => (
                <th key={column.key} className="px-3 py-2 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-ink-50 last:border-0">
                <td className="w-24 px-3 py-1.5 text-xs text-ink-600">{labelOf(index)}</td>
                {(field.columns ?? []).map((column) => (
                  <td key={column.key} className="px-2 py-1.5">
                    <input
                      value={row[column.key] ?? ""}
                      onChange={(event) => updateRow(index, column.key, event.target.value)}
                      className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
