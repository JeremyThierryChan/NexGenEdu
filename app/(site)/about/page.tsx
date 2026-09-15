import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { SITE } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "关于我们",
  description: `${SITE.nameZh}的教学理念、师资构成与校区情况。`,
};

/** 关于我们：Phase 3 改为读取 data/site/about.md。 */
export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="关于我们"
        title="把每一节课的准备与跟进做扎实"
        description="我们相信学习效果来自稳定的教学动作，而不是更多的课程数量。"
      />

      <Container>
        <Section
          title="教学理念"
          contentClassName="grid gap-5 sm:grid-cols-3"
          description="三条原则贯穿从排课到课后反馈的每个环节。"
        >
          <Card title="因材施教">
            <p className="text-sm leading-relaxed text-ink-600">
              入学前先做学科测评，明确薄弱点后再制定学习计划，避免用统一进度套所有学生。
            </p>
          </Card>
          <Card title="过程可见">
            <p className="text-sm leading-relaxed text-ink-600">
              每节课记录掌握情况，每 4 次课输出阶段反馈，让家长看到具体进步而非模糊评价。
            </p>
          </Card>
          <Card title="持续跟进">
            <p className="text-sm leading-relaxed text-ink-600">
              课后作业与错题由授课教师跟进，问题在下一节课前解决，不积压到考前。
            </p>
          </Card>
        </Section>

        <Section
          title="校区信息"
          className="border-t border-ink-200"
          contentClassName="grid gap-8 sm:grid-cols-2"
        >
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-ink-500">校区地址</dt>
              <dd className="mt-1 text-ink-800">{SITE.contact.address}</dd>
            </div>
            <div>
              <dt className="text-ink-500">营业时间</dt>
              <dd className="mt-1 text-ink-800">{SITE.contact.businessHours}</dd>
            </div>
          </dl>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-6">
            <h3 className="text-sm font-medium text-ink-900">校区规模</h3>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              <li>小班教室 6 间，每间容纳 6–8 人</li>
              <li>独立自习区，开放至 21:00</li>
              <li>在读学员 200 余人，覆盖初高中各年级</li>
            </ul>
          </div>
        </Section>
      </Container>
    </>
  );
}
