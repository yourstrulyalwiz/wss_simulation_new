/** Saved internal IDs are identities, not positions in the visible workflow. */
export const WORKSPACE_TABS = [
  { id: -1, step: 0, label: 'Setup' },
  { id: 0, step: 1, label: 'Data Inputs' },
  { id: 1, step: 2, label: 'BAU Scenario' },
  { id: 2, step: 3, label: 'Intervention Design' },
  { id: 3, step: 4, label: 'Loan funding' },
  { id: 4, step: 5, label: 'Results Dashboard' },
  { id: 6, step: 6, label: 'Post-Intervention Options' },
  { id: 5, step: 7, label: 'Slide Deck' },
] as const;

export const validWorkspaceTab = (id: unknown): id is number =>
  typeof id === 'number' && WORKSPACE_TABS.some(tab => tab.id === id);
