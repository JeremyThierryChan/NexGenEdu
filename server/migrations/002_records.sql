-- 002_records.sql —— 补上动态追踪与账本（列名照着备份里的真实记录字段写）。
--
-- 两张账本表（transactions / the payments 已在 001）都**只追加**：
-- 撤销用 reversed_at 标记，而不是删除那一行 —— 这是伪后端阶段就定的不变式。

CREATE TABLE IF NOT EXISTS lesson_records (
  id                TEXT PRIMARY KEY,
  lesson_id         TEXT NOT NULL,
  student_id        TEXT NOT NULL,
  attendance        TEXT NOT NULL DEFAULT '',
  leave_requested_at TEXT NOT NULL DEFAULT '',
  focus             TEXT NOT NULL DEFAULT '',
  interaction       TEXT NOT NULL DEFAULT '',
  rating            INTEGER NOT NULL DEFAULT 0,
  note              TEXT NOT NULL DEFAULT '',
  recorded_at       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lesson_records_lesson ON lesson_records (lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_records_student ON lesson_records (student_id, recorded_at);

CREATE TABLE IF NOT EXISTS homework_records (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  date       TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  submission TEXT NOT NULL DEFAULT '',
  accuracy   TEXT NOT NULL DEFAULT '',
  weak_points TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_homework_student ON homework_records (student_id, date);

CREATE TABLE IF NOT EXISTS assessments (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  date            TEXT NOT NULL DEFAULT '',
  score           REAL,
  previous_score  REAL,
  weak_points     TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_assessments_student ON assessments (student_id, date);

-- 课时流水（账本）：正数=加课时，负数=上课扣课时；reversed_at 非空表示已撤销
CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL,
  enrollment_id TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  delta         INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT '',
  lesson_id     TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  reversed_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_transactions_student ON transactions (student_id, at);

CREATE TABLE IF NOT EXISTS inquiries (
  id                     TEXT PRIMARY KEY,
  student_name           TEXT NOT NULL DEFAULT '',
  grade                  TEXT NOT NULL DEFAULT '',
  guardian               TEXT NOT NULL DEFAULT '',
  subject                TEXT NOT NULL DEFAULT '',
  duration_minutes       INTEGER NOT NULL DEFAULT 60,
  interval_weeks         INTEGER NOT NULL DEFAULT 1,
  planned_lessons        INTEGER NOT NULL DEFAULT 0,
  starts_at              TEXT NOT NULL DEFAULT '',
  candidates             TEXT NOT NULL DEFAULT '[]',
  preferred_teacher_id   TEXT NOT NULL DEFAULT '',
  preferred_classroom_id TEXT NOT NULL DEFAULT '',
  skip_dates             TEXT NOT NULL DEFAULT '[]',
  status                 TEXT NOT NULL DEFAULT '待确认',
  note                   TEXT NOT NULL DEFAULT '',
  scheduled_lesson_ids   TEXT NOT NULL DEFAULT '[]',
  created_at             TEXT NOT NULL DEFAULT ''
);
