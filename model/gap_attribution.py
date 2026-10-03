"""Attribute an existing sector financing gap without changing the funding or coverage model."""


def attribute_gap(new_sm, new_basic, repl_sm, repl_basic, replacement_credit, basic_share, cash_deficit=0.0):
    """Return (SM gap, Basic gap, SM funded, Basic funded) in the model's money units.

    New-service costs are already residual after funded connections; never
    subtract expansion funding again. The funded values are replacement credit
    only, proportional to reported replacement obligations. Attribute a cash
    deficit by original need shares, falling back to the investment split.
    """
    needs = (new_sm + repl_sm, new_basic + repl_basic)
    replacement = repl_sm + repl_basic
    replacement_paid = min(max(0.0, replacement_credit), max(0.0, replacement))
    paid_sm_repl = replacement_paid * repl_sm / replacement if replacement > 0 else 0.0
    paid_basic_repl = replacement_paid - paid_sm_repl

    basic_share = min(1.0, max(0.0, basic_share))
    funded_sm = paid_sm_repl
    funded_basic = paid_basic_repl
    # Net cash-consuming interventions can make the sector gap exceed investment
    # need. Attribute that excess by the actual need mix (or the investment split
    # if there is no investment need), so the two gaps still reconcile.
    debt = max(0.0, cash_deficit)
    share_sm = needs[0] / sum(needs) if sum(needs) > 0 else 1.0 - basic_share
    sm_gap = max(0.0, needs[0] - funded_sm) + debt * share_sm
    basic_gap = max(0.0, needs[1] - funded_basic) + debt * (1.0 - share_sm)
    return sm_gap, basic_gap, funded_sm, funded_basic