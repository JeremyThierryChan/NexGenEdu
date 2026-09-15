import type { Metadata } from "next";
import { FeatureCard } from "@/components/site/FeatureCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { SITE } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "让学习真正发生",
  description: `${SITE.nameZh}（${SITE.name}）—— ${SITE.tagline}。面向初高中学生提供小班学科辅导与升学规划。`,
};

/** 首页教学特色。文案属于品牌层，Phase 1 先固定在此，后续可迁移到 data/site/home.md。 */
const FEATURES = [
  {
    title: "小班教学",
    description: "每班 4–8 人，教师能照顾到每一位学生的课堂参与与掌握情况。",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="13.5" cy="8" r="2" />
        <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M12 12.5c2.5-.4 5 .7 5 3.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "个性化方案",
    description: "入学测评后按学生薄弱点制定学习计划，并随进度动态调整。",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4 3.5h12v13H4z" strokeLinejoin="round" />
        <path d="M7 7h6M7 10h6M7 13h3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "阶段反馈",
    description: "每 4 次课输出一次学习反馈，家长可以清楚看到阶段进步与下一步重点。",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M3 16V9M8 16V4M13 16v-5M18 16H2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "灵活排课",
    description: "支持按周固定或临时加课，缺课可安排补课，不额外占用课时。",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
        <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
      </svg>
    ),
  },
] as const;

export default function HomePage() {
  return (
    <>
      {/* Hero：只保留一句话主张 + 两个 CTA + 关键事实 */}
      <section className="border-b border-ink-200 bg-ink-50">
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-brand-600">{SITE.nameZh} · {SITE.name}</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              让学习真正发生
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-600">{SITE.tagline}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/courses" size="lg">
                了解课程
              </ButtonLink>
              <ButtonLink href="/contact" size="lg" variant="outline">
                联系我们
              </ButtonLink>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink-200 bg-ink-200">
            {[
              { label: "班级规模", value: "4–8 人" },
              { label: "师生比", value: "1 : 6" },
              { label: "覆盖学段", value: "初高中" },
              { label: "在校学员", value: "200+" },
            ].map((item) => (
              <div key={item.label} className="bg-white px-5 py-6">
                <dt className="text-xs text-ink-500">{item.label}</dt>
                <dd className="mt-2 text-xl font-medium text-ink-900 tabular">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <Container>
        <Section
          eyebrow="教学特色"
          title="我们把注意力放在真正影响结果的事情上"
          description="不追求课程数量，而是把每一节课的准备、反馈和跟进做扎实。"
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <FeatureCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        </Section>
      </Container>

      {/* 数据来自 Markdown 的区块：Phase 2/3 接入后替换为真实内容 */}
      <div className="border-y border-ink-200 bg-ink-50">
        <Container>
          <Section
            eyebrow="课程"
            title="按学科与学段设置课程"
            description="课程资料统一维护在 data/site/courses 下，接入数据层后自动呈现。"
            contentClassName="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
          >
            {["数学", "英语", "物理", "化学"].map((subject) => (
              <div
                key={subject}
                className="rounded-lg border border-dashed border-ink-300 bg-white/60 p-6"
              >
                <h3 className="text-base font-medium text-ink-900">{subject}</h3>
                <p className="mt-2 text-sm text-ink-500">课程详情待录入</p>
              </div>
            ))}
            <p className="sm:col-span-2 lg:col-span-4">
              <ButtonLink href="/courses" variant="outline" size="sm">
                查看全部课程
              </ButtonLink>
            </p>
          </Section>
        </Container>
      </div>

      <Container>
        <Section
          eyebrow="教师"
          title="负责的教师团队"
          description="教师资料统一维护在 data/teachers 下，包含所授科目与教学简介。"
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="rounded-lg border border-dashed border-ink-300 p-6"
              >
                <div className="size-12 rounded-full bg-ink-100" aria-hidden />
                <p className="mt-4 text-sm text-ink-500">教师资料待录入</p>
              </div>
            ))}
          </div>
          <p className="mt-6">
            <ButtonLink href="/teachers" variant="outline" size="sm">
              查看教师团队
            </ButtonLink>
          </p>
        </Section>

        <Section
          eyebrow="教室环境"
          title="小班教室与自习区"
          description="每个教室按 6–8 人配置，配备白板与独立自习位。"
          className="border-t border-ink-200"
        >
          <div className="grid gap-5 sm:grid-cols-3">
            {["301 教室", "302 教室", "自习区"].map((name) => (
              <figure
                key={name}
                className="overflow-hidden rounded-lg border border-ink-200"
              >
                {/* 占位图区域：有真实照片后替换为 next/image */}
                <div
                  className="flex aspect-4/3 items-center justify-center bg-ink-100 text-xs text-ink-400"
                  aria-hidden
                >
                  图片占位
                </div>
                <figcaption className="bg-white px-4 py-3 text-sm text-ink-700">
                  {name}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      </Container>

      {/* 结尾 CTA */}
      <div className="bg-brand-800">
        <Container className="flex flex-col items-start justify-between gap-6 py-14 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-medium text-white sm:text-2xl">
              先来一次免费测评
            </h2>
            <p className="mt-2 text-sm text-brand-100">
              了解学生当前水平与薄弱环节，再决定是否报名。
            </p>
          </div>
          <ButtonLink href="/contact" size="lg" variant="secondary">
            预约试听
          </ButtonLink>
        </Container>
      </div>
    </>
  );
}
