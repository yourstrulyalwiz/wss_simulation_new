"""Attribute an existing sector financing gap without changing the funding or coverage model."""


def attribute_gap(new_sm, new_basic, repl_sm, repl_basic, available, basic_share):
    """Return (SM gap, Basic gap, SM funded, Basic funded) in the model's money units.

    Replacement is funded first, proportional to each level's actual replacement
    obligation if the pool cannot cover it. New-service funding follows the
    configured split; surplus assigned to a fully-funded level rolls to the other.
    A negative net available balance is a shared liability rather than funding.
    """
    needs = (new_sm + repl_sm, new_basic + repl_basic)
    replacement = repl_sm + repl_basic
    cash = max(0.0, available)
    replacement_paid = min(cash, replacement)
    paid_sm_repl = replacement_paid * repl_sm / replacement if replacement > 0 else 0.0
    paid_basic_repl = replacement_paid - paid_sm_repl

    basic_share = min(1.0, max(0.0, basic_share))
    remaining = cash - replacement_paid
    paid_sm_new = min(new_sm, remaining * (1.0 - basic_share))
    paid_basic_new = min(new_basic, remaining * basic_share)
    surplus = remaining - paid_sm_new - paid_basic_new
    transfer_sm = min(max(0.0, new_sm - paid_sm_new), surplus)
    paid_sm_new += transfer_sm
    surplus -= transfer_sm
    paid_basic_new += min(max(0.0, new_basic - paid_basic_new), surplus)

    funded_sm = paid_sm_repl + paid_sm_new
    funded_basic = paid_basic_repl + paid_basic_new
    # Net cash-consuming interventions can make the sector gap exceed investment
    # need. Attribute that excess by the actual need mix (or the investment split
    # if there is no investment need), so the two gaps still reconcile.
    debt = max(0.0, -available)
    share_sm = needs[0] / sum(needs) if sum(needs) > 0 else 1.0 - basic_share
    sm_gap = max(0.0, needs[0] - funded_sm) + debt * share_sm
    basic_gap = max(0.0, needs[1] - funded_basic) + debt * (1.0 - share_sm)
    return sm_gap, basic_gap, funded_sm, funded_basic