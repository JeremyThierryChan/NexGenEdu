"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { api, type OperationLog } from "@/lib/backend/api";
import {
  createCsv,
  createIcs,
  databaseStats,
  downloadTextFile,
  serializeDatabase,
  stampForFilename,
  type DatabaseStats,
} from "@/lib/backend/backup";
import { formatDayLabel } from "@/lib/backend/format";

/**
 * 数据与备份。
 *
 * 为什么这个页面很重要（不只是「导出一下」）：
 *   1. 数据只存在**当前浏览器**里 —— 换电脑、清缓存都会丢，导出是唯一的保险；
 *   2. 将来转前后端分离时，要靠「导出 → 在服务端导入」把数据搬过去；
 *   3. 导入是唯一能一次性毁掉全部数据的操作，因此这里配了三道保险：
 *      结构校验、导入前自动备份、一键恢复导入前的数据。
 */
export default function AdminDataPage() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<OperationLog[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [db, logList] = await Promise.all([api.exportDatabase(), api.logs.list(100)]);
    setStats(databaseStats(db));
    setHasBackup(api.hasBackup());
    setLogs(logList);
  }, []);

  async function clearLogs() {
    if (!window.confirm("清空操作日志？日志本身也会记一条「清空日志」。")) return;
    setBusy(true);
    const count = await api.logs.clear();
    setBusy(false);
    setMessage(`已清空 ${count} 条操作日志。`);
    await load();
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function exportJson() {
    setBusy(true);
    const db = await api.exportDatabase();
    downloadTextFile(
      `nexgenedu-备份-${stampForFilename()}.json`,
      serializeDatabase(db),
      "application/json",
    );
    setBusy(false);
    setMessage("已导出全部数据（JSON）。换设备或以后搬到服务端都用这份文件。");
  }

  async function exportStudentsCsv() {
    setBusy(true);
    const [students, teachers] = await Promise.all([api.students.list(), api.teachers.list()]);

    const csv = createCsv(
      ["姓名", "年级", "状态", "家长联系方式", "在读科目", "剩余课时", "报课条数", "建档日期"],
      students.map((student) => [
        student.name,
        student.grade,
        student.status,
        student.guardian,
        student.subjects.join("、"),
        `${student.enrollments
          .filter((item) => item.status === "在读")
          .reduce((sum, item) => sum + Math.max(0, item.totalLessons - item.usedLessons), 0)}`,
        `${student.enrollments.length}`,
        formatDayLabel(student.createdAt),
      ]),
    );

    downloadTextFile(`nexgenedu-学生名单-${stampForFilename()}.csv`, csv, "text/csv");
    setBusy(false);
    setMessage(`已导出学生名单（CSV，${students.length} 人，教师 ${teachers.length} 位）。`);
  }

  async function exportLessonsIcs() {
    setBusy(true);
    const [lessons, teachers, classrooms] = await Promise.all([
      api.lessons.list(),
      api.teachers.list(),
      api.classrooms.list(),
    ]);

    const ics = createIcs(
      lessons.map((lesson) => ({
        uid: `lesson-${lesson.id}@nexgenedu`,
        title: `${lesson.subject}${lesson.form !== "" ? ` · ${lesson.form}` : ""}`,
        location: classrooms.find((item) => item.id === lesson.classroomId)?.name ?? "",
        description: [
          `教师：${teachers.find((item) => item.id === lesson.teacherId)?.name ?? "待定"}`,
          ...(lesson.note !== "" ? [`备注：${lesson.note}`] : []),
        ].join("\n"),
        startsAt: lesson.startsAt,
        durationMinutes: lesson.durationMinutes,
      })),
      "NexGenEdu 全部课程",
    );

    downloadTextFile(`nexgenedu-全部课程-${stampForFilename()}.ics`, ics, "text/calendar");
    setBusy(false);
    setMessage(`已导出 ${lessons.length} 节课的日历文件（ICS），导入手机日历即可看到。`);
  }

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");

    const text = await file.text();
    const result = await api.importDatabase(text);
    setBusy(false);

    if (!result.ok) {
      setError(`导入失败：${result.error}（现有数据未被改动）`);
      return;
    }
    setMessage(`${result.note}：${describeStats(result.stats)}。可以点「恢复导入前的数据」撤销。`);
    await load();
  }

  async function restore() {
    if (!window.confirm("恢复导入前的数据？当前数据会被替换回去。")) return;
    setBusy(true);
    const result = await api.restoreBackup();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`${result.note}：${describeStats(result.stats)}。`);
    await load();
  }

  async function reset() {
    if (!window.confirm("重置为初始示例数据？当前数据会全部丢失（建议先导出备份）。")) return;
    setBusy(true);
    await api.reset();
    setBusy(false);
    setMessage("已重置为示例数据。");
    await load();
  }

  return (
    <>
      <PageHeading
        title="数据与备份"
        description="导出全部数据、导入备份、把课表导进手机日历。"
      />

      {/* 数据概览 */}
      <Panel className="mt-6" title="当前数据" description="数据只保存在这台电脑的浏览器里。">
        <dl className="grid gap-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="学生" value={stats?.students} />
          <Stat label="教师" value={stats?.teachers} />
          <Stat label="场地" value={stats?.classrooms} />
          <Stat label="排课" value={stats?.lessons} />
          <Stat label="课堂记录" value={stats?.lessonRecords} />
          <Stat label="作业记录" value={stats?.homeworkRecords} />
          <Stat label="阶段测评" value={stats?.assessments} />
          <Stat label="课时流水" value={stats?.transactions} />
          <div className="sm:col-span-3 lg:col-span-4">
            <dt className="text-xs text-ink-500">最后写入 / 数据结构版本</dt>
            <dd className="mt-1 text-sm text-ink-800">
              {stats === null
                ? "加载中…"
                : `${new Date(stats.updatedAt).toLocaleString("zh-CN")} · v${stats.version}`}
            </dd>
          </div>
        </dl>
      </Panel>

      {message !== "" && (
        <p className="mt-4 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-600">
          {message}
        </p>
      )}
      {error !== "" && (
        <p role="alert" className="mt-4 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      {/* 导出 */}
      <Panel
        className="mt-4"
        title="导出"
        description="建议每周导出一次备份；换设备前一定先导出。"
      >
        <div className="flex flex-wrap gap-2 px-4 py-4">
          <Button size="sm" disabled={busy} onClick={() => void exportJson()}>
            导出全部数据（JSON）
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportStudentsCsv()}>
            导出学生名单（CSV）
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportLessonsIcs()}>
            导出全部课程（ICS 日历）
          </Button>
        </div>
        <p className="px-4 pb-4 text-xs leading-relaxed text-ink-500">
          JSON 是完整备份（含档案、报课、流水、记录），也是以后搬到服务端时要导入的文件；
          CSV 只导出学生名单，方便用 Excel 看；ICS 可以导入手机日历（老师也能自己导自己的课表，
          见「课表与占用」页）。
        </p>
      </Panel>

      {/* 导入 */}
      <Panel
        className="mt-4"
        title="导入"
        description="导入前会自动备份当前数据，导错了可以一键恢复。"
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void importFile(file);
              // 清空，允许连续导入同一个文件
              event.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            选择 JSON 文件导入
          </Button>
          {hasBackup && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore()}>
              恢复导入前的数据
            </Button>
          )}
        </div>
        <p className="px-4 pb-4 text-xs leading-relaxed text-ink-500">
          导入会**整体替换**当前数据（不是合并）。文件结构不对会直接拒绝，现有数据不受影响；
          版本较旧的文件会自动升级到当前结构。
        </p>
      </Panel>

      {/* 操作日志：谁在什么时候改了什么 */}
      <Panel
        className="mt-4"
        title="操作日志"
        description="记录谁在什么时候改了什么（最近 100 条）。纯前端阶段存在本机，接服务端后改为服务端审计。"
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (logs?.length ?? 0) === 0}
            onClick={() => void clearLogs()}
          >
            清空日志
          </Button>
        }
      >
        {logs === null ? (
          <p className="px-4 py-3 text-sm text-ink-400">加载中…</p>
        ) : logs.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-500">还没有操作记录。</p>
        ) : (
          <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-xs">
                <span className="w-32 shrink-0 text-ink-400">
                  {new Date(log.at).toLocaleString("zh-CN")}
                </span>
                <span className="shrink-0 text-ink-500">{log.operator}</span>
                <span className="shrink-0 rounded-sm bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                  {log.entity} · {log.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{log.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 危险操作 */}
      <Panel
        className="mt-4"
        title="重置"
        description="演示或改乱之后恢复初始示例数据 —— 会丢掉现有全部数据。"
      >
        <div className="px-4 py-4">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void reset()}>
            重置为示例数据
          </Button>
        </div>
      </Panel>
    </>
  );
}

function describeStats(stats: DatabaseStats): string {
  return `${stats.students} 名学生 / ${stats.lessons} 节排课 / ${stats.transactions} 笔课时流水`;
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-medium tabular text-ink-900">{value ?? "…"}</dd>
    </div>
  );
}
