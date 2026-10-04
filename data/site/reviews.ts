/**
 * 本文件由 scripts/sync-content.mjs 自动生成，请勿手工编辑。
 * 内容来源：data/site/reviews.md —— 修改后执行 npm run sync-content。
 *
 * 这里额外引入一个同步时间戳（data/site/.sync-stamp.ts，未纳入版本库）：
 * 生成的内容是纯字符串常量，内容改回原样后与上一次编译结果逐字节相同，
 * 打包器会判定「未变化」而跳过重新编译，页面继续使用旧产物
 * （表现为内容改好了却仍是旧的，需重启开发服务器）。
 * 把时间戳放在单独文件里，就既能强制缓存失效，又不会让每次同步都改动本文件。
 * 该文件未纳入版本库，因此类型检查依赖 types/sync-stamp.d.ts 的模块声明。
 */
import { syncStamp } from "./.sync-stamp";

// 该文件未纳入版本库，CI 全新 checkout 时可能不存在，因此保留兜底值
export const reviewsSyncedAt = syncStamp ?? "unbuilt";
export const reviewsSource = `# NexGenEdu · 新锐教培 · 家长与学生评价

> 这个文件决定「学生案例」页 \`/cases\` 里那块「家长与学生怎么说」的内容。
>
> 结构说明：
> - \`## 页面: 家长与学生评价\` 是这一块的短字段（眉题、标题、说明、页脚提示）
> - 每条评价是一个 \`### 署名\` 分组
> - \`#### 字段: 值\` 写这条评价的信息，可用字段：\`分组\`（家长 / 学生）、\`科目\`、\`正文\`、
>   \`补充\`、\`原文\`、\`原文语言\`
> - \`正文\`（译文）与 \`原文\` 可以**多段**：第一段写在 \`#### 字段:\` 那一行上，
>   其余段落写在下面（**段与段之间空一行**）。前台会照常分段显示 ——
>   折成一行会把段落挤成一坨
> - 填了 \`原文\` 的评价是**双语评价**：前台卡片默认显示译文（前缀「（译文）」），
>   多一个「看原文 / 看译文」按钮；\`原文语言\`（例：\`法语\`）用来说前缀
>   「（法语原文）」，留空则显示「（原文）」
> - **没有 \`原文\` 的是单语评价**：前台不加任何前缀、也不显示按钮（保持干净）
>
> **重要：请勿编造真实评价。** 下面几条是**真实评价或体例示例**，展示该怎么写、页面上会长什么样。
> 请替换为真实评价（**可隐去姓名**，用「初二 李同学家长」这类称呼），或把对应分组整段删掉
> —— 删光也不会报错，页面上会显示一句「评价整理中」。
>
> 评价必须**真实发生过、并已征得本人同意**才能发布；不要写没有发生过的成绩或提分数字。
>
> ⚠️ 本文件由 \`npm run site:export\` 从后台导出：**后台为准**，手工改动会在下次导出时被覆盖。

## 页面: 家长与学生评价

---
eyebrow: 家长与学生评价
title: 家长与学生怎么说
description: 下面是家长和学生的原话。评价均经本人同意后发布，姓名已做隐去处理。
notice: 评价均经家长/学生同意后发布。
---

页面标题与说明在上方短字段里。下面是体例示例，**请替换为真实评价（可隐去姓名）或整段删掉**。

### 王同学

#### 分组: 学生

#### 科目: 高中物理

#### 正文: 很负责的老师，上课的时候讲解很透彻，听不懂也会讲多次，会根据个人掌握情况调节上课进程，会根据学生课堂预期灵活调整教学内容，平时讲话特别幽默风趣，沟通方便，在我提出问题时会简单犀利的指出其中关键，并带动学生思路直到成功解题，待人友善真诚，不会有很大的上课压力，更多的是以一种朋友之间的相处模式，寓教于乐，让人学习起来相对轻松，很全能，会带小礼物，总而言之，一个字好，两个字很好，三个字超级好

#### 补充: 来自浙江省温州市

### 王同学家长

#### 分组: 家长

#### 科目: 高中物理

#### 正文: 物理对女生来说是一门比较难上手的学科，孩子在陈老师的带领下拥有了更强的思考及反思能力。学习上还是陈老师费心了。孩子也是反馈陈老师的教学她很适应，也很喜欢。

#### 补充: 来自浙江温州

### 刘同学

#### 分组: 学生

#### 科目: 初三英语

#### 正文: 我的英语基础很不好，基本上就是完全什么都看不懂，考试只能靠蒙，但是陈老师还是很耐心的帮我从最基础的部分一点一点带我记单词和梳理知识点，然后我开始觉得有些时候并没有很难。我慢慢的的开始学会英语了，对考试也有信心了。

#### 补充: 浙江温州

### 邱同学

#### 分组: 学生

#### 科目: 高中物理、高中化学

#### 正文: 我觉得陈老师很厉害，能一个人教很多科目，这样我也不用适应不同老师的教学方法。而且陈老师很耐心，我不理解的地方能够反复帮我拆解。粗心犯错的时候陈老师也会帮我分析为什么我在这个位置会粗心或者把问题想简单。只上了几节课我就明显感觉在学校里的学习轻松了很多，形成了学习方法，很感谢陈老师！

#### 补充: 浙江温州

### Milan

#### 分组: 学生

#### 科目: 汉语

#### 正文: Jeremy（陈老师）是一位非常优秀的老师，也是一位值得信赖的良师益友。

由于家族在中国有一些事务需要使用中文，我找到了Jeremy学习汉语。在教学过程中，他会根据我的实际需求，设计真实的生活和工作场景，让我通过情境模拟进行练习，而不仅仅是学习课本上的内容。

Jeremy主要使用英语授课，同时也会经常使用我的母语法语帮助我更准确地理解所学内容，这让我能够更高效地掌握中文。

现在，我已经顺利完成了相关事务并回到了欧洲，但我依然非常愿意向大家推荐Jeremy作为中文老师。如果你正在寻找一位认真、灵活，并且能够根据你的实际需求进行教学的老师，我非常推荐他！

#### 补充: 来自法国洛里昂

#### 原文: Jeremy (professeur Chen) est un excellent professeur, mais aussi une personne de confiance et un véritable mentor.

J’avais besoin d’utiliser le chinois dans le cadre de certaines affaires familiales en Chine, et j’ai donc fait appel à Jeremy pour apprendre le chinois. Pendant les cours, il adapte son enseignement à mes besoins réels et crée des situations concrètes inspirées de la vie quotidienne et du monde professionnel, afin que je puisse m’entraîner dans des contextes aussi proches que possible de la réalité.

Jeremy enseigne principalement en anglais, mais il utilise également régulièrement ma langue maternelle, le français, pour m’aider à mieux comprendre certains concepts et certaines nuances. Cette approche m’a permis de progresser beaucoup plus efficacement.

J’ai maintenant terminé mes démarches avec succès et je suis de retour en Europe, mais je recommande toujours vivement Jeremy comme professeur de chinois. Si vous recherchez un professeur sérieux, flexible et capable d’adapter ses cours à vos besoins concrets, je vous le recommande sans hésitation !

#### 原文语言: 法语
`;
