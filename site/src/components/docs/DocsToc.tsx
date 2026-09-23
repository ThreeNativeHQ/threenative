import { useEffect, useState } from "react";

export interface IDocsTocItem {
  readonly id: string;
  readonly label: string;
}

export function useActiveSection(items: readonly IDocsTocItem[]): string | undefined {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    if (items.length === 0) return;
    let frame = 0;
    const update = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        let current = items[0]?.id;
        for (const item of items) {
          const section = document.getElementById(item.id);
          if (section && section.getBoundingClientRect().top <= 128) current = item.id;
        }
        setActive(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
    };
  }, [items]);

  return active;
}

export function DocsToc({
  items,
  active,
}: {
  readonly items: readonly IDocsTocItem[];
  readonly active: string | undefined;
}) {
  return (
    <nav aria-label="On this page" className="space-y-2">
      {items.map((item) => (
        <a
          aria-current={active === item.id ? "location" : undefined}
          className={`block text-[13px] leading-5 transition-colors hover:text-tn-fg ${active === item.id ? "font-medium text-tn-accent" : "text-tn-fg-subtle"}`}
          href={`#${item.id}`}
          key={item.id}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
