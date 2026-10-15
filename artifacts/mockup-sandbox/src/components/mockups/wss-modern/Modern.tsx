import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './_shared/previewRuntime';
import App from './_shared/modern-source/App';
import './_group.css';
import './Modern.css';

type BauSection = 'graph' | 'table' | 'baseline';
type BauKpis = {
  baselineYear: string;
  endYear: string;
  baselineManaged: string;
  baselineBasic: string;
  bauManaged: string;
  bauBasic: string;
  targetManaged: string;
  targetBasic: string;
  scopeSector: string;
  percentageMode: boolean;
};

const BAU_SECTIONS: { key: BauSection; label: string }[] = [
  { key: 'graph', label: 'BAU Graph' },
  { key: 'table', label: 'BAU Table' },
  { key: 'baseline', label: 'Review Baseline Information' },
];

function readKpis(graph: HTMLElement): BauKpis | null {
  const chartRoots = Array.from(graph.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && !!child.querySelector('h3'));
  if (chartRoots.length < 2) return null;
  const managedChart = chartRoots[0];
  const firstForecast = Number(managedChart.querySelector('table tbody tr:first-child td:first-child')?.textContent?.trim());
  const endYear = Number(managedChart.querySelector('table tbody tr:last-child td:first-child')?.textContent?.trim());
  const readEndpoints = (chart: HTMLElement) => {
    const unitButton = Array.from(chart.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '% of population');
    const percentageMode = !!unitButton && getComputedStyle(unitButton).backgroundColor !== 'rgb(255, 255, 255)';
    const lists = Array.from(chart.querySelectorAll<SVGGElement>('.recharts-label-list'));
    const readList = (list: SVGGElement | undefined) =>
      Array.from(list?.querySelectorAll('text') || [])
        .map(node => node.textContent?.trim() || '')
        .filter(value => value.length > 0);
    const managed = readList(lists[0]);
    const tableRows = Array.from(chart.querySelectorAll('table tbody tr'));
    const lastCells = Array.from(tableRows[tableRows.length - 1]?.querySelectorAll('td') || []);
    const numericCell = (index: number) => Number((lastCells[index]?.textContent || '').replace(/,/g, '').trim());
    const total = numericCell(1);
    const accessPercent = (index: number) => {
      const value = numericCell(index);
      return total > 0 && Number.isFinite(value) ? `~${((value / total) * 100).toFixed(1)}%` : '';
    };
    return {
      baselineManaged: managed[0] || '',
      endManaged: accessPercent(2),
      endTarget: accessPercent(3),
      percentageMode,
    };
  };
  const managed = readEndpoints(chartRoots[0]);
  const basic = readEndpoints(chartRoots[1]);
  const scopeSector = chartRoots[0].querySelector('h3')?.textContent?.split('—')[0]?.trim() || '';
  return {
    baselineYear: firstForecast > 1900 ? String(firstForecast - 1) : '',
    endYear: endYear > 1900 ? String(endYear) : '',
    baselineManaged: managed.baselineManaged,
    baselineBasic: basic.baselineManaged,
    bauManaged: managed.endManaged,
    bauBasic: basic.endManaged,
    targetManaged: managed.endTarget,
    targetBasic: basic.endTarget,
    scopeSector,
    percentageMode: managed.percentageMode && basic.percentageMode,
  };
}

export function Modern() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [bauMode, setBauMode] = useState(false);
  const [activeSection, setActiveSection] = useState<BauSection>('graph');
  const [graphIntro, setGraphIntro] = useState<HTMLElement | null>(null);
  const [kpis, setKpis] = useState<BauKpis | null>(null);
  const openedBauTab = useRef(false);
  const initialGraphScope = useRef(false);

  const getTargets = useCallback(() => {
    const workspace = frameRef.current?.querySelector<HTMLElement>('.modern-bau-workspace');
    const graph = workspace?.querySelector<HTMLElement>('.modern-bau-graph');
    const baseline = workspace?.querySelector<HTMLElement>('.modern-bau-baseline');
    const chartRoots = graph ? Array.from(graph.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !!child.querySelector('h3')) : [];
    const table = graph?.querySelector('table');
    const tableTarget = table?.closest<HTMLElement>('[style*="overflow"]')
      || table?.parentElement as HTMLElement | null;
    const baselinePanel = baseline?.querySelector<HTMLElement>('.modern-input-panel');
    return {
      graph: chartRoots[0]?.querySelector<HTMLElement>('h3') || graph,
      table: tableTarget,
      baseline: baselinePanel || baseline,
    };
  }, []);

  const navigateTo = useCallback((key: BauSection) => {
    const workspace = frameRef.current?.querySelector<HTMLElement>('.modern-bau-workspace');
    const target = getTargets()[key];
    if (!workspace || !target) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const navOffset = window.matchMedia?.('(max-width: 767px)').matches ? 82 : 14;
    const top = workspace.scrollTop + target.getBoundingClientRect().top - workspace.getBoundingClientRect().top - navOffset;
    workspace.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
    setActiveSection(key);
  }, [getTargets]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let initialObserver: MutationObserver | null = null;
    let tabObserver: MutationObserver | null = null;
    let chartObserver: MutationObserver | null = null;
    const percentInitialized = new WeakSet<Element>();
    let workspace: HTMLElement | null = null;
    let scrolling: (() => void) | null = null;
    let baselineNode: HTMLElement | null = null;
    let graphNode: HTMLElement | null = null;
    const clearWorkspace = () => {
      if (workspace && scrolling) workspace.removeEventListener('scroll', scrolling);
      chartObserver?.disconnect();
      chartObserver = null;
      workspace?.classList.remove('modern-bau-workspace');
      baselineNode?.classList.remove('modern-bau-baseline');
      graphNode?.classList.remove('modern-bau-graph');
      workspace = null;
      scrolling = null;
      baselineNode = null;
      graphNode = null;
      setGraphIntro(null);
      setKpis(null);
    };
    const syncWorkspace = () => {
      const tabs = Array.from(frame.querySelectorAll<HTMLButtonElement>('.wb-tab'));
      if (tabs.length > 1 && !openedBauTab.current) {
        openedBauTab.current = true;
        tabs[1].click();
      }
      const activeTab = frame.querySelector<HTMLElement>('.wb-tab-active');
      const selected = !!activeTab && tabs[1] === activeTab;
      setBauMode(previous => previous === selected ? previous : selected);
      if (!selected) {
        frame.classList.remove('modern-bau-mode');
        frame.style.removeProperty('--modern-bau-nav-top');
        if (workspace) clearWorkspace();
        return;
      }
      frame.classList.add('modern-bau-mode');
      const app = frame.querySelector<HTMLElement>('.wb-app');
      const nextWorkspace = app?.querySelector<HTMLElement>('.wb-scope-bar')?.nextElementSibling as HTMLElement
        || app?.querySelector<HTMLElement>('div[style*="position: relative"]');
      if (!nextWorkspace) return;
      if (workspace !== nextWorkspace) {
        if (workspace && scrolling) workspace.removeEventListener('scroll', scrolling);
        workspace = nextWorkspace;
      }
      const children = Array.from(workspace.children).filter(child => child instanceof HTMLElement) as HTMLElement[];
      if (baselineNode && baselineNode !== children[0]) baselineNode.classList.remove('modern-bau-baseline');
      if (graphNode && graphNode !== children[1]) graphNode.classList.remove('modern-bau-graph');
      baselineNode = children[0] || null;
      graphNode = children[1] || null;
      workspace.classList.add('modern-bau-workspace');
      baselineNode?.classList.add('modern-bau-baseline');
      graphNode?.classList.add('modern-bau-graph');
      const graph = workspace.querySelector<HTMLElement>('.modern-bau-graph');
      if (graph) {
        const national = Array.from(graph.querySelectorAll('button'))
          .find(button => /^National\b/.test(button.textContent?.trim() || ''));
        if (national) {
          if (national.style.display !== 'none') national.style.display = 'none';
          const scopeGroup = national.parentElement;
          if (scopeGroup && !initialGraphScope.current) {
            initialGraphScope.current = true;
            Array.from(scopeGroup.querySelectorAll('button'))
              .find(button => button.textContent?.trim() === 'Urban')?.click();
          }
        }
        const chartRoots = Array.from(graph.children).filter((child): child is HTMLElement =>
          child instanceof HTMLElement && !!child.querySelector('h3'));
        chartRoots.forEach(chart => {
          const percent = Array.from(chart.querySelectorAll('button'))
            .find(button => button.textContent?.trim() === '% of population');
          if (!percent || percentInitialized.has(chart)) return;
          percentInitialized.add(chart);
          if (getComputedStyle(percent).backgroundColor === 'rgb(255, 255, 255)') percent.click();
        });
        const baseline = workspace.querySelector<HTMLElement>('.modern-bau-baseline');
        baseline?.querySelectorAll<HTMLButtonElement>('.wb-section-trigger:not(.wb-section-trigger-open)').forEach(trigger => {
          trigger.click();
        });
        baseline?.querySelectorAll<HTMLButtonElement>('.wb-section-trigger-open').forEach(trigger => {
          trigger.setAttribute('aria-expanded', 'true');
          trigger.setAttribute('aria-disabled', 'true');
          trigger.tabIndex = -1;
        });
        const nextKpis = readKpis(graph);
        setKpis(previous => JSON.stringify(previous) === JSON.stringify(nextKpis) ? previous : nextKpis);
        const intro = graph.querySelector<HTMLElement>('.modern-chart-intro--bau');
        setGraphIntro(previous => previous === intro ? previous : intro);
      } else {
        setGraphIntro(null);
        setKpis(null);
      }
      if (workspace) {
        const navTop = `${Math.max(0, workspace.getBoundingClientRect().top)}px`;
        if (frame.style.getPropertyValue('--modern-bau-nav-top') !== navTop) {
          frame.style.setProperty('--modern-bau-nav-top', navTop);
        }
      }
      if (selected && workspace && !scrolling) {
        scrolling = () => {
          const targets = getTargets();
          const reference = workspace!.getBoundingClientRect().top +
            (window.matchMedia?.('(max-width: 767px)').matches ? 82 : 96);
          let current: BauSection = 'graph';
          for (const item of BAU_SECTIONS) {
            const element = targets[item.key];
            if (element && element.getBoundingClientRect().top <= reference) current = item.key;
          }
          setActiveSection(current);
        };
        workspace.addEventListener('scroll', scrolling, { passive: true });
      }
      if (!chartObserver && workspace) {
        chartObserver = new MutationObserver(syncWorkspace);
        chartObserver.observe(workspace, { subtree: true, childList: true, characterData: true });
      }
    };
    const watchTabs = () => {
      const nav = frame.querySelector<HTMLElement>('.wb-tab-nav');
      if (!nav) return false;
      tabObserver = new MutationObserver(syncWorkspace);
      tabObserver.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
      syncWorkspace();
      return true;
    };
    if (!watchTabs()) {
      initialObserver = new MutationObserver(() => {
        if (watchTabs()) initialObserver?.disconnect();
      });
      initialObserver.observe(frame, { subtree: true, childList: true });
    }
    const onResize = () => syncWorkspace();
    window.addEventListener('resize', onResize);
    return () => {
      initialObserver?.disconnect();
      tabObserver?.disconnect();
      chartObserver?.disconnect();
      window.removeEventListener('resize', onResize);
      if (workspace && scrolling) workspace.removeEventListener('scroll', scrolling);
      frame.classList.remove('modern-bau-mode');
      frame.style.removeProperty('--modern-bau-nav-top');
    };
  }, [getTargets]);

  return (
    <div ref={frameRef} className={`wss-modern-frame${bauMode ? ' modern-bau-mode' : ''}`}>
      <App />
      {bauMode && (
        <nav className="modern-bau-nav" aria-label="Business-as-usual sections">
          <span className="modern-bau-nav__eyebrow">BUSINESS-AS-USUAL</span>
          <div className="modern-bau-nav__items">
            {BAU_SECTIONS.map((section, index) => (
              <button key={section.key} type="button"
                className={`modern-bau-nav__item${activeSection === section.key ? ' is-active' : ''}`}
                aria-current={activeSection === section.key ? 'location' : undefined}
                onClick={() => navigateTo(section.key)}>
                <span className="modern-bau-nav__number">{index + 1}</span>
                <span>{section.label}</span>
              </button>
            ))}
          </div>
          <small className="modern-bau-nav__hint">One baseline · two service systems</small>
        </nav>
      )}
      {bauMode && graphIntro && createPortal(
        <div className="modern-bau-kpi-region" aria-label="Baseline and forecast-end service coverage">
          <div className="modern-bau-kpi-context">{kpis?.scopeSector || 'Selected area and service system'} · share of households</div>
          <div className="modern-bau-kpis" aria-live="polite">
          <div className="modern-bau-kpi modern-bau-kpi--baseline">
            <span className="modern-bau-kpi__eyebrow">BASELINE · LAST HISTORICAL YEAR {kpis?.baselineYear || ''}</span>
            <strong>{kpis?.percentageMode ? `SM ${kpis.baselineManaged || '—'}` : '—'}</strong>
            <small>{kpis?.percentageMode ? `Basic ${kpis.baselineBasic || '—'} · chart labels rounded to whole points` : 'Coverage appears when both charts show % of population.'}</small>
          </div>
          <div className="modern-bau-kpi">
            <span className="modern-bau-kpi__eyebrow">BUSINESS-AS-USUAL · FORECAST END {kpis?.endYear || ''}</span>
            <strong>{kpis?.percentageMode ? `SM ${kpis.bauManaged || '—'}` : '—'}</strong>
            <small>{kpis?.percentageMode ? `Basic ${kpis.bauBasic || '—'} · from the forecast ledger` : 'Switch both charts to % of population to show coverage.'}</small>
          </div>
          <div className="modern-bau-kpi modern-bau-kpi--target">
            <span className="modern-bau-kpi__eyebrow">ENTERED SERVICE TARGET · FORECAST END {kpis?.endYear || ''}</span>
            <strong>{kpis?.percentageMode ? `SM ${kpis.targetManaged || '—'}` : '—'}</strong>
            <small>{kpis?.percentageMode ? `Basic ${kpis.targetBasic || '—'} · from the forecast ledger` : 'Switch both charts to % of population to show coverage.'}</small>
          </div>
          </div>
        </div>,
        graphIntro,
      )}
    </div>
  );
}
