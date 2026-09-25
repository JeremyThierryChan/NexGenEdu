"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { MultiSelect, type MultiSelectOption } from "@/components/admin/MultiSelect";
import { Button } from "@/components/ui/Button";
import { useFormOptions } from "@/components/admin/useFormOptions";
import { api, STUDENT_STATUSES, type Catalog, type Student, type Teacher } from "@/lib/backend/api";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";
// 教材的唯一显示口径（`学科·模块名`，v32）与「已失效教材」那句话
import { textbookLabel, textbookSummary } from "@/lib/backend/textbooks";
import { profileText, type StudentProfile } from "@/lib/backend/student-profile";

/**
 * 学生表单（基础信息）：新建与编辑共用。
 *
 * 这里只放「快速建档」需要的字段。信息采集表的几十个字段在「信息采集表」面板里填。
 *
 * **报课在新建时可以一并填**（可多门，每门节数各自独立）：家长来报名时说的就是
 * 「数学 10 节、英语 20 节」，先建档再逐门点「报课」是重复劳动。编辑时这块不显示 ——
 * 已有报课记录在「报课与课时」里维护（那里有续费、退课、收款，别在表单里改账）。
 *
 * 金额刻意不在这里收：报课的「约定应缴 / 实收」要按班型定价算，而且可能分期，
 * 建档时先记科目与课时，钱到「报课与课时 → 收款」里记 —— 钱的入口只留一个。
 *
 * ## v32 补上的三样（机构原话：「新建学生应该有一个年级、生日以及现阶段使用的教材
 * （可以有多本，因为一个学生可能有多个科目）」）
 *
 * | 字段 | 落在哪 | 为什么 |
 * | --- | --- | --- |
 * | **年级** | `Student.grade`（本来就有） | 只补了 `<datalist>` 候选，**不是**固定枚举：机构自己就有「初二」「小学五年级」几种写法 |
 * | **生日** | `Student.profile.birthDate` | **不新增字段**：出生日期在信息采集表里已经有了，一个事实只有一处 |
 * | **教材** | `Student.textbooks`（模块 id 列表） | 教材就是「课程 → 课程类型」里那一层内容模块，可多本、可跨学科；**不是报课** |
 *
 * ⚠️ 生日那一条最容易写坏，所以单独说清：`profile` 是**整份覆盖**（`students.update` 是浅合并，
 * 传了就整块换掉），而采集表里还有几十个别的字段。因此这里的做法是
 * **把打开表单时读到的那一份 `profile` 存成 state**（与 `version` 来自同一次读），
 * 提交时只改 `birthDate` 这一个键、整份交回去 —— 既不会抹掉采集表里已填的其它字段，
 * 也不会拿"别人刚改过的那一份"去覆盖（真有人改过，`expectedVersion` 会拒掉这次提交并说清原因）。
 * 详见 `profile` 那个 state 上的注释。
 */

/**
 * 年级候选（`<datalist>`：**只提示、不限制**）。
 *
 * 为什么不做成 `<select>`：年级是自由文本，机构自己就有「初二」「小学五年级」「三年级」
 * 这几种写法（真实库里各年级的写法不止一套），固定枚举会逼着人把「初二」记成「八年级」,
 * 而学生在报课 / 采集表 / 家长嘴里都是「初二」。候选只负责"常用写法一点就有"。
 *
 * 「一年级…六年级 / 七年级…九年级 / 高一…高三」这三段写法**并存**是有意的：
 * 机构既有小学部（一年级）也有初中部（初二那种叫法）。缺了哪一段，那一档就只能手打。
 */
const GRADE_SUGGESTIONS = [
  "一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
  "七年级", "八年级", "九年级",
  "高一", "高二", "高三",
];

export function StudentForm({
  student,
  onCancel,
  onSaved,
}: {
  student?: Student;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = student !== undefined;

  const [name, setName] = useState(student?.name ?? "");
  const [grade, setGrade] = useState(student?.grade ?? "");
  const [guardian, setGuardian] = useState(student?.guardian ?? "");
  const [status, setStatus] = useState<Student["status"]>(student?.status ?? "在读");
  const [note, setNote] = useState(student?.note ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /** 年级候选那个 `<datalist>` 的 id（用 `useId` 而不是写死：同屏可能有两个表单）。 */
  const gradeListId = useId();

  /**
   * 生日（v32）：写进**信息采集表已有的** `profile.birthDate`，不另立字段。
   *
   * 初始值取的就是采集表里那一格 —— 因此"在采集表里填过出生日期"的学生，
   * 打开这个表单就能看到同一个日期（一个事实只有一处，两边不可能显示成两个值）。
   */
  const [birthDate, setBirthDate] = useState(() => profileText(student?.profile ?? {}, "birthDate"));

  /**
   * 打开表单时读到的那一份采集表（**与 `version` 来自同一次读**）。
   *
   * 为什么要存成 state 而不是提交时读 `student.profile`：
   *   - `profile` 是**整份覆盖**的字段（`students.update` 把 patch 浅合并进整条记录），
   *     而采集表里还有几十个别的字段 —— 只交 `{ birthDate }` 会把它们**全部抹掉**；
   *   - 那就得把"完整的那一份"交回去，而"完整的那一份"必须是**我手上这一份**：
   *     `student` 是父组件的 prop，父组件刷新后会换成新对象，那时用 `student.profile`
   *     配着手上的旧 `version` 提交，两半来自不同的两次读（同 `StudentProfileForm` 的说明）；
   *   - 别人真的改过采集表时，`expectedVersion` 会拒绝这次提交（错误原话显示在下面），
   *     而不是静默盖掉对方填的内容。
   */
  const [profile] = useState<StudentProfile>(() => structuredClone(student?.profile ?? {}));

  /**
   * 现阶段使用的教材（v32）：课程类型里「内容模块」的 id 列表。
   *
   * 存 id 而不是名字：模块改名时这里跟着变（存名字的话，机构改一次模块名，
   * 所有学生的教材就全对不上了）。显示口径统一走 `textbookLabel`（`学科·模块名`）。
   */
  const [textbooks, setTextbooks] = useState<string[]>(student?.textbooks ?? []);

  /*
   * 乐观锁（v17）：打开表单时读到的那一版。
   *
   * 存成 state 而不是提交时读 `student.version`：父组件的列表刷新之后那个 prop
   * 已经是新对象了，用它提交等于把锁关掉（版本永远对得上）。保存成功后用服务端
   * 返回的记录更新它，免得下一次保存对着自己的成功报一次假冲突。
   */
  const [version, setVersion] = useState(student?.version ?? 1);

  /**
   * 课程类型（教材候选的来源）。
   *
   * 候选**列全部模块、按学科分组**（数学下面能看到「七年级教材 / 八年级教材 / 必修教材」，
   * 英语下面是「N5 / CEFR-B1 / 听力 / 作文」）—— 不限制类型：机构把教材放在哪一层，
   * 那一层就是教材（见 `lib/backend/textbooks.ts` 的文件头）。
   */
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  /*
   * 报课（只有新建时用）：勾选的科目 + 每门各自的节数。
   *
   * 节数用字符串存，因为输入框允许「先删空再补数字」，中间态不是合法数字。
   */
  const { options: subjectOptions } = useSubjectOptions();
  const formOptions = useFormOptions();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  /*
   * **每门课各自一份**：节数 / 班型 / 指定教师。
   *
   * 为什么不做成"上面选一次、下面共用"：这三件事本来就是按科目定的 ——
   * 数学是一对一、英语是一对二小组课、晚辅导不指定教师，都是常见组合。
   * 共用一套只会让人建完档再回头逐门改（而改报课目前还没有入口）。
   * 默认值仍然统一给（新勾一门课就带上默认班型），因此只有真正不同的那几门要动。
   */
  const [lessonsBySubject, setLessonsBySubject] = useState<Record<string, string>>({});
  const [formBySubject, setFormBySubject] = useState<Record<string, string>>({});
  const [teacherBySubject, setTeacherBySubject] = useState<Record<string, string>>({});
  const [bulkLessons, setBulkLessons] = useState("10");
  // 班型候选是异步来的（见 useFormOptions）：第一帧用模版那一份的第一个当默认值
  const defaultForm = formOptions[0] ?? "";

  useEffect(() => {
    if (editing) return;
    let alive = true;
    void api.teachers
      .listActive()
      .then((rows) => {
        if (alive) setTeachers(rows);
      })
      .catch(() => {
        // 取不到教师只是少一个可选项，不该让建档打不开
      });
    return () => {
      alive = false;
    };
  }, [editing]);

  // 课程类型（教材候选）：取不到就是"教材那一栏暂时选不了"，同样不该让建档打不开
  useEffect(() => {
    let alive = true;
    void api.catalog
      .list()
      .then((data) => {
        if (alive) setCatalog(data);
      })
      .catch(() => {
        // 读不到课程类型时教材候选是空的，面板上会说明原因（见下面 placeholder）
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 教材候选：**按学科分组**（组名＝学科，组内是模块名），可跨学科多选。
   *
   * 三件事按顺序：
   *   1. 按 `catalog.subjects` 的顺序排（数学 / 英语 / 物理…，与「课程类型」页一致），
   *      因此人找得到东西；组名用学科、选项文字用 `textbookLabel`（`学科·模块名`）；
   *   2. 没挂在任何学科下的模块也列出来（组名为空）—— 少了它们就成了"看不见但存在"的模块；
   *   3. 学生**已经选着、但课程类型里已经删掉**的那几本也列出来，
   *      显示成「已失效教材（id）」而不是消失：看不见的话，人只会看到"我明明选过两本、
   *      这里只剩一本"，而不知道另一本去哪了（与教室「校区未填」那种待办标同一个道理）。
   */
  const textbookOptions = useMemo<MultiSelectOption[]>(() => {
    if (catalog === null) return [];
    const options: MultiSelectOption[] = [];
    const listed = new Set<string>();
    /*
     * 循环变量刻意**不叫** `module`（`@next/next/no-module-...` 那条 lint 规则
     * 把 `module` 当成 CommonJS 变量，一用就报错）；叫 `item`，口径不受影响。
     */
    for (const subject of catalog.subjects) {
      for (const item of catalog.modules) {
        if (item.subjectId !== subject.id) continue;
        options.push({
          value: item.id,
          label: textbookLabel(catalog, item.id),
          group: subject.name,
        });
        listed.add(item.id);
      }
    }
    for (const item of catalog.modules) {
      if (listed.has(item.id)) continue;
      options.push({ value: item.id, label: textbookLabel(catalog, item.id) });
    }
    for (const id of textbooks) {
      if (options.some((option) => option.value === id)) continue;
      options.push({ value: id, label: textbookLabel(catalog, id) });
    }
    return options;
  }, [catalog, textbooks]);

  const lessonsOf = (subject: string) => lessonsBySubject[subject] ?? bulkLessons;
  const formOf = (subject: string) => formBySubject[subject] ?? defaultForm;
  const teacherOf = (subject: string) => teacherBySubject[subject] ?? "";
  const totalLessons = picked.reduce((sum, subject) => {
    const value = Number(lessonsOf(subject));
    return sum + (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
  }, 0);

  function applyBulk() {
    setLessonsBySubject(Object.fromEntries(picked.map((subject) => [subject, bulkLessons])));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim() === "" || grade.trim() === "") {
      setError("姓名与年级必填。");
      return;
    }

    /*
     * 报课数据先在界面上拦一遍（服务端还会再拦一次）。
     * 界面这层是为了即时反馈：填错了立刻说，不用等一次往返。
     */
    const enrollments = picked.map((subject) => ({
      subject,
      lessons: Math.trunc(Number(lessonsOf(subject))),
      form: formOf(subject),
      teacherId: teacherOf(subject),
    }));
    for (const item of enrollments) {
      if (!Number.isFinite(item.lessons) || item.lessons <= 0) {
        setError(`「${item.subject}」的课时数要填大于 0 的整数。`);
        return;
      }
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      grade: grade.trim(),
      guardian: guardian.trim(),
      status,
      note: note.trim(),
    };

    /*
     * 采集表那一份：**打开表单时读到的那一份 + 这次填的生日**。
     *
     * 整份交回去是必须的（`profile` 是整份覆盖的字段），而"哪一份"必须是手上这一份
     * （与 `version` 同一次读）—— 否则就是把别人刚填的采集表盖掉。
     * 生日留空时写空串：采集表里"没填"就是空串（界面上的「未填写」），
     * 不是把键删掉 —— 键在不在不影响任何显示（`profileCompletion` 也只认非空值）。
     */
    const nextProfile: StudentProfile = { ...profile, birthDate: birthDate.trim() };

    try {
      if (editing) {
        /*
         * 整份提交（姓名 / 年级 / 生日 / 家长 / 状态 / 备注 / 教材），因此带上读到的版本：
         * 别人先改过这位学生时服务端会拒绝，而不是静默盖掉对方改的。
         * （信息采集表整份覆盖 `profile`，走的是另一个入口 `saveProfile`，那里同样带版本。）
         */
        const saved = await api.students.update(
          student.id,
          { ...payload, textbooks, profile: nextProfile },
          { expectedVersion: version },
        );
        if (saved !== null) setVersion(saved.version);
      } else {
        await api.students.create({
          ...payload,
          textbooks,
          // 新建时采集表本来就是空的：这一份只可能是 `{ birthDate }`
          profile: nextProfile,
          enrollments,
        });
      }
    } catch (cause) {
      // 服务端拒绝的理由（同一门科目报了两次、教材里有个不存在的模块、或这条记录刚被别人改过）原样显示出来
      setPending(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="姓名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 示例·李同学"
          required
        />
        {/*
          年级：**自由文本 + 候选**（见 `GRADE_SUGGESTIONS`）。
          这里与教师页那个「来源」datalist 同一处做法：值仍然是人手打的自由文本，
          候选只是"点一下就填上"；候选是常量，因此 datalist 常驻、不条件渲染。
        */}
        <TextField
          label="年级"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
          placeholder="例如 初二 / 小学五年级"
          list={gradeListId}
          required
        />
        {/*
          生日：**写进信息采集表已有的那一格**（`profile.birthDate`）—— 不新增 `Student.birthday`，
          一个事实只有一处（采集表里的标签叫「出生日期」，是同一个日期）。
        */}
        <TextField
          label="生日"
          hint="写进信息采集表的「出生日期」（同一处，不是第二个生日）"
          type="date"
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
        />
        <TextField
          label="家长联系方式"
          value={guardian}
          onChange={(event) => setGuardian(event.target.value)}
          placeholder="电话或微信"
        />
        <SelectInput
          label="状态"
          value={status}
          onChange={(event) => setStatus(event.target.value as Student["status"])}
          options={STUDENT_STATUSES.map((value) => ({ value, label: value }))}
        />
      </div>

      {/* 年级候选：只提示、不限制（自由文本，机构自己就有「初二」「小学五年级」几种写法） */}
      <datalist id={gradeListId}>
        {GRADE_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      {/*
        现阶段使用的教材（v32，机构原话：「现阶段使用的教材（可以有多本，
        因为一个学生可能有多个科目）」）。

        候选**列全部内容模块、按学科分组**（数学下面是「七年级教材 / 八年级教材 / 必修教材」，
        英语下面是「N5 / CEFR-B1 / 听力 / 作文」）：不限制类型，因为机构把教材就放在那一层。
        存的是模块 id，给人看的是 `学科·模块名`（模块名在多个学科下重名，不带学科认不出来）。
      */}
      <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
        <MultiSelect
          label="现阶段使用的教材"
          hint="可多本、可跨学科；候选取自「课程 → 课程类型」里的内容模块"
          options={textbookOptions}
          value={textbooks}
          onChange={setTextbooks}
          placeholder={catalog === null ? "正在读取课程类型…" : "点击勾选教材（可多本）"}
          emptyText="「课程类型」里还没有内容模块：先到「课程 → 课程类型」把教材加进去。"
        />
        {textbooks.length > 0 && (
          /* 显示口径只有一处（`textbookSummary`）：带学科，因为「必修教材」在好多学科下都有 */
          <p className="mt-1.5 text-[11px] text-ink-500">
            现阶段使用：{catalog === null ? "（正在读取课程类型）" : textbookSummary(catalog, textbooks)}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-ink-400">
          教材**不参与报价、也不参与排课冲突与课时账本** —— 它只回答「这个孩子现在在读哪几本」。
          报课仍然要在下面的「报课科目与课时」里选。
        </p>
      </div>

      {/* 报课（只有新建时显示）：勾选科目 + 每门各自的节数 */}
      {!editing && (
        <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
          <p className="text-xs font-medium text-ink-700">报课科目与课时（选填，可多门）</p>
          <p className="mt-1 text-xs text-ink-500">
            勾选科目、填节数，建档时就一起把课时记上 —— 例如数学 10 节、英语 20 节。
            金额与收款等家长付款后在「报课与课时 → 收款」里补记（那里也支持分期）。
          </p>

          <div className="mt-2">
            <MultiSelect
              label="报课科目"
              hint="可多选；候选取自课程库（网站课程 + 机构自建课程）"
              options={subjectOptions.map((option) => ({
                value: option.name,
                group: option.category,
              }))}
              value={picked}
              onChange={setPicked}
              placeholder="点击勾选科目（可多门）"
            />
          </div>

          {picked.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex items-center gap-1.5 text-xs text-ink-600">
                  统一节数
                  <input
                    type="number"
                    min={1}
                    value={bulkLessons}
                    onChange={(event) => setBulkLessons(event.target.value)}
                    className="w-16 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={applyBulk}>
                    应用到所有科目
                  </Button>
                </label>
                <span className="text-xs text-ink-500">
                  已选 {picked.length} 门 · 合计 {totalLessons} 节
                </span>
              </div>

              {/*
                每门课一行：节数 / 班型 / 指定教师，**都在行内各自选**。
                新勾一门课时会带上默认班型与"不指定"，因此只有真正不同的那几门要动。
              */}
              <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-md border border-ink-200 bg-white">
                <li className="hidden bg-ink-50/60 px-3 py-1 text-[11px] text-ink-500 sm:flex sm:items-center sm:gap-2">
                  <span className="min-w-0 flex-1">科目</span>
                  <span className="w-16 shrink-0">节数</span>
                  <span className="w-40 shrink-0">班型</span>
                  <span className="w-32 shrink-0">指定教师</span>
                  <span className="w-10 shrink-0" />
                </li>
                {picked.map((subject) => (
                  <li
                    key={subject}
                    className="flex flex-wrap items-center gap-2 px-3 py-1.5 sm:flex-nowrap"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{subject}</span>
                    <input
                      type="number"
                      min={1}
                      value={lessonsOf(subject)}
                      aria-label={`${subject} 的课时数`}
                      onChange={(event) =>
                        setLessonsBySubject((current) => ({ ...current, [subject]: event.target.value }))
                      }
                      className="w-16 shrink-0 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    <select
                      value={formOf(subject)}
                      aria-label={`${subject} 的班型`}
                      onChange={(event) =>
                        setFormBySubject((current) => ({ ...current, [subject]: event.target.value }))
                      }
                      className="w-40 shrink-0 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    >
                      {/* 库里没有这个班型也照样显示它，免得把已有的值静默改掉 */}
                      {(formOf(subject) !== "" && !formOptions.includes(formOf(subject))
                        ? [formOf(subject), ...formOptions]
                        : formOptions
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="">（还没定）</option>
                    </select>
                    <select
                      value={teacherOf(subject)}
                      aria-label={`${subject} 的指定教师`}
                      onChange={(event) =>
                        setTeacherBySubject((current) => ({ ...current, [subject]: event.target.value }))
                      }
                      className="w-32 shrink-0 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    >
                      <option value="">不指定</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setPicked((current) => current.filter((item) => item !== subject))}
                      className="w-10 shrink-0 text-xs text-ink-400 transition-colors hover:text-danger-600"
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-ink-400">
                每门课各自选班型与教师（默认是「{defaultForm || "第一个班型"}」与「不指定」）：
                数学一对一、英语一对二小组课这种组合，在这里一次就录准。
              </p>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-500">
        {editing
          ? "报读科目与课时在下方「报课与课时」里维护；其余采集表字段（性别、学校、监护人姓名…）在「信息采集表」里填写 —— 上面的「生日」就是那里的「出生日期」，这里改一次、那边也跟着变。"
          : "不勾科目也可以先建档（之后在详情里报课）；信息采集表可以以后再填 —— 上面的「生日」写进去的就是采集表的「出生日期」，以后在采集表里改也一样。"}
      </p>

      <div className="mt-3">
        <TextAreaField
          label="备注"
          hint="薄弱点、家长诉求、上课习惯等，只在后台可见。"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {error !== "" && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : editing ? "保存修改" : picked.length > 0 ? `建档并报课（${picked.length} 门）` : "建档"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
