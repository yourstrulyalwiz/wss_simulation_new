import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const colors = read('chartColors.ts');
const categories = read('contributionView.tsx').split('export function ContributionViewToggle')[0]
  .replace("import React from 'react';", '');
const attribution = read('sourceAttribution.ts')
  .replace("import { C, INTV_PALETTE as P } from './chartColors';", '');
const ledger = read('resultsLedger.ts')
  .replace("import { CONTRIBUTION_CATEGORIES } from './contributionView';", '')
  .replace("import { sourceDefinition } from './sourceAttribution';", '');
const js = ts.transpile(`${colors}\nconst P = INTV_PALETTE;\n${categories}\n${attribution}\n${ledger}`,
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
export const ledgerModule = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
