import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ComposedChart, Line, Label, ReferenceLine, LabelList,
} from 'recharts';
import { C } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import { linesFirstLegend } from './chartLegend';
import ChartExport from './ChartExport';
import TableExport from './TableExport';

/**
 * BAU vs Target chart driven by the LIVE calculation engine (validated cell-by-cell against the
 * reference Excel). Re-computes whenever the shared inputs change (debounced).
 *
 * Accepts EITHER a single `inputs` (one area) or an `inputsList` of several area datasets that are
 * summed element-wise (Urban + Rural = National) — households, safely-managed BAU/target counts and
 * the financing gap are all additive across areas.
 *
 * test2 chart: unit toggle is "# households" vs "% of population"; the financing gap is shown as the
 * VERTICAL Target−BAU difference at the final forecast year (not a floating box); per-year numbers
 * live in the data table below the chart. Animations snap (no tween).
 */

// Round to 3 significant figures. toPrecision avoids the float artefacts that dividing by a tiny
// power of ten produced (e.g. 117 / 1e-5 = 11699999.999999998).
function round3(v: number): number {
  if (!isFinite(v) || v === 0) return 0;
  return Number(v.toPrecision(3));
}
// Format with thousands separators, at most 2 decimals (no scientific notation).
function sig3(v: number): string {
  return round3(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
// Money in the engine is carried in MILLIONS; display large money in BILLIONS (÷1000) to 3 sig figs,
// so a financing gap like 254,000 M reads "254 B" instead of a six-digit number.
function sigB(vMillions: number): string {
  return sig3(vMillions / 1000);
}

export default function LiveBAUChart({ inputs, inputsList, sector, scopeLabel, rung = 0 }:
  { inputs?: any; inputsList?: any[]; sector: 'water' | 'sanitation'; scopeLabel?: string; rung?: number }) {
  const datasets = ((inputsList && inputsList.length) ? inputsList : (inputs ? [inputs] : [])).filter(Boolean);
  // Which JMP rung this chart plots: 0 = Safely managed (the primary chart), 1 = Basic, … The Basic chart
  // gets the SAME elements as SM (BAU area, Target line, reference lines, 🎯 call-outs, endpoint labels),
  // but the MONEY financing gap / cumulative need / budget-constrained warning are SM-specific (the engine's
  // financing_gap is the cost of closing the SM gap), so they are shown only on the rung-0 (SM) chart.
  const ccx = datasets[0]?.country_config || {};
  const rungNameRaw = (sector === 'water'
    ? [ccx.ws_serv1_name, ccx.ws_serv2_name, ccx.ws_serv3_name, ccx.ws_serv4_name, ccx.ws_serv5_name]
    : [ccx.san_serv1_name, ccx.san_serv2_name, ccx.san_serv3_name, ccx.san_serv4_name, ccx.san_serv5_name])[rung]
    || ['Safely managed', 'Basic', 'Limited', 'Unimproved', 'No service'][rung] || 'Service';
  const rungLabel = rungNameRaw.toLowerCase();          // e.g. "safely managed" | "basic"
  const bauKey = `Households with ${rungLabel} (BAU)`;   // dataKey shared by the rows + the chart Area
  const tgtKey = `Target (${rungLabel})`;
  const showMoney = rung === 0;                          // financing gap etc. only apply to the SM chart
  const [data, setData] = useState<any[]>([]);
  const [tableRows, setTableRows] = useState<any[]>([]);
  const [endAnno, setEndAnno] = useState<{ year: number; bau: number; tgt: number; bauShare: number; tgtShare: number; gapHH: number; finGap: number | null; cur: string } | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when the BAU is budget-constrained (frozen): the capex budget is below the replacement need in
  // every forecast year, so no new safely-managed service is built and unit cost has no effect.
  const [constrained, setConstrained] = useState<{ avail: number; repl: number; cur: string } | null>(null);
  // Reference lines carry BOTH the absolute (count) and share value so they track the Y-axis unit toggle.
  const [targetLines, setTargetLines] = useState<{ y: number; yShare: number; label: string }[]>([]);
  // On-chart target call-outs: one 🎯 chat-box per target year, anchored at the target point, showing
  // that year's coverage and service gap. Closeable via ✕ (leaves a small reopen marker); the 🎯 Targets
  // multi-select controls which are drawn (null = all visible, so new targets appear automatically).
  const [targetPoints, setTargetPoints] = useState<any[]>([]);
  const [closedFlags, setClosedFlags] = useState<Set<string>>(new Set());
  const toggleFlag = (key: string, open: boolean) => setClosedFlags(prev => {
    const n = new Set(prev); if (open) n.delete(key); else n.add(key); return n;
  });
  const [visibleTargets, setVisibleTargets] = useState<Set<number> | null>(null);
  const [tgtDropOpen, setTgtDropOpen] = useState(false);
  const isTargetVisible = (yr: number) => !visibleTargets || visibleTargets.has(yr);
  const toggleTargetVisible = (yr: number, allYears: number[]) => setVisibleTargets(prev => {
    const n = new Set(prev ?? allYears);          // null (all) -> materialize the full set first
    if (n.has(yr)) n.delete(yr); else n.add(yr);
    return n;
  });
  // Y-axis unit: absolute household counts (millions) or share of total POPULATION (%).
  const [unitMode, setUnitMode] = useState<'count' | 'share'>('count');
  // Show/hide the per-year data-point dots on the chart.
  const [showDots, setShowDots] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);
  // ── Overlay geometry: the final-year vertical-gap annotation is drawn in a SEPARATE svg stacked
  // ABOVE the chart, so nothing recharts paints can cross it. Pixel positions are derived from the
  // rendered axis ticks: both axes are linear in (year, value), so two ticks fix each mapping.
  const [overlay, setOverlay] = useState<{ left: number; top: number; width: number; height: number;
    xm: number; xb: number; ym: number; yb: number } | null>(null);
  const [winTick, setWinTick] = useState(0);          // bump to re-measure the overlay geometry
  const [wrapW, setWrapW] = useState(0);              // measured chart width — drives the chart explicitly
  // recharts' ResponsiveContainer does not reliably re-fit when the side Guide panel opens/closes
  // (it changes the chart's width with no window 'resize'), leaving the chart and its financing-gap
  // overlay pinned to a stale width. We instead measure the wrapper ourselves and size the chart
  // explicitly, re-measuring on every width change via a ResizeObserver. useLayoutEffect measures
  // before paint so there is no zero-width first frame.
  useLayoutEffect(() => {
    const measure = () => { if (chartRef.current) setWrapW(chartRef.current.clientWidth); setWinTick(t => t + 1); };
    measure();
    window.addEventListener('resize', measure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && chartRef.current) {
      ro = new ResizeObserver(() => measure());
      ro.observe(chartRef.current);
    }
    return () => { window.removeEventListener('resize', measure); if (ro) ro.disconnect(); };
  }, []);
  const isShareNow = unitMode === 'share';
  // recharts repositions its axis ticks a few frames AFTER the data / unit / width changes. A single
  // measurement taken before that lands on a STALE scale — and, worse, it can equal the current (stale)
  // overlay, so a "stop once stable" loop would quit early and leave the financing-gap bracket floating.
  // So on every such change we open a short window (below) and re-measure each frame until it settles.
  const settle = useRef(0);
  useEffect(() => { settle.current = 32; setWinTick(t => t + 1); }, [data, unitMode, wrapW]);
  useLayoutEffect(() => {
    let raf = 0;
    const again = () => { raf = requestAnimationFrame(() => setWinTick(t => t + 1)); };
    const inWindow = settle.current > 0;
    if (settle.current > 0) settle.current -= 1;
    // next: a fresh geometry to apply, null to hide, or undefined to keep the current one (mid-update).
    const finish = (next: typeof overlay | undefined) => {
      let moved = false;
      if (next !== undefined) {
        moved = (!!overlay) !== (!!next) ||
          (!!overlay && !!next && (['left', 'top', 'width', 'height', 'xm', 'xb', 'ym', 'yb'] as const)
            .some(k => Math.abs(overlay[k] - next[k]) >= 0.5));
        if (moved) setOverlay(next);
      }
      if (inWindow || moved) again();   // keep re-measuring through the window, or while still moving
      return () => cancelAnimationFrame(raf);
    };
    const wrap = chartRef.current;
    const surface = wrap ? ([...wrap.querySelectorAll('svg.recharts-surface')] as SVGSVGElement[])
      .sort((a, b) => b.clientWidth - a.clientWidth)[0] : null;
    if (!wrap || !surface || surface.clientWidth < 100) return finish(data.length ? undefined : null);
    const sR = surface.getBoundingClientRect();
    const wR = wrap.getBoundingClientRect();
    const xt: { yr: number; x: number }[] = [];
    const yt: { v: number; y: number }[] = [];
    let sawPct = false;
    surface.querySelectorAll('text.recharts-cartesian-axis-tick-value').forEach((t) => {
      const raw = (t.textContent || '').trim();
      const x = parseFloat(t.getAttribute('x') || '');
      const y = parseFloat(t.getAttribute('y') || '');
      if (/^(19|20)\d{2}$/.test(raw)) {
        if (!isNaN(x)) xt.push({ yr: parseInt(raw, 10), x });
      } else {
        if (/%$/.test(raw)) sawPct = true;
        const v = parseFloat(raw.replace(/[%,\s]/g, ''));
        if (!isNaN(v) && !isNaN(y)) yt.push({ v: isShareNow ? v / 100 : v, y });
      }
    });
    // ticks mid-update (wrong count, or %/count mismatch during a unit toggle) → keep the current overlay
    if (xt.length < 2 || yt.length < 2 || sawPct !== isShareNow) return finish(undefined);
    const xa = xt[0], xz = xt[xt.length - 1];
    const ya = yt[0], yz = yt[yt.length - 1];
    if (xz.yr === xa.yr || yz.v === ya.v) return finish(undefined);
    const xm = (xz.x - xa.x) / (xz.yr - xa.yr), xb = xa.x - xm * xa.yr;
    const ym = (yz.y - ya.y) / (yz.v - ya.v), yb = ya.y - ym * ya.v;
    return finish({ left: sR.left - wR.left, top: sR.top - wR.top, width: sR.width, height: sR.height, xm, xb, ym, yb });
  }, [data, unitMode, winTick]);

  const depKey = JSON.stringify(datasets) + '|' + sector;
  useEffect(() => {
    if (!datasets.length) return;
    const h = setTimeout(() => {
      Promise.all(datasets.map(inp =>
        fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inp) })
          .then(r => { if (!r.ok) throw new Error('calc failed (' + r.status + ')'); return r.json(); })
      )).then(resList => {
        const base = resList[0];
        const years: number[] = base.years;
        const secOf = (res: any) => sector === 'water' ? res.water_supply : res.sanitation;
        // Element-wise sum across areas (Urban + Rural = National). All series are additive.
        const sum = (pick: (res: any, i: number) => number) =>
          years.map((_: number, i: number) => resList.reduce((a, res) => a + (pick(res, i) || 0), 0));
        const total = sum((res, i) => res.total_hh[i]);
        const pop = sum((res, i) => res.population[i]);
        const bau = sum((res, i) => secOf(res).bau_hh[rung][i]);
        const tgt = sum((res, i) => secOf(res).target_hh[rung][i]);
        const finGapSeries = showMoney ? sum((res, i) => (secOf(res).financing_gap || [])[i] || 0) : years.map(() => 0);

        const per = datasets[0]?.period || {};
        const baseYr = per.baseline_year ?? years[0];
        const rows = years.map((y: number, i: number) => {
          const tot = +total[i].toFixed(4);
          // Safely-managed can never exceed total households — clamp both BAU and target for display.
          const bauC = +Math.min(total[i], bau[i]).toFixed(4);
          const tgtC = +Math.min(total[i], tgt[i]).toFixed(4);
          return {
            year: y,
            'Total households': tot,
            [bauKey]: bauC,
            [tgtKey]: tgtC,
          };
        });
        setData(rows);

        const cur0 = datasets[0]?.country_config?.currency || 'LCU';

        // Per-year data table (forecast years only): total HH, safely-managed BAU, target, HH gap, financing gap.
        const tblRows = years.map((y: number, i: number) => {
          if (y <= baseYr) return null;
          const tot = total[i] || 0;
          const b = Math.min(tot, bau[i]);
          const t = Math.min(tot, tgt[i]);
          const gapHH = Math.max(0, t - b);
          return { year: y, total: tot, bau: b, tgt: t, gapHH, finGap: showMoney ? (finGapSeries[i] ?? null) : null };
        }).filter(Boolean) as any[];
        setTableRows(tblRows);

        // Final-year vertical-gap annotation: the Target−BAU difference (households) and the annual
        // financing gap (money) at the LAST forecast year.
        const endIdx = years.length - 1;
        const totEnd = total[endIdx] || 0;
        const popEnd = pop[endIdx] || 0;
        const bauEnd = Math.min(totEnd, bau[endIdx]);
        const tgtEnd = Math.min(totEnd, tgt[endIdx]);
        setEndAnno({
          year: years[endIdx],
          bau: +bauEnd.toFixed(4), tgt: +tgtEnd.toFixed(4),
          bauShare: totEnd > 0 ? bauEnd / totEnd : 0, tgtShare: totEnd > 0 ? tgtEnd / totEnd : 0,
          gapHH: Math.max(0, tgtEnd - bauEnd), finGap: showMoney ? (finGapSeries[endIdx] ?? null) : null, cur: cur0,
        });

        // test2: target years come from the service table — any forecast column whose 5 rung shares
        // sum to ~100% is a target. Union across areas. Draw a horizontal reference line at each level.
        const svcSection = sector === 'water' ? 'water_service' : 'sanitation_service';
        const svcPrefix = sector === 'water' ? 'serv' : 'sserv';
        const tgtYearSet = new Set<number>();
        datasets.forEach((inp: any) => {
          const svc = inp?.[svcSection] || {};
          const arrs = [1, 2, 3, 4, 5].map(k => svc[`${svcPrefix}${k}_ts`] || []);
          const msy = inp?.period?.model_start_year ?? years[0];
          const by = inp?.period?.baseline_year ?? msy;
          const end = inp?.period?.forecast_end_year ?? years[years.length - 1];
          const maxLen = Math.max(0, ...arrs.map((a: any[]) => a.length));
          for (let idx = 0; idx < maxLen; idx++) {
            const yr = msy + idx;
            if (yr <= by || yr > end) continue;
            let s = 0, any = false;
            arrs.forEach((a: any[]) => { const v = a[idx]; if (v != null && v > 0) { s += v; any = true; } });
            if (any && Math.abs(s - 1) < 0.02) tgtYearSet.add(yr);
          }
        });
        const tgtYears = [...tgtYearSet].sort((a, b) => a - b);
        // Per-target anchor + coverage payload for the on-chart call-outs (all additive across areas).
        const points = tgtYears.map((yr: number) => {
          const ix = years.indexOf(yr);
          if (ix < 0) return null;
          const tot = total[ix] || 0;
          const t = Math.min(tot, tgt[ix]), b = Math.min(tot, bau[ix]);
          return {
            year: yr,
            y: +t.toFixed(4), yShare: tot > 0 ? t / tot : 0,             // target point (callout anchor)
            bauCov: tot > 0 ? b / tot : 0, tgtCov: tot > 0 ? t / tot : 0,
            svcGap: Math.max(0, t - b),
          };
        }).filter(Boolean) as any[];
        setTargetPoints(points);
        setTargetLines(points.map((p: any) => ({ y: p.y, yShare: p.yShare, label: `Target (${p.year})` })));

        // Budget-constrained (frozen) detection.
        const availS = sum((res, i) => (secOf(res).bau_available || [])[i] || 0);
        const replS = sum((res, i) => (secOf(res).bau_replacement_capex || [])[i] || 0);
        const fcast = years.map((y: number, i: number) => (y > baseYr ? i : -1)).filter((i: number) => i >= 0);
        const frozen = showMoney && fcast.length > 0 && fcast.every((i: number) => availS[i] <= replS[i] + 1e-9);
        const avgOf = (arr: number[]) => fcast.reduce((a: number, i: number) => a + (arr[i] || 0), 0) / fcast.length;
        setConstrained(frozen ? { avail: avgOf(availS), repl: avgOf(replS), cur: cur0 } : null);

        // ── Headline summary ──
        const cov = (arr: number[]) => totEnd > 0 ? Math.min(totEnd, arr[endIdx]) / totEnd : 0;
        const covPop = (arr: number[]) => popEnd > 0 ? Math.min(totEnd, arr[endIdx]) / totEnd : 0;   // ≈ share of population
        const tin = sum((res, i) => (secOf(res).total_investment_need || [])[i] || 0);
        let cumNeed = 0; years.forEach((y: number, i: number) => { if (y > baseYr) cumNeed += tin[i] || 0; });
        setSummary({
          costSM: datasets.length === 1 ? secOf(base)[showMoney ? 'cost_per_hh' : 'cost_basic'] : null,
          currency: cur0, rungLabel, showMoney,
          endline: years[endIdx], baseline: baseYr, firstForecast: baseYr + 1,
          bauCov: cov(bau), tgtCov: cov(tgt), bauPop: covPop(bau), tgtPop: covPop(tgt),
          gapEnd: Math.max(0, tgtEnd - bauEnd), finGapEnd: showMoney ? (finGapSeries[endIdx] ?? null) : null,
          cumNeed: showMoney ? cumNeed : null,
        });
        setError(null);
      }).catch(e => setError(String(e)));
    }, 350);
    return () => clearTimeout(h);
  }, [depKey]);

  const sectorLabel = sector === 'water' ? 'Water Supply' : 'Sanitation';
  const isShare = unitMode === 'share';

  // Endpoint value labels: annotate the baseline year and the final forecast year only.
  const per0 = datasets[0]?.period || {};
  const endpointYears = useMemo(() => {
    const s = new Set<number>();
    if (per0.baseline_year != null) s.add(per0.baseline_year);
    if (per0.forecast_end_year != null) s.add(per0.forecast_end_year);
    return s;
  }, [per0.baseline_year, per0.forecast_end_year]);

  // In share mode, divide every series by that row's Total households (= share of population, since
  // the model uses one household size). Total households becomes the 100% ceiling.
  const displayData = useMemo(() => {
    if (!isShare) return data;
    return data.map(row => {
      const tot = row['Total households'] || 0;
      const div = (v: number | null) => v == null ? null : (tot > 0 ? v / tot : 0);
      return {
        year: row.year,
        'Total households': tot > 0 ? 1 : 0,
        [bauKey]: div(row[bauKey]),
        [tgtKey]: div(row[tgtKey]),
      };
    });
  }, [data, isShare, bauKey, tgtKey]);

  const fmtVal = (v: any) => isShare ? ((+(v ?? 0)) * 100).toFixed(1) + '%' : sig3(+(v ?? 0)) + 'M';
  const fmtLabel = (v: any) => isShare ? ((+(v ?? 0)) * 100).toFixed(0) + '%' : sig3(+(v ?? 0)) + 'M';

  // Render a value label only at the baseline / endline year points (used by <LabelList> on key series).
  const endpointLabel = (props: any) => {
    const { x, y, index, value } = props;
    const row = displayData[index];
    if (!row || value == null || !endpointYears.has(row.year)) return null;
    return <text x={x} y={y - 7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#0c4a6e">{fmtLabel(value)}</text>;
  };

  const fileBase = `${(scopeLabel ? scopeLabel + '_' : '')}${sector}_${rungLabel.replace(/\s+/g, '')}_bau`;

  // Data series behind the chart (what is plotted) — for the chart's ⤓ Excel export.
  const chartHeaders = ['Year', bauKey, tgtKey, 'Total households'];
  const chartRows = displayData.map((r: any) => [r.year, r[bauKey], r[tgtKey], r['Total households']]);
  // Native Excel chart: BAU as a filled area, Target (solid) and the households ceiling (dashed) as lines.
  const chartSpec = {
    category: 'Year', stacked: false,
    areas: [{ name: bauKey, color: C.bauFill }],
    lines: [{ name: tgtKey, color: C.target }, { name: 'Total households', color: C.total, dash: true }],
    yTitle: isShare ? '% of population' : '# households (millions)', xTitle: 'Year',
  };
  // Forecast data table (per year) — for its own ⤓ CSV / ⤓ Excel.
  const tableHeaders = ['Year', 'Total households (M)', `${rungNameRaw} BAU (M)`, `Target ${rungLabel} (M)`, 'Service Gap (M HH)',
    ...(showMoney ? [`Financing gap (${endAnno?.cur || 'LCU'} M/yr)`] : [])];
  const tableExportRows = tableRows.map((r: any) => [r.year, round3(r.total), round3(r.bau), round3(r.tgt), round3(r.gapHH),
    ...(showMoney ? [r.finGap == null ? '' : round3(r.finGap)] : [])]);

  const toolBtn: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6,
    background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 500,
  };

  // ── Final-year financing-gap annotation ──────────────────────────────────────────────────────
  // A vertical bracket at the last forecast year spanning BAU→Target, labelled with the money gap.
  const GapAnnotation = () => {
    if (!overlay || !endAnno) return null;
    const bauV = isShare ? endAnno.bauShare : endAnno.bau;
    const tgtV = isShare ? endAnno.tgtShare : endAnno.tgt;
    const x = overlay.xm * endAnno.year + overlay.xb;
    const yBau = overlay.ym * bauV + overlay.yb;
    const yTgt = overlay.ym * tgtV + overlay.yb;
    if (!isFinite(x) || !isFinite(yBau) || !isFinite(yTgt)) return null;
    const yTop = Math.min(yBau, yTgt), yBot = Math.max(yBau, yTgt);
    // Draw the bracket just to the LEFT of the final-year gridline so it doesn't fall off the plot.
    const bx = Math.min(x, overlay.width - 8);
    const tick = 6;
    const midY = (yTop + yBot) / 2;
    // Closed -> collapse to a small reopen marker at the bracket, exactly as a target call-out does.
    // The bracket, the arrows, the dashed leader and the label box all go with it, so nothing red is
    // left behind on the plot.
    const key = `g-${endAnno.year}`;
    if (closedFlags.has(key)) {
      return (
        <g onClick={() => toggleFlag(key, true)} style={{ cursor: 'pointer' }}>
          <title>{`Reopen the Financing gap ${endAnno.year} call-out`}</title>
          <circle cx={bx} cy={midY} r={8} fill="#fff" stroke="#b91c1c" strokeWidth={1.5} />
          <text x={bx} y={midY + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#b91c1c">↕</text>
        </g>
      );
    }
    const money = endAnno.finGap == null ? null : `${sigB(endAnno.finGap)} B ${endAnno.cur}/yr`;
    const gapHHtxt = `${sig3(endAnno.gapHH)} M HH`;
    // Label box to the left of the bracket.
    const boxW = 132, boxH = money ? 44 : 30;
    const boxX = Math.max(4, bx - boxW - 10);
    const boxY = Math.max(2, Math.min(midY - boxH / 2, overlay.height - boxH - 2));
    return (
      <g>
        {/* endpoints on the two lines */}
        <circle cx={x} cy={yBau} r={3} fill={C.bau} stroke="#fff" strokeWidth={1} />
        <circle cx={x} cy={yTgt} r={3} fill={C.target} stroke="#fff" strokeWidth={1} />
        {/* vertical double-arrow bracket */}
        <line x1={bx} y1={yTop} x2={bx} y2={yBot} stroke="#b91c1c" strokeWidth={2} />
        <line x1={bx - tick} y1={yTop} x2={bx + tick} y2={yTop} stroke="#b91c1c" strokeWidth={2} />
        <line x1={bx - tick} y1={yBot} x2={bx + tick} y2={yBot} stroke="#b91c1c" strokeWidth={2} />
        <path d={`M ${bx} ${yTop} l -4 6 l 8 0 z`} fill="#b91c1c" />
        <path d={`M ${bx} ${yBot} l -4 -6 l 8 0 z`} fill="#b91c1c" />
        {/* leader from bracket to label box */}
        <line x1={boxX + boxW} y1={midY} x2={bx} y2={midY} stroke="#b91c1c" strokeWidth={1} strokeDasharray="2 2" />
        {/* label box */}
        <rect x={boxX + 2} y={boxY + 2.5} width={boxW} height={boxH} rx={5} fill="#0f172a" opacity={0.16} />
        <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={5} fill="#fff" stroke="#b91c1c" strokeWidth={1.4} />
        <text x={boxX + 8} y={boxY + 14} fontSize={9.5} fontWeight={700} fill="#b91c1c">Financing gap · {endAnno.year}</text>
        {money
          ? <><text x={boxX + 8} y={boxY + 27} fontSize={10} fontWeight={700} fill="#7f1d1d">{money}</text>
              <text x={boxX + 8} y={boxY + 39} fontSize={9} fill="#334155">{gapHHtxt} shortfall</text></>
          : <text x={boxX + 8} y={boxY + 25} fontSize={10} fontWeight={700} fill="#7f1d1d">{gapHHtxt} shortfall</text>}
        <g onClick={() => toggleFlag(key, false)} style={{ cursor: 'pointer' }}>
          <title>Close</title>
          <circle cx={boxX + boxW - 11} cy={boxY + 11} r={7} fill="#fff" stroke="#cbd5e1" />
          <text x={boxX + boxW - 11} y={boxY + 14} textAnchor="middle" fontSize={9} fontWeight={700} fill="#64748b">✕</text>
        </g>
      </g>
    );
  };

  // ── On-chart target call-outs ────────────────────────────────────────────────────────────────
  const pct1 = (f: number) => (f * 100).toFixed(1) + '%';
  const BUBBLE_W = 142, BUBBLE_H = 63;
  // Collision-aware placement: each open call-out tries candidate spots (above/below the anchor, shifted
  // sideways, stacked further out) and takes the first that doesn't overlap an already-placed box; if all
  // collide it takes the least-overlapping one. Closed call-outs take no space.
  const flagPlan = useMemo(() => {
    if (!overlay) return null;
    const chartW = overlay.width, chartH = overlay.height;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const M = 6;
    const clampR = (c: { x: number; y: number }, w: number, h: number) => ({
      x: Math.max(4, Math.min(c.x, chartW - w - 4)),
      y: Math.max(2, Math.min(c.y, chartH - h - 2)), w, h,
    });
    const collide = (r: any) => placed.some(p =>
      r.x < p.x + p.w + M && p.x < r.x + r.w + M && r.y < p.y + p.h + M && p.y < r.y + r.h + M);
    const place = (cands: { x: number; y: number }[], w: number, h: number) => {
      let best: any = null, bestScore = Infinity;
      for (const c of cands) {
        const r = clampR(c, w, h);
        if (!collide(r)) { placed.push(r); return r; }
        let s = 0;
        placed.forEach(p => {
          const ox = Math.max(0, Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x));
          const oy = Math.max(0, Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y));
          s += ox * oy;
        });
        if (s < bestScore) { bestScore = s; best = r; }
      }
      placed.push(best);
      return best;
    };
    const bubbles: Record<number, { x: number; y: number }> = {};
    targetPoints.filter((p: any) => isTargetVisible(p.year)).forEach((p: any) => {
      if (closedFlags.has(`t-${p.year}`)) return;
      const cx = overlay.xm * p.year + overlay.xb;
      const cy = overlay.ym * (isShareNow ? p.yShare : p.y) + overlay.yb;
      const cands: { x: number; y: number }[] = [];
      for (let lvl = 0; lvl < 4; lvl++) {
        const yAbove = cy - BUBBLE_H - 12 - lvl * (BUBBLE_H + 10);
        const yBelow = cy + 12 + lvl * (BUBBLE_H + 10);
        for (const x of [cx - BUBBLE_W / 2, cx - BUBBLE_W - 10, cx + 10]) cands.push({ x, y: yAbove });
        for (const x of [cx - BUBBLE_W / 2, cx - BUBBLE_W - 10, cx + 10]) cands.push({ x, y: yBelow });
      }
      const r = place(cands, BUBBLE_W, BUBBLE_H);
      bubbles[p.year] = { x: r.x, y: r.y };
    });
    return { bubbles };
  }, [overlay, targetPoints, visibleTargets, closedFlags, isShareNow]);

  // TargetBubble: a chat-box call-out with a tail pointing at the target point, closeable via ✕ (a closed
  // call-out collapses to a small 🎯 marker that reopens it on click).
  const TargetBubble = (props: any) => {
    const { cx, cy, point, box } = props;
    if (cx == null || cy == null) return null;
    const key = `t-${point.year}`;
    if (closedFlags.has(key)) {
      return (
        <g onClick={() => toggleFlag(key, true)} style={{ cursor: 'pointer' }}>
          <title>{`Reopen the Target ${point.year} call-out`}</title>
          <circle cx={cx} cy={cy} r={8} fill="#fff" stroke="#16a34a" strokeWidth={1.5} />
          <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={9}>🎯</text>
        </g>
      );
    }
    if (!box) return null;
    const lines = [
      `Target coverage: ${pct1(point.tgtCov)}`,
      `BAU coverage: ${pct1(point.bauCov)}`,
      `Service gap: ${sig3(point.svcGap)} M HH`,
    ];
    const w = BUBBLE_W, h = BUBBLE_H, lineH = 12;
    const bx = box.x, by = box.y;
    const tx = Math.max(bx + 12, Math.min(cx, bx + w - 12));
    let connector: React.ReactNode;
    if (by + h <= cy - 4) {          // box above the point → tail from the bottom edge
      connector = <path d={`M ${tx - 6} ${by + h} L ${tx + 6} ${by + h} L ${cx} ${cy - 3} Z`} fill="#ffffff" stroke="#16a34a" strokeWidth={1} />;
    } else if (by >= cy + 4) {       // box below the point → tail from the top edge
      connector = <path d={`M ${tx - 6} ${by} L ${tx + 6} ${by} L ${cx} ${cy + 3} Z`} fill="#ffffff" stroke="#16a34a" strokeWidth={1} />;
    } else {                          // box beside the point → thin leader line to the nearest edge
      const ex = cx < bx ? bx : bx + w;
      connector = <line x1={cx} y1={cy} x2={ex} y2={Math.max(by + 6, Math.min(cy, by + h - 6))} stroke="#16a34a" strokeWidth={1.2} />;
    }
    return (
      <g>
        <circle cx={cx} cy={cy} r={3.5} fill="#16a34a" stroke="#fff" strokeWidth={1} />
        <rect x={bx + 2} y={by + 2.5} width={w} height={h} rx={7} fill="#0f172a" opacity={0.16} />
        {connector}
        <rect x={bx} y={by} width={w} height={h} rx={7} fill="#ffffff" stroke="#16a34a" strokeWidth={1.4} />
        <text x={bx + 9} y={by + 15} fontSize={10} fontWeight={700} fill="#15803d">🎯 Target {point.year}</text>
        {lines.map((t, i) => (
          <text key={i} x={bx + 9} y={by + 29 + i * lineH} fontSize={9} fill="#334155">{t}</text>
        ))}
        <g onClick={() => toggleFlag(key, false)} style={{ cursor: 'pointer' }}>
          <title>Close</title>
          <circle cx={bx + w - 11} cy={by + 11} r={7} fill="#fff" stroke="#cbd5e1" />
          <text x={bx + w - 11} y={by + 14} textAnchor="middle" fontSize={9} fontWeight={700} fill="#64748b">✕</text>
        </g>
      </g>
    );
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 6, fontWeight: 600, color: '#1e3a5f' }}>
        {scopeLabel ? scopeLabel + ' ' : ''}{sectorLabel} — {rungNameRaw}: BAU vs Target (live calculation engine)
      </h3>
      <div style={{ fontSize: 10, color: '#065f46', background: '#d1fae5', padding: '4px 8px', borderRadius: 4, marginBottom: 8 }}>
        Live engine output.{datasets.length > 1 ? ' National = Urban + Rural (summed).' : ' Edits on the Data Inputs tab recompute this chart.'}
      </div>
      {constrained && (
        <div style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '6px 10px', marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ <b>Budget-constrained BAU.</b> The BAU capex budget (~{sigB(constrained.avail)} B {constrained.cur}/yr) is below the replacement need (~{sigB(constrained.repl)} B {constrained.cur}/yr), so no new safely-managed service is built and <b>unit cost has no effect</b> on this curve. Raise the {sectorLabel.toLowerCase()} budget above the replacement need to move it.
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
      {summary && (() => {
        const cur = summary.currency;
        const pct = (f: number) => (f * 100).toFixed(1) + '%';
        const money = (v: number | null) => v == null ? '—' : sigB(v) + ' B ' + cur;
        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #2563eb', borderRadius: 6, padding: '8px 12px', lineHeight: 1.55 }}>
              <b>Summary.</b> Under business-as-usual, {summary.rungLabel} {sectorLabel.toLowerCase()} reaches <b>{pct(summary.bauPop)}</b> of the population by {summary.endline}, against a target of <b>{pct(summary.tgtPop)}</b>{summary.gapEnd > 0.0005 ? <> — a shortfall of <b>{sig3(summary.gapEnd)} M households</b></> : null}.{summary.showMoney && <> The annual financing gap at {summary.endline} is <b>{money(summary.finGapEnd)}/yr</b>; meeting the target needs <b>{sigB(summary.cumNeed)} B {cur}</b> cumulatively ({summary.firstForecast}–{summary.endline}).</>}
              {summary.costSM != null && <> Weighted {summary.rungLabel} cost per household: <b>{sig3(summary.costSM)} {cur}</b>.</>}
            </div>
          </div>
        );
      })()}
      {targetPoints.length > 0 && (
        <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 6 }}>
          🎯 Target call-outs and the financing-gap box are drawn on the chart. Click a box's ✕ to close it, or click its marker to reopen; use 🎯 Targets to choose which targets show.
        </div>
      )}
      {/* Toolbar: Y-axis unit toggle + per-chart exports */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
          {([['count', '# Households'], ['share', '% of population']] as const).map(([m, l]) => (
            <button key={m} onClick={() => setUnitMode(m)} style={{
              padding: '4px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
              background: unitMode === m ? '#2563eb' : '#fff', color: unitMode === m ? '#fff' : '#475569',
              fontWeight: unitMode === m ? 700 : 500,
            }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setShowDots(d => !d)} style={{ ...toolBtn, fontWeight: 600, background: showDots ? '#eff6ff' : '#fff', color: showDots ? '#2563eb' : '#475569', borderColor: showDots ? '#93c5fd' : '#cbd5e1' }} title="Show or hide the per-year data-point dots">● Data points: {showDots ? 'on' : 'off'}</button>
        {/* Multi-select: which target years' call-outs are drawn (declutters when there are many targets). */}
        {targetPoints.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setTgtDropOpen(o => !o)} title="Choose which targets' call-outs are shown on the chart"
              style={{ ...toolBtn, fontWeight: 600, background: tgtDropOpen ? '#f0fdf4' : '#fff', borderColor: '#86efac', color: '#15803d' }}>
              🎯 Targets shown: {visibleTargets ? visibleTargets.size : targetPoints.length}/{targetPoints.length} ▾
            </button>
            {tgtDropOpen && (<>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setTgtDropOpen(false)} />
              <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '8px 10px', minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Show call-out for:</div>
                {targetPoints.map((p: any) => (
                  <label key={p.year} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 2px', cursor: 'pointer', color: '#334155' }}>
                    <input type="checkbox" checked={isTargetVisible(p.year)}
                      onChange={() => toggleTargetVisible(p.year, targetPoints.map((q: any) => q.year))}
                      style={{ accentColor: '#16a34a' }} />
                    🎯 Target {p.year}
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, borderTop: '1px solid #e2e8f0', paddingTop: 6 }}>
                  <button onClick={() => setVisibleTargets(null)} style={{ ...toolBtn, padding: '2px 10px', fontSize: 10 }}>All</button>
                  <button onClick={() => setVisibleTargets(new Set())} style={{ ...toolBtn, padding: '2px 10px', fontSize: 10 }}>None</button>
                </div>
              </div>
            </>)}
          </div>
        )}
        <ChartExport chartRef={chartRef} filename={fileBase} title={`${sectorLabel} — ${rungNameRaw}: BAU vs Target`}
          sheets={[{ name: 'Chart data', headers: chartHeaders, rows: chartRows }]} chartSpec={chartSpec} />
      </div>
      <div ref={chartRef} style={{ position: 'relative' }}>
        <ComposedChart width={Math.max(1, wrapW)} height={380} data={displayData} margin={{ top: 14, right: 70, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(displayData)} />
            <YAxis tick={{ fontSize: 10 }} domain={isShare ? [0, 1] : undefined}
              tickFormatter={isShare ? (v: number) => Math.round(v * 100) + '%' : (v: number) => sig3(v)}>
              <Label value={isShare ? '% of population' : '# households (millions)'} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
            </YAxis>
            <Tooltip formatter={(value: any) => fmtVal(value)}
              labelFormatter={(label: any) => (per0.baseline_year != null && label === per0.baseline_year) ? `${label} — last historical year` : String(label)}
              contentStyle={{ fontSize: 11 }} />
            {/* Legend lists the Total & Target lines first, then the BAU area fill (see chartLegend);
                render order below is unchanged so the lines still draw over the area. */}
            <Legend wrapperStyle={{ fontSize: 10 }} content={linesFirstLegend} />
            <Area type="monotone" dataKey={bauKey} fill={C.bauFill} stroke={C.bau} fillOpacity={0.55} dot={showDots ? { r: 1.8 } : false} legendType="rect" isAnimationActive={false}>
              <LabelList content={endpointLabel} />
            </Area>
            <Line type="monotone" dataKey="Total households" stroke={C.total} strokeWidth={2.5} dot={showDots ? { r: 1.8 } : false} legendType="plainline" strokeDasharray="8 4" isAnimationActive={false} />
            {/* Target trajectory: one solid line across all years */}
            <Line type="monotone" dataKey={tgtKey} stroke={C.target} strokeWidth={3} dot={showDots ? { r: 1.8 } : false} legendType="plainline" connectNulls={false} isAnimationActive={false}>
              <LabelList content={endpointLabel} />
            </Line>
            {/* Horizontal reference line at each target's safely-managed level */}
            {targetLines.map((t, i) => (
              <ReferenceLine key={i} y={isShare ? t.yShare : t.y} stroke={C.target} strokeDasharray="2 4" ifOverflow="extendDomain"
                label={{ value: t.label, position: 'right', fontSize: 9, fill: '#15803d' }} />
            ))}
          </ComposedChart>
        {/* Overlay svg above the chart: the financing-gap bracket + the 🎯 target call-outs. The svg
            itself ignores pointer events; only the call-out groups are clickable, so chart hover/tooltip
            still works everywhere else. */}
        {overlay && (endAnno || (flagPlan && targetPoints.length > 0)) && (
          <svg width={overlay.width} height={overlay.height}
            style={{ position: 'absolute', left: overlay.left, top: overlay.top, overflow: 'visible', pointerEvents: 'none', zIndex: 20 }}>
            {endAnno && endAnno.gapHH > 1e-4 && <GapAnnotation />}
            {flagPlan && targetPoints.filter((p: any) => isTargetVisible(p.year)).map((p: any) => (
              <g key={`tb-${p.year}`} style={{ pointerEvents: 'auto' }}>
                <TargetBubble cx={overlay.xm * p.year + overlay.xb} cy={overlay.ym * (isShareNow ? p.yShare : p.y) + overlay.yb}
                  point={p} box={flagPlan.bubbles[p.year]} />
              </g>
            ))}
          </svg>
        )}
      </div>

      {/* ── Per-year data table (forecast years) ─────────────────────────────────────────────── */}
      {tableRows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a5f' }}>Forecast data (per year)</div>
            <TableExport filename={fileBase} sheetName="Forecast" headers={tableHeaders} rows={tableExportRows} compact />
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, width: '100%' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', color: '#334155' }}>
                  {['Year', 'Total households (M)', `${rungNameRaw} — BAU (M)`, 'Target (M)', 'Service Gap (M if HH)', ...(showMoney ? [`Financing gap (B ${endAnno?.cur || 'LCU'}/yr)`] : [])].map((h, i) => (
                    <th key={i} style={{ padding: '5px 10px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 700, whiteSpace: 'nowrap', position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined, background: '#f1f5f9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r: any, ri: number) => (
                  <tr key={r.year} style={{ background: ri % 2 ? '#fafbfc' : '#fff' }}>
                    <td style={{ padding: '4px 10px', fontWeight: 600, color: '#1e3a5f', position: 'sticky', left: 0, background: ri % 2 ? '#fafbfc' : '#fff' }}>{r.year}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right' }}>{sig3(r.total)}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', color: C.bau }}>{sig3(r.bau)}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', color: '#15803d' }}>{sig3(r.tgt)}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', color: '#b45309', fontWeight: 600 }}>{sig3(r.gapHH)}</td>
                    {showMoney && <td style={{ padding: '4px 10px', textAlign: 'right', color: '#b91c1c' }}>{r.finGap == null ? 'n/a' : sigB(r.finGap)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
