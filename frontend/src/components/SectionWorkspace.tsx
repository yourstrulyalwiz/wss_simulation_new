import React, { useRef, useState } from 'react';

export type WorkspaceSection = { key: string; label: string };
export default function SectionWorkspace({ sections, label, children }: {
  sections: WorkspaceSection[]; label: string; children: React.ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(sections[0]?.key || '');
  const navigate = (key: string) => {
    const target = content.current?.querySelector<HTMLElement>(`[data-section-key="${key}"]`);
    if (!target || !content.current) return;
    setActive(key);
    const heading = target.querySelector<HTMLElement>('h2, h3') || target;
    heading.focus({ preventScroll: true });
    content.current.scrollTo({
      top: content.current.scrollTop + target.getBoundingClientRect().top - content.current.getBoundingClientRect().top - 12,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  if (!sections.length) return <>{children}</>;
  return <div className="modern-section-workspace">
    <nav className="modern-inputs-nav" aria-label={label}>
      <span className="modern-inputs-nav__eyebrow">{label}</span>
      <div className="modern-inputs-nav__items">{sections.map((section, index) =>
        <button key={section.key} className="modern-inputs-nav__item"
          aria-current={active === section.key ? 'location' : undefined} onClick={() => navigate(section.key)}>
          <span className="modern-inputs-nav__number">{index + 1}</span>{section.label}
        </button>)}</div>
      <select className="modern-inputs-nav__select" aria-label={`Go to ${label}`} value={active}
        onChange={event => navigate(event.target.value)}>
        {sections.map((section, index) => <option key={section.key} value={section.key}>{index + 1}. {section.label}</option>)}
      </select>
    </nav>
    <div ref={content} className="modern-inputs-content" onScroll={() => {
      if (!content.current) return;
      const top = content.current.getBoundingClientRect().top;
      let current = sections[0].key;
      for (const section of sections) {
        const node = content.current.querySelector<HTMLElement>(`[data-section-key="${section.key}"]`);
        if (node && node.getBoundingClientRect().top <= top + 65) current = section.key;
      }
      setActive(current);
    }}>{children}</div>
  </div>;
}
