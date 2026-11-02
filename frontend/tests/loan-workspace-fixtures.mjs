import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Fresh engine calculations, in memory only; never accesses a database or saved project. */
export function engineLoanFixtures() {
  const python = spawnSync('python', ['-c', `
import copy,json
from test_debt_servicing import DebtServicingTests
from demo_adapter import coerce_to_engine
from model.engine import calculate
x,_=DebtServicingTests().scenario(connection=True)
for sector in ('water','sanitation'):
 x['utility_debt'][sector].update(schema_version=3,mode='indicative_lump_sum',
  annual_real_interest_rate=.05,loan_term_years=16,revenue_sources=['collection','tariff'])
areas={}
for area in ('urban','rural'):
 data=copy.deepcopy(x)
 if area=='rural':
  data['water_interventions']['basic_share']=.52
  data['sanitation_interventions']['basic_share']=.52
  for s in ('water','sanitation'): data['utility_debt'][s]['allocation_share']=.3
 off=copy.deepcopy(data)
 for s in ('water','sanitation'): off['utility_debt'][s]['enabled']=False
 areas[area]={'inputs':data,'enabled':calculate(coerce_to_engine(data)),
  'disabled':calculate(coerce_to_engine(off))}
print(json.dumps(areas,allow_nan=False))
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (python.status !== 0) throw new Error(python.stderr);
  return JSON.parse(python.stdout);
}
