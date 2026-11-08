import React, { createContext, useContext, useEffect, useId, useState } from 'react';
import { simulationHeaders } from './simulationTransport';
import { calculationPayload } from './api';
import { withSpendingDrafts } from './publicSpendingSchedule';
import { nrwAllocationIssues } from './nrwAllocationValidation';

export type InterventionIssue = {
  area: string; sector: string; intervention: string; field: string; label: string;
  severity: 'error' | 'warning'; code: string; message: string;
};
export class InterventionValidationError extends Error {
  issues: InterventionIssue[];
  constructor(issues: InterventionIssue[]) { super(''); this.issues = issues; }
}
export async function validateInterventions(inputs: any, signal?: AbortSignal): Promise<InterventionIssue[]> {
  const local = nrwAllocationIssues(inputs);
  if (local.some(issue => issue.severity === 'error')) return local;
  const response = await fetch('/api/intervention-validation', {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: simulationHeaders(inputs), body: JSON.stringify(calculationPayload(withSpendingDrafts(inputs))), signal,
  });
  if (!response.ok) throw new Error('Intervention validation is unavailable. Please retry.');
  const remote: InterventionIssue[] = (await response.json()).issues;
  return [...remote.filter(issue => !local.some(item => item.field === issue.field)), ...local];
}
export async function guardInterventionExport(areas?: Record<string, any>) {
  if (!areas) throw new Error('Current simulation inputs are required for export.');
  for (const [area, inputs] of Object.entries(areas)) {
    const issues = await validateInterventions(inputs);
    if (issues.some(issue => issue.severity === 'error')) {
      window.dispatchEvent(new CustomEvent('intervention-validation-navigation', {detail: {area, issues}}));
      return false;
    }
  }
  return true;
}
export const ValidationContext = createContext<{ issues: InterventionIssue[]; sector: string; onNavigate?: () => void }>({ issues: [], sector: 'water' });
export const FieldIssuesContext = createContext<InterventionIssue[]>([]);
export function useInterventionIssues(inputs: any) {
  const key = JSON.stringify(inputs);
  const [state, setState] = useState<{key: string; issues: InterventionIssue[]}>({key: '', issues: []});
  useEffect(() => {
    const controller = new AbortController();
    validateInterventions(inputs, controller.signal).then(issues => {
      if (!controller.signal.aborted) setState({key, issues});
    }).catch(() => { /* Calculations and exports independently fail closed. */ });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.issues : nrwAllocationIssues(inputs);
}
export function IssueMessages({ issues }: {issues: InterventionIssue[]}) {
  const { onNavigate } = useContext(ValidationContext);
  const id = useId();
  return <>{issues.map((issue, i) => <div key={`${issue.field}:${issue.code}`} id={`${id}-${i}`}
    style={{ gridColumn: '1 / -1', fontSize: 11, color: issue.severity === 'error' ? '#b91c1c' : '#92400e' }}>
    {issue.message}
    {(issue.field.startsWith('revenue_bases.') || issue.field.startsWith('bau.') || issue.field.includes('nrw_treatment_cost_pct_capex')) &&
      <button type="button" onClick={onNavigate} style={{marginLeft: 6}}>Open Data Inputs</button>}
  </div>)}</>;
}
export const interventionGroup: Record<string, string> = {
  'Increase in Public Spending': 'financial_commitment',
  'External Funding (Private Sector, Donor, Foreign Direct Investment)': 'exogenous_injection',
  'Collection efficiency': 'collection_efficiency', 'NRW reduction': 'nrw',
  'Budget execution improvement': 'capital_efficiency', 'Budget execution': 'capital_efficiency',
  'Capex efficiency (unit cost)': 'costeff', 'Optimised technology selection': 'techmix',
};
export function groupForLabel(label: string) {
  if (interventionGroup[label]) return interventionGroup[label];
  if (/microfinance/i.test(label)) return 'microfinance';
  if (/tariff/i.test(label)) return 'tariff';
  if (/NRW/i.test(label)) return 'nrw_link';
  if (/execution/i.test(label)) return 'capital_efficiency';
  return label;
}
