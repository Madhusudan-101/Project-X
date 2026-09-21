"""Admin financial analytics — /admin/finance/summary

There is NO financial data in the database today: no payments, subscriptions,
invoices or expense records exist, so nothing here can be calculated. This
endpoint is the stable contract the Finance page renders; every metric is
`null` (the UI shows N/A) and `available` is false. Nothing is invented.

To integrate real finance data later, only `get_finance_summary` changes:
  1. add the source table(s) — at minimum a payments/invoices ledger with
     amount, currency, paid_at, and the college_id / company_id it belongs to,
     plus an expense ledger for expenditure;
  2. add an `admin_finance_summary(p_from, p_to)` SQL function next to the
     other admin_* functions (service_role only);
  3. return its result from `get_finance_summary` with `available: true`.
The response shape, route and Finance page stay as they are.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from ...deps import require_admin_role
from ...services.admin.common import DateRange, date_range

router = APIRouter(prefix="/admin/finance", tags=["admin-finance"], dependencies=[Depends(require_admin_role)])

_METRICS = (
    "revenue", "monthly_revenue", "annual_revenue", "revenue_per_college",
    "revenue_per_company", "expenditure", "net_revenue", "growth_rate",
)


def get_finance_summary(rng: DateRange) -> Dict[str, Any]:
    return {
        "available": False,
        "currency": None,
        "source": None,
        "message": "No financial data source is connected yet — there are no payment, "
                   "subscription or expense records in the database.",
        "metrics": {name: None for name in _METRICS},
    }


@router.get("/summary")
def finance_summary(rng: DateRange = Depends(date_range)):
    return get_finance_summary(rng)
