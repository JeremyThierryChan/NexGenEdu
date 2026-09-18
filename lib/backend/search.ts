import type { Classroom, Lesson, SearchHit, Student, Teacher } from "./types";
import { dateKey } from "./format";

/**
 * 全局搜索。
 *
 * 后台的入口很多（学生 / 教师 / 教室 / 课表 / 统计…），但「我要找某个人或某节课」
 * 是最高频的动作 —— 挨个页面翻太慢。这里把五类对象放到一个搜索框里，
 * 结果按类别分组，点进去直达。
 *
 * 纯函数：只吃一份数据快照，不碰存储，因此自检可以逐类验证匹配规则。
 */

export type SearchInput = {
  keyword: string;
  students: Student[];
  teachers: Teacher[];
  classrooms: Classroom[];
  lessons: Lesson[];
  /** 站点课程（科目名 → 页面路径），来自前台内容。 */
  courses: Array<{ title: string; href: string }>;
  /** 单类结果上限，避免一个关键词刷出一屏。 */
  limitPerKind?: number;
};

const DEFAULT_LIMIT = 5;

/**
 * 匹配规则：把对象的所有可搜索字段拼成一段文本，做**不区分大小写**的子串匹配。
 *
 * 刻意不用模糊匹配（拼音首字母之类）：后台里「张」和「章」是两个学生，
 * 宁可搜不到也不要搜错人。空关键词返回空结果，而不是把所有数据倒出来。
 */
function matches(haystack: string, keyword: string): boolean {
  return haystack.toLowerCase().includes(keyword.toLowerCase());
}

export function searchAll(input: SearchInput): SearchHit[] {
  const keyword = input.keyword.trim();
  if (keyword === "") return [];

  const limit = input.limitPerKind ?? DEFAULT_LIMIT;
  const hits: SearchHit[] = [];

  // 学生：姓名 / 年级 / 家长联系方式 / 在读科目
  hits.push(
    ...input.students
      .filter((student) =>
        matches(
          [student.name, student.grade, student.guardian, ...student.subjects].join(" "),
          keyword,
        ),
      )
      .slice(0, limit)
      .map((student) => ({
        kind: "学生" as const,
        id: student.id,
        title: student.name,
        subtitle: [student.grade, student.subjects.join("、")].filter((v) => v !== "").join(" · "),
        // 带上 id：学生页会读这个参数并直接展开这位学生的详情
        href: `/admin/students?studentId=${encodeURIComponent(student.id)}`,
      })),
  );

  // 教师：姓名 / 职务 / 可带科目
  hits.push(
    ...input.teachers
      .filter((teacher) =>
        matches([teacher.name, teacher.role, ...teacher.subjects].join(" "), keyword),
      )
      .slice(0, limit)
      .map((teacher) => ({
        kind: "教师" as const,
        id: teacher.id,
        title: teacher.name,
        subtitle: [teacher.role, teacher.subjects.join("、")]
          .filter((value) => value !== "")
          .join(" · "),
        href: "/admin/teachers",
      })),
  );

  // 教室：名称 / 用途 / 备注
  hits.push(
    ...input.classrooms
      .filter((room) => matches([room.name, room.kind, room.note].join(" "), keyword))
      .slice(0, limit)
      .map((room) => ({
        kind: "教室" as const,
        id: room.id,
        title: room.name,
        subtitle: `${room.kind} · 容纳 ${room.capacity} 人`,
        href: "/admin/classrooms",
      })),
  );

  // 排课：科目 / 班型 / 备注 → 跳到那一天的课程安排
  hits.push(
    ...input.lessons
      .filter((lesson) => matches([lesson.subject, lesson.form, lesson.note].join(" "), keyword))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, limit)
      .map((lesson) => ({
        kind: "排课" as const,
        id: lesson.id,
        title: lesson.subject,
        subtitle: `${dateKey(lesson.startsAt)} ${lesson.form}`.trim(),
        // 带上日期：课程安排页会读这个参数并切到那一天
        href: `/admin/lessons?date=${dateKey(lesson.startsAt)}`,
      })),
  );

  // 课程（前台科目页）：便于从后台直接查到某门课的对外页面
  hits.push(
    ...input.courses
      .filter((course) => matches(course.title, keyword))
      .slice(0, limit)
      .map((course) => ({
        kind: "课程" as const,
        id: course.title,
        title: course.title,
        subtitle: "前台课程页面",
        href: course.href,
      })),
  );

  return hits;
}

/** 按类别分组（页面上分组展示）。 */
export function groupHits(hits: SearchHit[]): Array<{ kind: SearchHit["kind"]; hits: SearchHit[] }> {
  const order: SearchHit["kind"][] = ["学生", "教师", "教室", "排课", "课程"];
  return order
    .map((kind) => ({ kind, hits: hits.filter((hit) => hit.kind === kind) }))
    .filter((group) => group.hits.length > 0);
}
