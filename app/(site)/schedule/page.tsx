import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getScheduleContent } from "@/lib/data/pages";

export function generateMetadata(): Metadata {
  const content = getScheduleContent();
  return { title: content.title, description: content.description };
}

/**
 * 课程时间安排页面。内容来自 data/site/schedule.md。
 *
 * 每个分组渲染成一张表：时段与内容两列对齐，比卡片更便于横向比较时间。
 */
export default function SchedulePage() {
  const content = getScheduleContent();

  return (
    <>
      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
      />

      <Container>
        <Section contentClassName="grid gap-6 lg:grid-cols-2">
          {content.groups.map((group) => (
            <Card key={group.title} title={group.title}>
              {group.note !== "" && (
                <p className="text-sm leading-relaxed text-ink-600">{group.note}</p>
              )}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-ink-100">
                  {group.items.map((item) => (
                    <tr key={item.title}>
                      <th
                        scope="row"
                        className="py-2.5 pr-4 text-left align-top font-normal text-ink-600"
                      >
                        {item.title}
                      </th>
                      <td className="py-2.5 text-right align-top font-medium text-ink-900 tabular">
                        {item.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </Section>

        {content.notice !== "" && (
          <Section className="pt-0">
            <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
              {content.notice}
            </p>
          </Section>
        )}
      </Container>
    </>
  );
}
