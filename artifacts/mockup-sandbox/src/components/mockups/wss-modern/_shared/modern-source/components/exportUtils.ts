// Shared download / capture helpers for the per-table and per-chart export buttons.
import { currencyRateNote, priceBasisNote, type CurrencyDisplaySettings } from '../currencyDisplay';

export function downloadBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename; a.click();
  URL.revokeObjectURL(u);
}

export async function postForBlob(endpoint: string, body: any, filename: string) {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const payload = await r.json().catch(() => ({}));
    throw new Error(payload.detail || payload.error || 'Export failed (' + r.status + ').');
  }
  downloadBlob(await r.blob(), filename);
}

// Client-side CSV (with a BOM so Excel reads UTF-8 correctly).
function currencyMetadataRows(settings?: CurrencyDisplaySettings) {
  if (!settings) return [];
  const source = settings.sourceCurrency || 'LCU';
  const display = settings.mode === 'usd' ? 'USD' : source;
  const rateNote = settings.mode === 'usd'
    ? currencyRateNote(settings, source)
    : `Local-currency results; no conversion applied.${settings.localPerUsd ? ` Configured reference rate ${settings.localPerUsd} ${source} per US$1 is not applied.` : ''}`;
  const convertedUsd = settings.mode === 'usd' && source.toUpperCase() !== 'USD';
  return [
    ['Selected display currency', display],
    ['Source currency', source],
    ['Rate direction', convertedUsd ? 'Local currency units per US$1' : 'Not applied'],
    ['Rate', settings.localPerUsd ?? ''],
    ['Rate reference year', settings.rateReferenceYear ?? ''],
    ['Rate source / note', settings.sourceNote || ''],
    ['Rate note', rateNote],
    ['Price-basis note', priceBasisNote(settings, source)],
    ['Conversion', convertedUsd ? 'USD = local amount ÷ localPerUsd; model inputs and calculations remain in source currency.' : 'No currency conversion applied; model inputs and calculations remain in source currency.'],
  ];
}

export function csvDownload(headers: any[], rows: any[][], filename: string, currencyDisplay?: CurrencyDisplaySettings) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const metadata = currencyMetadataRows(currencyDisplay).flatMap(([key, value]) => [[esc(key), esc(value)].join(',')]);
  const lines = [...metadata, ...(metadata.length ? [''] : []), headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

// ── chart capture ────────────────────────────────────────────────────────────────────────────────
// Rasterise a recharts chart to a PNG/JPEG data URL WITHOUT html-to-image (which stalls cloning the DOM
// in some renderers). We serialise the chart's own <svg> surfaces (plot + any annotation overlay) straight
// to canvas, then draw the legend from its DOM — deterministic and fast. Same-origin only, so no taint.

const FONT = "13px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function svgToImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  (clone.style as any).fontFamily = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const s = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('svg decode failed'));
    img.src = url;
  });
}

type LegendItem = { color: string; text: string; line: boolean };
function readLegend(node: HTMLElement): LegendItem[] {
  const wrap = node.querySelector('.recharts-legend-wrapper');
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll('li')).map(li => {
    const lineEl = li.querySelector('svg line') as SVGLineElement | null;
    const sw = li.querySelector('span[style*="background"]') as HTMLElement | null;
    const text = (li.querySelector('span:last-child')?.textContent || li.textContent || '').trim();
    return { color: lineEl ? (lineEl.getAttribute('stroke') || '#000') : (sw ? sw.style.background : '#000'), text, line: !!lineEl };
  });
}

export async function captureImage(node: HTMLElement, fmt: 'png' | 'jpeg'): Promise<string> {
  const scale = 2;
  const svgs = Array.from(node.querySelectorAll('svg')) as SVGSVGElement[];
  // The plot surface(s): recharts' main <svg class="recharts-surface"> plus any large annotation overlay
  // (e.g. the BAU financing-gap bracket). Skip the tiny legend icon <svg>s.
  const big = svgs.map(s => ({ s, r: s.getBoundingClientRect() })).filter(x => x.r.width > 60 && x.r.height > 60);
  if (!big.length) throw new Error('no chart to capture');
  const base = big.find(x => x.s.classList.contains('recharts-surface')) || big[0];
  const baseR = base.r;
  const legend = readLegend(node);
  const legendH = legend.length ? 26 : 0;

  const W = Math.ceil(baseR.width), H = Math.ceil(baseR.height) + legendH;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // draw each surface at its offset relative to the base surface (overlay lands on top, in place)
  for (const { s, r } of big) {
    const img = await svgToImage(s, r.width, r.height);
    ctx.drawImage(img, Math.round(r.left - baseR.left), Math.round(r.top - baseR.top), r.width, r.height);
  }

  // draw the legend as a centred row of swatch + label below the plot
  if (legend.length) {
    ctx.font = FONT; ctx.textBaseline = 'middle';
    const gap = 18, sw = 12;
    const widths = legend.map(it => sw + 6 + ctx.measureText(it.text).width);
    const total = widths.reduce((a, w) => a + w, 0) + gap * (legend.length - 1);
    let x = Math.max(6, (W - total) / 2);
    const y = H - legendH / 2;
    legend.forEach((it, i) => {
      ctx.fillStyle = it.color; ctx.strokeStyle = it.color;
      if (it.line) { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sw, y); ctx.stroke(); }
      else { ctx.fillRect(x, y - sw / 2, sw, sw); }
      ctx.fillStyle = '#334155';
      ctx.fillText(it.text, x + sw + 6, y);
      x += widths[i] + gap;
    });
  }
  return fmt === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.95);
}
