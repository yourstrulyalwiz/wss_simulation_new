"""Delivered billing stocks, in million HH; independent of affordability cohorts."""
class BillingCohorts:
    def __init__(self, sm, basic, sm_share, basic_share, new_sm_share, new_basic_share):
        self.sm, self.basic = float(sm), float(basic)
        self.billed_sm, self.billed_basic = sm * sm_share, basic * basic_share
        self.new_sm_share, self.new_basic_share = new_sm_share, new_basic_share
        self.nrw_billed = 0.0

    def _align(self, sm, basic):
        """Attrition reduces billed stock proportionally; population is not a revenue multiplier."""
        if self.sm > 0 and sm < self.sm:
            factor = max(0.0, sm) / self.sm
            self.billed_sm *= factor
            self.nrw_billed *= factor
        if self.basic > 0 and basic < self.basic:
            self.billed_basic *= max(0.0, basic) / self.basic
        self.sm, self.basic = max(0.0, sm), max(0.0, basic)
        self.billed_sm = min(self.billed_sm, self.sm)
        self.billed_basic = min(self.billed_basic, self.basic)

    def close(self, entries, nrw_upgrades, other_upgrades, sm, basic):
        """NRW then ordinary/affordability upgrades share only the opening Basic pool."""
        upgrades = max(0.0, nrw_upgrades) + max(0.0, other_upgrades)
        if upgrades > self.basic + 1e-9:
            raise ValueError('Billing upgrades exceed the eligible opening Basic pool.')
        share = self.billed_basic / self.basic if self.basic > 0 else 0.0
        removed = upgrades * share
        added = upgrades * self.new_sm_share
        entered = max(0.0, entries) * self.new_basic_share
        self.nrw_billed += max(0.0, nrw_upgrades * (self.new_sm_share - share))
        self.billed_basic += entered - removed
        self.billed_sm += added
        self.basic += max(0.0, entries) - upgrades
        self.sm += upgrades
        self._align(sm, basic)
        return {
            'connection_billed_basic_entry_households': entered * 1e6,
            'connection_billed_basic_transfer_households': removed * 1e6,
            'connection_billed_sm_transfer_households': added * 1e6,
        }

    def diagnostics(self):
        return {'connection_billed_basic_households': self.billed_basic * 1e6,
                'connection_billed_sm_households': self.billed_sm * 1e6,
                'nrw_tagged_billed_households': self.nrw_billed * 1e6}
