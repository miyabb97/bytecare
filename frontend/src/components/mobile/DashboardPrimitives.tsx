import { useEffect, useState, type ReactNode, type RefObject } from "react";

export type BadgeTone = "red" | "yellow" | "blue" | "neutral" | "success";

const badgeToneClass: Record<BadgeTone, string> = {
  red: "bg-[#FFF1F1] text-[#EF5A5A] border border-[#FFD8D8]",
  yellow: "bg-[#FFF8E8] text-[#C18421] border border-[#F4DEB5]",
  blue: "bg-[#EEF4FF] text-[#3B6EF5] border border-[#D8E5FF]",
  neutral: "bg-[#F2F4F7] text-[#667085] border border-[#E4E7EC]",
  success: "bg-[#ECFDF3] text-[#15803D] border border-[#B7EACB]",
};

export function BadgePill({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.01em] ${badgeToneClass[tone]}`}>
      {label}
    </span>
  );
}

export function Header({
  title,
  left,
  right,
}: {
  title: string;
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[#E9EEF7] bg-white">
      <div className="mx-auto flex h-[78px] w-full max-w-md items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {left}
          <h1 className="text-[30px] font-bold leading-none text-[#1F2A37]">{title}</h1>
        </div>
        {right ? <div className="flex items-center gap-3">{right}</div> : null}
      </div>
    </header>
  );
}

export function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#1F2A37]">{title}</h2>;
}

export function StatCard({
  title,
  value,
  delta,
  children,
}: {
  title: string;
  value: string;
  delta?: string;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3]">{title}</p>
      <div className="mt-1 flex items-end justify-between">
        <p className="text-[38px] font-bold leading-none text-[#1F2A37]">{value}</p>
        {delta ? <p className="text-[13px] font-semibold text-[#EF5A5A]">{delta}</p> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </article>
  );
}

export function AlertCard({
  tone,
  title,
  description,
  action,
  icon,
}: {
  tone: "red" | "yellow";
  title: string;
  description: string;
  action: string;
  icon?: ReactNode;
}) {
  const accent = tone === "red" ? "border-[#EF5A5A]" : "border-[#E7A93B]";
  return (
    <article className={`rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-9 w-1.5 rounded-full ${tone === "red" ? "bg-[#EF5A5A]" : "bg-[#E7A93B]"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {icon}
            <p className="text-[16px] font-semibold text-[#1F2A37]">{title}</p>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[#667085]">{description}</p>
          <button type="button" className={`mt-0 w-auto bg-transparent p-0 text-[13px] font-semibold ${tone === "red" ? "text-[#3B6EF5]" : "text-[#3B6EF5]"}`}>
            {action}
          </button>
        </div>
      </div>
      <div className={`pointer-events-none absolute inset-0 rounded-2xl border-l-4 ${accent} opacity-0`} />
    </article>
  );
}

export function ActionTile({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="mt-0 flex h-[92px] w-full flex-1 flex-col items-center justify-center rounded-2xl border border-[#E9EEF7] bg-white p-0 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <div className="mb-2 text-[#3B6EF5]">{icon}</div>
      <span className="text-[12px] font-semibold text-[#344054]">{label}</span>
    </button>
  );
}

export function QuickActionRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

export function SummaryCard({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-[16px] font-semibold text-[#1F2A37]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function ChartCard({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-[#E9EEF7] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">{children}</section>;
}

export function PatientCard({ children }: { children: ReactNode }) {
  return <section className="rounded-3xl border border-[#D8E4F7] bg-[#FDFEFF] p-4 shadow-[0_1px_3px_rgba(16,24,40,0.04)]">{children}</section>;
}

export function TabBar({
  tabs,
  active,
  containerRef,
  onTabChange,
}: {
  tabs: Array<{ key: string; label: string; icon: ReactNode }>;
  active: string;
  containerRef?: RefObject<HTMLElement | null>;
  onTabChange?: (key: string) => void;
}) {
  const [bounds, setBounds] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const updateBounds = () => {
      const element = containerRef?.current;
      if (!element) {
        setBounds(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setBounds({ left: rect.left, width: rect.width });
    };

    updateBounds();

    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, { passive: true });

    const element = containerRef?.current;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && element
        ? new ResizeObserver(() => updateBounds())
        : null;

    if (resizeObserver && element) {
      resizeObserver.observe(element);
    }

    return () => {
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds);
      resizeObserver?.disconnect();
    };
  }, [containerRef]);

  return (
    <div
      className="fixed bottom-0 z-30"
      style={bounds ? { left: `${bounds.left}px`, width: `${bounds.width}px` } : { left: 0, right: 0 }}
    >
      <nav className="flex w-full border-t border-[#E9EEF7] bg-white px-3 pb-3 pt-2">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange?.(tab.key)}
              className={`mt-0 flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 ${isActive ? "bg-[#3B6EF5]" : "bg-transparent"}`}
            >
              <span className={isActive ? "text-white" : "text-[#98A2B3]"}>{tab.icon}</span>
              <span className={`text-[11px] font-semibold ${isActive ? "text-white" : "text-[#98A2B3]"}`}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
