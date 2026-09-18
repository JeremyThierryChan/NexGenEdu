import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { FOOTER_GROUPS } from "@/lib/site/nav";
import type { SiteBrand } from "@/lib/types/site";

type FooterProps = {
  brand: SiteBrand;
};

/**
 * 宣传网站页脚。
 *
 * 布局按「家长想做什么」分四栏，而不是把所有链接堆成一列：
 *
 * ```
 * 品牌 + 两个行动按钮 │ 选课与价格 │ 了解我们 │ 联系我们
 * ────────────────────────────────────────────────────────
 * © 版权                                          教务后台
 * ```
 *
 * 三个刻意的处理：
 *   - **电话与邮箱是可点的链接**（`tel:` / `mailto:`）：页脚通常是家长在手机上
 *     最后一次看到联系方式的时机，不能只给一串没法点的文字；
 *   - **不放「首页」**：页头 Logo 就是回首页的入口，页脚再放一条纯属占位；
 *   - **空值不渲染**：地址、营业时间没填就不显示这一行，而不是留一个空标签。
 *
 * 品牌与联系方式来自 data/site/content.md。
 */
export function Footer({ brand }: FooterProps) {
  const year = new Date().getFullYear();
  const { contact } = brand;

  const telHref = toTelHref(contact.phone);
  const contactRows: Array<{ label: string; value: string; href?: string }> = [
    { label: "电话", value: contact.phone, href: telHref },
    { label: "微信", value: contact.wechat },
    { label: "邮箱", value: contact.email, href: `mailto:${contact.email}` },
    { label: "地址", value: contact.address },
    { label: "营业时间", value: contact.businessHours },
  ].filter((row) => row.value.trim() !== "");

  return (
    <footer className="border-t border-ink-200 bg-ink-50">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        {/* 品牌与行动入口：页脚是最后一个转化点，这里给两个明确的下一步 */}
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo brand={brand} />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">
            {brand.tagline}
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <ButtonLink href="/contact" size="sm">
              预约试听
            </ButtonLink>
            <ButtonLink href="/quote" size="sm" variant="outline">
              查看报价
            </ButtonLink>
          </div>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-medium text-ink-900">{group.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-ink-600 transition-colors hover:text-brand-700"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div>
          {/* 标题也可点：家长想找的是「联系方式那一页」，而不只是这几个字 */}
          <h2 className="text-sm font-medium text-ink-900">
            <Link href="/contact" className="transition-colors hover:text-brand-700">
              联系我们
            </Link>
          </h2>
          <dl className="mt-4 space-y-2.5">
            {contactRows.map((row) => (
              <div key={row.label} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-ink-500">{row.label}</dt>
                <dd className="min-w-0 text-ink-600">
                  {row.href !== undefined ? (
                    <a
                      href={row.href}
                      className="transition-colors hover:text-brand-700"
                    >
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>

      <Container className="flex flex-col gap-3 border-t border-ink-200 py-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {brand.copyrightHolder}。保留所有权利。
        </p>
        <Link href="/admin" className="transition-colors hover:text-brand-700">
          教务后台
        </Link>
      </Container>
    </footer>
  );
}

/**
 * 把「+86 138-6853-0992（陈老师）」这类字符串转成可拨号的 `tel:` 链接。
 *
 * 只保留数字与开头的 `+`：括号里的备注、空格、连字符都不能进 tel 链接，
 * 否则手机上拨不出去。拿不到数字就返回 undefined（渲染成纯文本）。
 */
function toTelHref(value: string): string | undefined {
  const digits = value.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+")
    ? `+${digits.slice(1).replace(/\+/g, "")}`
    : digits.replace(/\+/g, "");
  return normalized.replace(/\D/g, "") === "" ? undefined : `tel:${normalized}`;
}
