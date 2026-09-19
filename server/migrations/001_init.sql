-- 001_init.sql —— 骨架阶段的核心表。
--
-- 约定：
--   * 嵌套结构先按 JSON 文本存（报课记录 enrollments、采集表 profile、教室时段 availability、
--     课程班型 forms、咨询候选时段 candidates …）：它们要么是键值对字段表，要么是整体读写的小结构，
--     拆表收益低。等真要按课时流水跨学生统计时再把 enrollments 独立成表。
--   * 课时与金额**只追加不删**（transactions / payments 用 reversed_at 标记撤销），
--     这是伪后端阶段就定下的不变式，数据库层不再给它开口子。
--   * 结构版本由 schema_version 表记录（迁移器维护），不在这里建。

CREATE TABLE IF NOT EXISTS students (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  grade       TEXT NOT NULL DEFAULT '',
  guardian    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '在读',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  enrollments TEXT NOT NULL DEFAULT '[]',   -- JSON：报课记录（含续费与退课）
  profile     TEXT NOT NULL DEFAULT '{}'    -- JSON：信息采集表（键值对，加字段不用迁移）
);

CREATE TABLE IF NOT EXISTS teachers (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT '',
  subjects TEXT NOT NULL DEFAULT '[]',      -- JSON：可带科目（课程名）
  phone    TEXT NOT NULL DEFAULT '',
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classrooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  capacity     INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL DEFAULT '上课用教室',
  availability TEXT NOT NULL DEFAULT '[]',  -- JSON：[{weekdays:[1,2],start,end}]
  note         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lessons (
  id                   TEXT PRIMARY KEY,
  subject              TEXT NOT NULL DEFAULT '',
  form                 TEXT NOT NULL DEFAULT '',
  teacher_id           TEXT NOT NULL DEFAULT '',
  classroom_id         TEXT NOT NULL DEFAULT '',
  student_ids          TEXT NOT NULL DEFAULT '[]',  -- JSON
  starts_at            TEXT NOT NULL,               -- ISO
  duration_minutes     INTEGER NOT NULL DEFAULT 60,
  status               TEXT NOT NULL DEFAULT '已排',
  note                 TEXT NOT NULL DEFAULT '',
  makeup_for_lesson_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lessons_starts_at ON lessons (starts_at);
CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON lessons (teacher_id, starts_at);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL DEFAULT '',
  enrollment_id TEXT NOT NULL DEFAULT '',
  amount        REAL NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT '收款',
  method        TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_payments_at ON payments (at);

CREATE TABLE IF NOT EXISTS courses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,   -- 课程名是引用键：排课/教师科目/报课都按名字记
  category   TEXT NOT NULL DEFAULT '',
  forms      TEXT NOT NULL DEFAULT '[]',
  origin     TEXT NOT NULL DEFAULT '后台',
  status     TEXT NOT NULL DEFAULT '开放',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS logs (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  operator  TEXT NOT NULL DEFAULT 'admin',
  entity    TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_at ON logs (at);

CREATE TABLE IF NOT EXISTS pricing (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  config     TEXT NOT NULL,          -- JSON：PricingConfig（基础价/系数/计费规则/教师分成）
  source     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

-- 网站内容的**只读镜像**（真源仍是 data/site/*.md，见 docs/后端开发方案.md §10.1）。
-- 记下来源文件、内容哈希与同步时间，是为了「读到旧镜像时能看出来它旧了」。
CREATE TABLE IF NOT EXISTS site_content (
  id           TEXT PRIMARY KEY,
  source_file  TEXT NOT NULL,
  page         TEXT NOT NULL DEFAULT '',
  section      TEXT NOT NULL DEFAULT '',
  item         TEXT NOT NULL DEFAULT '',
  value        TEXT NOT NULL DEFAULT '',
  raw          TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  synced_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_site_content_file ON site_content (source_file, page);
