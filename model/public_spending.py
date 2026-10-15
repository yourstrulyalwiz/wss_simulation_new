"""Stepwise executed-spending targets; legacy scalar mathematics stay in sector_bau."""
import math
from pydantic import BaseModel, field_validator


class PublicSpendingTarget(BaseModel):
    year: int
    target_share: float

    @field_validator('year', mode='before')
    @classmethod
    def strict_year(cls, value):
        if type(value) is not int:
            raise ValueError('effective year must be an integer, not a boolean or string')
        return value

    @field_validator('target_share', mode='before')
    @classmethod
    def strict_share(cls, value):
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError('target share must be a finite nonnegative number')
        return value


def resolve_schedule(raw, baseline_year, end_year, label):
    """Validate only an active schedule, sorting a copy rather than modifying inputs."""
    if not isinstance(raw, list) or not raw:
        raise ValueError(f'{label}: public-spending schedule requires at least one complete target.')
    points, seen = [], set()
    for index, row in enumerate(raw, 1):
        try:
            point = row if isinstance(row, PublicSpendingTarget) else PublicSpendingTarget.model_validate(row)
        except (ValueError, TypeError) as error:
            raise ValueError(f'{label}: public-spending target row {index}: {error}') from error
        if not baseline_year < point.year <= end_year:
            raise ValueError(f'{label}: target row {index}, year {point.year}, must be within '
                             f'{baseline_year + 1}–{end_year}.')
        if point.year in seen:
            raise ValueError(f'{label}: duplicate public-spending target year {point.year} (row {index}).')
        seen.add(point.year)
        points.append(point)
    return sorted(points, key=lambda point: point.year)
