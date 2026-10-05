// Results can exclude borrowing without changing the user's saved loan settings.
export function resultsInputs(inputs: any, includeDebt: boolean) {
  if (!inputs || includeDebt) return inputs;
  return {
    ...inputs,
    utility_debt: {
      ...(inputs.utility_debt || {}),
      water: { ...(inputs.utility_debt?.water || {}), enabled: false },
      sanitation: { ...(inputs.utility_debt?.sanitation || {}), enabled: false },
    },
  };
}
