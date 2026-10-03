import React from 'react';

export default function ScenarioCompatibilityNotice({ notes, onReviewed }: {
  notes: string[]; onReviewed: () => void;
}) {
  if (!notes.length) return null;
  return <section aria-label="Saved scenario assumptions requiring review" role="status"
    style={{ margin: '0 0 12px', padding: '10px 12px', background: '#fffbeb', border: '1px solid #f3cd76', borderRadius: 6, color: '#78350f', fontSize: 11, lineHeight: 1.5 }}>
    <strong>Saved scenario assumptions to review</strong>
    <p style={{ margin: '4px 0' }}>Your saved inputs are retained. Legacy financing defaults to reinvest-all/no-new-borrowing unless the saved format already explicitly supports the current loan assumptions. Review these notes before comparing results or enabling borrowing.</p>
    <details><summary style={{ cursor: 'pointer' }}>{notes.length} assumption notes for the current area</summary>
      <ul style={{ margin: '6px 0' }}>{notes.map(note => <li key={note}>{note}</li>)}</ul>
    </details>
    <button type="button" onClick={onReviewed} style={{ marginTop: 6, cursor: 'pointer', padding: '4px 8px', background: '#fff', border: '1px solid #d3b876', borderRadius: 4, color: '#78350f', fontSize: 11 }}>I have reviewed these assumptions</button>
  </section>;
}