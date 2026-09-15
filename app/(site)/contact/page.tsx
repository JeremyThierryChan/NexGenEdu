import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { SITE } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "联系我们",
  description: `校区地址、电话、微信与营业时间。${SITE.contact.address}`,
};

/** 联系方式展示项。Phase 3 改为读取 data/site/contact.md。 */
const CONTACT_ITEMS = [
  { label: "电话", value: SITE.contact.phone },
  { label: "微信", value: SITE.contact.wechat },
  { label: "邮箱", value: SITE.contact.email },
  { label: "地址", value: SITE.contact.address },
  { label: "营业时间", value: SITE.contact.businessHours },
] as const;

/**
 * 联系我们页面。
 *
 * 当前阶段不接表单后端：咨询入口统一为电话 / 微信，避免出现「提交后无响应」的假交互。
 * 后续接入表单服务时，在此处新增 ContactForm 即可，联系方式区块无需改动。
 */
export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="联系我们"
        title="预约免费学科测评"
        description="电话或微信联系我们，说明学生年级与薄弱学科，我们会安排对应的授课教师做测评。"
      />

      <Container>
        <Section contentClassName="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card title="联系方式">
            <dl className="divide-y divide-ink-100">
              {CONTACT_ITEMS.map((item) => (
                <div key={item.label} className="flex gap-6 py-3 first:pt-0 last:pb-0">
                  <dt className="w-20 shrink-0 text-sm text-ink-500">{item.label}</dt>
                  <dd className="text-sm text-ink-800">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="到校路线" description="地铁 9 号线示例站 2 号口步行 5 分钟">
            <div
              className="flex aspect-4/3 items-center justify-center rounded-md bg-ink-100 text-xs text-ink-400"
              aria-hidden
            >
              地图占位
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-600">
              建议提前电话预约，以便安排对应学科教师与独立测评时间。
            </p>
            <Button className="mt-5 w-full" variant="outline" size="sm" disabled>
              在线预约表单（后续版本开放）
            </Button>
          </Card>
        </Section>
      </Container>
    </>
  );
}
