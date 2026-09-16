import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getContactContent, getSiteBrand } from "@/lib/data/site";

/** 联系我们页面内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const contact = getContactContent();
  const brand = getSiteBrand();
  return {
    title: contact.title,
    description: `${contact.description}${brand.contact.address}`,
  };
}

/**
 * 联系我们页面。
 *
 * 当前阶段不接表单后端：咨询入口统一为电话 / 微信，避免出现「提交后无响应」的假交互。
 * 后续接入表单服务时，在此处新增 ContactForm 即可，联系方式区块无需改动。
 */
export default function ContactPage() {
  const contact = getContactContent();

  return (
    <>
      <PageHeader
        eyebrow={contact.eyebrow}
        title={contact.title}
        description={contact.description}
      />

      <Container>
        <Section contentClassName="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card title="联系方式">
            <dl className="divide-y divide-ink-100">
              {contact.methods.map((method) => (
                <div key={method.title} className="flex gap-6 py-3 first:pt-0 last:pb-0">
                  <dt className="w-20 shrink-0 text-sm text-ink-500">{method.title}</dt>
                  <dd className="text-sm text-ink-800">{method.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title={contact.routeTitle} description={contact.routeDescription}>
            <div
              className="flex aspect-4/3 items-center justify-center rounded-md bg-ink-100 text-ink-300"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                className="size-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-600">
              {contact.routeParagraph}
            </p>
            <Button className="mt-5 w-full" variant="outline" size="sm" disabled>
              {contact.disabledActionLabel}
            </Button>
          </Card>
        </Section>

      </Container>
    </>
  );
}
