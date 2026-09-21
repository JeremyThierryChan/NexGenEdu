import type { Classroom, Lesson, Student, Teacher } from "./types";
import { remainingOf } from "./enrollment";
import { withinRange } from "./finance";
import { dateKey } from "./format";

/**
 * 经营统计。
 *
 * 这些数字回答的是**决策问题**，不是「给老板看的报表」：
 *   - 教室利用率：这间教室值不值？是不是该加教室，还是该把课挪到别的时段？
 *   - 教师课时：谁排满了、谁还空着？排班与薪酬的参考。
 *   - 退课与流失：学生在什么阶段退？退的原因集中在哪？
 *
 * 全部是纯函数，自检可以造数据逐项验证。
 */

/**
 * 教室没设可用时段时，估算「一周可用时长」用的基准：每天 8:00–22:00，共 14 小时。
 *
 * 取的是**上课时间**而不是营业时间（接待咨询 9:00–21:00）：教室能不能用，
 * 取决于「这个时段能不能上课」，而不是「有没有老师在前台」。
 * 不设时段表示「不限」，但算利用率总得有个分母。
 */
export const CLASS_HOURS_PER_DAY = 14;

/** 一周可用分钟数（每天 8:00–22:00，共 7 天）。 */
const DEFAULT_WEEKLY_MINUTES = Math.round(CLASS_HOURS_PER_DAY * 60 * 7);

/** 「HH:MM」→ 分钟数。 */
function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1=周一 … 7=周日。 */
function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export type RoomUtilization = {
  classroom: Classroom;
  /** 本周可用时长（分钟）。 */
  availableMinutes: number;
  /** 本周已排时长（不含已取消）。 */
  bookedMinutes: number;
  /** 利用率 0–1。 */
  rate: number;
  lessonCount: number;
  /** 有可用时段、但本周一节课都没排的日期（`YYYY-MM-DD`）。 */
  idleDays: string[];
};

/**
 * 教室利用率。
 *
 * 可用时长优先按教室自己的「可用时段」算；没设时段（`availability` 为空 = 不限）的
 * 按**上课时间**估算（每天 8:00–22:00 共 14 小时，见文件顶部那段说明）——
 * 不是接待咨询的营业时间（9:00–21:00）。
 * 只统计**未取消**的课 —— 取消的课不占用教室。
 */
export function roomUtilization(
  classrooms: Classroom[],
  lessons: Lesson[],
  days: Date[],
): RoomUtilization[] {
  return classrooms.map((classroom) => {
    const booked = lessons.filter(
      (lesson) => lesson.classroomId === classroom.id && lesson.status !== "已取消",
    );
    const bookedMinutes = booked.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);

    const availableMinutes =
      classroom.availability.length === 0
        ? DEFAULT_WEEKLY_MINUTES
        : days.reduce((sum, day) => {
            const weekday = isoWeekday(day);
            return (
              sum +
              classroom.availability
                .filter((row) => row.weekdays.includes(weekday))
                .reduce((minutes, row) => {
                  const start = toMinutes(row.start);
                  const end = toMinutes(row.end);
                  return start !== null && end !== null && end > start
                    ? minutes + (end - start)
                    : minutes;
                }, 0)
            );
          }, 0);

    const idleDays = days
      .filter((day) => {
        const key = dateKey(day);
        const hasWindow =
          classroom.availability.length === 0 ||
          classroom.availability.some((row) => row.weekdays.includes(isoWeekday(day)));
        const hasLesson = booked.some((lesson) => dateKey(lesson.startsAt) === key);
        return hasWindow && !hasLesson;
      })
      .map((day) => dateKey(day));

    return {
      classroom,
      availableMinutes,
      bookedMinutes,
      rate: availableMinutes > 0 ? bookedMinutes / availableMinutes : 0,
      lessonCount: booked.length,
      idleDays,
    };
  });
}

/** 各时段的课次分布：回答「哪个时段最挤、哪个时段空」。 */
export function hourlyLoad(lessons: Lesson[]): Array<{ hour: number; count: number; minutes: number }> {
  const map = new Map<number, { count: number; minutes: number }>();
  for (const lesson of lessons) {
    if (lesson.status === "已取消") continue;
    const hour = new Date(lesson.startsAt).getHours();
    const current = map.get(hour) ?? { count: 0, minutes: 0 };
    map.set(hour, {
      count: current.count + 1,
      minutes: current.minutes + lesson.durationMinutes,
    });
  }
  return [...map]
    .map(([hour, value]) => ({ hour, ...value }))
    .sort((a, b) => a.hour - b.hour);
}

export type TeacherWorkload = {
  teacher: Teacher;
  lessonCount: number;
  minutes: number;
  /** 涉及的不同学生数。 */
  studentCount: number;
  /** 平均每节课的学生数（一对一 = 1）。 */
  avgStudents: number;
  bySubject: Array<{ subject: string; lessonCount: number; minutes: number }>;
};

/** 教师课时（排班与薪酬的参考）。 */
export function teacherWorkload(teachers: Teacher[], lessons: Lesson[]): TeacherWorkload[] {
  return teachers
    .map((teacher) => {
      const own = lessons.filter(
        (lesson) => lesson.teacherId === teacher.id && lesson.status !== "已取消",
      );
      const minutes = own.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
      const students = new Set(own.flatMap((lesson) => lesson.studentIds));
      const totalStudents = own.reduce((sum, lesson) => sum + lesson.studentIds.length, 0);

      const bySubject: TeacherWorkload["bySubject"] = [];
      for (const lesson of own) {
        const existing = bySubject.find((item) => item.subject === lesson.subject);
        if (existing === undefined) {
          bySubject.push({ subject: lesson.subject, lessonCount: 1, minutes: lesson.durationMinutes });
        } else {
          existing.lessonCount += 1;
          existing.minutes += lesson.durationMinutes;
        }
      }
      bySubject.sort((a, b) => b.minutes - a.minutes);

      return {
        teacher,
        lessonCount: own.length,
        minutes,
        studentCount: students.size,
        avgStudents: own.length > 0 ? Math.round((totalStudents / own.length) * 10) / 10 : 0,
        bySubject,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

export type ChurnStats = {
  /** 已退课的报课条数。 */
  refundedCount: number;
  /** 退掉的课时合计（含已上与未上）。 */
  refundedLessons: number;
  /** 退课时仍未上的课时合计（真正的「损失」）。 */
  refundedRemaining: number;
  /** 已退课条目的收费合计（用于看影响面）。 */
  refundedAmount: number;
  bySubject: Array<{ subject: string; count: number }>;
  /** 退课原因分布（来自退课时填的备注）。 */
  byReason: Array<{ reason: string; count: number }>;
  /** 退课时平均已上节数。 */
  avgUsedLessons: number;
  /** 退课时平均已上比例（流失点：学生通常在学到多少时退）。 */
  avgUsedRatio: number;
  /** 暂停 / 结课的学生数。 */
  pausedOrFinished: number;
};

/**
 * 退课与流失。
 *
 * 两个数字最有用：
 *   - **平均已上比例**：学生通常在学到多少时退 —— 如果集中在 20%–30%，
 *     说明问题出在「入门期」，而不是「快学完时」；
 *   - **原因分布**：直接来自退课时填的备注，是唯一能反映真实原因的数据。
 */
export function churnStats(students: Student[]): ChurnStats {
  const refunded = students.flatMap((student) =>
    student.enrollments.filter((enrollment) => enrollment.status === "已退课"),
  );

  const bySubject: ChurnStats["bySubject"] = [];
  for (const enrollment of refunded) {
    const key = enrollment.subject.trim() === "" ? "未指定科目" : enrollment.subject.trim();
    const existing = bySubject.find((item) => item.subject === key);
    if (existing === undefined) bySubject.push({ subject: key, count: 1 });
    else existing.count += 1;
  }

  const byReason: ChurnStats["byReason"] = [];
  for (const enrollment of refunded) {
    // 退课原因取报课记录里最后一条「退课」流水的备注
    const entry = [...enrollment.history].reverse().find((item) => item.kind === "退课");
    const reason = (entry?.note ?? "").trim();
    if (reason === "") continue;
    const existing = byReason.find((item) => item.reason === reason);
    if (existing === undefined) byReason.push({ reason, count: 1 });
    else existing.count += 1;
  }

  const usedLessons = refunded.reduce((sum, item) => sum + item.usedLessons, 0);
  const totalLessons = refunded.reduce((sum, item) => sum + item.totalLessons, 0);

  return {
    refundedCount: refunded.length,
    refundedLessons: totalLessons,
    refundedRemaining: refunded.reduce((sum, item) => sum + remainingOf(item), 0),
    refundedAmount: Math.round(refunded.reduce((sum, item) => sum + item.paidAmount, 0) * 100) / 100,
    bySubject: bySubject.sort((a, b) => b.count - a.count),
    byReason: byReason.sort((a, b) => b.count - a.count),
    avgUsedLessons:
      refunded.length > 0 ? Math.round((usedLessons / refunded.length) * 10) / 10 : 0,
    avgUsedRatio:
      totalLessons > 0 ? Math.round((usedLessons / totalLessons) * 1000) / 1000 : 0,
    pausedOrFinished: students.filter(
      (student) => student.status === "暂停" || student.status === "结课",
    ).length,
  };
}

/** 一段时间的整体规模（页面顶部一行）。 */
export function rangeSummary(lessons: Lesson[], from: Date, to: Date): {
  lessonCount: number;
  minutes: number;
  studentCount: number;
  teacherCount: number;
  classroomCount: number;
  cancelled: number;
} {
  const inRange = lessons.filter(
    (lesson) => withinRange(lesson.startsAt, from, to),
  );
  const active = inRange.filter((lesson) => lesson.status !== "已取消");

  return {
    lessonCount: active.length,
    minutes: active.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
    studentCount: new Set(active.flatMap((lesson) => lesson.studentIds)).size,
    teacherCount: new Set(active.map((lesson) => lesson.teacherId)).size,
    classroomCount: new Set(active.map((lesson) => lesson.classroomId)).size,
    cancelled: inRange.filter((lesson) => lesson.status === "已取消").length,
  };
}

/** 把分钟数说成人话：`7.5 小时`。 */
export function describeMinutes(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} 小时`;
}

/** 百分比显示：`62%`。 */
export function describeRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
