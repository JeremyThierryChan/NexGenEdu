import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createSeedDatabase } from "./seed";
import type {
  Classroom,
  Database,
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
      const parsed = JSON.parse(raw) as Database;
      // 结构版本不一致时先不做迁移（当前只有 v1），直接重新灌入并保留提示
      if (parsed.version === 1) {
        cache = parsed;
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
  Database,
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
};
export { STUDENT_STATUSES, LESSON_STATUSES } from "./types";
