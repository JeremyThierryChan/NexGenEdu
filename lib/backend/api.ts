import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createSeedDatabase } from "./seed";
import { isWithinAvailability } from "./availability";
import type {
  Classroom,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
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

/**
 * 当前数据结构版本。
 *
 * v1 → v2：教室增加「用途」（上课用教室 / 自习室）与「可用时段」。
 * 改结构时必须同时写迁移，否则别人浏览器里那份旧数据会缺字段，
 * 界面上就会出现 undefined。
 */
const CURRENT_VERSION = 2;

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
 * 返回 null 表示这份数据没法用（版本比当前还新，或结构不认识）——
 * 调用方会重新灌入示例数据，而不是带着缺字段的数据继续跑。
 */
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

  return db.version === CURRENT_VERSION ? db : null;
}

function persist(db: Database): void {
  db.updatedAt = nowIso();
  store.write(STORAGE_KEY, JSON.stringify(db));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    /** 建档时间由服务生成，调用方不用管。 */
    async create(input: NewStudent): Promise<Student> {
      return studentCollection.create({ ...input, createdAt: new Date().toISOString() });
    },
    /**
     * 调整剩余课时（delta 可为负）。
     *
     * 单独成一个方法而不是让页面「读出对象、加一下、整体写回」：
     * 将来接服务端时，扣课时必须是一次服务端原子操作（还要写流水），
     * 页面按这个签名调用就不用改。
     */
    async adjustLessons(id: string, delta: number): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === id);
      if (student === undefined) return null;
      student.remainingLessons = Math.max(0, student.remainingLessons + delta);
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
        return { lesson: null, deducted: [], alreadyCompleted: false };
      }

      const alreadyCompleted = lesson.status === "已上";
      if (!alreadyCompleted) {
        lesson.status = "已上";
        for (const studentId of lesson.studentIds) {
          const student = db.students.find((item) => item.id === studentId);
          if (student !== undefined) {
            student.remainingLessons = Math.max(0, student.remainingLessons - 1);
          }
        }
        persist(db);
      }

      const deducted = lesson.studentIds.map((studentId) => ({
        studentId,
        remainingLessons: db.students.find((item) => item.id === studentId)?.remainingLessons ?? 0,
      }));

      return clone({
        lesson,
        deducted: alreadyCompleted ? [] : deducted,
        alreadyCompleted,
      });
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
        .filter((student) => student.status !== "结课" && student.remainingLessons <= 5)
        .map((student) => ({ student, remainingLessons: student.remainingLessons }))
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
  Classroom,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
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
export { CLASSROOM_KINDS, STUDENT_STATUSES, LESSON_STATUSES } from "./types";
