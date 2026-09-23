"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, rolesOrAll } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { NumberInput, Panel, SelectInput, TextField } from "@/components/admin/AdminFields";
import { api, type Catalog, type Course } from "@/lib/backend/api";
import { classTypeIssuesText, syncClassTypes } from "@/lib/backend/class-types";
import { MultiSelect } from "@/components/admin/MultiSelect";
import {
  addLibraryCourseToPricing,
  pricingConfigCore,
  pricingConfigFromContent,
  pricingStatusForCourses,
  validatePricingConfig,
  type PricingConfig,
  type QuoteResult,
  type TeacherFeeResult,
} from "@/lib/backend/pricing";
import {
  describeTeacherShare,
  teacherShareFormula,
  TEACHER_SHARE_MAX_STUDENTS,
} from "@/lib/backend/teacher-share";
import { formatMoney, round2 } from "@/lib/backend/finance";
import { cn } from "@/lib/utils/cn";

/**
 * 报价（后台）。
 *
 * 报价原先只有宣传页上那个计算器，规则还写死在代码里：调价要改代码、重新构建，
 * 家长打电话来时也只能切到宣传页点一遍。这一页解决三件事：
 *
 *   1. **改价**：基础价、人数系数、时长乘数、手续费与试课规则都是数据；
 *   2. **试算**：当场按家长说的方案算出课时价与总价（含试课怎么收）；
 *   3. **导出**：伪后端的数据只在这台电脑上，导出成与 `data/site/pricing.md`
 *      同构的片段替换进内容文件，价格才真正上线 —— 这一页顶部把这件事说清楚了。
 *
 * 校验放在保存时由服务层复核（`api.pricing.update`），前端这一层只是提前提示；
 * 系数写成 0 会让所有报价变 0，不能让这种配置进库。
 */
export default function AdminPricingPage() {
  const [saved, setSaved] = useState<PricingConfig | null>(null);
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  /** 试算这一块的失败原因（教师课时费 403、后端问题等）。 */
  const [quoteError, setQuoteError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [exported, setExported] = useState("");
  /** 课程库：报价要跟着它走（改名跟随、停开跟随）。 */
  const [libraryCourses, setLibraryCourses] = useState<Course[]>([]);
  /**
   * 课程类型的维度表：**班型的名称与人数区间以它为准**（v25）。
   *
   * 报价这一份只存"这个班型多少钱"（系数 / 按人数分摊），名字跟着维度表走 ——
   * 两边各显示一套名字是"不会报错的那类错"，因此这一页要拿维度表对一次并提示差异。
   */
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  /** 待定价的课程库课程（多选）。 */
  const [pickedCourses, setPickedCourses] = useState<string[]>([]);
  const [targetStage, setTargetStage] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [newCoursePrice, setNewCoursePrice] = useState(300);
  const [copied, setCopied] = useState(false);

  // 试算器
  const [courseName, setCourseName] = useState("");
  const [classTypeName, setClassTypeName] = useState("");
  const [durationName, setDurationName] = useState("");
  const [lessons, setLessons] = useState(10);
  const [students, setStudents] = useState(1);
  const [studentCount, setStudentCount] = useState(12);
  const [classCost, setClassCost] = useState(2400);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  /** 教师课时费试算结果（教师拿多少、机构留多少）。 */
  const [teacherQuote, setTeacherQuote] = useState<TeacherFeeResult | null>(null);
  /** 人数对照表：1–8 人各自的教师课时费（按当前选择与时长）。 */
  const [shareRows, setShareRows] = useState<TeacherFeeResult[]>([]);

  /**
   * 读数据（报价配置 + 课程库）。
   *
   * `quiet: true` = **安静刷新**：这一页整页都挂在 `loading` 上（`if (loading || draft === null)`
   * 就把整页换成一行"加载中…"），所以刷新时只要进了加载态，页面高度会从好几屏塌成一行、
   * 浏览器随即把滚动位置夹回顶部（§15.3）。手动刷新走安静模式，落在原地。
   * 首屏那一次仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    const [config, courses, dimensions] = await Promise.all([
      api.pricing.get(),
      api.courses.list(),
      api.catalog.list(),
    ]);
    setSaved(config);
    setDraft(config);
    setLibraryCourses(courses);
    setCatalog(dimensions);
    setTargetStage((current) => current || (config.stages[0]?.name ?? ""));
    setCourseName((current) => current || (config.stages[0]?.courses[0]?.name ?? ""));
    setClassTypeName((current) => current || (config.classTypes[0]?.name ?? ""));
    setDurationName((current) => current || (config.durations[0]?.name ?? ""));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 就地改草稿：改的是副本，保存前不影响已存配置。 */
  const edit = useCallback((change: (next: PricingConfig) => void) => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as PricingConfig;
      change(next);
      return next;
    });
  }, []);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [draft, saved],
  );

  /**
   * 「（未导出上线）」到底该不该显示 —— **真的比一次内容文件**，而不是只看来源。
   *
   * 原先这句写的是 `draft.source === "后台修改"`，于是它**永远不会消失**：点「导出配置」、
   * 把片段替换进 `data/site/pricing.md` 并发布之后，配置的来源仍然是"后台修改"，
   * 页面却还在说"未导出上线" —— 机构要么以为网站上的价还是旧的（白跑一遍发布），
   * 要么因为这句永远在而干脆不当回事（那这句提示就白写了）。
   *
   * 现在比的是**库里存着的这一份**（`saved`，不是正在编辑的草稿 —— 草稿没保存时
   * 按钮上已经写着"保存修改"）与内容文件里那一份。比的是 `pricingConfigCore`：
   * 它刻意忽略 `courseId` 与班型的 `formatId`，那两样是后台专属的关联、内容文件里没有写法
   * （比进去的话，"明明一样"的两份也会永远不相等）。
   */
  const publishedInSync = useMemo(
    () => saved !== null && pricingConfigCore(saved) === pricingConfigCore(pricingConfigFromContent()),
    [saved],
  );

  /**
   * 班型与课程类型之间的差异（报价页顶部提示）。
   *
   * 用的是与保存路径**同一个**纯函数（`syncClassTypes`），所以"页面上提示的"
   * 与"存下去会对齐成什么"必然一致 —— 不会出现"提示说没事、保存却改了名"。
   */
  const classTypeIssues = useMemo(
    () =>
      draft === null || catalog === null
        ? ""
        : classTypeIssuesText(syncClassTypes(draft.classTypes, catalog)),
    [draft, catalog],
  );

  const selectedClassType = draft?.classTypes.find((item) => item.name === classTypeName);

  /** 课程库里还没定价的课程（家长问价时答不上来的那些）。 */
  const unpricedCourses = useMemo(() => {
    if (draft === null) return [];
    return pricingStatusForCourses(draft, libraryCourses).filter((item) => !item.priced);
  }, [draft, libraryCourses]);

  /** 有多少课程库课程已定价（列表顶部显示进度）。 */
  const pricedCount = libraryCourses.length - unpricedCourses.length;

  /**
   * 把课程库里选中的课程加进报价配置（填一个基础价）。
   *
   * 只改草稿，**不直接落库**：与这一页其它字段一样，改完点「保存修改」——
   * 否则一次误点就写进了配置，而这个配置是算钱的依据。
   */
  function addPickedCourses() {
    if (draft === null || pickedCourses.length === 0) return;
    const stageName = targetStage === "__new__" ? newStageName.trim() : targetStage;
    if (stageName === "") {
      setMessage("请先选择或填写一个阶段名。");
      return;
    }
    edit((next) => {
      for (const courseId of pickedCourses) {
        const course = libraryCourses.find((item) => item.id === courseId);
        if (course === undefined) continue;
        const result = addLibraryCourseToPricing(next, {
          courseId: course.id,
          name: course.name,
          stageName,
          basePrice: newCoursePrice,
          available: course.status === "开放",
        });
        next.stages = result.config.stages;
      }
    });
    setMessage(
      `已把 ${pickedCourses.length} 门课加进「${stageName}」（基础价 ${newCoursePrice} 元/小时）。` +
        "确认价格后点「保存修改」；要上线到家长看到的报价页，还需要「导出配置」并替换内容文件。",
    );
    setPickedCourses([]);
  }

  /*
   * 这个角色能做什么（`canCallMethod` = 服务端用的同一个判定函数）。
   *
   * 审计实测：招生老师进得来这一页（`PAGE_ACCESS["/admin/pricing"]` 允许），
   * 但 `pricing.update/reset/exportMarkdown/teacherFee` 对他全是 403 ——
   * 于是页面一挂载的自动试算就抛（`teacherFee` 403），**「试算结果」整块永远空白**、
   * 「导出配置」点了没反应。现在：读得到就显示、读不到就说清原因；
   * 没权限的写按钮不渲染，并写一句"归谁"。
   */
  const roles = rolesOrAll(useAuth());
  const canQuote = canCallMethod(roles, "pricing.quote");
  const canTeacherFee = canCallMethod(roles, "pricing.teacherFee");
  const canSave = canCallMethod(roles, "pricing.update");
  const canExport = canCallMethod(roles, "pricing.exportMarkdown");
  const canReset = canCallMethod(roles, "pricing.reset");

  async function save() {
    if (draft === null) return;
    setProblems(validatePricingConfig(draft));
    setSaving(true);
    setMessage("");
    try {
      const next = await api.pricing.update(draft);
      setSaved(next);
      setDraft(next);
      setMessage("已保存。别忘了导出并替换内容文件，家长看到的报价页才会更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function resetToContent() {
    if (!window.confirm("恢复为站点内容（data/site/pricing.md）里的价格？后台改过的价格会丢失。")) {
      return;
    }
    try {
      const next = await api.pricing.reset();
      setSaved(next);
      setDraft(next);
      setMessage("已恢复为站点内容里的价格。");
    } catch (error) {
      // 失败要说出来：裸 await 会让 403/500 变成"点了没反应"
      setMessage(error instanceof Error ? error.message : "恢复失败。");
    }
  }

  async function runQuote() {
    // 试算本身没权限就不试了（否则 Promise.all 一抛，"试算结果"整块永远空白且不说原因）
    if (!canQuote) {
      setQuoteError(`你的角色（${roles.join(" · ")}）不能试算报价 —— 这件事归 ${methodOwnerText("pricing.quote")}。`);
      return;
    }
    setQuoteError("");
    const selection = {
      courseName,
      classTypeName,
      durationName,
      lessons,
      studentCount,
      classCost,
    };
    /*
     * 家长价与教师课时费**分开取**：教师课时费对某些角色是 403（它属于教师分成），
     * 而"家长价"是所有人都该看到的。早先放在同一个 `Promise.all` 里，
     * 一个 403 就让整块试算结果空白（审计实测到的那条）。
     */
    const parent = await api.pricing.quote(selection);
    setQuote(parent);

    if (!canTeacherFee) {
      setTeacherQuote(null);
      setShareRows([]);
      return;
    }
    try {
      setTeacherQuote(await api.pricing.teacherFee({ ...selection, students }));
      // 人数对照表：把 1–8 人各算一遍，老师问「这个班多少钱」时直接看表
      setShareRows(
        await Promise.all(
          Array.from({ length: TEACHER_SHARE_MAX_STUDENTS }, (_, index) =>
            api.pricing.teacherFee({ ...selection, students: index + 1 }),
          ),
        ),
      );
    } catch (error) {
      setTeacherQuote(null);
      setShareRows([]);
      setQuoteError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "教师课时费没算出来（权限或后端问题）。",
      );
    }
  }

  // 打开页面就先按默认选择算一次：规则表与金额立刻是可看的，不用先点按钮
  useEffect(() => {
    if (!loading && draft !== null && quote === null) void runQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, draft, quote]);

  async function exportMarkdown() {
    try {
      const text = await api.pricing.exportMarkdown();
      setExported(text);
      setCopied(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败。");
    }
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (loading || draft === null) {
    return (
      <>
        <PageHeading title="报价" description="加载中…" />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="报价"
        description="基础价与系数是算钱的依据：改完保存，再用试算器核对一遍，最后导出替换内容文件。"
      />
      <DataNotice
        onRefresh={async () => {
          // 安静刷新：整页挂在 loading 上，一进加载态就会塌成一页（见 load 的说明）
          await load({ quiet: true });
        }}
      />

      {/*
        这段原先写的是"价格只有这台电脑能看到 / 后台数据存在浏览器本地" —— 那是**接后端之前**的
        实情，现在数据在服务端 SQLite 里（同一屏上方的 `DataNotice` 就写着"数据保存在服务端数据库"），
        两句话互相打脸。现在如实说清"什么时候需要导出上线"。
      */}
      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <strong className="font-medium">价格改完就保存在服务端了。</strong>
        家长看到的报价页是构建时生成的静态页面：构站那台机器能连上后端时，直接用库里的价格；
        连不上（例如线上 GitHub Pages 那份）才需要点「导出配置」，把片段替换进
        <code className="mx-1 rounded bg-white/70 px-1">data/site/pricing.md</code>
        （页面文案字段不要动）再发布。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* 没权限的按钮不渲染（点了 403 而界面不说话，人只会以为系统坏了） */}
        {canSave && (
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "保存中…" : dirty ? "保存修改" : "已保存"}
          </Button>
        )}
        {canExport && (
          <Button variant="outline" onClick={() => void exportMarkdown()}>
            导出配置
          </Button>
        )}
        {canReset && (
          <Button variant="outline" onClick={() => void resetToContent()}>
            恢复为站点内容
          </Button>
        )}
        {!canSave && (
          <span className="text-xs text-ink-500">
            你的角色（{roles.join(" · ")}）只能看与试算：改价归 {methodOwnerText("pricing.update")}
          </span>
        )}
        <span className="text-xs text-ink-500">
          来源：{draft.source}
          {draft.updatedAt === "" ? "" : ` · 最后修改 ${draft.updatedAt.slice(0, 16).replace("T", " ")}`}
          {publishedInSync ? "" : "（未导出上线）"}
        </span>
      </div>

      {message !== "" && (
        <p className="mt-2 text-xs leading-relaxed text-ink-600">{message}</p>
      )}
      {quoteError !== "" && (
        <p role="alert" className="mt-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
          {quoteError}
        </p>
      )}
      {/* 班型与课程类型对不上时的提示（两类差异各有各的后果，分开说） */}
      {classTypeIssues !== "" && (
        <p className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
          {classTypeIssues}{" "}
          <Link href="/admin/courses#dimensions" className="underline">
            去「课程类型」看看
          </Link>
        </p>
      )}

      {problems.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 rounded-md border border-red-300 bg-red-50 px-5 py-2.5 text-xs text-red-800">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {/* ── 试算器：家长打电话来的时候用 ── */}
      <Panel
        title="试算"
        description="按家长说的方案算一遍。试课费按课程原价收，不带系数与手续费。"
        className="mt-5"
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectInput
            label="课程"
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
            options={draft.stages.flatMap((stage) =>
              stage.courses.map((course) => ({
                value: course.name,
                label: `${stage.name} · ${course.name}${
                  course.basePrice === null ? "（未开放）" : ` ¥${course.basePrice}`
                }`,
              })),
            )}
          />
          <SelectInput
            label="班型"
            value={classTypeName}
            onChange={(event) => setClassTypeName(event.target.value)}
            options={draft.classTypes.map((item) => ({
              value: item.name,
              label:
                item.mode === "cost-share"
                  ? `${item.name}（费用 ÷ 人数）`
                  : `${item.name}（×${item.coefficient ?? 1}）`,
            }))}
          />
          <SelectInput
            label="每节课时长"
            value={durationName}
            onChange={(event) => setDurationName(event.target.value)}
            options={draft.durations.map((item) => ({
              value: item.name,
              label: `${item.name}（×${item.multiplier}）`,
            }))}
          />
          <NumberInput
            label="报课节数"
            hint={`满 ${draft.rules.freeTrialMinLessons} 节试课免费`}
            min={1}
            value={lessons}
            onChange={(event) => setLessons(Number(event.target.value))}
          />
          {selectedClassType?.mode === "coefficient" && (
            <NumberInput
              label="学生人数"
              hint="决定教师分成比例（1 人 40% 起）"
              min={1}
              max={TEACHER_SHARE_MAX_STUDENTS}
              value={students}
              onChange={(event) => setStudents(Number(event.target.value))}
            />
          )}
          {selectedClassType?.mode === "cost-share" && (
            <>
              <NumberInput
                label="班级人数"
                min={1}
                value={studentCount}
                onChange={(event) => setStudentCount(Number(event.target.value))}
              />
              <NumberInput
                label="教师课时总费用"
                suffix="元"
                min={0}
                value={classCost}
                onChange={(event) => setClassCost(Number(event.target.value))}
              />
            </>
          )}
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void runQuote()}>
              算一下
            </Button>
          </div>
        </div>

        {quote !== null && (
          <div className="border-t border-ink-100 px-4 py-4">
            {quote.ok ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <p className="text-sm text-ink-600">
                    课单价{" "}
                    <strong className="text-lg font-medium text-ink-900">
                      {formatMoney(quote.unitPrice)}
                    </strong>
                    <span className="text-ink-400"> / 节</span>
                  </p>
                  <p className="text-sm text-ink-600">
                    {quote.lessons} 节正课 {formatMoney(quote.lessonsPrice)}
                  </p>
                  <p className="text-sm text-ink-600">
                    试课 {quote.trialFree ? "免费" : formatMoney(quote.trialFee)}
                  </p>
                  <p className="text-sm text-ink-600">
                    合计{" "}
                    <strong className="text-lg font-medium text-brand-800">
                      {formatMoney(quote.totalPrice)}
                    </strong>
                  </p>
                </div>
                <ul className="mt-3 grid gap-1 text-xs text-ink-500 sm:grid-cols-2 lg:grid-cols-3">
                  {quote.breakdown.map((item) => (
                    <li key={item.label} className="flex justify-between gap-3">
                      <span>{item.label}</span>
                      <span className="text-ink-700">{item.value}</span>
                    </li>
                  ))}
                </ul>

                {teacherQuote !== null && (
                  <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 px-3 py-2.5">
                    {teacherQuote.ok ? (
                      <>
                        <p className="text-xs font-medium text-ink-700">
                          教师课时费（分成规则算出来的，不是手填的）
                        </p>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                          <p className="text-sm text-ink-600">
                            教师{" "}
                            <strong className="font-medium text-ink-900">
                              {formatMoney(teacherQuote.teacherFee)}
                            </strong>
                            <span className="text-ink-400">
                              {" "}（{teacherQuote.students} 人 · {teacherQuote.percent}%）
                            </span>
                          </p>
                          <p className="text-sm text-ink-600">
                            机构留存 {formatMoney(teacherQuote.keepFee)}
                          </p>
                          <p className="text-xs text-ink-400">
                            家长侧本课时段合计 {formatMoney(teacherQuote.revenue)}
                          </p>
                        </div>
                        <ul className="mt-2 grid gap-1 text-xs text-ink-500 sm:grid-cols-2 lg:grid-cols-3">
                          {teacherQuote.breakdown.map((item) => (
                            <li key={item.label} className="flex justify-between gap-3">
                              <span>{item.label}</span>
                              <span className="text-ink-700">{item.value}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-xs leading-relaxed text-ink-500">
                        教师课时费：{teacherQuote.reason}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-red-700">{quote.reason}</p>
            )}
          </div>
        )}
      </Panel>

      {/* ── 课程库课程定价：把「能排的课」变成「有价的课」 ── */}
      <Panel
        title="课程库课程定价"
        description="课程库里能排的课，在这里给它们一个基础价，家长问价时才有依据。"
        className="mt-5"
      >
        <div className="space-y-4 px-4 py-4">
          <p className="text-xs leading-relaxed text-ink-500">
            课程库共 {libraryCourses.length} 门，已定价 {pricedCount} 门
            {unpricedCourses.length > 0 && `，还有 ${unpricedCourses.length} 门没价格`}。
            课程库决定了「能排哪些课」，这一页决定「这门课多少钱」；课程库里改了名字或设为
            暂未开放，这里会跟着变（保存时会自动同步）。
          </p>

          {unpricedCourses.length === 0 ? (
            <p className="text-xs text-success-600">课程库里的课程都已有报价配置。</p>
          ) : (
            <>
              <MultiSelect
                label="选择要定价的课程"
                hint="可多选；一次给多门课定同一个基础价"
                options={unpricedCourses.map((item) => ({ value: item.name }))}
                value={pickedCourses
                  .map((id) => libraryCourses.find((course) => course.id === id)?.name ?? "")
                  .filter((name) => name !== "")}
                onChange={(names) =>
                  setPickedCourses(
                    names
                      .map((name) => libraryCourses.find((course) => course.name === name)?.id ?? "")
                      .filter((id) => id !== ""),
                  )
                }
                placeholder="选择还没定价的课程"
              />

              <div className="grid gap-3 sm:grid-cols-3">
                <SelectInput
                  label="放进哪个阶段"
                  hint="对应报价页上的分组"
                  value={targetStage}
                  onChange={(event) => setTargetStage(event.target.value)}
                  options={[
                    ...draft.stages.map((stage) => ({ value: stage.name, label: stage.name })),
                    { value: "__new__", label: "＋ 新建一个阶段" },
                  ]}
                />
                {targetStage === "__new__" && (
                  <TextField
                    label="新阶段名"
                    hint="例如「兴趣才艺」"
                    value={newStageName}
                    onChange={(event) => setNewStageName(event.target.value)}
                    placeholder="兴趣才艺"
                  />
                )}
                <NumberInput
                  label="基础价"
                  hint="每小时的价（一对一、报 2 节及以上）——再乘每节课的小时数才是课单价"
                  suffix="元 / 小时"
                  min={0}
                  value={newCoursePrice}
                  onChange={(event) => setNewCoursePrice(Number(event.target.value))}
                />
              </div>

              {/*
                把"这个价折成课单价是多少"当场算给机构看：基础价是**元 / 小时**，
                而家长看到的课单价是**元 / 节**（= 基础价 × 每节课几小时）。
                不写这一行，填 150 的人会以为家长看到的就是 150。
              */}
              <p className="mt-1 text-xs text-ink-400">
                {formatMoney(newCoursePrice)} 元/小时 →
                {draft.durations
                  .map((duration) => ` ${duration.name} ${formatMoney(round2(newCoursePrice * duration.multiplier))} 元/节`)
                  .join(" ·")}
                （一对一、不加手续费）
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={addPickedCourses}
                  disabled={pickedCourses.length === 0}
                >
                  加入报价配置（{pickedCourses.length} 门）
                </Button>
                <span className="text-xs text-ink-400">
                  加入后还需要点上面的「保存修改」；上线到家长看到的报价页要再「导出配置」。
                </span>
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* ── 基础价 ── */}
      <Panel
        title="基础价"
        description="每门课的价格在这里定，单位是**元 / 小时**（一对一、报 2 节及以上）：一节课 1 小时就是它本身，1.5 小时乘 1.5、2 小时乘 2 —— 家长看到的「课单价（元 / 节）」就是这么算出来的。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          {draft.stages.map((stage, stageIndex) => (
            <div key={stage.name}>
              <h3 className="mb-2 text-xs font-medium text-ink-500">{stage.name}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {stage.courses.map((course, courseIndex) => (
                  <div key={course.name} className="rounded-md border border-ink-200 px-3 py-2.5">
                    <p className="mb-2 flex items-center gap-1.5 text-sm text-ink-800">
                      {course.name}
                      {course.courseId !== undefined && course.courseId !== "" && (
                        <span className="rounded-sm border border-brand-200 bg-brand-50 px-1 py-0.5 text-[10px] text-brand-700">
                          课程库
                        </span>
                      )}
                    </p>
                    <div className="flex items-end gap-2">
                      <NumberInput
                        label=""
                        suffix="元 / 小时"
                        min={0}
                        disabled={!course.available}
                        value={course.basePrice ?? ""}
                        onChange={(event) =>
                          edit((next) => {
                            const target = next.stages[stageIndex]?.courses[courseIndex];
                            if (target === undefined) return;
                            const value = event.target.value;
                            target.basePrice = value === "" ? 0 : Number(value);
                          })
                        }
                      />
                      <label className="flex shrink-0 items-center gap-1.5 pb-2 text-xs text-ink-500">
                        <input
                          type="checkbox"
                          checked={!course.available}
                          onChange={(event) =>
                            edit((next) => {
                              const target = next.stages[stageIndex]?.courses[courseIndex];
                              if (target === undefined) return;
                              target.available = !event.target.checked;
                              if (!target.available) target.basePrice = null;
                            })
                          }
                        />
                        暂未开放
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── 人数系数 ── */}
      <Panel
        title="人数系数"
        description="人数系数管「人越多每人越便宜」：一对一 1、一对二 0.7、一对三 0.6、一对多（4-8）0.5；班课（9-20）按人数分摊、不用系数。系数 1 表示不加价。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">
              人数系数
              <span className="ml-2 font-normal text-ink-400">
                班型的名称与人数区间以「课程类型」页为准，这里只填「这个班型多少钱」
              </span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {draft.classTypes.map((classType, index) => (
                <div key={classType.name}>
                  {classType.mode === "cost-share" ? (
                    <p className="rounded-md border border-dashed border-ink-300 px-3 py-2 text-xs leading-relaxed text-ink-500">
                      <span className="text-ink-700">{classType.name}</span>
                      <br />
                      按「教师课时总费用 ÷ 班级人数」分摊，不用系数。
                    </p>
                  ) : (
                    <NumberInput
                      label={classType.name}
                      step={0.05}
                      min={0.05}
                      value={classType.coefficient ?? 1}
                      onChange={(event) =>
                        edit((next) => {
                          const target = next.classTypes[index];
                          if (target === undefined) return;
                          target.coefficient = Number(event.target.value);
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── 时长与规则 ── */}
      <Panel
        title="课时时长与计费规则"
        description="时长乘数按 1 小时为基准；手续费与试课门槛就是公式里那两个会变的数字。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {draft.durations.map((duration, index) => (
              <div key={duration.name} className="rounded-md border border-ink-200 px-3 py-2.5">
                <p className="mb-2 text-sm text-ink-800">{duration.name}</p>
                <div className="flex gap-2">
                  <NumberInput
                    label="小时"
                    step={0.5}
                    min={0.5}
                    value={duration.hours}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.durations[index];
                        if (target === undefined) return;
                        target.hours = Number(event.target.value);
                      })
                    }
                  />
                  <NumberInput
                    label="乘数"
                    step={0.1}
                    min={0.1}
                    value={duration.multiplier}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.durations[index];
                        if (target === undefined) return;
                        target.multiplier = Number(event.target.value);
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberInput
              label="只报 1 节的手续费"
              hint="报 2 节及以上不加收"
              suffix="%"
              min={0}
              max={100}
              value={draft.rules.singleLessonFeePercent}
              onChange={(event) =>
                edit((next) => {
                  next.rules.singleLessonFeePercent = Number(event.target.value);
                })
              }
            />
            <NumberInput
              label="试课免费门槛"
              hint="报课达到该节数则试课免费"
              suffix="节"
              min={1}
              value={draft.rules.freeTrialMinLessons}
              onChange={(event) =>
                edit((next) => {
                  next.rules.freeTrialMinLessons = Number(event.target.value);
                })
              }
            />
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={draft.rules.chargeTrialWhenNotFree}
                  onChange={(event) =>
                    edit((next) => {
                      next.rules.chargeTrialWhenNotFree = event.target.checked;
                    })
                  }
                />
                未达门槛时按课程原价收 1 节试课费
              </label>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── 教师分成：公式翻成人话 + 人数对照表 ── */}
      <Panel
        title="教师分成规则（课内课时费）"
        description="课内按人数系数计价的班型适用。规则只有这一份实现，后台与将来接的服务端共用同一个函数。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">规则原文（机构给的口径）</h3>
            <p className="overflow-x-auto rounded-md bg-ink-50 px-3 py-2 font-mono text-xs leading-relaxed text-ink-700">
              {teacherShareFormula(draft.teacherShare)}
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">人话版（给老师看的就是这一段）</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-ink-600">
              {describeTeacherShare(draft.teacherShare).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberInput
              label="第一名学生分成"
              suffix="%"
              min={0}
              max={500}
              value={draft.teacherShare.basePercent}
              onChange={(event) =>
                edit((next) => {
                  next.teacherShare.basePercent = Number(event.target.value);
                })
              }
            />
            <NumberInput
              label="每增加一名学生加"
              hint="单位是百分点"
              suffix="pp"
              min={0}
              max={500}
              value={draft.teacherShare.stepPercent}
              onChange={(event) =>
                edit((next) => {
                  next.teacherShare.stepPercent = Number(event.target.value);
                })
              }
            />
            <SelectInput
              label="课程单价口径"
              hint="公式里「课程单价/小时」按哪一档算"
              value={draft.teacherShare.priceBasis}
              onChange={(event) =>
                edit((next) => {
                  next.teacherShare.priceBasis =
                    event.target.value === "seat" ? "seat" : "course";
                })
              }
              options={[
                { value: "course", label: "课程标准单价（基础价）" },
                { value: "seat", label: "班型课时价（再乘人数系数）" },
              ]}
            />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">
              人数对照表（按试算里选中的「{courseName} · {durationName}」）
            </h3>
            {shareRows[0]?.ok === true ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-left text-ink-400">
                      <th className="border-b border-ink-100 py-1.5 pr-3 font-normal">学生人数</th>
                      <th className="border-b border-ink-100 py-1.5 pr-3 font-normal">分成比例</th>
                      <th className="border-b border-ink-100 py-1.5 pr-3 font-normal">教师课时费</th>
                      <th className="border-b border-ink-100 py-1.5 font-normal">机构留存</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shareRows.map((row) => (
                      <tr
                        key={row.students}
                        className={row.students === students ? "bg-brand-50" : undefined}
                      >
                        <td className="border-b border-ink-100 py-1.5 pr-3 text-ink-700">
                          {row.students} 人
                        </td>
                        <td className="border-b border-ink-100 py-1.5 pr-3 text-ink-600">
                          {row.percent}%
                        </td>
                        <td className="border-b border-ink-100 py-1.5 pr-3 text-ink-800">
                          {formatMoney(row.teacherFee)}
                        </td>
                        <td className="border-b border-ink-100 py-1.5 text-ink-600">
                          {formatMoney(row.keepFee)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-ink-500">
                当前选择的班型不适用这条规则
                {shareRows[0]?.reason === undefined ? "。" : `：${shareRows[0].reason}`}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              表格固定用当前选中的课程与班型算出「课时单价」，再按人数给比例 ——
              用来看「多一个学生，老师多拿多少」。9 人以上大班课不出现在这张表里：
              那类按「教师课时总费用 ÷ 班级人数」另议。比例与金额都是按当前配置算的，
              改上面的数字或切换单价口径，表格会立刻跟着变。
            </p>
          </div>
        </div>
      </Panel>

      {/* ── 其他项目 ── */}
      <Panel
        title="其他项目"
        description="按学期 / 按期的独立产品（晚辅导、特色网课），不参与课时公式，报价页单独列出。"
        className="mt-5"
      >
        <div className="space-y-4 px-4 py-4">
          {draft.otherItems.map((item, itemIndex) => (
            <div key={item.name} className="rounded-md border border-ink-200 px-3 py-2.5">
              <p className="mb-2 text-sm text-ink-800">{item.name}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {item.details.map((detail, detailIndex) => (
                  <TextField
                    key={`${item.name}-${detail.title}`}
                    label={detail.title}
                    value={detail.value}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.otherItems[itemIndex]?.details[detailIndex];
                        if (target === undefined) return;
                        target.value = event.target.value;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {draft.trial !== null && (
            <p className="text-xs text-ink-500">
              试课：{draft.trial.name} · {draft.trial.priceLabel}（试课费按课程原价收，
              这一行只是报价页上的文案）
            </p>
          )}
        </div>
      </Panel>

      {/* ── 导出 ── */}
      <Panel
        title="导出配置（上线用）"
        description="把下面这段替换 data/site/pricing.md 里「## 学习阶段」及其后的部分，页面文案字段不要动。"
        className="mt-5 mb-8"
      >
        <div className="px-4 py-4">
          {exported === "" ? (
            <p className="text-xs text-ink-500">
              点上方「导出配置」生成。导出内容与内容文件同构，`npm run check`
              会把它回读一遍，确保导出的价格能被解析、且与这里的配置一致。
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => void copyExport()}>
                  {copied ? "已复制" : "复制"}
                </Button>
                <span className="text-xs text-ink-500">
                  包含 {draft.stages.reduce((sum, stage) => sum + stage.courses.length, 0)} 门课、
                  {draft.classTypes.length} 种班型与计费规则。
                </span>
              </div>
              <textarea
                readOnly
                rows={14}
                value={exported}
                className={cn(
                  "w-full rounded-md border border-ink-200 bg-ink-50 p-3 font-mono text-xs leading-relaxed text-ink-700",
                )}
              />
            </>
          )}
        </div>
      </Panel>
    </>
  );
}
