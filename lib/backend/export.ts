/**
 * 按需导出：选数据集、选行、选格式，导出成 CSV / JSON / ICS / Markdown。
 *
 * ## 为什么要有这一层
 *
 * 之前只有三个固定出口（全部数据 JSON、学生名单 CSV、全部课程 ICS），
 * 于是「把这学期围棋课的排课导出来发给老师」这种需求只能导全量再自己筛。
 * 这一层把「数据集 × 选中的行 × 格式」变成一次调用：
 *
 *   - **数据集**：学生 / 教师 / 教室 / 排课 / 课程 / 报课记录 / 收款记录 / 课堂记录；
 *   - **选中的行**：不传 `ids` 就是全选，传了就是只导这几条；
 *   - **格式**：CSV（交给 Excel）与 JSON（交给别的系统）对所有数据集可用；
 *     排课额外支持 ICS（进手机日历）、课程额外支持 Markdown（粘回内容文件）。
 *
 * ## 两个刻意的决定
 *
 * 1. **CSV 列是「人看的」，不是数据库字段**：表头写中文（「学生」「上课时间」「教室」），
 *    内容里把 id 换成名字（教室 id → 「301 教室」）。导出给人看、给 Excel 用，
 *    一列 uuid 是没有意义的。
 * 2. **只读**：这里只从数据库读数、拼文本，不改任何东西 —— 导出不该有副作用。
 */

import { partitionPathLabel, partitionPlace } from "./course-partitions";
// 教室名的唯一显示口径（「校区·教室名」，v31）：排课表与 ICS 的「地点」都用它
import { classroomLabel } from "./classrooms";
import type { Database } from "./types";
import {
  createCsv,
  createIcs,
  stampForFilename,
  type CalendarEvent,
} from "./backup";
import { activeEnrollments, remainingTotal } from "./enrollment";

/** 支持的格式。 */
export const EXPORT_FORMATS = ["csv", "json", "ics", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 格式的中文名与 MIME（界面与下载都用同一份，避免两处各写一套）。 */
export const FORMAT_META: Record<ExportFormat, { label: string; ext: string; mime: string }> = {
  csv: { label: "CSV（Excel）", ext: "csv", mime: "text/csv" },
  json: { label: "JSON（给其他系统）", ext: "json", mime: "application/json" },
  ics: { label: "ICS（手机日历）", ext: "ics", mime: "text/calendar" },
  md: { label: "Markdown（粘回内容文件）", ext: "md", mime: "text/markdown" },
};

/** 一个数据集的定义。 */
export type ExportDataset = {
  id: string;
  label: string;
  /** 一段说明：这个数据集是什么、导出去干什么。 */
  description: string;
  /** 可用格式（第一个是界面默认选中的）。 */
  formats: ExportFormat[];
  /** 主键字段（id），用于「只导选中的行」。 */
  rows: (db: Database) => Array<{ id: string }>;
  /** 一行数据 → CSV 列（表头与值一一对应）。 */
  columns: (db: Database) => { headers: string[]; row: (item: never) => string[] };
  /** ICS 事件（只有排课有）。 */
  events?: (db: Database, items: Array<{ id: string }>) => CalendarEvent[];
  /** Markdown 片段（只有课程有）。 */
  markdown?: (db: Database, items: Array<{ id: string }>) => string;
};

/* ── 小工具：把 id 换成名字（导出给人看，不出现 uuid） ───────────────── */

const nameOf = <T extends { id: string; name: string }>(list: T[], id: string): string =>
  list.find((item) => item.id === id)?.name ?? "";

/**
 * 教室在导出里的写法：**显示口径**（「校区·教室名」，v31）。
 *
 * 排课那张表的「教室」列与 ICS 的「地点」都是**给人看的**（导出给老师、进手机日历），
 * 因此与后台卡片上保持同一个写法；教室那张表自己不在这里 —— 它是**数据**（名称与校区分两列，
 * 见下面 `classrooms` 数据集的说明）。
 */
const classroomLabelOf = (list: Database["classrooms"], id: string): string => {
  const room = list.find((item) => item.id === id);
  return room === undefined ? "" : classroomLabel(room);
};

const joinNames = <T extends { id: string; name: string }>(list: T[], ids: string[]): string =>
  ids.map((id) => nameOf(list, id)).filter((name) => name !== "").join("、");

/**
 * 分区在导出里的写法：`栏目 / 子栏目`（未归类为空串）。
 *
 * 写法本身收在 `partitionPathLabel()` 一处 —— 导出、下拉、清单、数据页四处必须一模一样，
 * 否则"导出来是 `高中课内 / 七选三`、下拉里是 `七选三`"这种不一致没有任何自检能发现。
 * 导入那侧的解析见 `import.ts` 的 `parsePartitionPath`：两处都认 `/` 与 `／`。
 */
function partitionLabel(db: Database, partitionId: string): string {
  return partitionPathLabel(db.coursePartitions, partitionId);
}

/** 本地时间 `YYYY-MM-DD HH:MM`。 */
function localDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/* ── 数据集清单 ─────────────────────────────────────────────────────── */

/**
 * 数据集清单。
 *
 * 顺序按机构平时导出的频率排（学生 → 排课 → 教师 → 教室 → 课程 → 报名收费与记录）。
 * 新增实体时在这里加一项即可，界面与自检都从这份清单取，不会漏。
 */
export const EXPORT_DATASETS: ExportDataset[] = [
  {
    id: "students",
    label: "学生",
    description: "每名学生一行：年级、监护人、状态、剩余课时合计、在读科目。",
    formats: ["csv", "json"],
    rows: (db) => db.students,
    columns: () => ({
      headers: ["姓名", "年级", "监护人", "状态", "剩余课时", "在读科目", "备注", "建档时间"],
      row: (item: never) => {
        const student = item as Database["students"][number];
        /*
         * 判据用 `activeEnrollments`（`status === "在读"`）而不是 `endedAt === ""`：
         * 同一个仓库里两种写法迟早分叉（审计那条），而"哪些报课还在读"只有一个答案。
         */
        const active = activeEnrollments(student.enrollments);
        return [
          student.name,
          student.grade,
          student.guardian,
          student.status,
          String(remainingTotal(student.enrollments)),
          active.map((row) => row.subject).join("、"),
          student.note,
          localDateTime(student.createdAt),
        ];
      },
    }),
  },
  {
    id: "lessons",
    label: "排课",
    description: "每节课一行：时间、时长、科目、班型、教师、教室、学生。ICS 可直接进手机日历。",
    formats: ["csv", "json", "ics"],
    rows: (db) => db.lessons,
    columns: (db) => ({
      headers: ["日期", "开始", "时长（分钟）", "科目", "班型", "教师", "教室", "学生", "状态", "备注"],
      row: (item: never) => {
        const lesson = item as Database["lessons"][number];
        const start = new Date(lesson.startsAt);
        const pad = (value: number) => `${value}`.padStart(2, "0");
        return [
          `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
          `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          String(lesson.durationMinutes),
          lesson.subject,
          lesson.form,
          nameOf(db.teachers, lesson.teacherId),
          classroomLabelOf(db.classrooms, lesson.classroomId),
          joinNames(db.students, lesson.studentIds),
          lesson.status,
          lesson.note,
        ];
      },
    }),
    events: (db, items) =>
      items
        .map((item) => db.lessons.find((lesson) => lesson.id === item.id))
        .filter((lesson) => lesson !== undefined)
        .map((lesson) => ({
          uid: `lesson-${lesson.id}@nexgenedu`,
          title: lesson.subject === "" ? "课程" : lesson.subject,
          location: classroomLabelOf(db.classrooms, lesson.classroomId),
          description: [
            lesson.form,
            nameOf(db.teachers, lesson.teacherId),
            joinNames(db.students, lesson.studentIds),
          ]
            .filter((part) => part !== "")
            .join(" · "),
          startsAt: lesson.startsAt,
          durationMinutes: lesson.durationMinutes,
        })),
  },
  {
    id: "teachers",
    label: "教师",
    description: "每位教师一行：职务、可带科目、联系方式、在职状态、本周课次。",
    formats: ["csv", "json"],
    rows: (db) => db.teachers,
    columns: (db) => ({
      headers: ["姓名", "职务", "可带科目", "联系方式", "在职", "排课次数"],
      row: (item: never) => {
        const teacher = item as Database["teachers"][number];
        return [
          teacher.name,
          teacher.role,
          teacher.subjects.join("、"),
          teacher.phone,
          teacher.active ? "在职" : "离职",
          String(db.lessons.filter((lesson) => lesson.teacherId === teacher.id).length),
        ];
      },
    }),
  },
  {
    id: "classrooms",
    label: "教室",
    description: "每间教室一行：校区、名称、用途、容量、可用时段、已排课次。",
    formats: ["csv", "json"],
    rows: (db) => db.classrooms,
    /*
     * 这一张是**数据**（可能被拿去再导回来），不是给人念的名字，因此：
     *   - 「名称」只写教室名本身、**不拼校区**（拼了的话回读时又得靠拆分救回来）；
     *   - 单独一列「校区」—— 与批量导入那两列（`ENTITY_SPECS.classrooms`）**同形**，
     *     导出/导入才是可往返的。界面上的显示口径（`classroomLabel`）不在这里用。
     */
    columns: (db) => ({
      headers: ["校区", "名称", "用途", "容量", "可用时段", "已排课次"],
      row: (item: never) => {
        const room = item as Database["classrooms"][number];
        return [
          room.campus,
          room.name,
          room.kind,
          String(room.capacity),
          room.availability
            .map((slot) => `周${slot.weekdays.join("/")} ${slot.start}–${slot.end}`)
            .join("；"),
          String(db.lessons.filter((lesson) => lesson.classroomId === room.id).length),
        ];
      },
    }),
  },
  {
    id: "courses",
    label: "课程",
    description:
      "课程库的课程。Markdown 格式导出的是内容文件里的卡片行，可直接粘进 data/site/content.md。",
    formats: ["csv", "json", "md"],
    rows: (db) => db.courses,
    /*
     * 「分类」一列给的是**分区路径**：`高中课内 / 七选三`（没有子栏目时就只是栏目名）。
     *
     * 为什么合成一列而不是拆成「栏目」「子栏目」两列：导出的 CSV 是给**人**看、也是给
     * 导入用的，而导入时一行对应一门课、分区用一条路径就说清了。拆两列会让"只填了子栏目、
     * 没填栏目"这种半截行变成可能（导入时只能拒收）。
     */
    columns: (db) => ({
      headers: ["课程名", "分类", "来源", "状态", "可开班型", "备注"],
      row: (item: never) => {
        const course = item as Database["courses"][number];
        return [
          course.name,
          partitionLabel(db, course.partitionId),
          course.origin,
          course.status,
          course.forms.join("、"),
          course.note,
        ];
      },
    }),
    markdown: (db, items) => {
      const courses = items as Database["courses"];
      const lines = courses.map((course) => {
        const place = partitionPlace(db.coursePartitions, course.partitionId);
        const parts = [
          `路径: ${slugHint(course.name)}`,
          ...(place.column === null ? [] : [`栏目: ${place.column.name}`]),
          ...(place.leaf === null || place.leaf.parentId === "" ? [] : [`子栏目: ${place.leaf.name}`]),
          ...(course.forms.length === 0 ? [] : [`班型: ${course.forms.join("、")}`]),
          ...(course.status === "开放" ? [] : ["状态: 暂未开放"]),
        ];
        return `#### ${course.name} | ${parts.join(" · ")}`;
      });
      return `${lines.join("\n")}\n`;
    },
  },
  {
    id: "enrollments",
    label: "报课记录",
    description: "一条报课一行（含续费与退课）：科目、班型、课时、标价、应缴、实收、状态。",
    formats: ["csv", "json"],
    rows: (db) =>
      db.students.flatMap((student) =>
        student.enrollments.map((enrollment) => ({ ...enrollment, studentName: student.name })),
      ),
    columns: (db) => ({
      headers: ["学生", "科目", "班型", "教师", "总课时", "已用课时", "剩余", "标价", "应缴", "实收", "报课日期", "状态", "备注"],
      row: (item: never) => {
        const row = item as Database["students"][number]["enrollments"][number] & { studentName: string };
        return [
          row.studentName,
          row.subject,
          row.form,
          nameOf(db.teachers, row.teacherId),
          String(row.totalLessons),
          String(row.usedLessons),
          String(Math.max(0, row.totalLessons - row.usedLessons)),
          String(row.unitPrice),
          String(row.agreedAmount),
          String(row.paidAmount),
          localDateTime(row.startedAt),
          row.status,
          row.note,
        ];
      },
    }),
  },
  {
    id: "payments",
    label: "收款记录",
    description: "一笔收款 / 退款一行：学生、金额、方式、类型、时间、备注。",
    formats: ["csv", "json"],
    rows: (db) => db.payments,
    columns: (db) => ({
      headers: ["时间", "学生", "类型", "金额", "方式", "备注"],
      row: (item: never) => {
        const payment = item as Database["payments"][number];
        return [
          localDateTime(payment.at),
          nameOf(db.students, payment.studentId),
          payment.kind,
          String(payment.amount),
          payment.method,
          payment.note,
        ];
      },
    }),
  },
  {
    id: "lessonRecords",
    label: "课堂记录",
    description: "一次课堂记录一行：出勤、专注、互动、评分、请假时间、备注。",
    formats: ["csv", "json"],
    rows: (db) => db.lessonRecords,
    columns: (db) => ({
      headers: ["日期", "学生", "科目", "出勤", "专注", "互动", "评分", "请假时间", "备注"],
      row: (item: never) => {
        const record = item as Database["lessonRecords"][number];
        const lesson = db.lessons.find((row) => row.id === record.lessonId);
        return [
          lesson === undefined ? "" : localDateTime(lesson.startsAt),
          nameOf(db.students, record.studentId),
          lesson?.subject ?? "",
          record.attendance,
          record.focus,
          record.interaction,
          String(record.rating),
          record.leaveRequestedAt === "" ? "" : localDateTime(record.leaveRequestedAt),
          record.note,
        ];
      },
    }),
  },
];

/** 按 id 找数据集。 */
export function findExportDataset(id: string): ExportDataset | undefined {
  return EXPORT_DATASETS.find((dataset) => dataset.id === id);
}

/** 课程名 → 建议的路径 slug（导出 Markdown 卡片行时用；中文会被转成拼音无关的占位）。 */
function slugHint(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii === "" ? "请填一个英文短名" : ascii;
}

/* ── 导出 ───────────────────────────────────────────────────────────── */

export type ExportRequest = {
  datasetId: string;
  /** 只导这些行；不传或空数组表示**全选**。 */
  ids?: string[];
  format: ExportFormat;
};

export type ExportResult =
  | { ok: true; filename: string; content: string; mime: string; count: number; total: number }
  | { ok: false; error: string };

/**
 * 导出一个数据集。
 *
 * `ids` 为空/不传 = 全选（这是界面上「全选导出」的语义）。
 * 返回的 `count` 是实际导出的行数，`total` 是这个数据集一共多少行 ——
 * 界面靠这两个数字说清「导了 12 条，共 40 条」，避免用户以为导全了。
 */
export function exportDataset(db: Database, request: ExportRequest): ExportResult {
  const dataset = findExportDataset(request.datasetId);
  if (dataset === undefined) return { ok: false, error: `没有这个数据集：${request.datasetId}` };
  if (!dataset.formats.includes(request.format)) {
    return {
      ok: false,
      error: `「${dataset.label}」不支持 ${FORMAT_META[request.format].label} 格式`,
    };
  }

  const all = dataset.rows(db) as Array<{ id: string }>;
  const wanted = request.ids === undefined ? [] : request.ids;
  const selected = wanted.length === 0 ? all : all.filter((item) => wanted.includes(item.id));
  const stamp = stampForFilename();
  const base = `${dataset.label}-${stamp}${selected.length === 0 ? "" : `-选中${selected.length}条`}`;

  if (request.format === "json") {
    return {
      ok: true,
      filename: `${base}.json`,
      content: `${JSON.stringify(selected, null, 2)}\n`,
      mime: FORMAT_META.json.mime,
      count: selected.length,
      total: all.length,
    };
  }

  if (request.format === "csv") {
    const { headers, row } = dataset.columns(db);
    const rows = selected.map((item) => row(item as never));
    return {
      ok: true,
      filename: `${base}.csv`,
      content: createCsv(headers, rows),
      mime: FORMAT_META.csv.mime,
      count: selected.length,
      total: all.length,
    };
  }

  if (request.format === "ics") {
    if (dataset.events === undefined) {
      return { ok: false, error: `「${dataset.label}」导不出日历文件` };
    }
    const events = dataset.events(db, selected);
    return {
      ok: true,
      filename: `${base}.ics`,
      content: createIcs(events, `${dataset.label}（${stamp}）`),
      mime: FORMAT_META.ics.mime,
      count: events.length,
      total: all.length,
    };
  }

  if (dataset.markdown === undefined) {
    return { ok: false, error: `「${dataset.label}」导不出 Markdown` };
  }
  return {
    ok: true,
    filename: `${base}.md`,
    content: dataset.markdown(db, selected),
    mime: FORMAT_META.md.mime,
    count: selected.length,
    total: all.length,
  };
}

/** 数据集概览（界面里每个数据集显示「共 N 条」）。 */
export function datasetSizes(db: Database): Array<{ id: string; label: string; count: number }> {
  return EXPORT_DATASETS.map((dataset) => ({
    id: dataset.id,
    label: dataset.label,
    count: dataset.rows(db).length,
  }));
}
