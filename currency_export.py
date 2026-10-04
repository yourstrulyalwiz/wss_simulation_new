"""Validate display-currency metadata at export boundaries.

These helpers are presentation-only. Callers must calculate with the original inputs and apply
``factor`` only to explicitly identified result fields after calculation.
"""

from datetime import date
import math


def validate_currency_display(options, source_currencies):
    options = options if isinstance(options, dict) else {}
    currencies = [str(value or 'LCU').strip().upper() for value in source_currencies]
    if not currencies:
        currencies = [str(options.get('sourceCurrency') or 'LCU').strip().upper()]
    common = set(currencies)
    mode = options.get('mode', 'local')
    if mode not in ('local', 'usd'):
        raise ValueError('Display currency must be local or USD.')
    if mode == 'local':
        raw_rate = options.get('localPerUsd')
        try:
            rate = float(raw_rate)
            if not math.isfinite(rate) or rate <= 0:
                rate = None
        except (TypeError, ValueError):
            rate = None
        raw_year = options.get('rateReferenceYear')
        year = None
        if (not isinstance(raw_year, bool) and isinstance(raw_year, (int, float))
                and math.isfinite(float(raw_year)) and int(raw_year) == raw_year
                and 1900 <= int(raw_year) <= date.today().year):
            year = int(raw_year)
        source_note = str(options.get('sourceNote') or '').strip()
        configured = f' Configured rate: US$1 = {rate:g} {currencies[0]}' if rate else ''
        if year:
            configured += f' ({year} reference year; not applied).'
        elif configured:
            configured += ' (not applied).'
        return {
            'mode': 'local', 'source_currency': currencies[0], 'display_currency': currencies[0],
            'factor': 1.0, 'rate': rate, 'reference_year': year,
            'source_note': source_note,
            'rate_note': 'Local-currency results; no conversion applied.' + configured,
            'price_basis_note': 'Model constant-price basis.',
        }
    if len(common) != 1:
        raise ValueError('USD export requires all areas to use the same source currency.')
    source = next(iter(common))
    expected = str(options.get('sourceCurrency') or '').strip().upper()
    if expected and expected != source:
        raise ValueError(f'The USD rate is configured for {expected}, but this export contains {source}. Reconfigure the rate for the current model currency.')
    if source == 'USD':
        return {
            'mode': 'usd', 'source_currency': 'USD', 'display_currency': 'USD',
            'factor': 1.0, 'rate': 1.0, 'reference_year': None,
            'source_note': str(options.get('sourceNote') or '').strip(),
            'rate_note': 'Model currency is already USD; monetary values are unchanged.',
            'price_basis_note': 'Model constant-price basis; no annual exchange-rate forecast applied.',
        }
    raw_rate = options.get('localPerUsd')
    if isinstance(raw_rate, bool):
        raise ValueError('Exchange rate must be a finite positive number.')
    try:
        rate = float(raw_rate)
    except (TypeError, ValueError):
        raise ValueError('Enter a valid exchange rate before exporting in USD.')
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError('Exchange rate must be finite and greater than zero.')
    raw_year = options.get('rateReferenceYear')
    if isinstance(raw_year, bool) or not isinstance(raw_year, (int, float)) or not math.isfinite(float(raw_year)) or int(raw_year) != raw_year:
        raise ValueError('Rate reference year must be a whole year.')
    year = int(raw_year)
    if year < 1900 or year > date.today().year:
        raise ValueError(f'Rate reference year must be between 1900 and {date.today().year}.')
    source_note = str(options.get('sourceNote') or '').strip()
    rate_note = f'US$1 = {rate:g} {source} · {year} reference rate' + (f' · {source_note}' if source_note else '')
    return {
        'mode': 'usd', 'source_currency': source, 'display_currency': 'USD',
        'factor': 1.0 / rate, 'rate': rate, 'reference_year': year,
        'source_note': source_note, 'rate_note': rate_note,
        'price_basis_note': f'Constant-price model values translated at {rate:g} {source} per US$1 ({year} reference rate). No annual exchange-rate forecast applied.',
    }