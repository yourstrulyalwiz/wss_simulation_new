type AreaMode = {
  area: string;
  requested: boolean;
  effective: 'connection-based' | 'exogenous' | 'unknown';
  errors: string[];
};

export function aggregateWeightedRevenueRate(
  values: { rate: number | null; volume: number | null; tariff: number | null }[],
  weight: 'volume' | 'tariff-volume',
) {
  if (!values.length || values.some(value =>
    value.rate == null || value.volume == null || (weight === 'tariff-volume' && value.tariff == null))) return null;
  const weightOf = (value: typeof values[number]) =>
    Number(value.volume) * (weight === 'tariff-volume' ? Number(value.tariff) : 1);
  const denominator = values.reduce((sum, value) => sum + weightOf(value), 0);
  return denominator > 0
    ? values.reduce((sum, value) => sum + Number(value.rate) * weightOf(value), 0) / denominator
    : null;
}

function effectiveMode(value: any, requested: boolean): AreaMode['effective'] {
  const mode = String(value ?? '').toLowerCase().replace(/[_ ]/g, '-');
  if (value === true || mode.includes('connection') || mode === 'dynamic') return 'connection-based';
  if (value === false || mode.includes('exogenous')) return 'exogenous';
  return requested ? 'unknown' : 'exogenous';
}

export function connectionRevenueAreaModes(results: any[], inputs: any[], resultSector: string, sector: 'water' | 'sanitation'): AreaMode[] {
  return results.map((result, index) => {
    const metadata = result?.[resultSector]?.connection_revenue;
    const config = inputs[index]?.connection_revenue?.[sector];
    const requested = metadata?.requested ?? !!config?.enabled;
    const effective = effectiveMode(metadata?.effective, requested);
    const area = inputs[index]?.country_config?.area ||
      (inputs.length > 1 ? (index === 0 ? 'Urban' : index === 1 ? 'Rural' : `Area ${index + 1}`)
        : inputs[index]?.country_config?.country || 'Selected area');
    return { area, requested, effective, errors: Array.isArray(metadata?.errors) ? metadata.errors : [] };
  });
}

export function summarizeConnectionRevenueModes(areaConfigurations: AreaMode[]) {
  const effectiveModes = [...new Set(areaConfigurations.map(area => area.effective).filter(mode => mode !== 'unknown'))];
  const mixed = effectiveModes.length > 1;
  const hasUnknown = areaConfigurations.some(area => area.effective === 'unknown');
  const label = mixed ? 'Mixed across areas'
    : hasUnknown ? 'Effective mode not reported for every area'
      : effectiveModes[0] || 'Exogenous';
  return {
    area_configurations: areaConfigurations,
    mixed,
    requested: areaConfigurations.some(area => area.requested),
    effective: mixed ? 'mixed' : hasUnknown ? 'partially-reported' : (effectiveModes[0] || 'exogenous'),
    errors: areaConfigurations.flatMap(area => area.errors.map(error => `${area.area}: ${error}`)),
    label,
  };
}

export function connectionRevenueModeText(areaConfigurations: AreaMode[]) {
  const summary = summarizeConnectionRevenueModes(areaConfigurations);
  const perArea = areaConfigurations.map(area => ({
    area: area.area,
    label: area.effective === 'unknown'
      ? area.requested ? 'connection-based requested; effective not reported' : 'exogenous'
      : area.effective,
  }));
  return {
    ...summary,
    text: `Effective revenue mode: ${summary.label}${perArea.length > 1 || summary.mixed
      ? ` · Per area: ${perArea.map(area => `${area.area}: ${area.label}`).join(' · ')}` : ''}`,
  };
}
