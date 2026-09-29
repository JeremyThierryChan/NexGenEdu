"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { BulkImport } from "@/components/admin/BulkImport";
import {
  api,
  type Classroom,
  type Course,
  type CoursePartition,
  type Enrollment,
  type Lesson,
  type LessonRecord,
  type OperationLog,
  type Payment,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import {
  EXPORT_DATASETS,
  FORMAT_META,
  type ExportDataset,
  type ExportFormat,
} from "@/lib/backend/export";
import { remainingTotal } from "@/lib/backend/enrollment";
import { partitionPathLabel } from "@/lib/backend/course-partitions";
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
import { cn } from "@/lib/utils/cn";
import { BACKUP_SLOTS, LOG_LIMIT } from "@/lib/backend/api";
/*
 * 「每天自动备份」（服务端机器上那份每天一份的备份文件）的显示口径与确认文案：
 * 全部来自 `lib/backend/daily-backups.ts`（一处实现）—— 条数摘要、大小、时间、
 * 以及确认框里那句"这份备份里有什么 / 库里现在有什么"的**对照**。
 * 页面里不许自己拼这些字，否则改了那边忘了这边，确认框会少掉一半信息而没人发现。
 */
import {
  backupBytesText,
  backupCountsText,
  dailyBackupCompareText,
  dailyBackupTimeText,
  type DailyBackupEntry,
  type DailyBackupList,
} from "@/lib/backend/daily-backups";
// 教室名的唯一显示口径（「校区·教室名」，v31）
import { classroomLabel } from "@/lib/backend/classrooms";

/**
 * 数据与备份。
 *
 * 为什么这个页面很重要（不只是「导出一下」）：
 *   1. 数据只存在**当前浏览器**里 —— 换电脑、清缓存都会丢，导出是唯一的保险；
 *   2. 将来转前后端分离时，要靠「导出 → 在服务端导入」把数据搬过去；
 *   3. 导入是唯一能一次性毁掉全部数据的操作，因此这里配了三道保险：
 *      结构校验、导入前自动备份、一键恢复导入前的数据。
 */
/**
 * 尽力描述"这份导入文件里有什么"（给确认框用）。
 *
 * 只做**最粗**的判断：看得出是数据库导出就报条数，看不出就说明看不出 ——
 * 结构校验不在这里重复（那是服务端 `importDatabase` 的事，这里重复一遍只会出现两套口径）。
 */
function describeImportText(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const db = (typeof parsed === "object" && parsed !== null && typeof parsed.db === "object"
      ? (parsed.db as Record<string, unknown>)
      : parsed) as Record<string, unknown>;
    const count = (key: string): number => (Array.isArray(db[key]) ? (db[key] as unknown[]).length : 0);
    const parts = [
      `${count("students")} 名学生`,
      `${count("lessons")} 节课`,
      `${count("payments")} 条收款`,
      `${count("transactions")} 条课时流水`,
    ];
    const version = typeof db.version === "number" ? `结构版本 v${db.version}` : "没写结构版本";
    if (parts.every((part) => part.startsWith("0 "))) return `文件里${version}，但看不出学生 / 排课 / 收款（格式可能不对）。`;
    return `文件里：${parts.join("、")}（${version}）`;
  } catch {
    return "这份文件不是合法 JSON —— 点确认也会被服务端拒绝（现有数据不会被改动）。";
  }
}

export default function AdminDataPage() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  /** 导入前备份的清单（最近的在最前）—— 让人看到"有几份、什么时候的"。 */
  const [backupList, setBackupList] = useState<Array<{ at: string; summary: string }>>([]);
  /** 「每天自动备份」的清单（服务端机器上的备份文件；null = 还没读出来）。 */
  const [dailyList, setDailyList] = useState<DailyBackupList | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<OperationLog[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [db, logList, backupExists, slots, daily] = await Promise.all([
      api.exportDatabase(),
      api.logs.list(100),
      api.hasBackup(),
      // 备份清单只是为了显示"有几份"；读不到不影响这一页别的功能
      api.backupSlots().catch(() => []),
      /*
       * 「每天自动备份」的清单：读不到（例如后端没跑、或这一页在浏览器里独自打开）
       * 不该让整页崩，因此回一份"读不出来"的空清单 —— 那一块会显示一句说明，
       * 而不是把这一页和导出 / 导入一起搞坏。
       */
      api.dailyBackups.list().catch((cause: unknown) => ({
        available: false,
        reason: `读不出备份清单：${cause instanceof Error ? cause.message : String(cause)}`,
        dir: "",
        current: null,
        files: [],
      })),
    ]);
    setStats(databaseStats(db));
    setHasBackup(backupExists);
    setBackupList(slots);
    setDailyList(daily);
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
        // ICS 的「地点」是给人看的 → 唯一显示口径（「校区·教室名」，v31）
        location: (() => {
          const room = classrooms.find((item) => item.id === lesson.classroomId);
          return room === undefined ? "" : classroomLabel(room);
        })(),
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
    setError("");
    setMessage("");

    const text = await file.text();
    /*
     * **先看清再替换**（审计抓到的那条：这是全系统破坏力最大的动作，
     * 却是唯一没有二次确认的破坏性操作 —— 选中文件就直接整体替换整库）。
     *
     * 这里在客户端先尽力数一下"这份文件里有多少东西、现在库里有多少"，
     * 让人对着数字点确认；真正的结构校验仍在服务端（`importDatabase`），
     * 这里数不出来就退回一句"看不出内容"而不是拦住人。
     */
    const incoming = describeImportText(text);
    const current = stats === null
      ? "当前库里的条数还没读出来"
      : `当前库：${stats.students} 名学生、${stats.lessons} 节课、${stats.transactions} 条课时流水`;
    if (
      !window.confirm(
        `用这份文件整体替换当前数据？\n\n` +
          `文件：${file.name}\n${incoming}\n${current}\n\n` +
          "导入前会自动留一份备份（最近 5 份，可以恢复），但导入之后当前数据就没了。",
      )
    ) {
      return;
    }

    setBusy(true);
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
    const newest = backupList[0];
    if (
      !window.confirm(
        `恢复导入前的数据？当前数据会被替换回去。\n\n` +
          `恢复的是最新那一份备份${newest === undefined || newest.at === "" ? "（升级前留下的）" : `（${newest.at.slice(0, 16).replace("T", " ")}）`}` +
          `${newest === undefined || newest.summary === "" ? "" : ` · ${newest.summary}`}。`,
      )
    ) {
      return;
    }
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

  /**
   * 用「每天自动备份」里的**某一份**把库换回去。
   *
   * ## 二次确认里必须同时出现"两份东西有什么"
   *
   * 这一条与整库导入那条路是同一条纪律（见上面 `importFile` 的注释）：恢复是
   * **整库替换**，人点"确定"的时候必须知道自己在换掉什么。所以确认框里同时列出
   * **这份备份里的条数**与**库里现在的条数**（`dailyBackupCompareText` 一处实现），
   * 并说清"恢复前系统会先把现在这份另存"。
   *
   * ## 恢复完成之后必须告诉用户两件事
   *
   *   1. **现在用的是哪一天的数据**（否则他不知道回到了哪个时点）；
   *   2. **他原来那一份叫什么名字**（否则"还能回去"这句话是空的）——
   *      再加上清单里马上会多出那一行，两条线索对得上。
   */
  async function restoreDaily(entry: DailyBackupEntry) {
    setError("");
    setMessage("");
    /*
     * `window.confirm` 挡住的是**手滑**（真正的闸在服务端：`confirmed: true`，
     * 以及"校验不过一个字都不写"）。这里把两份条数摊开，让人对着数字点。
     */
    if (
      !window.confirm(
        `用这份备份把整个库换回去？\n\n` +
          dailyBackupCompareText(entry, dailyList?.current ?? null) +
          `\n恢复前系统会先把「现在的库」另存一份备份（清单里会出现它，名字会在下面告诉你）。\n` +
          `恢复的是**业务数据**（档案 / 报课 / 课时 / 收款 / 排课）；网站内容要另外发布。\n\n` +
          `确认恢复这一份？`,
      )
    ) {
      return;
    }
    setBusy(true);
    // 服务端要求显式确认：确认框点过了才传 true（见 lib/backend/daily-backups.ts 的说明）
    const result = await api.dailyBackups.restore(entry.name, { confirmed: true });
    setBusy(false);
    if (!result.ok) {
      setError(`恢复失败：${result.error}`);
      await load();
      return;
    }
    setMessage(
      `${result.note}\n` +
        `恢复前后：${backupCountsText(result.before)} → ${backupCountsText(result.after)}。\n` +
        `另存的那一份是 ${result.preRestore}（本次是从 ${result.file} 恢复的）—— ` +
        "它就在下面的清单里，点它的「恢复这一份」就能回到恢复前的状态。\n" +
        "网站内容（课程正文 / 案例 / 报价文案）要发布的话仍走 `npm run site:export` → 提交推送；" +
        "账号与口令不在备份里，不用重新配；另外，别人手上开着的后台页面看到的还是恢复前的数据，" +
        "请让他们刷新页面（或重新登录）再看。",
    );
    await load();
  }


  return (
    <>
      <PageHeading
        title="数据与备份"
        description="导出全部数据、导入备份、把课表导进手机日历。"
      />

      {/* 数据概览 */}
      <Panel
        className="mt-6"
        title="当前数据"
        description="数据保存在服务端数据库里（不在浏览器里）；下面这些数字是服务端刚算出来的。"
      >
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

      {/* 批量导入：把表格里的名单一次录进来（只新增，不覆盖） */}
      <BulkImport onImported={() => void load()} />

      {message !== "" && (
        <p className="mt-4 whitespace-pre-line rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-600">
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

      {/* 按需导出：数据集 × 选中的行 × 格式 */}
      <OnDemandExport />

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
          导入会整体替换当前数据（不是合并）。选中文件后会先告诉你「这份文件里有多少东西、库里现在有多少」，
          确认之后才替换。文件结构不对会直接拒绝，现有数据不受影响；版本较旧的文件会自动升级到当前结构。
          <br />
          导入前会自动留一份备份，滚动保留最近 {BACKUP_SLOTS} 份
          {backupList.length > 0
            ? `：最近一份是 ${backupList[0]?.at.slice(0, 16).replace("T", " ") ?? ""}（共 ${backupList.length} 份）`
            : "（现在还没有）"}
          。「恢复导入前的数据」恢复的是最新那一份。
        </p>
      </Panel>

      {/* 每天自动备份：机构问「数据丢了怎么办」时，答案就在这一块 */}
      <DailyBackupsPanel list={dailyList} busy={busy} onRestore={(entry) => void restoreDaily(entry)} />

      {/* 操作日志：谁在什么时候改了什么 */}
      <Panel
        className="mt-4"
        title="操作日志"
        description={
          `记录谁在什么时候改了什么（这里显示最近 100 条；库里最多保留 ${LOG_LIMIT} 条，` +
          `超出后最早的那些会被丢弃 —— 要长期留存请定期导出）。日志在服务端，操作人由服务端按会话记录。`
        }
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
    </>
  );
}

function describeStats(stats: DatabaseStats): string {
  return `${stats.students} 名学生 / ${stats.lessons} 节排课 / ${stats.transactions} 笔课时流水`;
}

/**
 * 「每天自动备份」——机构问"**数据丢了怎么办**"时，答案就在这一块。
 *
 * ## 为什么它必须是一个独立面板（而不是并进上面那个「导入」）
 *
 * 因为那是**另一套备份**：上面那一块是"导入前的滚动 5 份"（存在数据库里），
 * 这一块是**服务端机器上每天一份的备份文件**（`server/backups/`，默认留 90 份）。
 * 只有后者能回答机构真正会问的那句话：**"这周三的数据还在吗"** ——
 * 之前它只能靠开发在命令行里手工复制文件（步骤写在给开发看的文档里），
 * 所以"数据丢了怎么办"的答案是"找开发"，那不叫备份。
 *
 * ## 界面上必须同时说清的三件事
 *
 *   1. **清单**：每份的时间、大小、以及读得出的条数摘要；
 *   2. **读不出来的那一份要标出来**（不是藏起来）：目录里躺着一份坏备份正是最该知道的事；
 *   3. **恢复的是什么、不是什么**：恢复的是**业务数据**；`data/site/*.md` 与 `out/`
 *      不在备份范围内（网站内容要发布仍走 `npm run site:export` + 提交推送）。
 *      另外恢复**不动账号与口令** —— 恢复完还是用自己的账号登录。
 */
function DailyBackupsPanel({
  list,
  busy,
  onRestore,
}: {
  list: DailyBackupList | null;
  busy: boolean;
  onRestore: (entry: DailyBackupEntry) => void;
}) {
  return (
    <Panel
      className="mt-4"
      title="每天自动备份"
      description="服务端每天自动备一份（保留 90 份）。数据丢了就在这里挑一份恢复回来 —— 恢复前系统会先把「现在的库」另存一份。"
    >
      <div className="px-4 py-4">
        {list === null ? (
          <p className="text-sm text-ink-400">加载中…</p>
        ) : !list.available ? (
          <p className="rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
            {list.reason}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              备份目录：<code className="text-ink-700">{list.dir}</code>
              {list.current === null ? "" : ` · 库里现在：${backupCountsText(list.current)}`}
            </p>

            {list.files.length === 0 ? (
              <p className="text-sm text-ink-500">
                这个目录里还没有备份。后端启动时会先把「今天那份」补上，之后每小时检查一次
                （也可以在后端机器上跑 <code>npm run server:backup</code> 立刻备一份）。
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-md border border-ink-200">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="sticky top-0 bg-ink-50 text-ink-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">时间</th>
                      <th className="px-3 py-2 font-medium">大小</th>
                      <th className="px-3 py-2 font-medium">里面有多少数据</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {list.files.map((entry) => (
                      <tr key={entry.name}>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-800">
                          {dailyBackupTimeText(entry.at)}
                          <span className="mt-0.5 block text-[11px] text-ink-400">{entry.name}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-600">
                          {backupBytesText(entry.bytes)}
                        </td>
                        <td className="px-3 py-2 text-ink-700">
                          {entry.counts === null ? (
                            /*
                             * 读不出的那一份**照样列出来**并说明原因：它在目录里确实占着一份，
                             * 而当它不存在会让人以为"我的退路是连续 90 天"。
                             */
                            <span className="text-danger-600">
                              读不出这一份的内容：{entry.problem}
                            </span>
                          ) : (
                            backupCountsText(entry.counts)
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            // 读不出内容的备份恢复不了（服务端也会拒），因此按钮直接禁用并说清原因
                            disabled={busy || entry.counts === null}
                            onClick={() => onRestore(entry)}
                          >
                            恢复这一份
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              「恢复这一份」会把**整个库**换成那份备份里的数据：点下去会先让你看到
              「这份备份里有什么 / 库里现在有什么」的条数对照，确认之后才替换。
              <br />
              恢复前系统会**自动把现在的库另存一份**（清单里马上会多出那一行，恢复完也会告诉你它的名字），
              所以恢复错了还能再恢复回去。
              <br />
              恢复的是**业务数据**（学生 / 报课 / 课时 / 收款 / 排课 / 课堂记录）；
              `data/site/*.md` 与 `out/` **不在备份范围内** —— 网站内容要发布仍走
              <code className="mx-1">npm run site:export</code>再提交推送。
              恢复**不动账号与口令**（`server/data/` 下的账号表与凭据文件不在备份里），
              恢复完还是用你自己的账号登录。
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-medium tabular text-ink-900">{value ?? "…"}</dd>
    </div>
  );
}

/* ── 按需导出 ────────────────────────────────────────────────────────── */

/** 一行可导出的数据（界面用；真正的导出行在服务层按 id 取）。 */
type RowOption = {
  id: string;
  /** 主标签：一眼能认出是「哪一条」。 */
  label: string;
  /** 次要说明：时间、教室、剩余课时、状态这类补充信息。 */
  hint: string;
};

/** `09-19 17:30`：排课与收款这类「具体到时刻」的行用。 */
function monthDayTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把 id 换成名字（导出给人看，界面上也不该出现 uuid）。 */
function nameById<T extends { id: string; name: string }>(list: T[], id: string): string {
  return list.find((item) => item.id === id)?.name ?? "";
}

/**
 * 教室专用：**显示口径**（「校区·教室名」，v31）。
 *
 * 为什么不能直接用 `nameById`：它只认 `{id, name}` 这个最小形状（教师 / 学生都适用），
 * 而教室的显示名要由 `classroomLabel` 拼出来 —— 借 `nameById` 的话这里只会印出房间号，
 * 与卡片上的教室名对不上。
 */
function classroomNameById(classrooms: Classroom[], id: string): string {
  const room = classrooms.find((item) => item.id === id);
  return room === undefined ? "" : classroomLabel(room);
}

/**
 * 取某个数据集的行（**只取当前选中的这一个**）。
 *
 * 为什么不把 8 个数据集一起加载：排课、流水、课堂记录加起来几百条，
 * 每次打开这一页都要等它们全部读完，而用户一次只导一个数据集。
 * 代价是切换数据集时有一次短暂加载 —— 这个代价小得多。
 */
async function loadDatasetRows(datasetId: string): Promise<RowOption[]> {
  switch (datasetId) {
    case "students": {
      const students: Student[] = await api.students.list();
      return students.map((student) => ({
        id: student.id,
        label: `${student.name} · ${student.grade}`,
        hint: `剩 ${remainingTotal(student.enrollments)} 节 · ${student.status} · ${student.subjects.join("、") || "未报课"}`,
      }));
    }
    case "lessons": {
      const [lessons, teachers, classrooms] = await Promise.all([
        api.lessons.list(),
        api.teachers.list(),
        api.classrooms.list(),
      ]);
      return lessons
        .slice()
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .map((lesson: Lesson) => ({
          id: lesson.id,
          label: `${monthDayTime(lesson.startsAt)} ${lesson.subject} · ${nameById(teachers, lesson.teacherId) || "待定"}`,
          // 教室名走唯一显示口径（「校区·教室名」，v31）
          hint: `${classroomNameById(classrooms, lesson.classroomId) || "未定教室"} · ${lesson.durationMinutes} 分钟 · ${lesson.status}`,
        }));
    }
    case "teachers": {
      const teachers: Teacher[] = await api.teachers.list();
      return teachers.map((teacher) => ({
        id: teacher.id,
        label: `${teacher.name} · ${teacher.role === "" ? "教师" : teacher.role}`,
        hint: `${teacher.active ? "在职" : "离职"} · 可带 ${teacher.subjects.length} 科`,
      }));
    }
    case "classrooms": {
      const rooms: Classroom[] = await api.classrooms.list();
      return rooms.map((room) => ({
        id: room.id,
        // 「导出哪些行」的清单里也是给人看的名字 → 走唯一显示口径（「校区·教室名」，v31）
        label: `${classroomLabel(room)} · ${room.kind}`,
        hint: `容量 ${room.capacity} 人`,
      }));
    }
    case "courses": {
      const [courses, partitions]: [Course[], CoursePartition[]] = await Promise.all([
        api.courses.list(),
        api.coursePartitions.list(),
      ]);
      return courses.map((course) => {
        // 分区名要拿 id 去分区表里换（v18 起课程只存 id）；写法与别处共用一处实现
        const label = partitionPathLabel(partitions, course.partitionId);
        const where = label === "" ? "未归类" : label;
        return {
          id: course.id,
          label: `${course.name} · ${where}`,
          hint: `${course.origin} · ${course.status}`,
        };
      });
    }
    case "enrollments": {
      // 报课记录没有独立列表接口：挂在学生身上，这里摊平（id 用报课记录自己的 id）
      const students: Student[] = await api.students.list();
      return students.flatMap((student) =>
        student.enrollments.map((enrollment: Enrollment) => ({
          id: enrollment.id,
          label: `${student.name} · ${enrollment.subject}`,
          hint: `剩 ${Math.max(0, enrollment.totalLessons - enrollment.usedLessons)} 节 · ${enrollment.status} · ${enrollment.form || "未填班型"}`,
        })),
      );
    }
    case "payments": {
      const [payments, students] = await Promise.all([api.payments.list(), api.students.list()]);
      return payments
        .slice()
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .map((payment: Payment) => ({
          id: payment.id,
          label: `${monthDayTime(payment.at)} ${payment.kind} ¥${payment.amount} · ${nameById(students, payment.studentId) || "未指定学生"}`,
          hint: payment.method,
        }));
    }
    case "lessonRecords": {
      const [records, lessons, students] = await Promise.all([
        api.lessonRecords.list(),
        api.lessons.list(),
        api.students.list(),
      ]);
      return records.map((record: LessonRecord) => {
        const lesson = lessons.find((item) => item.id === record.lessonId);
        return {
          id: record.id,
          label: `${lesson === undefined ? "（课节已删除）" : monthDayTime(lesson.startsAt)} ${nameById(students, record.studentId) || "未指定学生"} · ${lesson?.subject ?? ""}`,
          hint: `${record.attendance} · 专注 ${record.focus} · 评分 ${record.rating}`,
        };
      });
    }
    default:
      return [];
  }
}

/**
 * 按需导出面板。
 *
 * 与上面三个固定出口的区别：这里是「数据集 × 选中的行 × 格式」——
 * 典型场景是「把这学期围棋课的排课导成 CSV 发给老师」，原先只能导全量再自己筛。
 *
 * 界面上最需要小心的是**空选择的语义**：`ids` 为空数组表示「全部」而不是「什么都不导」。
 * 因此这里做三件事，避免误解：
 *   1. 状态行明写「未选择任何行 → 导出全部 N 条」；
 *   2. 按钮字样跟着选择变（「导出全部 40 条」/「导出选中的 3 条」）；
 *   3. 导出结果里同时给 `count` 与 `total`（「已导出 3 条（该数据集共 40 条）」）。
 */
function OnDemandExport() {
  const [datasetId, setDatasetId] = useState<string>(EXPORT_DATASETS[0]?.id ?? "students");
  const [format, setFormat] = useState<ExportFormat>(EXPORT_DATASETS[0]?.formats[0] ?? "csv");
  const [rows, setRows] = useState<RowOption[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const dataset: ExportDataset | undefined = EXPORT_DATASETS.find(
    (item) => item.id === datasetId,
  );

  // 只加载当前数据集的行；切换数据集时清掉上一次的勾选（行都换了，留着勾选会导错）
  useEffect(() => {
    let alive = true;
    setRows(null);
    setSelected([]);
    setKeyword("");
    setResult("");
    setError("");

    void loadDatasetRows(datasetId)
      .then((list) => {
        if (alive) setRows(list);
      })
      .catch(() => {
        // 取数失败不该让整页崩：当成「没有可导出的行」并允许重试
        if (alive) setRows([]);
      });

    return () => {
      alive = false;
    };
  }, [datasetId]);

  /** 切换数据集：格式也要跟着换（ics 只有排课有、md 只有课程有，由 formats 决定）。 */
  function pickDataset(next: ExportDataset) {
    setDatasetId(next.id);
    setFormat(next.formats[0] ?? "csv");
  }

  const visible = (rows ?? []).filter((row) => {
    const key = keyword.trim();
    if (key === "") return true;
    return row.label.includes(key) || row.hint.includes(key);
  });

  const total = rows?.length ?? 0;
  const allSelected = total > 0 && selected.length === total;

  async function runExport() {
    setBusy(true);
    setError("");
    setResult("");

    // ids 传空数组 = 全选（服务层的语义，不是「什么都不导」）
    const response = await api.exportDataset({ datasetId, ids: selected, format });
    setBusy(false);

    if (!response.ok) {
      setError(response.error);
      return;
    }
    downloadTextFile(response.filename, response.content, response.mime);
    setResult(
      `已导出 ${response.count} 条（该数据集共 ${response.total} 条）→ ${response.filename}`,
    );
  }

  return (
    <Panel
      className="mt-4"
      title="按需导出"
      description="选数据集、选要哪些行、选格式 —— 导出的是「选中的行」，不选任何行就是全部。"
    >
      <div className="space-y-4 px-4 py-4">
        <p className="text-xs leading-relaxed text-ink-500">
          选中的行（不选 = 全部）：给 Excel 看用 <strong className="font-medium text-ink-700">CSV</strong>、
          给别的系统用 <strong className="font-medium text-ink-700">JSON</strong>、
          排课可以导 <strong className="font-medium text-ink-700">ICS</strong> 进手机日历、
          课程可以导 <strong className="font-medium text-ink-700">Markdown</strong> 粘回内容文件。
        </p>

        {/* 1. 选数据集 */}
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-500">第一步：选数据集</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EXPORT_DATASETS.map((item) => {
              const active = item.id === datasetId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pickDataset(item)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-brand-400 bg-brand-50"
                      : "border-ink-200 bg-white hover:border-ink-300",
                  )}
                >
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      active ? "text-brand-700" : "text-ink-800",
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-500">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. 选行 */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-ink-500">
              第二步：选要哪些行
              <span className="ml-2 font-normal text-ink-400">
                共 {rows === null ? "…" : total} 条，已选 {selected.length} 条
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={visible.length === 0}
                onClick={() =>
                  setSelected((prev) => [...new Set([...prev, ...visible.map((row) => row.id)])])
                }
              >
                全选当前结果
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={selected.length === 0}
                onClick={() => setSelected([])}
              >
                全不选
              </Button>
            </div>
          </div>

          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按名称 / 科目 / 教室等关键字筛选（只影响显示，不影响已选）"
            className="mb-2 w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
          />

          {/* 空选择的语义必须写出来：最容易被理解成「什么都不导」 */}
          <p
            className={cn(
              "mb-2 rounded-md px-3 py-2 text-xs leading-relaxed",
              selected.length === 0
                ? "bg-warning-50 text-warning-600"
                : "bg-ink-50 text-ink-600",
            )}
          >
            {selected.length === 0
              ? `未选择任何行 → 将导出全部 ${total} 条`
              : allSelected
                ? `已选全部 ${selected.length} 条（等同于全选）`
                : `已选 ${selected.length} 条 → 只导出这 ${selected.length} 条（该数据集共 ${total} 条）`}
          </p>

          {rows === null ? (
            <p className="px-1 py-3 text-xs text-ink-400">加载中…</p>
          ) : total === 0 ? (
            <p className="px-1 py-3 text-xs text-ink-500">没有可导出的行。</p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-3 text-xs text-ink-500">
              当前筛选没有匹配的行（共 {total} 条）。
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-md border border-ink-200">
              {visible.map((row) => {
                const checked = selected.includes(row.id);
                return (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-ink-50">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() =>
                          setSelected((prev) =>
                            checked ? prev.filter((id) => id !== row.id) : [...prev, row.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-800">{row.label}</span>
                        {row.hint !== "" && (
                          <span className="block truncate text-[11px] text-ink-500">
                            {row.hint}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 3. 选格式 + 导出 */}
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-500">第三步：选格式并导出</h3>
          <div className="flex flex-wrap items-center gap-2">
            {(dataset?.formats ?? []).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFormat(item)}
                aria-pressed={format === item}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition-colors",
                  format === item
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
                )}
              >
                {FORMAT_META[item].label}
              </button>
            ))}
            <Button
              size="sm"
              disabled={busy || total === 0}
              onClick={() => void runExport()}
            >
              {busy
                ? "导出中…"
                : selected.length === 0
                  ? `导出全部 ${total} 条`
                  : `导出选中的 ${selected.length} 条`}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            {dataset === undefined
              ? ""
              : `「${dataset.label}」支持：${dataset.formats.map((item) => FORMAT_META[item].label).join("、")}。`}
          </p>
        </div>

        {result !== "" && (
          <p className="rounded-md border border-success-100 bg-success-50 px-3 py-2 text-xs leading-relaxed text-success-600">
            {result}
          </p>
        )}
        {error !== "" && (
          <p
            role="alert"
            className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-xs leading-relaxed text-danger-600"
          >
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
