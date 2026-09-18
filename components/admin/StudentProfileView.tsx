"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Student } from "@/lib/backend/api";
import {
  PROFILE_SECTIONS,
  profileCompletion,
  profileList,
  profileTable,
  profileText,
  type ProfileField,
} from "@/lib/backend/student-profile";

/**
 * 信息采集表（只读查看）。
 *
 * 与表单共用同一份字段定义（PROFILE_SECTIONS），因此不会出现
 * 「表单里能填、这里不显示」的字段。
 *
 * 心理与情绪健康一节默认**折叠并遮住内容**：采集表里写明这类内容
 * 「仅限指定人员查看」，界面至少要做到「不点开就看不到」。
 */
export function StudentProfileView({
  student,
  onEdit,
}: {
  student: Student;
  onEdit: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const { filled, total } = profileCompletion(student.profile);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-sm text-ink-600">
          采集表已填 <span className="font-medium tabular text-ink-900">{filled}</span> / {total} 项
        </p>
        <Button size="sm" variant="outline" onClick={onEdit}>
          填写采集表
        </Button>
      </div>

      <div className="divide-y divide-ink-100">
        {PROFILE_SECTIONS.map((section) => {
          const hidden = section.sensitive === true && !revealed;
          return (
            <section key={section.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink-900">{section.title}</h3>
                {section.sensitive === true && (
                  <button
                    type="button"
                    onClick={() => setRevealed((value) => !value)}
                    className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                  >
                    {revealed ? "隐藏敏感内容" : "显示敏感内容"}
                  </button>
                )}
              </div>

              {hidden ? (
                <p className="mt-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-600">
                  本节涉及心理与情绪状态，默认折叠。仅限指定人员查看。
                </p>
              ) : (
                <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map((field) => {
                    const value = renderValue(student, field);
                    if (value === "") return null;
                    return (
                      <div key={field.key} className={field.type === "table" ? "sm:col-span-2 lg:col-span-3" : ""}>
                        <dt className="text-xs text-ink-500">{field.label}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink-800">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 把档案里的值渲染成一段文字（空值返回空串，调用方据此隐藏该项）。 */
function renderValue(student: Student, field: ProfileField): string {
  if (field.type === "multi") {
    return profileList(student.profile, field.key).join("、");
  }

  if (field.type === "table") {
    const rows = profileTable(student.profile, field.key);
    return rows
      .map((row, index) => {
        // 固定行（各科成绩、周一…周日）用定义里的行标签，其余按下标
        const label = field.rows?.[index] ?? `第 ${index + 1} 行`;
        const cells = (field.columns ?? [])
          .map((column) => row[column.key] ?? "")
          .filter((cell) => cell.trim() !== "");
        return cells.length === 0 ? "" : `${label}：${cells.join(" / ")}`;
      })
      .filter((line) => line !== "")
      .join("\n");
  }

  return profileText(student.profile, field.key);
}
