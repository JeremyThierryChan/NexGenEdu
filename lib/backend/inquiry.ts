import type { Classroom, Inquiry, InquirySlot, Lesson, Teacher } from "./types";
import { isWithinAvailability } from "./availability";
import { dateKey } from "./format";

/**
 * 咨询可行性：家长说「每周六上午十点，指定陈老师」——这安排能不能接？
 *
 * ## 为什么单独成文件、而且全是纯函数
 *
 * 这是「当场要给家长答复」的功能：答错了要么白答应（事后排不出课），
 * 要么白白推掉一个学生。因此判定必须是可测的纯函数，而不是散在页面里的 if。
 *
 * ## 判定的三条要点
 *
 * 1. **检查的是一串日期，不是一天**：每周一次 × 12 节 = 未来 12 个同一时段
 *    都得空着。只看第一次是这个功能最容易犯的错；
 * 2. **候选时段是「备选」而不是「全要」**：家长给了两个时段，是「哪个都行」，
 *    因此依次尝试、第一个能排下的就用它；
 * 3. **不可行要说清「挡路的是谁」**：不只是「不行」，而是「9月20日 17:30
 *    陈老师在上另一节课（学生：张小明）」—— 因为接着要决定是让新学生换时段、
 *    还是去协调那位已有学生。
 */

export type SlotBlockerKind =
  | "教师忙"
  | "教室满"
  | "教室不开放"
  | "无人能带该科目"
  | "没有可用场地";

export type SlotBlocker = {
  kind: SlotBlockerKind;
  /** 冲突发生的日期 `YYYY-MM-DD`。 */
  date: string;
  /** 挡住的那节课（教室满 / 教师忙时给出）。 */
  lessonId: string;
  teacherId: string;
  classroomId: string;
  /** 受影响的已有学生 —— 界面必须先显示再让管理员决定动不动它。 */
  studentIds: string[];
  /** 一句可读的说明。 */
  detail: string;
};

export type SlotAssignment = {
  teacherId: string;
  classroomId: string;
};

export type NearestAlternative = {
  /** 改了什么（给管理员判断代价用）。 */
  change: string;
  /** 新的时段与安排。 */
  slot: InquirySlot;
  assignment: SlotAssignment;
};

export type SlotFeasibility = {
  slotId: string;
  /** 「周六 10:00」这类标签。 */
  label: string;
  ok: boolean;
  /** 排下来的具体日期（前几次，界面上让人看到「排在哪几天」）。 */
  dates: string[];
  assignment: SlotAssignment | null;
  blockers: SlotBlocker[];
  /** 不可行时按「改动最小」排序的替代方案。 */
  alternatives: NearestAlternative[];
};

export type FeasibilityReport = {
  inquiryId: string;
  /** 依次尝试候选时段的结果（顺序即优先级）。 */
  slots: SlotFeasibility[];
  /** 第一个可行的候选（可能为空：都不行）。 */
  recommendedSlotId: string;
};

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? `周${weekday}`;
}

export function slotLabel(slot: InquirySlot): string {
  return `${weekdayLabel(slot.weekday)} ${slot.start}`;
}

export function slotMinutes(slot: InquirySlot): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(slot.start.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${`${hours}`.padStart(2, "0")}:${`${normalized % 60}`.padStart(2, "0")}`;
}

function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * 生成要占用的日期串。
 *
 * 规则：从 `startsAt` 起找**第一个匹配该星期几**的日期，然后每 `intervalWeeks`
 * 周一次，跳过 `skipDates` 里的日期，直到凑够 `plannedLessons` 个。
 *
 * 跳过发生在生成之后（而不是减少总节数）：家长说「报 12 节」，假期那一周不上、
 * 往后顺延，总节数不变 —— 这与线下机构的实际做法一致。
 */
export function buildDateSeries(input: {
  startsAt: string;
  weekday: number;
  intervalWeeks: number;
  plannedLessons: number;
  skipDates: string[];
  /** 防止死循环（例如星期几填错导致永远凑不够）。 */
  maxWeeks?: number;
}): Date[] {
  const interval = Math.max(1, Math.trunc(input.intervalWeeks));
  const total = Math.max(1, Math.trunc(input.plannedLessons));
  const skip = new Set(input.skipDates);
  const maxWeeks = input.maxWeeks ?? total * interval + 52;

  const start = new Date(input.startsAt);
  const first = new Date(start);
  // 首个不早于 startsAt 的、匹配该星期几的日期
  while (isoWeekday(first) !== input.weekday) {
    first.setDate(first.getDate() + 1);
  }

  const dates: Date[] = [];
  const cursor = new Date(first);
  let weeks = 0;

  while (dates.length < total && weeks < maxWeeks) {
    const key = dateKey(cursor);
    if (!skip.has(key)) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + interval * 7);
    weeks += 1;
  }

  return dates;
}

/** 在某天的这个时段里，是否与给定的课重叠（给定的课由调用方按教师或场地筛好）。 */
function findOverlap(
  lessons: Lesson[],
  date: Date,
  startMinutes: number,
  durationMinutes: number,
): Lesson | null {
  const key = dateKey(date);
  const end = startMinutes + durationMinutes;

  for (const lesson of lessons) {
    if (lesson.status === "已取消") continue;
    if (dateKey(lesson.startsAt) !== key) continue;

    const lessonStart = new Date(lesson.startsAt);
    const otherStart = lessonStart.getHours() * 60 + lessonStart.getMinutes();
    const otherEnd = otherStart + lesson.durationMinutes;
    // 相邻不算冲突：前一场结束正好等于后一场开始是常见排法
    if (startMinutes < otherEnd && otherStart < end) return lesson;
  }

  return null;
}

/** 谁能带这个科目（科目名出现在教师可带科目里；规则与前台一致）。 */
export function teachersForSubject(teachers: Teacher[], subject: string): Teacher[] {
  return teachers.filter(
    (teacher) =>
      teacher.active &&
      (teacher.subjects.length === 0 ||
        teacher.subjects.some((item) => item !== "" && subject.includes(item))),
  );
}

/**
 * 检查某个「时段 + 场地」在整串日期上是否可行。
 *
 * `blockingLessons` 由调用方**按教师或场地筛好**传进来 —— 这个函数只做时间层面的
 * 重叠判断，不关心是「人忙」还是「屋满」，因此同一个函数服务两种检查。
 *
 * 只报**第一次冲突**：一次列出 12 个同样的冲突没有意义，
 * 而且真正要处理的是「挡住的那节课」。
 */
export function checkAssignment(input: {
  dates: Date[];
  slot: InquirySlot;
  durationMinutes: number;
  blockingLessons: Lesson[];
  /** 传了场地就额外检查「该场地此时段是否开放」。 */
  classroom?: Classroom;
}): SlotBlocker[] {
  const startMinutes = slotMinutes(input.slot);
  if (startMinutes === null) {
    return [
      {
        kind: "教师忙",
        date: "",
        lessonId: "",
        teacherId: "",
        classroomId: "",
        studentIds: [],
        detail: `时间「${input.slot.start}」格式不对，应为 HH:MM`,
      },
    ];
  }

  const { slot, durationMinutes } = input;

  for (const date of input.dates) {
    const teacherClash = findOverlap(input.blockingLessons, date, startMinutes, durationMinutes);
    if (teacherClash !== null) {
      return [
        {
          kind: "教师忙",
          date: dateKey(date),
          lessonId: teacherClash.id,
          teacherId: teacherClash.teacherId,
          classroomId: teacherClash.classroomId,
          studentIds: teacherClash.studentIds,
          detail: `${dateKey(date)} 这个时间已有课：${teacherClash.subject}`,
        },
      ];
    }

    if (input.classroom !== undefined) {
      const roomClash = findOverlap(input.blockingLessons, date, startMinutes, durationMinutes);
      if (roomClash !== null) {
        return [
          {
            kind: "教室满",
            date: dateKey(date),
            lessonId: roomClash.id,
            teacherId: roomClash.teacherId,
            classroomId: roomClash.classroomId,
            studentIds: roomClash.studentIds,
            detail: `${dateKey(date)} ${input.classroom.name} 已被占用：${roomClash.subject}`,
          },
        ];
      }

      // 教室在该星期几、该时段必须开放
      const day = date;
      if (
        !isWithinAvailability(
          input.classroom.availability,
          new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            Math.floor(startMinutes / 60),
            startMinutes % 60,
          ),
          durationMinutes,
        )
      ) {
        return [
          {
            kind: "教室不开放",
            date: dateKey(date),
            lessonId: "",
            teacherId: "",
            classroomId: input.classroom.id,
            studentIds: [],
            detail: `${input.classroom.name} 在 ${weekdayLabel(slot.weekday)} ${slot.start} 不开放`,
          },
        ];
      }
    }
  }

  return [];
}

/** 评估一个候选时段的可行性（含最接近方案）。 */
export function evaluateSlot(input: {
  inquiry: Inquiry;
  slot: InquirySlot;
  teachers: Teacher[];
  classrooms: Classroom[];
  lessons: Lesson[];
  /** 教师当周课时量（用于「不限教师」时推荐最闲的）。 */
  load: Map<string, number>;
  /** 替代方案最多给几条。 */
  maxAlternatives?: number;
}): SlotFeasibility {
  const { inquiry, slot, teachers, classrooms, lessons } = input;
  const dates = buildDateSeries({
    startsAt: inquiry.startsAt,
    weekday: slot.weekday,
    intervalWeeks: inquiry.intervalWeeks,
    plannedLessons: inquiry.plannedLessons,
    skipDates: inquiry.skipDates,
  });
  const datePreview = dates.slice(0, 4).map((date) => dateKey(date));

  // 谁能带这门课：指定教师就只试他；不限则按当周课时量从少到多排
  const capable = teachersForSubject(teachers, inquiry.subject);
  const teacherPool =
    inquiry.preferredTeacherId !== ""
      ? teachers.filter((teacher) => teacher.id === inquiry.preferredTeacherId)
      : [...capable].sort(
          (a, b) => (input.load.get(a.id) ?? 0) - (input.load.get(b.id) ?? 0),
        );

  if (teacherPool.length === 0) {
    return {
      slotId: slot.id,
      label: slotLabel(slot),
      ok: false,
      dates: datePreview,
      assignment: null,
      blockers: [
        {
          kind: "无人能带该科目",
          date: "",
          lessonId: "",
          teacherId: inquiry.preferredTeacherId,
          classroomId: "",
          studentIds: [],
          detail:
            inquiry.preferredTeacherId !== ""
              ? "指定的教师档案不存在或不在职"
              : `没有登记能带「${inquiry.subject}」的教师，可到教师页补上科目`,
        },
      ],
      alternatives: [],
    };
  }

  // 场地池：指定就只试它；不限则按容量从小到大（别占大教室）
  const roomPool =
    inquiry.preferredClassroomId !== ""
      ? classrooms.filter((room) => room.id === inquiry.preferredClassroomId)
      : [...classrooms].sort((a, b) => a.capacity - b.capacity);

  // 依次试「教师 × 场地」，第一个整串日期都可行的就用
  let blockers: SlotBlocker[] = [];
  for (const teacher of teacherPool) {
    for (const room of roomPool) {
      const roomBlockers = checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: lessons.filter((lesson) => lesson.teacherId === teacher.id),
      });
      if (roomBlockers.length > 0) {
        blockers = blockers.length === 0 ? roomBlockers : blockers;
        continue;
      }

      const clashBlockers = checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: lessons.filter((lesson) => lesson.classroomId === room.id),
        classroom: room,
      });
      if (clashBlockers.length === 0) {
        return {
          slotId: slot.id,
          label: slotLabel(slot),
          ok: true,
          dates: datePreview,
          assignment: { teacherId: teacher.id, classroomId: room.id },
          blockers: [],
          alternatives: [],
        };
      }
      if (blockers.length === 0) blockers = clashBlockers;
    }
  }

  // 不可行：给出「改动最小」的替代方案
  const alternatives = buildAlternatives({
    inquiry,
    baseSlot: slot,
    teachers: capable,
    classrooms,
    lessons,
    load: input.load,
    max: input.maxAlternatives ?? 4,
  });

  return {
    slotId: slot.id,
    label: slotLabel(slot),
    ok: false,
    dates: datePreview,
    assignment: null,
    blockers,
    alternatives,
  };
}

/**
 * 最接近的方案，按「改动最小」排序：
 *   1. 同一天其他时段（只改时间）
 *   2. 同一时段换老师（只改人）
 *   3. 相邻日同一时段（只改日期）
 *   4. 换教室（只改场地）
 *
 * 每条都用同一个 checkAssignment 复核，因此给出来的方案一定是真能排的。
 */
export function buildAlternatives(input: {
  inquiry: Inquiry;
  baseSlot: InquirySlot;
  teachers: Teacher[];
  classrooms: Classroom[];
  lessons: Lesson[];
  load: Map<string, number>;
  max: number;
}): NearestAlternative[] {
  const { inquiry, baseSlot } = input;
  const baseMinutes = slotMinutes(baseSlot);
  if (baseMinutes === null) return [];

  const results: NearestAlternative[] = [];
  const seen = new Set<string>();

  const tryCandidate = (
    slot: InquirySlot,
    assignment: SlotAssignment,
    change: string,
  ): boolean => {
    const key = `${slot.weekday}-${slot.start}-${assignment.teacherId}-${assignment.classroomId}`;
    if (seen.has(key)) return false;
    seen.add(key);

    const dates = buildDateSeries({
      startsAt: inquiry.startsAt,
      weekday: slot.weekday,
      intervalWeeks: inquiry.intervalWeeks,
      plannedLessons: inquiry.plannedLessons,
      skipDates: inquiry.skipDates,
    });

    const teacher = input.teachers.find((item) => item.id === assignment.teacherId);
    const room = input.classrooms.find((item) => item.id === assignment.classroomId);
    if (teacher === undefined || room === undefined) return false;

    if (
      checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: input.lessons.filter((lesson) => lesson.teacherId === teacher.id),
      }).length > 0
    ) {
      return false;
    }
    if (
      checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: input.lessons.filter((lesson) => lesson.classroomId === room.id),
        classroom: room,
      }).length > 0
    ) {
      return false;
    }

    results.push({ change, slot, assignment });
    return results.length >= input.max;
  };

  /** 依次试教师 × 场地，第一个可行的就采用（前几个方案都是「同一时段」的变体）。 */
  const tryAt = (slot: InquirySlot, change: string): boolean => {
    const rooms =
      inquiry.preferredClassroomId !== ""
        ? input.classrooms.filter((room) => room.id === inquiry.preferredClassroomId)
        : [...input.classrooms].sort((a, b) => a.capacity - b.capacity);
    const teachers =
      inquiry.preferredTeacherId !== ""
        ? input.teachers.filter((teacher) => teacher.id === inquiry.preferredTeacherId)
        : [...input.teachers].sort(
            (a, b) => (input.load.get(a.id) ?? 0) - (input.load.get(b.id) ?? 0),
          );

    for (const teacher of teachers) {
      for (const room of rooms) {
        if (tryCandidate(slot, { teacherId: teacher.id, classroomId: room.id }, change)) {
          return true;
        }
      }
    }
    return false;
  };

  // 1) 同一天：前后各试几个时间（30 分钟为步长，最多前后各 2 小时）
  for (const delta of [60, -60, 30, -30, 120, -120]) {
    const shifted = baseMinutes + delta;
    if (shifted < 0 || shifted + inquiry.durationMinutes > 24 * 60) continue;
    const slot: InquirySlot = { ...baseSlot, id: `${baseSlot.id}_t${delta}`, start: minutesToTime(shifted) };
    if (tryAt(slot, `改时间到 ${weekdayLabel(slot.weekday)} ${slot.start}（原 ${baseSlot.start}）`)) break;
  }

  // 2) 相邻日同一时段（前一天、后一天）
  for (const step of [1, -1, 2, -2]) {
    const weekday = ((baseSlot.weekday - 1 + step + 7) % 7) + 1;
    const slot: InquirySlot = { ...baseSlot, id: `${baseSlot.id}_d${step}`, weekday };
    if (tryAt(slot, `改到 ${weekdayLabel(weekday)} ${baseSlot.start}`)) break;
  }

  // 3) 同一时段换老师（指定了教师时才有意义）
  if (inquiry.preferredTeacherId !== "") {
    const slot: InquirySlot = { ...baseSlot, id: `${baseSlot.id}_other` };
    tryAt(slot, "换老师（不指定教师）");
  }

  return results;
}
