import type { ReactNode } from "react";

export interface BannerProps {
  title: string;
  /** One sentence of supporting text. */
  children: ReactNode;
  /**
   * Set when the banner appears after an action or a status change, so it is
   * announced immediately (role="alert"). Static page notices omit it.
   */
  alert?: boolean;
}

/**
 * A notification banner (GOV.UK pattern): a tactile strip on top, a bold title,
 * and one supporting sentence. When shown in response to an action or a status
 * change it carries role="alert" so screen readers announce it (ui-design.md).
 */
export default function Banner({ title, children, alert = false }: BannerProps) {
  return (
    <section
      role={alert ? "alert" : undefined}
      className="overflow-hidden rounded-[18px] border border-line bg-surface"
    >
      <div className="tactile-strip" aria-hidden="true" />
      <div className="p-4">
        <h2 className="text-[22px]">{title}</h2>
        <p className="mt-2 text-ink">{children}</p>
      </div>
    </section>
  );
}
