import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getAboutContent, getSiteBrand } from "@/lib/data/site";

/** 关于我们页面内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const about = getAboutContent();
  const brand = getSiteBrand();
  return {
    title: about.title,
    description: `${brand.brandNameZh}的教学理念、师资构成与校区情况。${about.description}`,
  };
}

export default function AboutPage() {
  const about = getAboutContent();
  const brand = getSiteBrand();

  return (
    <>
      <PageHeader
        eyebrow={about.eyebrow}
        title={about.title}
        description={about.description}
      />

      <Container>
        <Section
          title={about.philosophy.title}
          description={about.philosophy.description}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {about.principles.map((principle) => (
              <Card key={principle.title} title={principle.title}>
                <p className="text-sm leading-relaxed text-ink-600">{principle.value}</p>
              </Card>
            ))}
          </div>
        </Section>

        {about.services.length > 0 && (
          <Section
            title={about.serviceTitle}
            className="border-t border-ink-200"
            contentClassName="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {about.services.map((service) => (
              <Card key={service.title} title={service.title}>
                <p className="text-sm leading-relaxed text-ink-600">{service.value}</p>
              </Card>
            ))}
          </Section>
        )}

        <Section
          title={about.campusTitle}
          className="border-t border-ink-200"
          contentClassName="grid gap-8 sm:grid-cols-2"
        >
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-ink-500">校区地址</dt>
              <dd className="mt-1 text-ink-800">{brand.contact.address}</dd>
            </div>
            {/* 两个时间含义不同：接待时间 = 有人在；上课时间 = 能上课 */}
            <div>
              <dt className="text-ink-500">营业时间（接待咨询）</dt>
              <dd className="mt-1 text-ink-800">{brand.contact.businessHours}</dd>
            </div>
            <div>
              <dt className="text-ink-500">上课时间</dt>
              <dd className="mt-1 text-ink-800">{brand.contact.classHours}</dd>
            </div>
          </dl>

          <div className="rounded-lg border border-ink-200 bg-ink-50 p-6">
            <h3 className="text-sm font-medium text-ink-900">校区规模</h3>
            <dl className="mt-4 space-y-2 text-sm text-ink-600">
              {about.facts.map((fact) => (
                <div key={fact.title} className="flex justify-between gap-4">
                  <dt>{fact.title}</dt>
                  <dd className="tabular text-ink-800">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>

        {about.campusParagraphs.length > 0 && (
          <Section>
            <ul className="max-w-2xl space-y-2 text-sm leading-relaxed text-ink-600">
              {about.campusParagraphs.map((paragraph) => (
                <li key={paragraph}>{paragraph}</li>
              ))}
            </ul>
          </Section>
        )}

      </Container>
    </>
  );
}
