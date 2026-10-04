import React, { useState, useRef } from 'react';
import { ServiceGapChart, FinancingGapChart, CumulativeChart, WaterfallChart, COLORS } from './Charts';

interface Props {
  results: any;
  inputs: any;
  compareResults?: any;
  compareName?: string | null;
  activeStep: number;
  onExportCSV: () => void;
}

export default function ResultsPanel({ results, inputs, compareResults, compareName, activeStep, onExportCSV }: Props) {
  const [activeTab, setActiveTab] = useState<'water' | 'sanitation'>('water');
  const chartsRef = useRef<HTMLDivElement>(null);

  if (!results) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>WSS Scenarios Simulation Tool</p>
          <p style={{ fontSize: 13 }}>Loading model...</p>
        </div>
      </div>
    );
  }

  const period = inputs?.period || {};
  const cc = inputs?.country_config || {};
  const CUR = cc.currency || 'LCU';
  const baselineYear = period.baseline_year || 2025;
  const asIsStart = period.as_is_forecast_start || 2026;
  const target1Year = period.target1_year || 2030;
  const target2Year = period.target2_year || 2040;
  const modelStart = period.model_start_year || 2011;
  const forecastEnd = period.forecast_end_year || 2040;

  const serviceChartStart = baselineYear;
  const financingChartStart = asIsStart;

  const midpoint = Math.round((target1Year + target2Year) / 2);
  const summaryYears = [baselineYear, target1Year, midpoint, target2Year]
    .filter((y, i, arr) => arr.indexOf(y) === i && y >= modelStart && y <= forecastEnd);

  const years = results.years;
  const sector = activeTab === 'water' ? results.water_supply : results.sanitation;
  const interventions = sector.interventions;
  const sectorLabel = activeTab === 'water' ? 'Water Supply' : 'Sanitation';

  // Compare sector
  const cmpSector = compareResults
    ? (activeTab === 'water' ? compareResults.water_supply : compareResults.sanitation)
    : null;

  const interventionSeries = [
    { name: 'Collection & NRW', data: interventions.collection_nrw?.cumulative_hh || interventions.collection_efficiency?.cumulative_hh || [], color: COLORS.ce_nrw },
    { name: 'Budget execution', data: interventions.capital_efficiency.cumulative_hh, color: COLORS.capeff },
    { name: 'Tariff Increase', data: interventions.tariff.cumulative_hh, color: COLORS.tariff },
  ];
  if (activeTab === 'sanitation' && interventions.microfinance) {
    interventionSeries.push({ name: 'Microfinance', data: interventions.microfinance.cumulative_hh, color: COLORS.microfinance });
  }
  // Add custom interventions
  if (interventions.custom) {
    interventions.custom.forEach((ci: any) => {
      interventionSeries.push({ name: ci.name, data: ci.cumulative_hh, color: ci.color });
    });
  }

  const getYearIdx = (y: number) => years.indexOf(y);

  const showBAU = activeStep === 1 || activeStep === 3;
  const showInterventions = activeStep === 2 || activeStep === 3;
  const showOutputs = activeStep === 3;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }} ref={chartsRef}>
      {/* Sector tabs + Export buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['water', 'sanitation'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '7px 18px', border: 'none', borderRadius: 5, cursor: 'pointer',
            background: activeTab === tab ? '#2563eb' : '#e5e7eb',
            color: activeTab === tab ? '#fff' : '#374151', fontWeight: 600, fontSize: 12,
          }}>
            {tab === 'water' ? 'Water Supply' : 'Sanitation'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={onExportCSV} style={exportBtnStyle}>CSV</button>
          <button onClick={() => {
            fetch('/api/export/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs) })
              .then(r => r.blob()).then(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'wss_results.xlsx'; a.click(); });
          }} style={exportBtnStyle}>Excel</button>
          <button onClick={() => {
            fetch('/api/export/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs) })
              .then(r => r.blob()).then(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'wss_scenarios.pptx'; a.click(); });
          }} style={exportBtnStyle}>PowerPoint</button>
          <button onClick={() => {
            if (chartsRef.current) {
              const svgs = chartsRef.current.querySelectorAll('.recharts-wrapper svg');
              svgs.forEach((svg, i) => {
                const svgData = new XMLSerializer().serializeToString(svg);
                const blob = new Blob([svgData], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                a.download = `${sectorLabel.replace(' ', '_')}_chart_${i + 1}.svg`; a.click();
              });
            }
          }} style={exportBtnStyle}>Export Charts</button>
        </div>
      </div>

      {compareName && <div style={{ background: '#fef3c7', padding: '6px 12px', borderRadius: 4, fontSize: 11, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 12, height: 3, background: COLORS.compare, display: 'inline-block' }} />
        Comparing current scenario with: <strong>{compareName}</strong> (slate dashed line and bars)
      </div>}

      {/* Step guidance */}
      {activeStep === 0 && (
        <div style={{ color: '#64748b', padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Step 1: Data Inputs</p>
          <p style={{ fontSize: 12, maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
            Use the panel on the left to enter macroeconomic assumptions, population data, current service levels, unit costs, and BAU investment data.
            Hover over any ⓘ icon to see the field description and acceptable range.
            When done, click <strong>2. BAU & Targets</strong> above to see results.
          </p>
        </div>
      )}
      {activeStep === 1 && !showBAU && null}
      {activeStep === 1 && (
        <div style={{ background: '#f0f9ff', padding: '8px 14px', borderRadius: 6, fontSize: 11, color: '#0c4a6e', marginBottom: 12 }}>
          <strong>BAU & Targets:</strong> The charts show the gap between business-as-usual coverage and your targets. Adjust targets in Step 1 or proceed to Step 3 to add interventions.
        </div>
      )}
      {activeStep === 2 && (
        <div style={{ background: '#f0fdf4', padding: '8px 14px', borderRadius: 6, fontSize: 11, color: '#14532d', marginBottom: 12 }}>
          <strong>Interventions:</strong> Toggle interventions on/off using the checkboxes on the left. Adjust parameters with sliders. The stacked chart shows how each intervention contributes to closing the gap.
        </div>
      )}
      {activeStep === 3 && (
        <div style={{ background: '#fefce8', padding: '8px 14px', borderRadius: 6, fontSize: 11, color: '#713f12', marginBottom: 12 }}>
          <strong>Outputs:</strong> Full results dashboard. Use the export buttons above to download CSV, Excel, or PowerPoint. Save your scenario to compare later.
        </div>
      )}

      {/* Step 1: BAU & Targets */}
      {showBAU && (
        <>
          <ServiceGapChart years={years} targetHH={sector.target_hh_serv[0]} bauHH={sector.bau_hh_serv[0]}
            interventions={showInterventions ? interventionSeries : []}
            title={`${sectorLabel} — ${showInterventions ? 'Service Gap After Interventions' : 'BAU vs Target'}`}
            startYear={serviceChartStart}
            compareBauHH={cmpSector?.bau_hh_serv[0]} compareName={compareName || undefined} />

          <FinancingGapChart years={years} investmentNeed={sector.investment_need} bauInvestment={sector.bau_investment}
            intervInvestment={showInterventions ? sector.interv_total_inv : undefined}
            title={`${sectorLabel} — Annual Investment Need vs BAU${showInterventions ? ' + Interventions' : ''}`} startYear={financingChartStart}
            compareInvNeed={cmpSector?.investment_need} compareBauInv={cmpSector?.bau_investment}
            compareName={compareName || undefined} />
        </>
      )}

      {/* Step 2: Interventions */}
      {activeStep === 2 && (
        <ServiceGapChart years={years} targetHH={sector.target_hh_serv[0]} bauHH={sector.bau_hh_serv[0]}
          interventions={interventionSeries}
          title={`${sectorLabel} — Service Gap After Interventions`}
          startYear={serviceChartStart}
          compareBauHH={cmpSector?.bau_hh_serv[0]} compareName={compareName || undefined} />
      )}

      {/* Step 3: Full outputs */}
      {showOutputs && (
        <>
          <CumulativeChart years={years} cumulativeNeed={sector.cumulative_inv_need} cumulativeBau={sector.cumulative_bau_inv}
            title={`${sectorLabel} — Cumulative Investment`} startYear={financingChartStart} />

          {/* Waterfall: Intervention contribution to closing the gap */}
          {(() => {
            const t2Idx = getYearIdx(target2Year);
            const gapAtT2 = t2Idx >= 0 ? sector.service_gap[t2Idx] : 0;
            const waterfallInterventions = interventionSeries
              .map(s => ({ name: s.name, value: t2Idx >= 0 && s.data[t2Idx] ? s.data[t2Idx] : 0, color: s.color }))
              .filter(s => s.value > 0.0001);
            return gapAtT2 > 0 ? (
              <WaterfallChart serviceGap={gapAtT2} interventions={waterfallInterventions}
                title={`${sectorLabel} — Intervention Contribution to Closing the Gap`} targetYear={target2Year} />
            ) : null;
          })()}

          {/* Comparison Summary Table */}
          {cmpSector && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>Scenario Comparison — {sectorLabel}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={thStyle}>Metric</th>
                    {summaryYears.map(y => (
                      <th key={y} style={thStyle} colSpan={2}>{y}</th>
                    ))}
                  </tr>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ ...thStyle, borderBottom: '1px solid #e5e7eb' }}></th>
                    {summaryYears.map(y => (
                      <React.Fragment key={y}>
                        <th style={{ ...thStyle, fontSize: 10, borderBottom: '1px solid #e5e7eb', color: '#2563eb' }}>Current</th>
                        <th style={{ ...thStyle, fontSize: 10, borderBottom: '1px solid #e5e7eb', color: COLORS.compare }}>{compareName}</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Target Safely Managed HH', key: 'target_hh_serv', isArr: true, dec: 4, div: 1 },
                    { label: 'BAU Safely Managed HH', key: 'bau_hh_serv', isArr: true, dec: 4, div: 1 },
                    { label: 'Service Gap (mill HH)', key: 'service_gap', isArr: false, dec: 4, div: 1 },
                    { label: 'Investment Need ({CUR} bill)', key: 'investment_need', isArr: false, dec: 2, div: 1000 },
                    { label: 'BAU Investment ({CUR} bill)', key: 'bau_investment', isArr: false, dec: 2, div: 1000 },
                    { label: 'Financing Gap ({CUR} bill)', key: 'financing_gap', isArr: false, dec: 2, div: 1000 },
                  ].map(row => (
                    <tr key={row.label}>
                      <td style={tdStyle}>{row.label}</td>
                      {summaryYears.map(y => {
                        const idx = getYearIdx(y);
                        const cur = row.isArr ? sector[row.key][0] : sector[row.key];
                        const cmp = row.isArr ? cmpSector[row.key][0] : cmpSector[row.key];
                        const curVal = idx >= 0 ? (cur[idx] / row.div) : 0;
                        const cmpVal = idx >= 0 ? (cmp[idx] / row.div) : 0;
                        const diff = curVal - cmpVal;
                        return (
                          <React.Fragment key={y}>
                            <td style={tdNum}>{curVal.toFixed(row.dec)}</td>
                            <td style={{ ...tdNum, color: diff > 0.001 ? '#16a34a' : diff < -0.001 ? '#ef4444' : '#64748b' }}>
                              {cmpVal.toFixed(row.dec)}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary Table */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>Summary at Key Years</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={thStyle}>Metric</th>
                  {summaryYears.map(y => <th key={y} style={thStyle}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>Total HH (millions)</td>
                  {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(results.total_hh, getYearIdx(y), 3)}</td>)}
                </tr>
                <tr>
                  <td style={tdStyle}>Target Safely Managed HH</td>
                  {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(sector.target_hh_serv[0], getYearIdx(y), 4)}</td>)}
                </tr>
                <tr>
                  <td style={tdStyle}>BAU Safely Managed HH</td>
                  {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(sector.bau_hh_serv[0], getYearIdx(y), 4)}</td>)}
                </tr>
                <tr>
                  <td style={tdStyle}>Service Gap (mill HH)</td>
                  {summaryYears.map(y => <td key={y} style={{ ...tdNum, color: '#ef4444' }}>{fmtIdx(sector.service_gap, getYearIdx(y), 4)}</td>)}
                </tr>
                <tr>
                  <td style={tdStyle}>Investment Need ({CUR} bill)</td>
                  {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(sector.investment_need, getYearIdx(y), 2, 1000)}</td>)}
                </tr>
                <tr>
                  <td style={tdStyle}>BAU Investment ({CUR} bill)</td>
                  {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(sector.bau_investment, getYearIdx(y), 2, 1000)}</td>)}
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td style={tdStyle}>Financing Gap ({CUR} bill)</td>
                  {summaryYears.map(y => <td key={y} style={{ ...tdNum, color: '#ef4444' }}>{fmtIdx(sector.financing_gap, getYearIdx(y), 2, 1000)}</td>)}
                </tr>
                {sector.interv_total_inv && <tr>
                  <td style={tdStyle}>Intervention Cash ({CUR} bill)</td>
                  {summaryYears.map(y => <td key={y} style={{ ...tdNum, color: '#16a34a' }}>{fmtIdx(sector.interv_total_inv, getYearIdx(y), 2, 1000)}</td>)}
                </tr>}
                {sector.adjusted_financing_gap && <tr style={{ fontWeight: 700 }}>
                  <td style={tdStyle}>Adjusted Gap ({CUR} bill)</td>
                  {summaryYears.map(y => {
                    const val = getYearIdx(y) >= 0 ? sector.adjusted_financing_gap[getYearIdx(y)] / 1000 : 0;
                    return <td key={y} style={{ ...tdNum, color: val > 0.01 ? '#ef4444' : '#16a34a' }}>{val.toFixed(2)}</td>;
                  })}
                </tr>}
              </tbody>
            </table>
          </div>

          {/* Intervention breakdown table */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>Intervention Impact (Cumulative Additional HH, millions)</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={thStyle}>Intervention</th>
                  {summaryYears.map(y => <th key={y} style={thStyle}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                {interventionSeries.map(s => (
                  <tr key={s.name}>
                    <td style={{ ...tdStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                      {s.name}
                    </td>
                    {summaryYears.map(y => <td key={y} style={tdNum}>{fmtIdx(s.data, getYearIdx(y), 4)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function fmtIdx(arr: number[], idx: number, decimals: number, divisor: number = 1): string {
  if (idx < 0 || !arr || idx >= arr.length) return '-';
  return (arr[idx] / divisor).toFixed(decimals);
}

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', fontSize: 12 };
const tdStyle: React.CSSProperties = { padding: '6px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 12 };
const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' };
const exportBtnStyle: React.CSSProperties = {
  padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 4,
  background: '#fff', cursor: 'pointer', fontSize: 11, color: '#374151',
};
