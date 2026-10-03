"""Non-mutating migration of saved frontend scenarios; shared by API and exports."""
import copy

SCHEMA_VERSION = 2
BORROWING_DEFAULTS = {
    'cash_allocation_alpha': 0, 'borrow_drawdown_year': 2028, 'borrow_interest_rate': .08,
    'borrow_term_years': 10, 'borrow_min_dscr': 1.2, 'borrow_ceiling': 0,
    'existing_debt_service': 0, 'borrow_entity_name': '',
    'borrow_cash_streams': ['collection', 'nrw', 'tariff', 'custom', 'nrw_link'],
    'borrow_rate_basis': 'real', 'baseline_obligations_known': False,
    'borrow_contract_principal': 0,
}
LEGACY_METHOD_NOTE = (
    'Saved targets do not identify asset ages, retirements or paying customers. Current calculations '
    'use gross connection/upgrade transitions and an approximate prior-year asset-value replacement allowance.')


def migrate_input_compatibility(inputs):
    if not inputs or ('water_interventions' not in inputs and
                      'serv1_ts' not in (inputs.get('water_service') or {})):
        return inputs  # Keep the separate engine-shaped API contract intact.
    migrated = copy.deepcopy(inputs)
    migrated.setdefault('legacy_financing_settings', {})
    try:
        old_version = int(inputs.get('reporting_schema_version', 0) or 0)
    except (TypeError, ValueError):
        old_version = 0
    notes = list(migrated.get('migration_notes') or [])
    toggles = dict(migrated.get('toggles') or {})
    migrated['toggles'] = toggles
    if old_version < SCHEMA_VERSION and LEGACY_METHOD_NOTE not in notes:
        notes.append(LEGACY_METHOD_NOTE)
    for prefix, section, label in (
        ('ws', 'water_interventions', 'Water Supply'),
        ('san', 'sanitation_interventions', 'Sanitation'),
    ):
        settings = dict(migrated.get(section) or {})
        migrated[section] = settings
        legacy_finance = (old_version < SCHEMA_VERSION and not all(
            key in settings for key in ('borrow_rate_basis', 'borrow_contract_principal')))
        if legacy_finance:
            migrated.setdefault('legacy_financing_settings', {})[section] = {
                'cash_allocation_alpha': settings.get('cash_allocation_alpha'),
                'borrowing_enabled': toggles.get(f'{prefix}_borrowing_enabled'),
            }
            settings['cash_allocation_alpha'] = 0
            toggles[f'{prefix}_borrowing_enabled'] = False
            notes.append(f'{label}: legacy financing defaults to reinvest-all/no-new-borrowing. '
                         'Previous allocation/enable settings are retained for review, not activated.')
            if 'borrow_rate_basis' not in settings:
                notes.append(f'{label}: interest basis was not recorded; the saved rate retains its '
                             'legacy real-rate interpretation. Verify whether nominal was intended.')
            if 'baseline_obligations_known' not in settings:
                notes.append(f'{label}: baseline financial coverage is unknown; any borrowing capacity '
                             'is a conditional incremental estimate, not a creditworthiness assessment.')
        toggles.setdefault(f'{prefix}_borrowing_enabled', False)
        injection = f'{prefix}_exogenous_injection_enabled'
        if injection not in toggles:
            toggles[injection] = bool(toggles.get(f'{prefix}_financial_commitment_enabled') and
                                      settings.get('fin_injection_enabled'))
            if old_version < SCHEMA_VERSION and settings.get('fin_injection_enabled'):
                notes.append(f'{label}: the legacy nested injection follows its former commitment '
                             'switch. Review the now-independent public capital injection control.')
        for key, value in BORROWING_DEFAULTS.items():
            settings.setdefault(key, copy.deepcopy(value))
    migrated['reporting_schema_version'] = max(SCHEMA_VERSION, old_version)
    migrated['migration_notes'] = list(dict.fromkeys(notes))
    return migrated