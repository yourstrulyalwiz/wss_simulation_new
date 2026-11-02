import React, { useEffect, useState } from 'react';
import { WATER_INTERVENTIONS, SANITATION_INTERVENTIONS, interventionEnabled } from '../interventionRegistry';
import './InterventionCategories.css';

// Presentation only. These labels must never define model, chart or export execution order.
const categories = [
  { id: 'funding', title: '1. Funding Mobilization',
    description: 'Mobilize funding through coverage-expansion revenue, spending commitments and additional funds.',
    labels: ['Increase in Public Spending', 'External Funding (Private Sector, Donor, Foreign Direct Investment)', 'Revenue from new connections'] },
  { id: 'operations', title: '2. Operational Efficiency Improvements',
    description: 'Improve revenue collection and reduce operational losses.',
    labels: ['Collection efficiency', 'NRW reduction', 'NRW-linked sanitation revenue'] },
  { id: 'investment', title: '3. Investment Planning and Delivery Improvements',
    description: 'Improve budget execution and the cost of delivering services.',
    labels: ['Budget execution improvement', 'Capex efficiency (unit cost)', 'Optimised technology selection'] },
  { id: 'tariff', title: '4. Tariff Reform',
    description: 'Adjust tariffs to increase collected revenue.',
    labels: ['Tariff reform'] },
  { id: 'household', title: '5. Household Financing and Affordability',
    description: 'Help households finance access to services.',
    labels: ['Microfinance'] },
];

export type InterventionReveal = { label: string };

// The same presentation groups and registry entries drive both rails. Chart/export
// execution order remains independent of the presentation order above.
export function interventionGroups(sector: 'water' | 'sanitation') {
  const registry = sector === 'water' ? WATER_INTERVENTIONS : SANITATION_INTERVENTIONS;
  return categories.map(category => ({
    ...category,
    interventions: category.labels.flatMap(label => {
      const definition = registry.find(item => (item.controlLabel || item.label) === label);
      return definition ? [{ ...definition, label }] : [];
    }),
  }));
}

export function InterventionNavigation({ sector, inputs, waterAvailable, selected, onSelect }: {
  sector: 'water' | 'sanitation'; inputs: any; waterAvailable: boolean; selected: string | null;
  onSelect: (label: string, trigger: HTMLButtonElement) => void;
}) {
  return <div className="intervention-nav-groups" aria-label={`${sector === 'water' ? 'Water supply' : 'Sanitation'} interventions`}>
    {interventionGroups(sector).map(group => <section key={group.id} className="intervention-nav-group"
      aria-labelledby={`nav-${sector}-${group.id}`}>
      <h4 id={`nav-${sector}-${group.id}`}>{group.title}</h4>
      <ul>{group.interventions.map(item => {
        const unavailable = item.key === 'san_nrw_link_enabled' && !waterAvailable;
        const active = !unavailable && interventionEnabled(inputs, item.key);
        const status = unavailable ? 'Unavailable without Water supply' : active ? 'Active' : 'Inactive';
        return <li key={item.key}><button type="button" className="intervention-nav-link"
          data-intervention-key={item.key} aria-label={`${item.label} — ${status}`}
          aria-expanded={selected === item.label} aria-controls="intervention-input-drawer"
          onClick={event => onSelect(item.label, event.currentTarget)}>
          <span>{item.label}</span>
          <span className="intervention-nav-status" data-active={active} aria-hidden="true" />
        </button></li>;
      })}</ul>
    </section>)}
  </div>;
}

function InterventionCategory({ id, title, description, children, reveal }: {
  id: string; title: string; description: string; children: React.ReactNode; reveal?: InterventionReveal | null;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  return (
    <section className="intervention-category" aria-labelledby={`${id}-header`}>
      <h4>
        <button type="button" id={`${id}-header`} className="intervention-category-header"
          aria-expanded={open} aria-controls={`${id}-content`} onClick={() => setOpen(v => !v)}>
          <span>{title}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      </h4>
      {/* Native hidden keeps child state mounted while removing all descendants from tab order. */}
      <div id={`${id}-content`} className="intervention-category-content" hidden={!open}>
        <p className="intervention-category-description">{description}</p>
        {children}
      </div>
    </section>
  );
}

function ComingSoonIntervention({ kind }: { kind: 'energy' | 'subsidies' }) {
  return (
    <div className="coming-soon-intervention">
      <div className="coming-soon-intervention-heading">
        <span>{kind === 'energy' ? 'Energy improvements' : 'Subsidies'}</span>
        <span className="coming-soon-badge">Coming soon</span>
      </div>
      <p>{kind === 'energy'
        ? 'Energy efficiency measures will be available in a future update.'
        : 'Additional subsidy options will be available in a future update.'}</p>
      {kind === 'subsidies' && <p>Means-based grants within Microfinance remain available.</p>}
    </div>
  );
}

export default function InterventionCategories({ sector, children, reveal, settingsOnly = false }: {
  sector: 'water' | 'sanitation'; children: React.ReactNode; reveal?: InterventionReveal | null; settingsOnly?: boolean;
}) {
  // Reuse the original controls unchanged, including every field, setter and guide identifier.
  const controls = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<{ label: string }> => React.isValidElement<{ label: string }>(child)
  );
  // Portal sources stay mounted, without category headings, rows or focus targets.
  if (settingsOnly) return <>{interventionGroups(sector).flatMap(category =>
    category.interventions.map(({ label }) => controls.find(control => control.props.label === label)))}</>;
  return <>{interventionGroups(sector).map(category => (
    <InterventionCategory key={`${sector}-${category.id}`} id={`${sector}-${category.id}`}
      title={category.title} description={category.description}
      reveal={reveal && category.labels.includes(reveal.label) ? reveal : null}>
      {category.interventions.map(({ label }) => controls.find(control => control.props.label === label))}
      {category.id === 'operations' && <ComingSoonIntervention kind="energy" />}
      {category.id === 'household' && <ComingSoonIntervention kind="subsidies" />}
    </InterventionCategory>
  ))}</>;
}