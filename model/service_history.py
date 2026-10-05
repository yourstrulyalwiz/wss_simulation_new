"""Shared historical delivered counts; independent of costs and intervention toggles."""
import numpy as np


def historical_households(ctx, pct_start, pct_base, hist_series=None,
                          first_year_idx=0, hist_all_proportional=False):
    bi, total_hh = ctx['bi'], ctx['total_hh']
    fi = max(0, min(int(first_year_idx or 0), bi))
    hs = hist_series or []

    def share(r, t):
        if r < len(hs):
            a = hs[r]
            if a is not None and t < len(a):
                v = a[t]
                return float(v) if (v and v > 0) else 0.0
        if t == 0:
            return float(pct_start[r] or 0.0)
        if t == bi:
            return float(pct_base[r] or 0.0)
        return 0.0

    cagr = []
    history = np.zeros((5, bi + 1))
    for r in range(5):
        known = {}
        for t in range(bi + 1):
            sh = share(r, t)
            if sh > 0:
                known[t] = sh * total_hh[t]
        ks = sorted(k for k in known if fi <= k <= bi)
        yoy = []
        for j in range(1, len(ks)):
            t0, t1 = ks[j - 1], ks[j]
            if known[t0] > 0 and t1 > t0:
                yoy.append((known[t1] / known[t0]) ** (1.0 / (t1 - t0)) - 1.0)
        g = float(np.mean(yoy)) if yoy else 0.0
        cagr.append(g)
        prev = None
        for t in range(bi + 1):
            if t in known:
                history[r, t] = known[t]
                prev = known[t]
            elif prev is not None:
                history[r, t] = prev * (1.0 + g)
                prev = history[r, t]

    bau = np.zeros((5, ctx['n']))
    for t in range(bi + 1):
        unadj = list(history[:, t])
        total_unadj = sum(unadj)
        scale = total_hh[t] / total_unadj if total_unadj > 0 else 0.0
        if hist_all_proportional:
            for r in range(5):
                bau[r, t] = unadj[r] * scale
        else:
            for r in (2, 3, 4):
                bau[r, t] = unadj[r] * scale
            bau[0, t] = unadj[0]
            bau[1, t] = total_hh[t] - unadj[0] - sum(bau[r, t] for r in (2, 3, 4))
    return bau, cagr


def sector_history(inputs, ctx, sector):
    sl = inputs.water_service if sector == 'water' else inputs.sanitation_service
    prefix = 'serv' if sector == 'water' else 'sserv'
    start = [getattr(sl, f'pct_{prefix}{r}_start') for r in range(1, 6)]
    base = [getattr(sl, f'pct_{prefix}{r}_baseline') for r in range(1, 6)]
    ts = [getattr(sl, f'{prefix}{r}_ts') for r in range(1, 6)]
    first = max(0, (sl.bau_first_year or inputs.period.model_start_year) - inputs.period.model_start_year)
    return historical_households(ctx, start, base, ts, first, sector == 'water')[0]
