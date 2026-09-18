import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createSeedDatabase } from "./seed";
import { isWithinAvailability } from "./availability";
import { CURRENT_VERSION } from "./version";
import { enrollmentForLesson, remainingOf, remainingTotal } from "./enrollment";
import type { StudentProfile } from "./student-profile";
import type {
  Assessment,
  Classroom,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
  HomeworkRecord,
  LessonRecord,
  NewAssessment,
  NewHomeworkRecord,
  NewLessonRecord,
  ConflictReport,
  Database,
  Enrollment,
  LessonInput,
  NewEnrollment,
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
} from "./types";

/**
 * 伪后端服务：后台页面的**唯一**数据入口。
 *
 * 设计目标是把「现在没有服务端」这件事挡在这一层里面：
 *
 * - 所有方法都是 `async`，签名与将来的 HTTP 接口一致
 *   （`list` / `get` / `create` / `update` / `remove`），
 *   页面上不会出现「同步读 localStorage」这种将来必须重写的写法；
 * - 数据以一份 JSON 快照存在键值存储里（浏览器里就是 localStorage），
 *   每次写入立即落盘，因此刷新、关掉浏览器再打开都还在；
 * - 将来接真后端时，只替换本文件的实现（改成 fetch 到你的服务），
 *   `types.ts` 的类型与所有页面代码不变。
 *
 * 明确的局限（不是 bug，是「纯前端」的边界）：
 * - 数据在**当前浏览器**里，换设备看不到；清缓存会丢；
 * - 没有并发控制：两个标签页同时写会以最后写入的为准。
 */

const STORAGE_KEY = "nexgenedu.admin.db.v1";

// 版本号与变更记录见 lib/backend/version.ts（seed 与迁移必须用同一个值）

/** 模拟网络延迟，让加载态、按钮禁用等交互在开发时就暴露出来。 */
const LATENCY_MS = 120;

let store: KeyValueStore = createKeyValueStore();
let cache: Database | null = null;

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 生成 id：时间戳 + 随机后缀，够用且不依赖自增（将来换服务端也无缝）。 */
function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 读取整库；首次访问时灌入示例数据。 */
function load(): Database {
  if (cache !== null) return cache;

  const raw = store.read(STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed = migrate(JSON.parse(raw) as Database);
      if (parsed !== null) {
        cache = parsed;
        // 迁移过就立刻落盘，避免每次打开都迁移一遍
        if (parsed.version !== JSON.parse(raw).version) persist(cache);
        return cache;
      }
    } catch {
      // 数据损坏：当作首次访问处理
    }
  }

  cache = createSeedDatabase();
  persist(cache);
  return cache;
}

/**
 * 老数据升级到当前结构版本。
 *
 * **分支必须按版本升序排列、逐级推进**：一次调用要把 v1 一路迁到当前版本。
 * 这里踩过一次坑：把「v3 → v4」的分支写在「v1 → v2」之前，于是 v1 数据
 * 迁到 v3 就停了（v3 分支已经执行过、不会再执行），migrate 返回 null，
 * 调用方直接把数据重新灌成了示例数据 —— 用户看到的是「我的数据没了」。
 *
 * 返回 null 表示这份数据没法用（版本比当前还新，或结构不认识）——
 * 调用方会重新灌入示例数据，而不是带着缺字段的数据继续跑。
 */
/** 是否是 v2 及更早的学生结构（课时挂在学生身上的总数）。 */
function isLegacyStudent(student: Student): boolean {
  const legacy = student as unknown as {
    remainingLessons?: number;
    enrollments?: unknown;
  };
  return (
    typeof legacy.remainingLessons === "number" || !Array.isArray(legacy.enrollments)
  );
}

function migrate(db: Database): Database | null {
  if (db.version > CURRENT_VERSION) return null;

  if (db.version === 1) {
    // v1 的教室只有 name / capacity / note
    db.classrooms = db.classrooms.map((room) => ({
      ...room,
      kind: room.kind ?? "上课用教室",
      availability: room.availability ?? [],
    }));
    db.version = 2;
  }

  /*
   * v2 → v3 只在**确实是旧结构**时执行：判据是「有 remainingLessons 字段」
   * 或「没有 enrollments 数组」。只比较版本号是不够的 —— 曾因为 seed 写错版本
   * 让新数据被当成旧数据迁移，把报课记录压成了一条。数据迁移宁可少做不可做错。
   */
  if (db.version === 2 && db.students.some(isLegacyStudent)) {
    /*
     * v2 的学生是 { subjects, remainingLessons }；v3 改为档案 + 按科目记账。
     * 折算规则：剩余课时变成一条「未指定科目」的报课记录（total = 剩余、used = 0），
     * 科目沿用原来的 subjects 列表 —— 一条总数无法拆成多科，因此不猜，
     * 让管理员在界面上按实际情况调整到具体科目。
     */
    db.students = db.students.map((legacy) => {
      // 已经是新结构的（理论上不该出现）原样返回，避免无谓改写
      if (!isLegacyStudent(legacy)) return legacy;

      const student = legacy as Student & {
        remainingLessons?: number;
        subjects?: string[];
      };
      const remaining = Math.max(0, Math.trunc(student.remainingLessons ?? 0));
      const subjects = student.subjects ?? [];

      const enrollments: Enrollment[] =
        remaining > 0 || subjects.length > 0
          ? [
              {
                id: `e_legacy_${student.id}`,
                subject: subjects.length === 1 ? (subjects[0] ?? "") : "未指定科目",
                form: "",
                teacherId: "",
                totalLessons: remaining,
                usedLessons: 0,
                startedAt: student.createdAt,
                endedAt: "",
                status: "在读",
                note: "由旧版「剩余课时」折算，请按实际情况调整科目与课时",
                history: [
                  {
                    at: nowIso(),
                    kind: "报课",
                    lessons: remaining,
                    note: "旧数据折算",
                  },
                ],
              },
            ]
          : [];

      // 旧的 remainingLessons 字段被报课记录取代，这里显式丢掉（不留在数据里）
      const { remainingLessons: _legacyLessons, ...rest } = student;
      void _legacyLessons;
      return {
        ...rest,
        profile: student.profile ?? {},
        enrollments,
        subjects: subjects.length > 0 ? subjects : enrollments.map((item) => item.subject),
      } as Student;
    });
    db.version = 3;
  }

  if (db.version === 3) {
    // v3 → v4：新增动态追踪三张表（课堂记录 / 作业记录 / 阶段测评）
    db.lessonRecords = db.lessonRecords ?? [];
    db.homeworkRecords = db.homeworkRecords ?? [];
    db.assessments = db.assessments ?? [];
    db.version = 4;
  }

  return db.version === CURRENT_VERSION ? db : null;
}

function persist(db: Database): void {
  db.updatedAt = nowIso();
  store.write(STORAGE_KEY, JSON.stringify(db));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 把学生的「报读科目」同步为在读报课的科目。
 *
 * subjects 是给人看的摘要（列表标签、搜索），因此不单独维护、只由报课推导，
 * 避免出现「退了课但科目列表还挂着」。
 */
function syncSubjects(student: Student): void {
  const subjects: string[] = [];
  for (const enrollment of student.enrollments) {
    if (enrollment.status !== "在读") continue;
    if (enrollment.subject.trim() !== "" && !subjects.includes(enrollment.subject)) {
      subjects.push(enrollment.subject);
    }
  }
  student.subjects = subjects;
}

/** 通用集合：把「取数组 → 改 → 存」的重复代码收在一处。 */
function collection<T extends { id: string }>(
  pick: (db: Database) => T[],
  prefix: string,
) {
  return {
    async list(): Promise<T[]> {
      await delay();
      return clone(pick(load()));
    },
    async get(id: string): Promise<T | null> {
      await delay();
      return clone(pick(load()).find((item) => item.id === id) ?? null);
    },
    async create(input: Omit<T, "id">): Promise<T> {
      await delay();
      const db = load();
      const created = { ...input, id: nextId(prefix) } as T;
      pick(db).push(created);
      persist(db);
      return clone(created);
    },
    async update(id: string, patch: Partial<Omit<T, "id">>): Promise<T | null> {
      await delay();
      const db = load();
      const list = pick(db);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const updated = { ...list[index], ...patch } as T;
      list[index] = updated;
      persist(db);
      return clone(updated);
    },
    async remove(id: string): Promise<boolean> {
      await delay();
      const db = load();
      const list = pick(db);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return false;
      list.splice(index, 1);
      persist(db);
      return true;
    },
  };
}

/** 日期键：YYYY-MM-DD（本地时区），用于按天分组。 */
export function dateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const studentCollection = collection<Student>((db) => db.students, "s");

export const api = {
  students: {
    ...studentCollection,
    /** 建档时间由服务生成；新建时不带报课记录（报课走 enroll()）。 */
    async create(input: NewStudent): Promise<Student> {
      const { subjects, ...rest } = input;
      return studentCollection.create({
        ...rest,
        subjects: subjects ?? [],
        profile: input.profile ?? {},
        enrollments: [],
        createdAt: new Date().toISOString(),
      });
    },
    /**
     * 报课：新开一条报课记录。
     *
     * 同科目同班型的在读记录不会被合并 —— 合并会掩盖「报了两次」的事实，
     * 续费请用 renewEnrollment()，那条会累加课时并留下流水。
     */
    async enroll(studentId: string, input: NewEnrollment): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      if (student === undefined) return null;

      const lessons = Math.max(0, Math.trunc(input.lessons));
      student.enrollments.push({
        id: nextId("e"),
        subject: input.subject.trim(),
        form: input.form.trim(),
        teacherId: input.teacherId,
        totalLessons: lessons,
        usedLessons: 0,
        startedAt: input.startedAt !== "" ? input.startedAt : nowIso(),
        endedAt: "",
        status: "在读",
        note: input.note.trim(),
        history: [{ at: nowIso(), kind: "报课", lessons, note: input.note.trim() }],
      });

      syncSubjects(student);
      persist(db);
      return clone(student);
    },

    /** 续费：给某条报课累加课时，并留下流水。 */
    async renewEnrollment(
      studentId: string,
      enrollmentId: string,
      lessons: number,
      note = "",
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;
      if (enrollment.status !== "在读") return clone(student);

      const added = Math.max(0, Math.trunc(lessons));
      enrollment.totalLessons += added;
      enrollment.history.push({ at: nowIso(), kind: "续费", lessons: added, note: note.trim() });

      syncSubjects(student);
      persist(db);
      return clone(student);
    },

    /**
     * 退课：把报课记录置为已退课并记下日期。
     *
     * 采用「标记退课」而不是删除记录：剩余课时与历史必须留痕，
     * 否则以后对账时说不清「这些课时去哪了」。
     */
    async refundEnrollment(
      studentId: string,
      enrollmentId: string,
      note = "",
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;

      enrollment.status = "已退课";
      enrollment.endedAt = nowIso();
      enrollment.history.push({
        at: nowIso(),
        kind: "退课",
        lessons: 0,
        note: note.trim(),
      });

      syncSubjects(student);
      persist(db);
      return clone(student);
    },

    /** 直接改一条报课的课时（补录 / 纠错用），同样留流水。 */
    async adjustEnrollmentLessons(
      studentId: string,
      enrollmentId: string,
      delta: number,
      note = "",
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;

      enrollment.totalLessons = Math.max(0, enrollment.totalLessons + Math.trunc(delta));
      enrollment.history.push({
        at: nowIso(),
        kind: "续费",
        lessons: Math.trunc(delta),
        note: note.trim() === "" ? "手工调整" : note.trim(),
      });

      syncSubjects(student);
      persist(db);
      return clone(student);
    },

    /** 保存信息采集表（整份覆盖；调用方传完整对象）。 */
    async saveProfile(
      id: string,
      profile: StudentProfile,
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === id);
      if (student === undefined) return null;
      student.profile = profile;
      persist(db);
      return clone(student);
    },

    async search(keyword: string): Promise<Student[]> {
      await delay();
      const text = keyword.trim().toLowerCase();
      if (text === "") return clone(load().students);
      return clone(
        load().students.filter((student) =>
          [student.name, student.grade, student.guardian, ...student.subjects]
            .join(" ")
            .toLowerCase()
            .includes(text),
        ),
      );
    },
  },

  teachers: {
    ...collection<Teacher>((db) => db.teachers, "t"),
    /** 在职教师，排课下拉用。 */
    async listActive(): Promise<Teacher[]> {
      await delay();
      return clone(load().teachers.filter((teacher) => teacher.active));
    },
  },

  classrooms: collection<Classroom>((db) => db.classrooms, "c"),

  /**
   * 课堂记录。
   *
   * 保存用 upsert 而不是 create：一节课一个学生只有一条记录，
   * 老师改完再保存不应该多出一条（这是最容易被写成「每次保存都新增」的地方）。
   */
  lessonRecords: {
    ...collection<LessonRecord>((db) => db.lessonRecords, "lr"),
    listByLesson: async (lessonId: string): Promise<LessonRecord[]> => {
      await delay();
      return clone(load().lessonRecords.filter((item) => item.lessonId === lessonId));
    },
    listByStudent: async (studentId: string): Promise<LessonRecord[]> => {
      await delay();
      return clone(
        load()
          .lessonRecords.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      );
    },
    /** 按「课节 + 学生」写入；已存在则更新。 */
    async save(input: NewLessonRecord): Promise<LessonRecord> {
      await delay();
      const db = load();
      const existing = db.lessonRecords.find(
        (item) => item.lessonId === input.lessonId && item.studentId === input.studentId,
      );

      if (existing !== undefined) {
        Object.assign(existing, input, { recordedAt: nowIso() });
        persist(db);
        return clone(existing);
      }

      const created: LessonRecord = { ...input, id: nextId("lr"), recordedAt: nowIso() };
      db.lessonRecords.push(created);
      persist(db);
      return clone(created);
    },
  },

  /** 作业记录（按次）。 */
  homework: {
    ...collection<HomeworkRecord>((db) => db.homeworkRecords, "hw"),
    listByStudent: async (studentId: string): Promise<HomeworkRecord[]> => {
      await delay();
      return clone(
        load()
          .homeworkRecords.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    },
  },

  /**
   * 阶段测评。
   *
   * create 时自动带出同科目上一次的分数作为 previousScore ——
   * 「趋势」是这条记录的核心信息，让页面自己去找上一条容易算错，
   * 也让「补录旧数据」时前后顺序对不上。
   */
  assessments: {
    ...collection<Assessment>((db) => db.assessments, "as"),
    listByStudent: async (studentId: string): Promise<Assessment[]> => {
      await delay();
      return clone(
        load()
          .assessments.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    },
    async add(input: NewAssessment): Promise<Assessment> {
      await delay();
      const db = load();
      const previous = db.assessments
        .filter((item) => item.studentId === input.studentId && item.subject === input.subject)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);

      const created: Assessment = {
        ...input,
        id: nextId("as"),
        previousScore: previous?.score ?? null,
      };
      db.assessments.push(created);
      persist(db);
      return clone(created);
    },
  },

  lessons: {
    ...collection<Lesson>((db) => db.lessons, "l"),

    /**
     * 冲突检查：同一教师 / 同一教室 / 同一学生在时间上重叠。
     *
     * 刻意做成**独立查询**而不是塞进 create：页面需要在保存前就能提示
     * 「和哪节课冲突」，而不是提交后才被拒绝。注意真实服务端也必须
     * 再校验一次 —— 客户端检查只是体验，不是保证。
     */
    async findConflicts(input: LessonInput): Promise<ConflictReport> {
      await delay();
      const db = load();

      const start = new Date(input.startsAt).getTime();
      const end = start + input.durationMinutes * 60_000;
      const overlaps = (lesson: Lesson) => {
        // 编辑自己时不算冲突；已取消的课不占用时间
        if (lesson.id === input.id || lesson.status === "已取消") return false;
        const otherStart = new Date(lesson.startsAt).getTime();
        const otherEnd = otherStart + lesson.durationMinutes * 60_000;
        // 相邻不算冲突（结束等于开始）
        return start < otherEnd && otherStart < end;
      };

      const clashing = db.lessons.filter(overlaps);
      const teacher = clashing.filter((lesson) => lesson.teacherId === input.teacherId);
      const classroom = clashing.filter((lesson) => lesson.classroomId === input.classroomId);
      const students = clashing.flatMap((lesson) =>
        lesson.studentIds
          .filter((id) => input.studentIds.includes(id))
          .map((studentId) => ({ studentId, lesson })),
      );

      // 同一节课既撞教师又撞教室时，students 里可能出现重复，这里去重
      const uniqueStudents = [
        ...new Map(students.map((item) => [`${item.studentId}-${item.lesson.id}`, item])).values(),
      ];

      // 教室在该时段是否开放：没设可用时段的教室视为不限，永远为 false
      const room = db.classrooms.find((item) => item.id === input.classroomId);
      const classroomClosed =
        room !== undefined &&
        !isWithinAvailability(room.availability, new Date(input.startsAt), input.durationMinutes);

      return clone({
        teacher,
        classroom,
        students: uniqueStudents,
        classroomClosed,
        total:
          teacher.length + classroom.length + uniqueStudents.length + (classroomClosed ? 1 : 0),
      });
    },

    /**
     * 标记为「已上」并按课时扣减。
     *
     * 幂等：已经是「已上」的课再点一次不会重复扣课时 —— 这是最容易出错的地方，
     * 自检里专门有一条断言守住它。
     */
    async markCompleted(id: string): Promise<CompletionResult> {
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === id);
      if (lesson === undefined) {
        return { lesson: null, deducted: [], skipped: [], alreadyCompleted: false };
      }

      const alreadyCompleted = lesson.status === "已上";
      const deducted: CompletionResult["deducted"] = [];
      const skipped: CompletionResult["skipped"] = [];

      if (!alreadyCompleted) {
        lesson.status = "已上";

        for (const studentId of lesson.studentIds) {
          const student = db.students.find((item) => item.id === studentId);
          if (student === undefined) {
            skipped.push({ studentId, reason: "学生档案不存在" });
            continue;
          }

          // 扣哪一条报课：按这节课的科目匹配（见 lib/backend/enrollment.ts）
          const enrollment = enrollmentForLesson(student.enrollments, lesson.subject);
          if (enrollment === null) {
            skipped.push({
              studentId,
              reason: `没有「${lesson.subject}」的在读报课记录，未扣课时`,
            });
            continue;
          }

          enrollment.usedLessons += 1;
          deducted.push({
            studentId,
            subject: enrollment.subject,
            remainingLessons: remainingOf(enrollment),
          });
        }

        persist(db);
      }

      return clone({ lesson, deducted, skipped, alreadyCompleted });
    },
    /** 某一天的课，按开始时间升序。 */
    async listByDate(date: Date): Promise<Lesson[]> {
      await delay();
      const key = dateKey(date);
      return clone(
        load()
          .lessons.filter((lesson) => dateKey(lesson.startsAt) === key)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个学生的课，按时间升序（学生详情用）。 */
    async listByStudent(studentId: string): Promise<Lesson[]> {
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.studentIds.includes(studentId))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个教师的课，按时间升序（教师详情用）。 */
    async listByTeacher(teacherId: string): Promise<Lesson[]> {
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.teacherId === teacherId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个教室的课，按时间升序（教室占用用）。 */
    async listByClassroom(classroomId: string): Promise<Lesson[]> {
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.classroomId === classroomId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 一段区间内的课（含首尾两天）。 */
    async listBetween(from: Date, to: Date): Promise<Lesson[]> {
      await delay();
      const fromKey = dateKey(from);
      const toKey = dateKey(to);
      return clone(
        load()
          .lessons.filter((lesson) => {
            const key = dateKey(lesson.startsAt);
            return key >= fromKey && key <= toKey;
          })
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
  },

  /** 今日概览的汇总。 */
  async today(now: Date = new Date()): Promise<TodaySummary> {
    await delay();
    const db = load();
    const key = dateKey(now);
    const todays = db.lessons.filter((lesson) => dateKey(lesson.startsAt) === key);

    const classroomUsage = db.classrooms.map((classroom) => ({
      classroom,
      lessonCount: todays.filter((lesson) => lesson.classroomId === classroom.id).length,
    }));

    return clone({
      date: key,
      lessonCount: todays.length,
      teacherCount: new Set(todays.map((lesson) => lesson.teacherId)).size,
      totalMinutes: todays.reduce((total, lesson) => total + lesson.durationMinutes, 0),
      classroomUsage,
      lowLessonStudents: db.students
        .filter((student) => student.status !== "结课")
        .map((student) => ({ student, remainingLessons: remainingTotal(student.enrollments) }))
        // 没有任何在读报课的学生也算「需要跟进」，否则会从预警里消失
        .filter((item) => item.remainingLessons <= 5)
        .sort((a, b) => a.remainingLessons - b.remainingLessons),
      studentCount: db.students.length,
      activeTeacherCount: db.teachers.filter((teacher) => teacher.active).length,
    });
  },

  /** 清空并重新灌入示例数据（开发与演示用）。 */
  async reset(): Promise<void> {
    await delay();
    cache = createSeedDatabase();
    persist(cache);
  },
};

/**
 * 仅供自检使用：把服务切到指定的存储实现（Node 里用内存存储）。
 * 页面代码不应调用它。
 */
export function __useStoreForTesting(backing: KeyValueStore): void {
  store = backing;
  cache = null;
}

// 重新导出，便于页面只 import 这一处
export type {
  Assessment,
  Classroom,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
  HomeworkRecord,
  LessonRecord,
  NewAssessment,
  NewHomeworkRecord,
  NewLessonRecord,
  Enrollment,
  NewEnrollment,
  ConflictReport,
  Database,
  LessonInput,
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
};
export {
  ATTENDANCE_OPTIONS,
  CLASSROOM_KINDS,
  ENROLLMENT_STATUSES,
  FOCUS_OPTIONS,
  INTERACTION_OPTIONS,
  LESSON_STATUSES,
  STUDENT_STATUSES,
  SUBMISSION_OPTIONS,
} from "./types";
