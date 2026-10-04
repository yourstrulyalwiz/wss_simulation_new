import React, { useState } from 'react';
import './InterventionCategories.css';

// Presentation only. These labels must never define model, chart or export execution order.
const categories = [
  { id: 'funding', title: '1. Funding Mobilization',
    description: 'Increase sector funding through spending commitments and additional funds.',
    labels: ['Increase in Financial Commitments', 'Exogenous Injection of Funds'] },
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

function InterventionCategory({ id, title, description, children }: {
  id: string; title: string; description: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
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

export default function InterventionCategories({ sector, children }: {
  sector: 'water' | 'sanitation'; children: React.ReactNode;
}) {
  // Reuse the original controls unchanged, including every field, setter and guide identifier.
  const controls = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<{ label: string }> => React.isValidElement<{ label: string }>(child)
  );
  return <>{categories.map(category => (
    <InterventionCategory key={`${sector}-${category.id}`} id={`${sector}-${category.id}`}
      title={category.title} description={category.description}>
      {category.labels.map(label => controls.find(control => control.props.label === label))}
      {category.id === 'operations' && <ComingSoonIntervention kind="energy" />}
      {category.id === 'household' && <ComingSoonIntervention kind="subsidies" />}
    </InterventionCategory>
  ))}</>;
}