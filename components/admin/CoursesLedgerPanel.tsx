"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { BulkImport } from "@/components/admin/BulkImport";
import { useScrollGuard } from "@/components/admin/useScrollGuard";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { SiteCourseContent, focusSiteSubject } from "@/components/admin/SiteCourseContent";
import { Panel, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import {
  api,
  COURSE_SITE_KINDS,
  COURSE_STATUSES,
  type Course,
  type CoursePartition,
  type CourseSiteKind,
  type CourseSummary,
  type SiteContent,
} from "@/lib/backend/api";
import {
  bandsForCard,
  cardTargets,
  coursesReferencingAnchor,
  uniqueBandAnchor,
  type BandHit,
  type CardAnchorSource,
} from "@/lib/backend/site-bands";
import { useFormOptions } from "@/components/admin/useFormOptions";
import { canRemoveCourse } from "@/lib/backend/courses";
import {
  childPartitions,
  groupByPartition,
  partitionDeleteRefusal,
  partitionPathLabel,
  partitionPlace,
  topLevelPartitions,
} from "@/lib/backend/course-partitions";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import type { SiteContentImportReport } from "@/lib/backend/api";
import {
  addLibraryCourseToPricing,
  pricingStatusForCourses,
  type LibraryPricingStatus,
  type PricingConfig,
} from "@/lib/backend/pricing";
import { cn } from "@/lib/utils/cn";

/**
 * 「把本区课程移到…」那个下拉里占位项的哨兵值。
 *
 * 为什么不用空串：这个下拉里空串是**合法目标**（＝未归类），占位项再用空串就会出现
 * 两个 `value=""` 的选项 —— 浏览器只认其中一个，于是"选择分区…"与"（未归类）"长得一样，
 * 点了也不知道自己选的是哪个。
 */
const PICK_PLACEHOLDER = "__pick__";

/** 「12 个学科 / 61 个小节」——保存正文后的提示与面板摘要用同一句话。 */
function contentCountText(content: SiteContent): string {
  const subjects = content.coursePage.subjects;
  const bands = subjects.reduce((sum, subject) => sum + subject.bands.length, 0);
  return `${subjects.length} 个学科 / ${bands} 个小节`;
}

/**
 * 「学考→高中物理学考、选考→高中物理选考」→ 标签数组（箭头可省略，省略时两边同名）。
 *
 * 刻意放在**模块级**（纯函数，不碰组件状态）：它既要在表单提交时用，也要在
 * "卡片字段变了就重算在编小节"的那个 effect 里用 —— 组件内定义的函数放进 effect
 * 会让依赖表每次都变（`exhaustive-deps` 也是有理由地拦这种事）。
 */
function parseTags(text: string): Course["tags"] {
  return text
    .split(/[、,，\n]/)
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "")
    .map((raw) => {
      const [label = "", jump = ""] = raw.split(/→|->/).map((part) => part.trim());
      return { label, target: jump !== "" ? jump : label };
    });
}

/**
 * 卡片表单里"正在编辑的小节"的一个槽位：指向草稿里的 (学科, 小节) 位置。
 *
 * 为什么记**下标**而不是锚点 / 标题：那两样正是用户可以改的字段（本节的核心功能就是改它们），
 * 拿它们当键的话，把锚点从「初中数学」改成「初中数学2」的第一下就会让它不再命中，
 * 编辑器当场消失、光标也丢了 —— 人就永远改不完这个锚点。
 */
type BandSlot = { subjectIndex: number; bandIndex: number; matched: string };

/**
 * 每个学科的小节数拼成的字符串（"结构指纹"）。
 *
 * 用途：判断"这一改动是不是动了小节的数量" —— 动了它，`bandSlots` 里记的下标就会整体前移，
 * 必须重算，否则会把 A 节的正文改到 B 节上（**静默的错**，比"列表里少显示一节"严重得多）。
 * 只改标题 / 锚点 / 正文时指纹不变，那块编辑器因此不会在打字中途跳走。
 */
function structureOf(content: SiteContent): string {
  return content.coursePage.subjects.map((subject) => subject.bands.length).join("/");
}

/**
 * 课程库。
 *
 * 排课的科目、教师可带科目、报课记录里的科目**都按课程名引用这里**。
 * 之前科目候选只来自网站内容，于是想开一门网站上还没有的课（围棋、书法、编程）
 * 就只能手打，名字一歪（「围棋」/「围棋课」）统计与课时对账就对不上。
 *
 * 两件事必须说清楚（页面里也写着）：
 *   1. 在这里加课程**不会**让宣传网站上多出一张卡片 —— 网站是静态内容，
 *      要上线得改 `data/site/content.md` 的课程栏目（见内容维护手册）；
 *   2. 网站来源的课程不能删（删了下次同步又回来），不想再排就改成「暂未开放」。
 */
export function CoursesLedgerPanel() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  /**
   * 课程分区（栏目 → 子栏目）。
   *
   * 它与课程**一起读**：清单要按分区分组、表单要选分区，因此这里与 `courses` 是
   * 一份数据的两个视图 —— 分区读到了、课程没读到（或反过来）都不行。
   */
  const [partitions, setPartitions] = useState<CoursePartition[]>([]);
  // 批量导入面板（低频操作：导完就收起来，不占着页面）
  const [importing, setImporting] = useState(false);
  /** 每门课在报价配置里的定价状态（「打通」的可见部分）。 */
  const [pricingStatus, setPricingStatus] = useState<LibraryPricingStatus[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  /** 刷新中（页面上已有数据，因此不清空列表 —— 见 load 的说明）。 */
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [originFilter, setOriginFilter] = useState("全部");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  /**
   * 正在切「开放 / 暂未开放」的那张卡片（防连点，也让"点了有反应"看得见）。
   *
   * 为什么要有它：一次切换要两趟请求（先写、再读计数）。这中间按钮不禁用的话，
   * 连点两下会发出两条方向相反的写 —— 服务端两条都写成功，界面上哪个是"最后状态"
   * 就看谁先回来。禁用 + 文案变「切换中…」同时告诉人"这一下已经收到了"。
   */
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /**
   * 就地动作的结果，**挂在被点的那张卡片上**（不是页顶）。
   *
   * 为什么必须挂在卡片上（三件事是同一件事）：
   *   1. 卡片清单在页面很下面，页顶那条横幅离眼睛几屏远 —— 结果写在那儿等于没写；
   *   2. 页顶横幅**出现 / 消失就是一次页面高度的变化**（它在滚动位置上方），
   *      而这一下点击最不该伴随页高变化（§15.3 那两条跳顶部的机制，一条是显式滚动，
   *      另一条就是页高变化让浏览器夹回滚动位置）；
   *   3. 失败（例如会话失效 401）必须**当场**说出来 —— 以前这里没有 try/catch，
   *      失败是一个没人看得见的 rejected promise，人看到的是"点了没反应"，
   *      就会反复点、再去猜系统坏了。
   */
  const [cardNote, setCardNote] = useState<{ id: string; kind: "ok" | "error"; text: string } | null>(null);
  /**
   * 「新增课程」那张表单展不展开（**默认收起**，理由写在渲染那一处）。
   *
   * 收起的状态跨保存保留（连加几门课是常事，保存后不必再点开一次）；
   * 它只在"新增"这一个身份下才有意义（`editing === null` 时那块才渲染）。
   */
  const [creatingCourse, setCreatingCourse] = useState(false);
  /**
   * 分区管理的表单状态：新分区名 + "在哪个栏目下新建"。
   *
   * 收纳成一个字符串状态而不是一个表单对象：这里只有两个字段、而且都是"输入框 + 按钮"，
   * 用 `useState` 各存一份就够了。
   */
  const [newPartitionName, setNewPartitionName] = useState("");
  const [newPartitionParent, setNewPartitionParent] = useState("");
  /** 正在改名的那一行（`null` = 没有在改名）。 */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  /** 分区那块的提示（与课程的 message/error 分开：两个动作的结果各说各的）。 */
  const partitionNotice = useActionNotice();
  /** 正在"把本区课程移到…"的分区 id（防连点）。 */
  const [movingFrom, setMovingFrom] = useState<string | null>(null);

  /*
   * 这个角色的动作能力：**直接问服务端用的那个判定函数**（`canCallMethod`），
   * 不另建一张页面权限表 —— 两张表迟早分叉，而分叉的表现就是"按钮看得见、点了 403"。
   */
  const auth = useAuth();
  const roles = rolesOrAll(auth);
  /*
   * 三个写动作各自问一次（而不是共用一个 `canWriteCourse`）：它们分属不同的方法，
   * 权限表里将来完全可以给"能建、不能删"这种组合 —— 界面上提前合成一个标志的话，
   * 那种组合一出现就会露出一个点了 403 的按钮（审计里那类"按钮看得见、点了没反应"）。
   */
  const canCreateCourse = canCallMethod(roles, "courses.create");
  const canUpdateCourse = canCallMethod(roles, "courses.update");
  const canRemoveCourseByRole = canCallMethod(roles, "courses.remove");
  const canWritePartition = canCallMethod(roles, "coursePartitions.create");
  /**
   * 小节级动作（删小节 / 新增小节）被拒的原因，**挂在被点的那个小节框里**。
   *
   * `key` 与列表项的 key 同源（学科下标-小节下标）：理由就出现在手指底下。
   * 为什么不滚到页顶去显示：编辑器就地展开在卡片下面，页顶离得很远，
   * 滚上去等于把人从"正在改的那一节"旁边甩开，还得再滑回来 ——
   * 而这正是这次要消掉的东西（原来这里有一句 `window.scrollTo({ top: 0 })`）。
   */
  const [bandError, setBandError] = useState<{ key: string; text: string } | null>(null);
  /*
   * 「从网站导入内容」：两阶段（体检 → 确认写入）。
   * 体检结果逐条列出来给人看 —— 一次导入会动到教师资料、课程字段与课程正文，
   * 不列清楚就变成"点一下按钮，数据悄悄变了一片"。
   */
  const [siteCheck, setSiteCheck] = useState<SiteContentImportReport | null>(null);
  const [siteOverwrite, setSiteOverwrite] = useState(false);
  const [sitePending, setSitePending] = useState(false);

  // 表单（新建 / 编辑共用）
  const [editing, setEditing] = useState<Course | null>(null);
  const [name, setName] = useState("");
  /** 表单里选的**分区 id**（空串＝未归类）。分区名与层级在分区面板里维护。 */
  const [partitionId, setPartitionId] = useState("");
  const [forms, setForms] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("开放");
  const [note, setNote] = useState("");
  /*
   * 网站卡片字段（v15）。课程库现在同时是**网站课程卡片**的来源：
   * 能连上后端时，网站上的栏目卡片就是这里的数据（见 docs/技术架构.md §10.1）。
   * 因此这几项要能在这里改，而不是只能去改内容文件。
   */
  const [path, setPath] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [target, setTarget] = useState("");
  const [order, setOrder] = useState("");
  const [intro, setIntro] = useState("");
  const [siteKind, setSiteKind] = useState<CourseSiteKind>("不展示");
  /*
   * 报价（元 / 节）：机构要的是"**一门课一张卡片里改完所有东西**" —— 卡片字段、网站正文、报价。
   * 报价那侧的管线本来就有（纯函数 `addLibraryCourseToPricing` 做 upsert + `pricing.update` 落库，
   * 报价页就是这么用的），因此这里只是把它接到卡片表单上：阶段 + 基础价 + 是否可报价。
   * 留空基础价 = 不参与报价页（内部课程不需要它）。
   */
  const [priceStage, setPriceStage] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [priceAvailable, setPriceAvailable] = useState(true);
  /** 当前报价配置（读一次用于下拉与回填；保存时在它基础上 upsert）。 */
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [pending, setPending] = useState(false);

  /*
   * ── 网站正文（课程页的学科 → 学段小节）──────────────────────────────────
   *
   * 这份草稿**由本页持有**，而不是各自存一份：卡片里的「网站正文（小节）」与下面那块
   * 「学科级设置与未挂到卡片的正文」改的是同一个东西（同一份正文整份覆盖保存）。
   * 两处各存一份草稿的话，先在一处保存、再到另一处保存，就会把前一处刚存的改动**静默盖回**
   * —— 这类"看起来保存成功了、内容却是旧的"最难查，因此口径只留一份（草稿 + 保存都在这页）。
   */
  const [siteContent, setSiteContent] = useState<SiteContent | null>(null);
  /** 草稿与库里不一致（＝这次保存要不要带上 `site.saveContent`）。 */
  const [contentDirty, setContentDirty] = useState(false);
  /** 面板的保存按钮用它禁用；卡片表单的保存用 `pending`（同一次提交里跑）。 */
  const [contentPending, setContentPending] = useState(false);
  /** 读不到正文的原因（读不到只影响"改正文"，不该让整个课程库页打不开）。 */
  const [contentLoadError, setContentLoadError] = useState("");
  /** 报价配置读不到时的说明（普通教师对 `pricing.get` 是 403，但课程库仍应可用）。 */
  const [pricingLoadError, setPricingLoadError] = useState("");
  /*
   * 面板的「保存网站内容」与卡片表单的保存**是两个动作**，因此提示也分两行：
   * 动作发生在哪一块，结果就显示在哪一块旁边（共用一行的话，在面板里保存的人
   * 得往页面上方找提示，容易以为没反应）。
   */
  const [contentMessage, setContentMessage] = useState("");
  const [contentError, setContentError] = useState("");
  /*
   * `contentDirty` 的镜像。给 `load()` 用：刷新/删除课程这些动作会重读数据，
   * 重读时不能把**还没保存的正文草稿**悄悄换掉（人会以为字被吃了）。
   * 但也不能把 `contentDirty` 塞进 `load` 的依赖 —— `load` 的身份一变，
   * 下面 `useEffect(..., [load])` 就会再跑一次，变成"改一个字就重新拉一遍全页数据"。
   */
  const contentDirtyRef = useRef(false);
  /** 「没有命中任何小节」时新增到哪个学科（空串＝第一个学科）。 */
  const [addBandSubjectId, setAddBandSubjectId] = useState("");
  /**
   * 卡片表单里**正在编的小节**（见 `BandSlot` 的说明）。
   *
   * 它刻意是**有状态的**、不是每次渲染从靶点现算：现算的话，用户改锚点 / 标题的第一下
   * 就会让它不再命中，那一块编辑器当场消失。重算只发生在四件事上：
   *   ① 换了编辑对象（`editing.id` 变）② 改了卡片靶点 ③ 改了卡片标签 ④ 正文被整份换掉（保存 / 读库）。
   * 增删小节的**下标位移**由 `addBand` / `removeBand` 自己修正（那是唯一会改结构的两处）。
   */
  const [bandSlots, setBandSlots] = useState<BandSlot[]>([]);
  /** 正文草稿的镜像：给上面那个 effect 读，但不放进它的依赖（放进去就变成"每敲一个字都重算"）。 */
  const siteContentRef = useRef<SiteContent | null>(null);
  /** 正文被**整份**换掉的次数（保存成功、读库成功时 +1）—— 重算在编小节的信号。 */
  const [contentStamp, setContentStamp] = useState(0);
  /*
   * 草稿镜像。放在"重算在编小节"那个 effect **之前**声明：同一个提交里两个 effect 按声明顺序跑，
   * 因此内容被换掉的那一次，镜像会先更新好，重算读到的就是最新的正文。
   */
  useEffect(() => {
    siteContentRef.current = siteContent;
  }, [siteContent]);

  const formOptions = useFormOptions();
  /**
   * 表单与清单用的分区下拉项：一级栏目在前，子栏目缩进跟在它下面。
   *
   * 用一个扁平数组而不是两级下拉：机构说的"分区"就是"这门课在哪一栏、哪一小节"，
   * 一次选定比先选栏目再选子栏目少一半点击；层级用 `　` 缩进与「/」路径表达。
   */
  const partitionChoices = useMemo(
    () =>
      topLevelPartitions(partitions).flatMap((column) => [
        { value: column.id, label: column.name, depth: 1 as const },
        ...childPartitions(partitions, column.id).map((child) => ({
          value: child.id,
          // 写法与导出、清单、数据页共用一处实现（见 course-partitions.ts）
          label: partitionPathLabel(partitions, child.id),
          depth: 2 as const,
        })),
      ]),
    [partitions],
  );
  /**
   * 分区 id → 显示名（清单里每张卡片上要写"属于哪一区"）。
   *
   * 直接用 `partitionPathLabel()`：导出、下拉、清单、数据页四处必须是同一个写法，
   * 各拼一次的话"这里写 `七选三`、导出写 `高中课内 / 七选三`"没有任何自检能发现。
   */
  const partitionLabelOf = useCallback(
    (id: string): string => partitionPathLabel(partitions, id),
    [partitions],
  );

  /**
   * 就地动作期间的滚动守护（见 `useScrollGuard`）：`toggleStatus` 前后各用一次。
   *
   * 为什么放在这里而不是每个页面各写一套：它是"就地动作"这一整类动作的共同纪律 ——
   * 就地更新让文档高度变一下时，不许把用户的滚动位置带走。
   */
  const scrollGuard = useScrollGuard();

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时，不把列表换掉、只在旁边显示"刷新中…"。
   * 这一点是必须的：如果刷新时把整块列表换成一行"加载中…"，页面高度会从很高塌成一行，
   * 浏览器随即把滚动位置夹回顶部 —— 于是"点一下『设为暂未开放』就跳回页面顶部、
   * 还得再往下滑"（真实反馈）。首屏加载用 `loading`（那时本来就没内容可保）。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet === true) setRefreshing(true);
    else setLoading(true);
    const [list, both, stats, config, site] = await Promise.all([
      /*
       * 分区与课程一起读。
       *
       * `coursePartitions.list` 是 `crud` 组的**只读**方法 → 四类角色都能读
       * （与 `courses.list` 同一个权限口径），因此不像报价那样需要单独 catch：
       * 读得到课程就一定读得到分区。
       */
      api.courses.list(),
      api.coursePartitions.list().then((items) => ({ items })),
      api.courses.summary(),
      /*
       * 报价配置**单独 catch**：`pricing.get` 对普通教师是 403（报价归技术/财务/招生），
       * 而这一页 `PAGE_ACCESS` 是允许普通教师进来看课程的 —— 早先把三个请求放进同一个
       * `Promise.all`，于是教师一点进课程库就是"整页停在一行「加载中…」"，
       * 没有任何解释（审计实测到的那条：403 → 远端代理 reject → `setLoading(false)` 走不到）。
       * 现在：读不到报价就退回 `null`，页面上"报价状态"那部分改成一句说明，课程照常能看。
       */
      api.pricing.get().catch(() => null),
      /*
       * 网站正文同样单独 catch：它读不到只是"正文那两块暂时改不了"，
       * 不该把整个课程库页拖成打不开 —— 排课科目、价格状态都还等着这一页。
       */
      api.site
        .publicContent()
        .then((data) => data.siteContent)
        .catch(() => null),
    ]);
    setCourses(list);
    setPartitions(both.items);
    setSummary(stats);
    setPricingConfig(config);
    setPricingStatus(config === null ? [] : pricingStatusForCourses(config, list));
    /*
     * 报价读不到时**单独说一句**（不借用"网站正文"那条错误 —— 那会把原因说错地方）。
     */
    setPricingLoadError(
      config === null
        ? "读不到报价配置（你的角色可能看不到报价）—— 课程照常能看，但「未定价 / 已定价」与报价阶段暂时不显示。"
        : "",
    );
    if (site === null) {
      setContentLoadError("读不到网站正文（后端没在跑？）—— 卡片里的「网站正文」与下面的学科面板暂时改不了。");
    } else {
      setContentLoadError("");
      // 有未保存的正文改动时不覆盖草稿：刷新走的是"重读数据"，不该吃掉人刚打的字
      if (!contentDirtyRef.current) {
        setSiteContent(site);
        // 整份换掉了 → 让卡片里那块按新的正文重算"在编小节"（见 bandSlots 的说明）
        setContentStamp((value) => value + 1);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setName("");
    setPartitionId("");
    setForms([]);
    setStatus("开放");
    setNote("");
    setPath("");
    setTagsText("");
    setTarget("");
    setOrder("");
    setIntro("");
    setSiteKind("不展示");
    setPriceStage("");
    setPriceValue("");
    setPriceAvailable(true);
  }

  function startEdit(course: Course) {
    setEditing(course);
    setName(course.name);
    setPartitionId(course.partitionId);
    setForms(course.forms);
    setStatus(course.status);
    setNote(course.note);
    setPath(course.path);
    // 标签写成「学考→高中物理学考、选考→高中物理选考」，与内容文件里的写法一致
    setTagsText(course.tags.map((tag) => `${tag.label}→${tag.target}`).join("、"));
    setTarget(course.target);
    setOrder(course.order === 999 ? "" : String(course.order));
    setIntro(course.intro);
    setSiteKind(course.siteKind);
    // 报价回填：从当前配置里找这门课（按 id 或名字），没配过就留空
    const status = pricingStatus.find((item) => item.courseId === course.id);
    setPriceStage(status?.stageName ?? "");
    setPriceValue(status?.basePrice === null || status?.basePrice === undefined ? "" : String(status.basePrice));
    const priced = pricingConfig?.stages
      .flatMap((stage) => stage.courses)
      .find((item) => item.courseId === course.id || item.name === course.name);
    setPriceAvailable(priced?.available ?? true);
    setMessage("");
    setError("");
    /*
     * 这里**刻意不滚动页面**（原来有一句 `window.scrollTo({ top: 0 })`，因为那时表单在页面顶部）。
     * 现在编辑器就在被点的那张卡片下面展开：滚到顶部等于把人从"他刚点的那门课"旁边挪走，
     * 还得再滑回来。点一下 → 卡片下面立刻出现编辑器，页面本身不动。
     */
  }

  /*
   * ── 卡片 ↔ 正文小节 ────────────────────────────────────────────────────
   *
   * 下面这几个值每渲染算一次就够（61 个小节，代价可以忽略），刻意**不做 useMemo**：
   * 缓存它换不来什么，却多一处"依赖写漏了就显示旧数据"的风险。
   *
   * 命中规则不在这里写：`bandsForCard`（`lib/backend/site-bands.ts`）是全仓库唯一的一份，
   * 课程清单的「网站正文」按钮、下面那块学科面板、以及自检脚本用的是同一个函数。
   * 命中规则有两份实现的下场是"按钮说找不到、面板里明明看得见"，而且不会报错。
   */
  /** 表单里此刻的标签（用户可能刚改过，还没保存也要跟着显示）。 */
  const cardTags = parseTags(tagsText);
  /** 这张卡片指着的全部名字：自己的靶点 + 各标签的目标。 */
  const cardTargetList = cardTargets({ target, tags: cardTags });
  /*
   * 在编小节的**成员表**（见 `bandSlots` 的说明）：只在这张卡片的字段变化或正文被整份换掉时重算。
   * 下标一律按 (学科, 小节) 记 —— 改锚点 / 标题不会让这一块跳走。
   */
  useEffect(() => {
    const content = siteContentRef.current;
    if (content === null) {
      setBandSlots([]);
      return;
    }
    setBandSlots(
      bandsForCard(content.coursePage.subjects, { target, tags: parseTags(tagsText) }).map((hit) => ({
        subjectIndex: hit.subjectIndex,
        bandIndex: hit.bandIndex,
        matched: hit.matched,
      })),
    );
  }, [editing?.id, target, tagsText, contentStamp]);
  /** 成员表里的槽位 → 这一刻草稿里的真实小节的（学科或小节被删掉时那个槽位就自动消失）。 */
  const listedHits: BandHit[] = bandSlots.flatMap((slot) => {
    const subject = siteContent?.coursePage.subjects[slot.subjectIndex];
    const band = subject?.bands[slot.bandIndex];
    if (subject === undefined || band === undefined) return [];
    return [
      { subject, subjectIndex: slot.subjectIndex, band, bandIndex: slot.bandIndex, matched: slot.matched },
    ];
  });
  /** 成员表里的槽位分布在几个学科里（>1 时页面要提醒：新增会加到第一个学科）。 */
  const hitSubjectNames = [...new Set(listedHits.map((hit) => hit.subject.name))];
  /**
   * 只有"会上网站"的卡片才显示「网站正文（小节）」这一块：填了网站形态与卡片路径
   * 才可能出现在网站课程页上，也才有指着小节的正文明细要改。内部课（围棋、书法）
   * 不该看到一块满是锚点的表单 —— 与课程清单里那个「网站正文」按钮同一个判据。
   */
  const showSiteBands = siteKind !== "不展示" && path.trim() !== "";

  /**
   * 判"还有谁指着这个小节"时看的卡片 = 库里**除正在改的这张之外**的卡片 + 这张的**草稿**。
   *
   * 为什么草稿也算：保存顺序是课程记录 → 正文 → 报价，服务端判护栏时读到的已经是
   * **改过标签之后**的课程行。前台要是只按落盘的那一份判，就会出现"用户在同一张表单里
   * 把标签从 A 改成 B、同时删掉 A 小节"，前台按旧标签拦着不让删、服务端其实会放行 ——
   * 两边结论不一致，而人只会觉得"这个按钮坏了"。
   */
  const anchorGuardCards: CardAnchorSource[] = [
    ...(courses ?? []).filter((course) => course.id !== editing?.id),
    {
      name: editing === null ? "（正在新建的这张卡片）" : name.trim(),
      target,
      tags: cardTags,
    },
  ];

  /**
   * 改网站正文草稿（卡片里的「网站正文」与下面的学科面板共用这一个入口）。
   *
   * 为什么是"整份深拷贝改一份"：服务端 `site.saveContent` 是**整份覆盖**，
   * 草稿就必须是完整的一份；在库里的对象上就地改会出现"页面已经变了、库还没变"的样子。
   * `contentDirty` 只在这里被置真 —— 保存时"要不要写正文"就看它（见 onSubmit）。
   *
   * `keepSlots: true` = **调用方自己负责**把"在编小节"的成员表修好（目前只有 `addBand` 用它：
   * 刚加的那一节还没被卡片指着，不能让它重算掉，否则"新增了却看不见"）。
   * 其余的增删（比如在下面那块面板里删了一节）会改结构指纹 → 这里通知那一块重算，
   * 免得下标整体前移之后把另一节的正文改掉。
   */
  function editSiteContent(
    mutate: (draft: SiteContent) => void,
    options: { keepSlots?: boolean } = {},
  ): void {
    if (siteContent === null) return;
    const structureBefore = structureOf(siteContent);
    const draft = JSON.parse(JSON.stringify(siteContent)) as SiteContent;
    mutate(draft);
    setSiteContent(draft);
    setContentDirty(true);
    contentDirtyRef.current = true;
    setContentMessage("");
    setContentError("");
    if (options.keepSlots !== true && structureOf(draft) !== structureBefore) {
      setContentStamp((value) => value + 1);
    }
  }

  /** 保存成功后把服务端那一份当新草稿（它做过 trim），并清掉"改过"的标记。 */
  function applySavedContent(saved: SiteContent): void {
    setSiteContent(saved);
    setContentDirty(false);
    contentDirtyRef.current = false;
    // 正文整份换掉了：卡片里那块按新正文重算"在编小节"（改过锚点又没改卡片的槽位会在这里退场）
    setContentStamp((value) => value + 1);
  }

  /** 下面那块学科面板的「保存网站内容」。卡片表单的保存走 onSubmit —— 两条路同一个落盘点。 */
  async function saveSiteContent(): Promise<void> {
    if (siteContent === null || !contentDirty) return;
    setContentPending(true);
    setContentError("");
    setContentMessage("");
    try {
      const saved = await api.site.saveContent(siteContent);
      applySavedContent(saved);
      setContentMessage(`已保存网站正文：${contentCountText(saved)}。重新构站一次（npm run build）网站就会跟着变。`);
    } catch (cause) {
      setContentError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setContentPending(false);
    }
  }

  /**
   * 删除一个小节。
   *
   * ## 为什么删之前要看有没有卡片指着它
   *
   * 卡片上的标签与靶点存的是**小节锚点**：锚点没了，那张卡片点进去就落空 ——
   * 网站那侧不会报错，只会停在页面顶部。这是这个页面最容易做出来的一次事故
   * （删小节和改标签是两个人、两个时间做的）。
   *
   * 因此这里**拒绝并点名**那门课，而不是问一句"确定吗"：一句确定的对话里，
   * 人根本不会意识到自己删的是别人卡片的目标；点名之后要么去改那门课的标签，
   * 要么就别删。同一条规则也在服务端判一次（`validateSiteContent`）——
   * 前台只拦得住手滑，拦不住直接调接口。
   */
  function removeBand(hit: BandHit): void {
    const anchor = hit.band.id.trim();
    const owners = coursesReferencingAnchor(anchorGuardCards, anchor);
    if (owners.length > 0) {
      setMessage("");
      /*
       * 被拒的**理由写在这一节自己的框里**（键＝学科下标-小节下标，与列表 key 同源）。
       *
       * 这里原来是一句 `window.scrollTo({ top: 0, behavior: "smooth" })`，为的是
       * "把被拒的人带到页顶那条原因跟前"。编辑器改成就地展开之后那句话就变成害人的了：
       * 页顶离这一节好几屏，滚上去等于把人从刚点的那一节旁边甩开；而且"跳顶部"本身
       * 正是机构反馈的毛病（§15.3）。挂在框里之后，理由出现在手指底下，页面一动不动 ——
       * 于是全仓库再也不需要任何一句显式滚动（自检里有一条断言守着这件事）。
       */
      setBandError({
        key: `${hit.subjectIndex}-${hit.bandIndex}`,
        text:
          `不能删掉小节「${anchor}」：课程 ${owners.map((course) => `「${course.name}」`).join("、")} 的` +
          "卡片靶点 / 标签还指着它，删了它网站上那张卡片点进去就会跳空。" +
          "请先改掉那门课的标签 / 靶点（改完保存），再回来删这个小节。",
      });
      return;
    }
    setBandError(null);
    editSiteContent(
      (draft) => {
        draft.coursePage.subjects[hit.subjectIndex]?.bands.splice(hit.bandIndex, 1);
      },
      /*
       * 这一次**我们自己知道**消失的是哪个槽位，因此不走"整表重算"（`keepSlots`）：
       * 重算会顺带把"改了锚点、卡片还没来得及改"的槽位一起扫掉，而那几个槽位
       * 正是人此刻在改的东西。下面那个修正就两步：去掉删掉的那个槽位，
       * 它后面同科的下标各减一。
       */
      { keepSlots: true },
    );
    setBandSlots((slots) =>
      slots
        .filter((slot) => !(slot.subjectIndex === hit.subjectIndex && slot.bandIndex === hit.bandIndex))
        .map((slot) =>
          slot.subjectIndex === hit.subjectIndex && slot.bandIndex > hit.bandIndex
            ? { ...slot, bandIndex: slot.bandIndex - 1 }
            : slot,
        ),
    );
    /*
     * 成功时**只写这一条提示**，不去动页顶那条 `error` 横幅。
     *
     * 这一条提示在页顶（会长高一行）—— 长高是安全的：它在滚动位置**上方**，页面只是把内容
     * 往下推一点，浏览器不会把滚动位置夹回顶部。真正会夹的是**变矮**（把上面那一块拿掉，
     * 剩下的一页装不下原来的滚动位置）。所以就地动作一律"可以多一行字，不许少一块内容"。
     */
    setMessage(`已删掉小节「${anchor}」—— 按「保存修改」才会真的写进库里。`);
  }

  /**
   * 新增一个小节，挂到 `subjectId`（空串 ＝ 之前选的/第一个学科）。
   *
   * 标题与锚点都按「课程名 + 小节N」给默认值，锚点还保证**组内与全库都不重名**
   * （`uniqueBandAnchor`：重了自动取下一个可用值）。
   * 为什么不能等 `validateSiteContent` 拒：表单是课程 + 正文 + 报价**一起交**的，
   * 服务端一拒就是整份被拒 —— 人看到的是"课程也没保存上"，真正的原因却是锚点重了一个字。
   */
  function addBand(subjectId: string): void {
    if (siteContent === null) return;
    const subjects = siteContent.coursePage.subjects;
    const subject = subjects.find((item) => item.id === subjectId) ?? subjects[0];
    if (subject === undefined) {
      /*
       * 一个学科都没有时无处可挂：这是**整块正文**的问题（不是某一节的问题），
       * 因此仍然显示在页顶那条横幅里 —— 这一条没有"被点的那一节"可以挂。
       */
      setError("课程正文里还没有学科 —— 先到下面「学科级设置与未挂到卡片的正文」里「新增学科」，再回来挂小节。");
      return;
    }
    const subjectIndex = subjects.indexOf(subject);
    const base = `${name.trim() === "" ? "新课程" : name.trim()}小节${subject.bands.length + 1}`;
    const anchor = uniqueBandAnchor(subjects, base);
    editSiteContent(
      (draft) => {
        draft.coursePage.subjects[subjectIndex]?.bands.push({ id: anchor, title: base, body: "" });
      },
      // 刚加的这一节还没被卡片指着，自己把它放进"在编小节"（见 editSiteContent 的 keepSlots）
      { keepSlots: true },
    );
    const bandIndex = subject.bands.length;
    setBandSlots((slots) =>
      slots.some((slot) => slot.subjectIndex === subjectIndex && slot.bandIndex === bandIndex)
        ? slots
        : [...slots, { subjectIndex, bandIndex, matched: "" }],
    );
    setBandError(null);
    setMessage(
      `已在学科「${subject.name}」下新增小节「${base}」（锚点 ${anchor}）—— ` +
        "按「保存修改」才会真的写进库里；想让它成为卡片点进去的那一节，把上面的「卡片点进哪一节」改成这个锚点。",
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    const payload = {
      name: name.trim(),
      // 分区存的是 id（v18）：名字与层级都在分区表里，这里不改名、也不建区
      partitionId,
      forms,
      status: (status === "暂未开放" ? "暂未开放" : "开放") as Course["status"],
      note: note.trim(),
      path: path.trim(),
      tags: cardTags,
      // 卡片点进哪个小节：没填就按「课程名，其次是第一个标签的目标」推导（网站那侧的口径）
      target: target.trim(),
      order: order.trim() === "" || !Number.isFinite(Number(order)) ? 999 : Number(order),
      intro: intro.trim(),
      siteKind,
    };
    const courseName = payload.name;
    /** 这次是新建还是改（`editing` 在后面会被换成刚写下去的那一版，因此先记下来）。 */
    const isCreate = editing === null;
    /*
     * **改过正文才写正文**。
     *
     * `site.saveContent` 是整份覆盖 + 一次操作日志；每次保存都顺手写一遍的话，
     * 日志里会堆满"保存网站内容（数量未变）"，真正的改动反而被淹掉，
     * 而且每写一次都要跑一遍校验（含删除护栏）——平白多一条被拒的可能。
     * `contentDirty` 只在 `editSiteContent` 里置真（改标题 / 锚点 / 正文、增删小节都走它），
     * 因此"改过没有"这件事从代码上一眼看得出来。
     */
    const saveContentToo = contentDirty && siteContent !== null;
    const price = Number(priceValue);
    const priceFilled = priceValue.trim() !== "" && Number.isFinite(price) && price >= 0;
    /** 服务端实际写下去之后的课程（失败时留在表单里，见 catch）。 */
    let savedCourse: Course | null = editing;
    /** 保存成功后那一条提示要说的三件事。 */
    const pieces: string[] = [];

    try {
      /*
       * 保存顺序：**课程记录 → 网站正文 → 报价**。
       *
       * 顺序不是随手定的，两边都说得通才算定下来：
       *   1. **谁挂在谁身上** —— 课程记录是主体，正文（卡片点进去的那一节）与报价
       *      （按课程名 / id 认领的那一条价目）都挂在它上面。先写报价的话，
       *      课程没保存成功就会留下一条指向不存在课程的价目，看到的是"价格改了、
       *      课程却没改成"；先写正文也一样，正文挂着一个小节，卡片却没指向它。
       *   2. **能失败的两步放后面** —— 正文要过 `validateSiteContent`（含删除护栏）、
       *      报价要过 `validatePricingConfig`，它们比课程字段更容易被拒。
       *      先做主体、再做会失败的两步，失败时停在"前面已经写好"的状态上：
       *      错误信息说的问题就是它说的问题，人接着改就行，不必回头核对三处。
       */
      if (isCreate) {
        // ① 课程记录
        savedCourse = await api.courses.create({
          ...payload,
          origin: "后台",
          createdAt: new Date().toISOString(),
        });
        pieces.push(siteKind === "不展示" ? "卡片（只在后台用）" : `卡片（网站上以「${siteKind}」出现）`);
      } else {
        /*
         * 带上**打开编辑时读到的那一版**（乐观锁，v17）：两个人同时改同一门课时，
         * 后提交的会被服务端拒绝，而不是把对方改的一整份静默盖掉。
         * 冲突时 `cause.message` 就是服务端原话（含"刚被别人改过"），
         * 由下面同一个 `setError` 显示 —— 界面上不另造一套提示。
         */
        const updated = await api.courses.update(editing.id, payload, { expectedVersion: editing.version });
        if (updated !== null) savedCourse = updated;
        pieces.push("卡片");
      }
      // 后面两步失败时表单还开着，用**刚写下去的那一版**接着改：不然重试会撞上
      // 自己刚刚造成的版本冲突（服务端会说"刚被别人改过"，其实是被自己改过）
      setEditing(savedCourse);

      // ② 网站正文（只在真的改过时写，见上面的 saveContentToo）
      if (saveContentToo && siteContent !== null) {
        const savedContent = await api.site.saveContent(siteContent);
        applySavedContent(savedContent);
        const bandCount = bandsForCard(savedContent.coursePage.subjects, payload).length;
        pieces.push(
          bandCount === 0
            ? "网站正文（已保存，这张卡片还没指向任何小节）"
            : `网站正文（${bandCount} 个小节）`,
        );
      }

      /*
       * ③ 报价与卡片**一起存**（机构要的是"一门课一个地方改完"）。
       *
       * 只在填了基础价时写报价：留空表示"这门课不参与报价页"（内部课程用不上），
       * 而不是"把价格清成 0" —— 静默改价是账目类功能里最不该有的行为。
       */
      if (priceFilled) {
        const config = pricingConfig ?? (await api.pricing.get());
        const stageName = priceStage.trim() === "" ? (config.stages[0]?.name ?? "未分组") : priceStage.trim();
        /*
         * 新建时课程还没有 id，用名字关联（`pricingStatusForCourses` 与 `syncLibraryLinks`
         * 都支持"按名字认领"），下一步保存后 `load()` 会重新读一次配置并把 courseId 补上。
         */
        const updated = addLibraryCourseToPricing(config, {
          courseId: savedCourse?.id ?? "",
          name: courseName,
          stageName,
          basePrice: price,
          available: priceAvailable,
        });
        await api.pricing.update(updated.config);
        pieces.push(`报价（${stageName} · ${price} 元/节${priceAvailable ? "" : " · 暂不可报价"}）`);
      }

      setMessage(
        `${isCreate ? "已添加" : "已保存"}「${courseName}」：${pieces.join(" + ")}。` +
          (isCreate ? "它现在可以用于排课、报课与教师科目。" : ""),
      );
      resetForm();
      await load({ quiet: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
      /*
       * 失败时**不清空表单**（人改的东西还在），也不丢掉还没写下去的正文草稿。
       * 仍然安静刷新一次列表：前面几步已经写下去的部分（课程记录）要在清单里看得见 ——
       * 否则会出现"提示说失败、其实课程已经改了"的错觉。
       * 草稿那里 `load` 会自己跳过覆盖（`contentDirtyRef`），不会吃掉人打的字。
       */
      await load({ quiet: true });
    } finally {
      setPending(false);
    }
  }

  /**
   * 切换「开放 / 暂未开放」。
   *
   * ## 这个动作**只允许**做三件事（一条都不能多）
   *
   *   1. 写库（`api.courses.update`）；
   *   2. 把这一条**就地换掉**（`setCourses` 里 map 一条）—— 不是整页重载：
   *      重载会把列表换成"加载中…"，页面高度从很高塌成一行，浏览器随即把滚动位置
   *      夹回顶部（"点一下『设为暂未开放』就跳回页面顶部"，真实反馈）；
   *   3. 补一次计数（`summary`，只改页顶那一行字）。
   *
   * **不滚动、不清空列表、不动 `loading`** —— 这三件是这一页所有就地动作的共同纪律，
   * 自检里有源码断言守着（`scripts/check.mts` 的「就地动作」那两条）。
   *
   * ## 为什么现在有 try/catch
   *
   * 以前这里没有：写失败（最常见的是会话失效的 401 —— 后端重启过）会变成
   * 一个没人看得见的 rejected promise，界面上什么都不发生。人看不到原因，
   * 只会反复点、再怀疑是"点了就跳顶部"。现在失败原话显示在**那张卡片上**，
   * 而且不往页顶放横幅（页顶横幅出现/消失＝页高变化，就在点击的同一瞬间）。
   */
  /* ── 分区：新建 / 改名 / 排序 / 删除 / 把一批课移进来 ────────────────────── */

  /**
   * 分区的写动作统一走这里：**动作名 + 一次真正的写**。
   *
   * 三个共同点值得收在一处（否则每个动作各写一遍，迟早漏掉一个）：
   *   1. 写之前 `clear()`、失败把服务端原话显示出来（删除被护栏拦下时那句话就是给人看的下一步）；
   *   2. 写完**重读整页数据**（课程与分区一起）—— 分区一动，清单的分组就变了，
   *      局部拼一份新状态比重新读一遍更容易写错（尤其是顺序）；
   *   3. 重读用 `quiet`：不清空列表，免得页面高度塌一下把人家的滚动位置带走。
   */
  async function partitionAction(label: string, run: () => Promise<string>): Promise<void> {
    partitionNotice.clear();
    try {
      const text = await run();
      await load({ quiet: true });
      partitionNotice.succeed(text);
    } catch (cause) {
      partitionNotice.fail(
        `${label}失败：${cause instanceof Error ? cause.message : "未知原因"}`,
      );
    }
  }

  async function createPartition(): Promise<void> {
    const name = newPartitionName.trim();
    if (name === "") {
      partitionNotice.fail("分区名不能为空。");
      return;
    }
    await partitionAction("新建分区", async () => {
      const created = await api.coursePartitions.create({ name, parentId: newPartitionParent });
      setNewPartitionName("");
      return `已新建${created.parentId === "" ? "栏目" : "子栏目"}「${created.name}」。`;
    });
  }

  async function renamePartition(id: string): Promise<void> {
    const current = partitions.find((item) => item.id === id);
    const name = renameText.trim();
    setRenamingId(null);
    if (current === undefined || name === "" || name === current.name) return;
    await partitionAction("改分区名", async () => {
      await api.coursePartitions.update(id, { name });
      return `分区已改名为「${name}」（课程挂的是分区 id，因此下面每一门课都跟着变了，不需要逐门改）。`;
    });
  }

  /**
   * 同级上移 / 下移：把**整组的新顺序**交上去（`reorder` 的语义就是"按这个顺序排"）。
   *
   * 为什么不交"把这个和上一个换一下"：两次点击之间别人插了一条时，那种语义会移错位置。
   */
  async function movePartition(id: string, delta: -1 | 1): Promise<void> {
    const target = partitions.find((item) => item.id === id);
    if (target === undefined) return;
    const siblings = childPartitions(partitions, target.parentId);
    const index = siblings.findIndex((item) => item.id === id);
    const swap = index + delta;
    if (index === -1 || swap < 0 || swap >= siblings.length) return;
    const ids = siblings.map((item) => item.id);
    const moved = ids[index]!;
    ids[index] = ids[swap]!;
    ids[swap] = moved;
    await partitionAction("调整分区顺序", async () => {
      await api.coursePartitions.reorder(ids);
      return `已把「${target.name}」${delta === -1 ? "上移" : "下移"}一位。`;
    });
  }

  async function removePartition(id: string): Promise<void> {
    const target = partitions.find((item) => item.id === id);
    if (target === undefined) return;
    /*
     * 先按同一套护栏**在界面上预判**一次，把理由当场说出来。
     * 服务端仍会再拦一遍（界面上的判断只是"早点说"，不是"说过了就不拦"）——
     * 两边用同一个 `partitionDeleteRefusal`，因此不会出现"界面说能删、服务端拒绝"。
     */
    const block = partitionDeleteRefusal(
      partitions,
      (partitionId) => (courses ?? []).filter((course) => course.partitionId === partitionId).length,
      id,
    );
    if (block !== "") {
      partitionNotice.fail(block);
      return;
    }
    if (!window.confirm(`删除分区「${target.name}」？`)) return;
    await partitionAction("删除分区", async () => {
      await api.coursePartitions.remove(id);
      return `已删除分区「${target.name}」。`;
    });
  }

  /** 把某一区（或某一子栏目）的课整批移到另一个分区。 */
  async function moveCourses(ids: string[], fromName: string, toId: string): Promise<void> {
    if (ids.length === 0) return;
    setMovingFrom(fromName);
    await partitionAction("移动课程", async () => {
      const count = await api.courses.setPartition(ids, toId);
      const to = partitionChoices.find((item) => item.value === toId)?.label ?? "未归类";
      return count === 0 ? "这些课本来就在目标分区里，没有移动。" : `已把「${fromName}」下的 ${count} 门课移到「${to}」。`;
    });
    setMovingFrom(null);
  }

  /**
   * 清单里一个分区的标题行：名字 + 门数 + （有权限时）改名 / 上下移 / 删除 / 整批移课。
   *
   * 标题行同时承担"分区管理"的入口，而不是另做一张管理页：
   * 机构整理课程时看的正是这一屏 —— 发现"这一区该叫别的名字"就地改，比跳到另一页找
   * 那个分区要顺手得多（也确实少了"两个地方都要维护"的负担）。
   */
  function renderPartitionHeader(
    partition: CoursePartition,
    items: Course[],
    level: 1 | 2,
  ): ReactNode {
    const Heading = level === 1 ? "h3" : "h4";
    const siblings = childPartitions(partitions, partition.parentId);
    const index = siblings.findIndex((item) => item.id === partition.id);
    const pending = partitionNotice.pending;
    return (
      <div className={cn("flex flex-wrap items-center gap-2", level === 1 ? "mb-1" : "mb-2")}>
        {renamingId === partition.id ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void renamePartition(partition.id);
            }}
          >
            <input
              autoFocus
              value={renameText}
              onChange={(event) => setRenameText(event.target.value)}
              onBlur={() => void renamePartition(partition.id)}
              className="h-7 w-40 rounded-md border border-brand-400 px-2 text-xs outline-none"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              保存名字
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
              取消
            </Button>
          </form>
        ) : (
          <Heading
            className={cn(
              "font-medium",
              level === 1 ? "text-xs text-ink-500" : "text-[11px] text-ink-400",
            )}
          >
            {partition.name}
            <span className="ml-2 font-normal text-ink-400">{items.length} 门</span>
          </Heading>
        )}

        {canWritePartition && renamingId !== partition.id && (
          <span className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setRenamingId(partition.id);
                setRenameText(partition.name);
                partitionNotice.clear();
              }}
              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300"
            >
              改名
            </button>
            {/*
              上下移只对同级有效：第一项不能再上移、最后一项不能再下移（按钮直接禁用，
              而不是点了没反应 —— 后者会让人以为坏了）。
            */}
            <button
              type="button"
              disabled={index <= 0 || pending}
              onClick={() => void movePartition(partition.id, -1)}
              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === -1 || index >= siblings.length - 1 || pending}
              onClick={() => void movePartition(partition.id, 1)}
              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
            >
              ↓
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void removePartition(partition.id)}
              className="rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600 disabled:opacity-40"
            >
              删除
            </button>
            {/*
              整批移课：机构最常见的整理动作是"这一区整体挪个位置"。
              门数为 0 时不显示（没有东西可移，留着只会让人点了才知道）。
            */}
            {items.length > 0 && movingFrom !== partition.name && (
              <label className="flex items-center gap-1 text-[11px] text-ink-500">
                移到
                <select
                  defaultValue={PICK_PLACEHOLDER}
                  disabled={pending}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === PICK_PLACEHOLDER) return;
                    void moveCourses(
                      items.map((course) => course.id),
                      partition.name,
                      value,
                    );
                    event.target.value = PICK_PLACEHOLDER;
                  }}
                  className="h-6 rounded-sm border border-ink-200 bg-white px-1 text-[11px] outline-none"
                >
                  {/*
                    占位项用一个**不会与真值撞上**的哨兵值，而不是空串：
                    空串本身是合法值（＝未归类），两项都用 `value=""` 的话浏览器只能选中一个
                    ——「选择分区…」与「（未归类）」看起来一模一样，点了也不知道选的是哪个。
                  */}
                  <option value={PICK_PLACEHOLDER}>选择分区…</option>
                  <option value="">（未归类）</option>
                  {partitionChoices
                    .filter((choice) => choice.value !== partition.id)
                    .map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {movingFrom === partition.name && (
              <span className="text-[11px] text-ink-400">移动中…</span>
            )}
          </span>
        )}
      </div>
    );
  }

  async function toggleStatus(course: Course) {
    /*
     * 防连点：改用 aria-disabled 之后按钮仍可点，因此在这里挡住（见按钮上的注释）。
     * 只拦"同一张卡片被连点两下"：那会发出两条方向相反的写，而界面上哪个是最后状态
     * 看谁先回来。不同卡片之间互不阻塞（各改各的一行，计数最后各读一次）。
     */
    if (togglingId === course.id) return;
    const next: Course["status"] = course.status === "开放" ? "暂未开放" : "开放";
    setTogglingId(course.id);
    /*
     * 就地动作期间守住滚动位置（`useScrollGuard`）。
     *
     * 为什么这一下要守：这一次点击会带出好几次就地更新（这条数据、卡片上的结果提示、
     * 按钮上的"切换中…"、以及页顶那行计数），它们会让**文档高度**动一下 ——
     * 浏览器在这种情况下可能顺手把你的滚动位置挪走。判据写死在纯函数
     * `inPlaceScrollCorrection` 里：**只有"文档高度确实变了、位置也确实被挪了"**才把位置放回去；
     * 高度没变而位置变了，那是人自己在滚，一个字都不写（绝不去跟用户抢滚动条）。
     * 它写回的永远是**记下来的那个位置**，因此它没有能力制造"跳到最顶部"。
     */
    scrollGuard.arm();
    try {
      const updated = await api.courses.update(course.id, { status: next });
      if (updated !== null) {
        setCourses((prev) => (prev ?? []).map((item) => (item.id === course.id ? updated : item)));
      }
      setCardNote({ id: course.id, kind: "ok", text: `已设为「${next}」。` });
    } catch (cause) {
      setCardNote({
        id: course.id,
        kind: "error",
        text: `没能切换「${course.name}」的状态：${cause instanceof Error ? cause.message : "未知原因"}`,
      });
      return;
    } finally {
      setTogglingId(null);
    }
    /*
     * 计数单独一趟、单独兜错：状态**已经改好了**，这里读不到只是页顶那行数字旧一会儿，
     * 不该回过头去说"切换失败"（那会让人以为没生效，再点一下又切回去）。
     */
    try {
      setSummary(await api.courses.summary());
    } catch {
      // 读不到计数就算了：状态已落库，下次刷新会补上
    } finally {
      // 这一下动作带来的就地更新都提完了 → 解除守护（此后一个字都不再写）
      scrollGuard.release();
    }
  }

  async function remove(course: Course) {
    const verdict = canRemoveCourse(course);
    if (!verdict.ok) {
      // 被拒的理由写在卡片上（页顶那条横幅离这张卡片好几屏，见 toggleStatus 的说明）
      setCardNote({ id: course.id, kind: "error", text: verdict.reason });
      return;
    }
    if (!window.confirm(`删除课程「${course.name}」？已有课节与报课记录里的科目名不会变（它们按名字记的）。`)) {
      return;
    }
    try {
      await api.courses.remove(course.id);
      /*
       * 删掉的正是"正在编辑的那一张"时，顺手把编辑状态清掉。
       *
       * 为什么必须清：编辑器现在就挂在卡片下面，卡片没了 → 编辑器也不在了；
       * 但 `editing` 还留着的话，「新增课程」那块（`editing === null` 才出现）也回不来 ——
       * 页面上会既没有编辑器、也没有新增表单，无处可去。
       * 删除按钮本身照旧：不禁用、确认框也不变，这一步只在删除成功之后跑。
       */
      if (editing?.id === course.id) resetForm();
      setCardNote(null);
      setMessage(`已删除「${course.name}」。`);
      await load({ quiet: true });
    } catch (cause) {
      /*
       * 失败写在这张卡片上（卡片还在）：**不往页顶放横幅** —— 页顶横幅出现/消失
       * 就是一次页高变化，而那正好发生在人刚点完按钮的一瞬间。
       */
      setCardNote({
        id: course.id,
        kind: "error",
        text: cause instanceof Error ? cause.message : "删除失败。",
      });
    }
  }

  async function syncFromSite() {
    setSyncing(true);
    setError("");
    setMessage("");
    const result = await api.courses.syncFromSite();
    setSyncing(false);
    setMessage(
      result.added.length === 0
        ? `网站上的课程都已在课程库里（共 ${result.total} 门）。`
        : `从网站同步了 ${result.added.length} 门课程：${result.added.join("、")}（现共 ${result.total} 门）。`,
    );
    await load({ quiet: true });
  }

  /** 体检：只算不写（服务端在深拷贝上算，库里一个字都不会变）。 */
  async function checkSiteContent() {
    setSitePending(true);
    setError("");
    setMessage("");
    try {
      setSiteCheck(await api.site.importFromContent({ write: false }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "体检失败。");
    } finally {
      setSitePending(false);
    }
  }

  /** 确认写入：默认只补空；勾了「用网站内容覆盖」才替换已有内容。 */
  async function applySiteContent() {
    setSitePending(true);
    setError("");
    setMessage("");
    try {
      const report = await api.site.importFromContent({ write: true, overwrite: siteOverwrite });
      setSiteCheck(report);
      const { counts } = report;
      setMessage(
        `已从网站内容导入：教师 新增 ${counts.teachersAdded} / 补资料 ${counts.teachersFilled}，` +
          `课程 新增 ${counts.coursesAdded} / 补字段 ${counts.coursesFilled}，` +
          `课程正文 ${counts.subjectsWritten} 个学科 / ${counts.bandsWritten} 个小节，` +
          `报价文案 ${counts.labelsFilled} 项。`,
      );
      await load({ quiet: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败。");
    } finally {
      setSitePending(false);
    }
  }

  const visible = useMemo(
    () =>
      (courses ?? []).filter((course) => {
        if (originFilter !== "全部" && course.origin !== originFilter) return false;
        const key = keyword.trim();
        // 搜索也认分区名（"高中课内"能把它下面的课都筛出来）—— 分区是清单的主结构，
        // 只按课程名搜会让人以为那一区是空的
        return key === "" || course.name.includes(key) || partitionLabelOf(course.partitionId).includes(key);
      }),
    [courses, keyword, originFilter, partitionLabelOf],
  );

  /** 还没配价格的课程（家长问价时答不上来的那些）。 */
  const unpricedCount = useMemo(
    () => pricingStatus.filter((item) => !item.priced).length,
    [pricingStatus],
  );
  const priceOf = useMemo(() => {
    const map = new Map<string, LibraryPricingStatus>();
    for (const item of pricingStatus) map.set(item.courseId, item);
    return map;
  }, [pricingStatus]);

  /**
   * 清单的分组：**栏目 → 子栏目 → 课程**，与网站课程页同一棵树。
   *
   * 为什么用 `groupByPartition()` 而不是在这里再写一遍分组：那正是这一版修掉的毛病
   * （后台一份、网站一份，迟早对不上）。顺序、层级、空组规则全在那个纯函数里。
   *
   * `unpartitioned`：没有有效分区的课（未归类、或引用了一条已经被删掉的分区）。
   * 它们**不参与分组**（"没有分区"不是一个分区），单独列在清单最后。
   */
  const grouped = useMemo(() => groupByPartition(visible, partitions), [visible, partitions]);
  /** 正在筛选（搜索框有字 / 来源不是「全部」）—— 空分区在筛选结果里不显示，见下面的渲染。 */
  const filtering = keyword.trim() !== "" || originFilter !== "全部";
  const unpartitioned = useMemo(
    () => visible.filter((course) => partitionPlace(partitions, course.partitionId).leaf === null),
    [visible, partitions],
  );

  /**
   * 课程表单 —— **新增与编辑共用同一份 JSX**。
   *
   * 为什么做成"本组件里的一个渲染函数"，而不是抽出去一个 `<CourseForm>` 组件：
   * 这张表单读写的状态几乎全在本页（报价配置 / 每门课的定价状态 / 网站正文草稿 / `bandSlots` …），
   * 抽成组件就得把十几样状态与回调一个个当 props 传下去 —— 那只是把状态搬了个家，
   * 还会多出一层"哪一处改的是哪一份数据"的模糊。这里要的只是"同一份 JSX 在两处各渲染一次"。
   *
   * 随场合变动的只有外层 class：顶部的父级是 `Panel`（自带内边距），行内那块外面已经有容器、
   * 缩进与左边那条竖线（不再重复左右内边距）。
   *
   * 表单里的 `editing === null ? …` 分支不是死代码：顶部这次渲染就是 editing === null 那一边，
   * 行内这次渲染就是编辑那一边 —— 提交按钮上写「添加课程」还是「保存修改」全看它。
   */
  /**
   * 清单里**一张课程卡片**（含就地展开的编辑器）。
   *
   * 为什么抽成一个渲染函数：卡片要在两处渲染 —— 分区/子栏目分组里、以及最后那块
   * 「未归类 / 分区已失效」。复制一份出来的话，卡片上的按钮与提示要改两处，
   * 而且"未归类那一片"会慢慢长成另一个样子（那种不一致没人会主动发现）。
   */
  function renderCourseCard(course: Course): ReactNode {
    /*
     * 一门课 = 卡片那一格 + （正在编辑时）它下面那一格编辑器。
     * 两格是同一条课程的两半，因此用 `<Fragment key={course.id}>` 包起来：
     * key 仍然落在"这一门课"上，刷新 / 过滤 / 改状态时卡片与编辑器不会错配
     * （React 也就不会把这两格当成"另外一门课"重新挂载，输入焦点与光标得以保留）。
     */
    const isEditing = editing?.id === course.id;
    return (
      <Fragment key={course.id}>
<li
                    className={cn(
                      "rounded-md border px-3 py-2",
                      /*
                       * 三选一，而不是"基础样式 + 再叠一个正在编辑的样式"：
                       * `cn` 只拼字符串、不做 Tailwind 冲突消解（见 lib/utils/cn.ts 的说明），
                       * 两份都写的话 border-color 谁赢全看生成 CSS 的顺序 —— 那就成了看运气。
                       */
                      isEditing
                        ? "border-brand-400 bg-brand-50/60"
                        : course.status === "开放"
                          ? "border-ink-200"
                          : "border-dashed border-ink-300 bg-ink-50",
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-ink-900">{course.name}</span>
                      <span className="flex items-center gap-1">
                        {/* 正在编辑的那张卡片：给个明确的标签，不用只靠边框颜色认 */}
                        {isEditing && (
                          <span className="rounded-sm border border-brand-400 bg-white px-1.5 py-0.5 text-[11px] text-brand-700">
                            正在编辑
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-sm border px-1.5 py-0.5 text-[11px]",
                            course.origin === "后台"
                              ? "border-brand-200 bg-brand-50 text-brand-700"
                              : "border-ink-200 bg-white text-ink-500",
                          )}
                        >
                          {course.origin}
                        </span>
                        <span
                          className={cn(
                            "rounded-sm border px-1.5 py-0.5 text-[11px]",
                            course.status === "开放"
                              ? "border-success-100 bg-success-50 text-success-600"
                              : "border-ink-200 bg-ink-50 text-ink-500",
                          )}
                        >
                          {course.status}
                        </span>
                      </span>
                    </div>

                    {course.forms.length > 0 && (
                      <p className="mt-1 text-[11px] text-ink-500">
                        班型：{course.forms.join("、")}
                      </p>
                    )}
                    {course.note !== "" && (
                      <p className="mt-1 text-[11px] text-ink-400">{course.note}</p>
                    )}

                    {pricingLoadError !== "" && (
                      <p className="mt-1 text-[11px] leading-relaxed text-warning-600">
                        {pricingLoadError}
                      </p>
                    )}


                    {/* 报价状态：课程库与报价配置「打通」之后，这里能一眼看出哪门课还没定价 */}
                    {(() => {
                      const status = priceOf.get(course.id);
                      if (status === undefined) return null;
                      if (!status.priced) {
                        return (
                          <p className="mt-1 text-[11px] text-warning-600">
                            未定价 —— 到「报价」页给它填一个基础价，家长问价时才有依据
                          </p>
                        );
                      }
                      return (
                        <p className="mt-1 text-[11px] text-ink-500">
                          {status.basePrice === null
                            ? `已关联报价（${status.stageName} · 暂未开放）`
                            : `报价 ${status.basePrice} 元/节（${status.stageName}）`}
                        </p>
                      );
                    })()}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {canUpdateCourse && (
                        <button
                          type="button"
                          onClick={() => startEdit(course)}
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-600 hover:border-brand-300 hover:text-brand-700"
                        >
                          编辑
                        </button>
                      )}
                      {/*
                        从课程清单直接跳到**这门课正文所在的学科**。
                        卡片与它的正文是同一门课的两半；卡片里的「网站正文」已经能改小节正文了，
                        这个按钮留着是给"学科级的东西"用的（学科导语 / 整组暂未开放 / 未挂到卡片的正文）。
                        targets 的算法与卡片里那块共用（`cardTargets`），因此两处不会各说一套。
                      */}
                      {course.siteKind !== "不展示" && course.path !== "" && (
                        <button
                          type="button"
                          onClick={() =>
                            focusSiteSubject({
                              cardName: course.name,
                              targets: cardTargets(course),
                            })
                          }
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-600 hover:border-brand-300 hover:text-brand-700"
                        >
                          网站正文
                        </button>
                      )}
                      {/*
                        **刻意不用 `disabled`**：点击的瞬间把聚焦中的按钮置为 disabled，
                        浏览器会把焦点丢回文档体，而在焦点落回 body 时页面可能被滚回顶部 ——
                        这就是"代码里一处滚动都没有、点一下却被弹到最上面"的成因
                        （机构反馈：点完还要重新滚下来才能继续切别的科目）。
                        改成 `aria-disabled` + `pointer-events-none` + 在 handler 里提前返回：
                        外观与防连点一样，但**不夺走焦点**，页面不会动。
                      */}
                      {canUpdateCourse && (
                      <button
                        type="button"
                        aria-disabled={togglingId === course.id}
                        onClick={() => void toggleStatus(course)}
                        className={cn(
                          "rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-600 hover:border-brand-300 hover:text-brand-700",
                          togglingId === course.id && "pointer-events-none opacity-50",
                        )}
                      >
                        {togglingId === course.id
                          ? "切换中…"
                          : course.status === "开放"
                            ? "设为暂未开放"
                            : "设为开放"}
                      </button>
                      )}
                      {course.origin === "后台" && canRemoveCourseByRole && (
                        <button
                          type="button"
                          onClick={() => void remove(course)}
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 hover:border-danger-100 hover:text-danger-600"
                        >
                          删除
                        </button>
                      )}
                    </div>

                    {/*
                      就地动作的结果就写在这张卡片上（成功一行绿字 / 失败一行红字）。
                      放在卡片里而不是页顶：一是眼睛就在这儿，二是页顶那条横幅
                      一出现一消失就是滚动位置上面多了一块 / 少了一块 —— 而"少了一块"
                      正是让浏览器把滚动位置夹回顶部的那个动作（见 toggleStatus 的说明）。
                    */}
                    {cardNote !== null && cardNote.id === course.id && (
                      <p
                        role={cardNote.kind === "error" ? "alert" : undefined}
                        className={cn(
                          "mt-1 text-[11px] leading-relaxed",
                          cardNote.kind === "error" ? "text-danger-600" : "text-success-600",
                        )}
                      >
                        {cardNote.text}
                      </p>
                    )}
                  </li>
                  {/*
                   编辑器**就在这张卡片下面**展开：`col-span-full`（占满整行）。
                   为什么不让它挤在卡片那一格里：卡片网格在宽屏是 2~3 列，编辑器里有课程字段、
                   「网站上怎么展示」、小节正文、报价四块，挤进三分之一的宽度就没法用了；
                   占满整行之后它落在"这张卡片所在的那一行"下面，窄屏（一列）本来就是紧跟着卡片。
                   缩进 + 左边一条竖线 + 浅底：一眼看出它是这张卡片的编辑区，而不是又一张课程卡片。
                  */}
                  {isEditing && (
                    <li className="col-span-full">
                      <div className="ml-2 border-l-2 border-brand-300 bg-ink-50/70 py-3 pl-3 pr-3 sm:ml-4 sm:pl-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-ink-700">
                            正在编辑「{course.name}」
                            <span className="ml-2 font-normal text-ink-400">改完点下面「保存修改」，这一块会自己收起。</span>
                          </p>
                          <Button variant="ghost" size="sm" onClick={resetForm}>
                            取消
                          </Button>
                        </div>
                        {renderCourseForm("mt-3 space-y-3")}
                      </div>
                    </li>
                )}
                  
      </Fragment>
    );
  }

  function renderCourseForm(formClassName: string): ReactNode {
    return (
      <form onSubmit={onSubmit} className={formClassName}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="课程名"
            hint="排课与统计都按这个名字记，请不要重复"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 围棋"
            required
          />
          <SelectInput
            label="分区"
            hint="清单按它分组；增删改名到下面的「课程分区」"
            options={[
              // 未归类是**允许**的中间状态：先建课、之后再分区（服务端也接受空串）
              { value: "", label: "（未归类）" },
              ...partitionChoices.map((item) => ({
                value: item.value,
                label: item.depth === 1 ? item.label : `　└ ${item.label}`,
              })),
            ]}
            value={partitionId}
            onChange={(event) => setPartitionId(event.target.value)}
          />
          <SelectInput
            label="状态"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={COURSE_STATUSES.map((item) => ({ value: item, label: item }))}
          />
        </div>

        <MultiSelect
          label="可开班型"
          hint="这门课按哪些班型开班（留空也可以，后面再补）"
          options={formOptions.map((item) => ({ value: item }))}
          value={forms}
          onChange={setForms}
          placeholder="选择班型（可多选）"
        />

        <TextAreaField
          label="备注"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如：教材用《围棋入门》、需自备棋具"
        />

        {/*
          网站卡片字段（v15）：课程库同时是**网站课程卡片**的来源。
          刻意收在一个可折叠说明的区块里：只有"这门课要出现在网站上"时才需要填，
          日常加一门内部课（围棋、书法）用不上这些。
        */}
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
          <p className="text-xs font-medium text-ink-700">网站上怎么展示（选填）</p>
          <p className="mt-1 text-xs text-ink-500">
            网站能连上后端构站时，课程页的栏目卡片就按这里的数据生成；
            「不展示」表示这门课只在后台用于排课与记课时。
          </p>

          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectInput
              label="网站形态"
              hint="学科＝有自己的学段小节；选修＝只有一段介绍"
              options={COURSE_SITE_KINDS.map((value) => ({ value, label: value }))}
              value={siteKind}
              onChange={(event) => setSiteKind(event.target.value as CourseSiteKind)}
            />
            <TextField
              label="卡片路径"
              hint="网址里的 ASCII 分段，例如 junior-math（不展示可留空）"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="例如 junior-math"
            />
            <TextField
              label="卡片标签"
              hint="「标签→小节名」用顿号分隔；不填表示这门课没有细分"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="例如 学考→高中物理学考、选考→高中物理选考"
            />
            <TextField
              label="卡片点进哪一节"
              hint="留空则用课程名（有标签时用第一个标签的目标）"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="例如 高中物理学考"
            />
            <TextField
              label="显示顺序"
              hint="同一分区内越小越靠前；留空排在最后"
              type="number"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              placeholder="例如 1"
            />
          </div>

          <div className="mt-3">
            <TextAreaField
              label="一句话介绍"
              hint="选修课卡片会用到；学科卡片留空时网站用正文首段代替"
              rows={2}
              value={intro}
              onChange={(event) => setIntro(event.target.value)}
            />
          </div>
        </div>

        {/*
          网站正文（小节）：卡片点进去的那些正文，就在这张卡片里改。
          为什么放在「网站上怎么展示」与「报价」之间：它跟上面那组字段是**同一件事**
          （卡片靶点 / 标签指向哪个小节 ↔ 那一节的正文），人改完靶点会立刻想看那一节；
          报价是另一件事（钱），排在最后。
        */}
        {showSiteBands && (
          <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
            <p className="text-xs font-medium text-ink-700">网站正文（小节）</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              这张卡片指向的小节（靶点 {cardTargetList.length === 0 ? "还没填" : `「${cardTargetList.join("」「")}」`}
              ）：标题、锚点、正文都能在这里直接改，改完跟卡片一起保存。
              学科导语、整组暂未开放、没被任何卡片指向的正文在下面「学科级设置与未挂到卡片的正文」里改。
            </p>

            {siteContent === null ? (
              <p className="mt-2 text-xs text-ink-400">
                {contentLoadError === "" ? "正在读取网站正文…" : contentLoadError}
              </p>
            ) : listedHits.length === 0 ? (
              /*
               * 命中 0 个：这张卡片还没指向任何已有小节 —— 让人**选**一个学科挂上去。
               *
               * 为什么不按课程名自动新建一个学科：卡片上的名字常常只是**还没写对**
               * （打错一个字、或者标签里写的是导语），照着它建学科会在网站课程页上多出
               * 一个只有一节正文的空学科组 —— 而删学科要连它的小节一起删，收尾很烦。
               * 「新增学科」是**有意为之**的动作（下面那块面板里就有），这里只做可逆的那一步：
               * 挂到一个已有学科下；挂错了，删掉这一节即可。
               */
              <div className="mt-2 rounded-md border border-dashed border-ink-300 bg-white px-3 py-2">
                <p className="text-xs text-ink-500">
                  {cardTargetList.length === 0
                    ? "卡片靶点与标签都还空着，因此没有指向任何小节。"
                    : `卡片写的名字（${cardTargetList.join("、")}）在正文里没有对应的小节。`}
                  可以把新的一节挂到某个学科下（网站的正文是按学科分组的：
                  学科 → 学段小节）。
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <SelectInput
                    label="挂到哪个学科下"
                    value={addBandSubjectId === "" ? (siteContent.coursePage.subjects[0]?.id ?? "") : addBandSubjectId}
                    onChange={(event) => setAddBandSubjectId(event.target.value)}
                    options={siteContent.coursePage.subjects.map((subject) => ({
                      value: subject.id,
                      label: subject.name,
                    }))}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      addBand(addBandSubjectId === "" ? (siteContent.coursePage.subjects[0]?.id ?? "") : addBandSubjectId)
                    }
                  >
                    新增小节
                  </Button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  没有你要的学科？先到下面那块里「新增学科」，再回来挂这一节。
                  （如果刚把某个小节的锚点改了名，正文里那一节现在叫新名字：把上面的
                  「卡片点进哪一节」或标签改成新名字就能重新对上 —— 改名而没改卡片的，
                  保存时会被拦下来并告诉你是哪门课在指着它。）
                </p>
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                {hitSubjectNames.length > 1 && (
                  /* 一张卡片指向了**多个学科**的小节：如实说出来，别静默挑一个 */
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                    注意：这张卡片的靶点 / 标签命中了 {hitSubjectNames.length} 个学科的小节（
                    {hitSubjectNames.join("、")}）——「新增小节」会加到第一个命中的学科下。
                    网站上的卡片是按学科分组的，建议把靶点 / 标签收敛到一个学科里。
                  </p>
                )}
                {listedHits.map((hit) => (
                  <div
                    key={`${hit.subjectIndex}-${hit.bandIndex}`}
                    className="rounded-md border border-ink-200 bg-white px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-ink-400">
                        在学科「{hit.subject.name}」下
                        {hit.matched !== "" && hit.matched !== hit.band.id.trim() &&
                          `（卡片上写的是「${hit.matched}」—— 与这个小节的锚点不同名）`}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] text-ink-400 hover:text-danger-600"
                        onClick={() => removeBand(hit)}
                      >
                        删除这个小节
                      </button>
                    </div>
                    {/*
                      被拒的理由就写在这一节自己的框里（键与列表 key 同源）：
                      眼睛不用移动，页面也不用滚动 —— 见 removeBand 的说明。
                    */}
                    {bandError !== null && bandError.key === `${hit.subjectIndex}-${hit.bandIndex}` && (
                      <p
                        role="alert"
                        className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-[11px] leading-relaxed text-danger-600"
                      >
                        {bandError.text}
                      </p>
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <TextField
                        label="小节标题"
                        hint="可以写成「初中数学｜建立数学模型」：竖线之后是导语"
                        value={hit.band.title}
                        onChange={(event) =>
                          editSiteContent((draft) => {
                            const band = draft.coursePage.subjects[hit.subjectIndex]?.bands[hit.bandIndex];
                            if (band !== undefined) band.title = event.target.value;
                          })
                        }
                      />
                      <TextField
                        label="小节锚点"
                        hint="卡片标签 / 靶点按它跳转；改了它就要跟着改卡片上的名字"
                        value={hit.band.id}
                        onChange={(event) =>
                          editSiteContent((draft) => {
                            const band = draft.coursePage.subjects[hit.subjectIndex]?.bands[hit.bandIndex];
                            if (band !== undefined) band.id = event.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="mt-2">
                      <TextAreaField
                        label="正文"
                        rows={6}
                        value={hit.band.body}
                        onChange={(event) =>
                          editSiteContent((draft) => {
                            const band = draft.coursePage.subjects[hit.subjectIndex]?.bands[hit.bandIndex];
                            if (band !== undefined) band.body = event.target.value;
                          })
                        }
                      />
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    // 命中时按规格加到"命中小节所在的学科"：取第一个命中所在的学科
                    onClick={() => addBand(listedHits[0]?.subject.id ?? "")}
                  >
                    在「{listedHits[0]?.subject.name}」下新增一节
                  </Button>
                  <span className="text-[11px] text-ink-400">
                    新增的小节标题 / 锚点默认是「{name.trim() === "" ? "新课程" : name.trim()}小节N」，锚点重复时自动换一个可用的。
                  </span>
                </div>
              </div>
            )}

            {contentDirty && (
              <p className="mt-2 text-[11px] text-warning-600">
                网站正文有未保存的改动 —— 按下面「{editing === null ? "添加课程" : "保存修改"}」时会**连它一起保存**。
              </p>
            )}
          </div>
        )}

        {/*
          报价与卡片放在同一个表单里（机构要的是"一门课一个地方改完所有东西"）：
          改完点一次保存，卡片与价格一起落库。留空基础价 = 这门课不参与报价页。
        */}
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
          <p className="text-xs font-medium text-ink-700">报价（元 / 节）</p>
          <p className="mt-1 text-xs text-ink-500">
            填写后这门课就会出现在家长的报价页上（与「报价」页改的是同一份配置）。
            <strong className="font-medium text-ink-600">留空表示不参与报价页</strong> —— 内部课程不用填。
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <TextField
              label="学习阶段"
              hint="报价页的第一步（小学 / 初中阶段 / 高中阶段 / 出国考试…）"
              value={priceStage}
              onChange={(event) => setPriceStage(event.target.value)}
              list="course-price-stages"
              placeholder="例如 初中阶段"
            />
            <datalist id="course-price-stages">
              {(pricingConfig?.stages ?? []).map((stage) => (
                <option key={stage.name} value={stage.name} />
              ))}
            </datalist>
            <TextField
              label="基础价"
              hint="元 / 节；填写即会写入报价配置"
              type="number"
              min={0}
              value={priceValue}
              onChange={(event) => setPriceValue(event.target.value)}
              placeholder="例如 220"
            />
            <label className="flex items-end gap-2 pb-1 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={priceAvailable}
                onChange={(event) => setPriceAvailable(event.target.checked)}
              />
              可报价（取消勾选＝页面显示「暂未开放」）
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "保存中…" : editing === null ? "添加课程" : "保存修改"}
          </Button>
          {editing === null && (
            <span className="text-xs text-ink-400">
              添加后可立即在「课程安排」「咨询」「学生报课」里选到这门课。
            </span>
          )}
        </div>
      </form>
    );
  }

  return (
    <>
      <DataNotice
        onRefresh={async () => {
          // 同样用安静刷新：手动刷新也不该把列表清空、把页面高度塌掉
          await load({ quiet: true });
        }}
      />

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <strong className="font-medium">课程会在网站上怎么出现，取决于两件事。</strong>
        一是下面每门课的「网站上怎么展示」：填了「学科 / 选修」与卡片路径的课程才会成为
        网站上的卡片（填「不展示」表示它只在后台用于排课与记课时）。二是网站**构站时能不能
        连上后端**：连得上就用库里的数据生成页面，连不上（例如 GitHub Pages）就整体回落到
        模版文件 <code className="mx-1 rounded bg-white/70 px-1">data/site/*.md</code>
        —— 口径见技术架构 §10.1。反过来，内容文件里新加了课程卡片后，点「从网站同步课程」
        把它拉进课程库；老库升级上来时点「从网站导入内容」把卡片字段与课程正文一次性补齐。
        <br />
        <strong className="font-medium">与报价的关系：</strong>
        课程库决定「能排哪些课」，报价页决定「这门课多少钱」。每门课下面是它的报价状态；
        没定价的课到「报价」页填一个基础价（那一步之后还要「导出配置」才会出现在家长的报价页上）。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void syncFromSite()} disabled={syncing}>
          {syncing ? "同步中…" : "从网站同步课程"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void checkSiteContent()}
          disabled={sitePending}
        >
          {sitePending ? "体检中…" : "从网站导入内容"}
        </Button>
        <Button variant="outline" onClick={() => setImporting((value) => !value)}>
          {importing ? "收起导入" : "批量导入"}
        </Button>
        {summary !== null && (
          <span className="text-xs text-ink-500">
            共 {summary.total} 门（网站 {summary.fromSite} · 后台 {summary.fromAdmin}）· 开放{" "}
            {summary.open} · 暂未开放 {summary.unavailable}
            {unpricedCount > 0 && ` · 未定价 ${unpricedCount} 门`}
          </span>
        )}
      </div>

      {importing && (
        <BulkImport fixedEntity="courses" onImported={async () => { await load({ quiet: true }); }} />
      )}

      {message !== "" && <p className="mt-2 text-xs leading-relaxed text-success-600">{message}</p>}
      {error !== "" && (
        <p className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-xs leading-relaxed text-danger-600">
          {error}
        </p>
      )}

      {/*
        ── 新增课程 ──

        只有**新增**时这块才在页面顶部。编辑已经改成"在哪张卡片上点，就在哪张卡片下面展开"
        （见下面课程清单里的行内编辑器），因此这里只剩一个身份：新增课程 —— 不再有"编辑「X」"。
        新课程还没有对应的卡片行，没地方可以就地展开，所以它仍然在这儿填。

        **默认收起**（一行摘要 + 右边一个按钮）。这不是为了好看，是为了"点编辑不跳顶部"：
        这块表单在**课程清单上面**，而编辑是在卡片下面就地展开的 —— 点「编辑」时这块会被卸载，
        于是**滚动位置上方一下子少掉几百像素**。上方变矮正是那条真实反馈的第二条机制
        （§15.3 原因二：上方塌掉、浏览器只好把滚动位置往上收，收过头就停在顶部）。
        收起之后它只剩一行，点编辑时上方少掉的那一块小到不会把人推回顶部；
        而"展开新增课程"是**长高**，长高只会把内容往下推，不会把人推回顶部。
        （与下面那块「学科级设置与未挂到卡片的正文」一个取舍：低频的东西默认只留一行。）
      */}
      {editing === null && (
        <Panel
          className="mt-5"
          title="新增课程"
          description="例如「围棋」「书法」「编程」。分区可以选一个已有的，也可以先到上面「课程分区」里新建一个。"
          actions={
            canCreateCourse ? (
              <Button variant="outline" size="sm" onClick={() => setCreatingCourse((value) => !value)}>
                {creatingCourse ? "收起表单" : "填写新课程"}
              </Button>
            ) : undefined
          }
        >
          {!canCreateCourse ? (
            <p className="px-4 py-4 text-xs leading-relaxed text-ink-500">
              你的角色可以看课程库，但不能新增课程（{methodOwnerText("courses.create")}）。
            </p>
          ) : creatingCourse ? (
            renderCourseForm("space-y-3 px-4 py-4")
          ) : (
            <p className="px-4 py-4 text-xs leading-relaxed text-ink-500">
              点右边「填写新课程」展开表单：课程记录（名字 / 分类 / 状态 / 班型 / 备注）、
              网站上怎么展示、这门课的**网站正文**、以及它的**报价**都在这一张表单里，
              改完点一次保存就一起写好。改已有的课请到下面清单里点那门课的「编辑」——
              编辑器就在它自己的卡片下面展开。
            </p>
          )}
        </Panel>
      )}

      {/*
        体检 / 导入结果面板：逐条列出会动什么，确认后才写。
        写成"列清单 + 两个按钮"，而不是"再点一次就写"—— 导入是不可撤销的动作。
      */}
      {siteCheck !== null && (
        <Panel
          className="mt-5"
          title={siteCheck.written ? "已从网站内容导入" : "从网站导入 · 体检结果（尚未写入）"}
          description="教师资料、课程卡片字段、课程正文、报价文案。默认**只补空**：机构在后台改过的内容不会被冲掉。"
        >
          <ul className="max-h-64 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-ink-600">
            {siteCheck.changes.map((item) => (
              <li key={item} className="border-b border-ink-50 py-1 last:border-0">
                {item}
              </li>
            ))}
          </ul>
          <label className="mx-4 mb-2 flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={siteOverwrite}
              onChange={(event) => setSiteOverwrite(event.target.checked)}
            />
            用网站内容**覆盖**已有内容（课程正文、课程字段、教师资料都会按内容文件重写）
          </label>
          <div className="flex items-center gap-2 px-4 pb-4">
            {!siteCheck.written && (
              <Button onClick={() => void applySiteContent()} disabled={sitePending}>
                {sitePending ? "导入中…" : "确认导入"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setSiteCheck(null)}>
              关闭
            </Button>
          </div>
        </Panel>
      )}

      {/*
        学科级设置与未挂到卡片的正文。
        每门课的正文在上面那张卡片里改，这里只剩两类东西：学科本身的字段（名字 / 顺序 /
        整组暂未开放 / 学科导语）与**没被任何卡片指向**的小节。草稿由本页持有，两处改的是同一份
        （见上面 siteContent 的说明）—— 因此在这里保存也不会把卡片里刚改的正文盖回去。
      */}
      <SiteCourseContent
        content={siteContent}
        courses={courses ?? []}
        loading={loading}
        loadError={contentLoadError}
        dirty={contentDirty}
        saving={contentPending}
        notice={contentMessage}
        error={contentError}
        onChange={editSiteContent}
        onSave={() => void saveSiteContent()}
      />

      {/* ── 课程分区（栏目 → 子栏目）── */}
      <Panel
        className="mt-5"
        title="课程分区"
        description="清单按这里的分区分组；网站课程页的「栏目 → 子栏目」就是同一棵树（空分区不会出现在网站上）。"
      >
        <div className="px-4 py-4">
          {/*
            分区管理为什么做成"在这一页"而不是另开一页：整理课程时看的正是这一屏 ——
            发现"这一区该改个名字"就地改，比跳到另一页去找那个分区顺手得多。
            下面清单里每个分区标题旁就有改名 / 上下移 / 删除 / 整批移课。
          */}
          <p className="text-xs leading-relaxed text-ink-500">
            分区**只有两级**：栏目（小学课内 / 高中课内…）与它下面的子栏目（必考科目 / 外语 / 七选三）
            —— 宣传网站课程页渲染的就是这两级，第三级存得下也画不出来，因此服务端会拒绝。
            改名不用逐门课改：课程挂的是分区本身，改一次，下面每一门课都跟着变。
            <br />
            改名 / 排序 / 删除 / 把一区的课整批移走：在下面「课程清单」里每个分区的标题旁。
          </p>

          {canWritePartition ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void createPartition();
              }}
            >
              <div className="w-48">
                <TextField
                  label="新建分区"
                  hint="栏目或子栏目的名字"
                  value={newPartitionName}
                  onChange={(event) => setNewPartitionName(event.target.value)}
                  placeholder="例如 兴趣才艺"
                />
              </div>
              <div className="w-56">
                <SelectInput
                  label="上级"
                  hint="选「（一级栏目）」就是新栏目"
                  options={[
                    { value: "", label: "（一级栏目）" },
                    ...topLevelPartitions(partitions).map((column) => ({
                      value: column.id,
                      label: `${column.name} 的子栏目`,
                    })),
                  ]}
                  value={newPartitionParent}
                  onChange={(event) => setNewPartitionParent(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={partitionNotice.pending}>
                {partitionNotice.pending ? "新建中…" : "新建"}
              </Button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-ink-500">
              你的角色可以看分区，但不能改（{methodOwnerText("coursePartitions.create")}）。
            </p>
          )}

          <ActionNoticeView notice={partitionNotice} className="mt-3" />
        </div>
      </Panel>

      {/* ── 列表 ── */}
      <Panel className="mt-5 mb-8" title="课程清单" description="按分区（栏目 → 子栏目）分组。网站来源的课程跟着内容文件走，不能删除。">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3">
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索课程名或分区…"
            className="h-9 min-w-48 flex-1 rounded-md border border-ink-200 px-3 text-sm outline-none focus:border-brand-400"
          />
          <div className="flex items-center gap-1.5">
            {["全部", "网站", "后台"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setOriginFilter(item)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  originFilter === item
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-ink-200 text-ink-600 hover:border-ink-300",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-400">
            {visible.length} 门{refreshing ? "（刷新中…）" : ""}
          </span>
        </div>

        {/*
          正在编辑的那门课被搜索 / 来源筛选挡在清单外时，它的编辑器**不在页面上** ——
          编辑器就挂在它那张卡片下面，卡片不渲染就没有它。
          没有丢东西（改到一半的字段都还在 `editing` 与表单状态里），清掉搜索就回到原处；
          但不说一声的话，人会以为"我刚点的编辑没了"，而且顶部那块是**新增专用**的，也不会出现。
        */}
        {editing !== null && !visible.some((course) => course.id === editing.id) && (
          <p className="border-b border-ink-100 px-4 py-2 text-xs leading-relaxed text-warning-600">
            正在编辑的「{editing.name}」不在当前筛选结果里 —— 它的编辑器就在那张卡片下面，
            清掉搜索框里搜的字、或把来源切回「全部」，就回到原处（改过的内容都还在）。
          </p>
        )}

        {loading ? (
          <p className="px-4 py-6 text-sm text-ink-400">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">没有匹配的课程。</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {grouped.map(({ column, groups }) => {
              /*
               * 一个栏目 = 标题（可改名 / 排序 / 删除 / 把本区课程整批移走）+ 它的子栏目分组。
               * 结构与顺序全部来自 `groupByPartition()`（与网站课程页同一个函数），页面只负责画。
               */
              const columnItems = groups.flatMap((group) => group.items);
              /*
               * 三个显示口径：
               *   - **搜索/筛选时**只显示有命中的分区与子栏目（否则结果里夹着一堆"0 门"的空标题）；
               *   - 不筛选时**空分区照常显示**（机构要能先建好分区、再往里放课）；
               *   - 空分区给一句话说明它为什么在这儿（否则会以为清单坏了）。
               */
              const shown = groups.filter((group) => !filtering || group.items.length > 0);
              if (filtering && columnItems.length === 0) return null;
              return (
                <div key={column.id} className="px-4 py-3">
                  {renderPartitionHeader(column, columnItems, 1)}
                  {columnItems.length === 0 && (
                    <p className="mb-1 text-[11px] text-ink-400">
                      这一区还没有课 —— 新增课程时在「分区」里选它，或用别处的「移到」把课挪进来。
                      （空分区不会出现在宣传网站的课程页上。）
                    </p>
                  )}
                  {shown.map((group) => (
                    <div key={group.subgroup?.id ?? `${column.id}-direct`} className="mt-3">
                      {/*
                        直接挂在栏目上的课（`subgroup === null`）**不渲染子标题** ——
                        与网站课程页一致（那一组在网站上就是没有小标题的一块）。
                      */}
                      {group.subgroup !== null && renderPartitionHeader(group.subgroup, group.items, 2)}
                      {group.subgroup !== null && group.items.length === 0 && (
                        <p className="mb-1 text-[11px] text-ink-400">
                          这个子栏目还没有课。
                        </p>
                      )}
                      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.items.map((course) => renderCourseCard(course))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}

            {unpartitioned.length > 0 && (
              <div className="px-4 py-3">
                <h3 className="mb-2 text-xs font-medium text-warning-600">
                  未归类 / 分区已失效
                  <span className="ml-2 font-normal text-ink-400">{unpartitioned.length} 门</span>
                </h3>
                <p className="mb-2 text-[11px] leading-relaxed text-ink-500">
                  这些课没有有效的分区：新加的课还没选分区，或者它原来那一区已经不在了
                  （删除有课的分区会被拦住，因此后者通常意味着数据是从别处恢复过来的）。
                  用每张卡片上的「编辑」给它们选一个分区即可。
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {unpartitioned.map((course) => renderCourseCard(course))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
