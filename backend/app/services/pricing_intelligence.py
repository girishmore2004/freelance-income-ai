"""Explainable pricing calibration from a user's own recorded outcomes."""
from statistics import median


def _number(value):
    try:
        value=float(value)
        return value if value > 0 else None
    except (TypeError, ValueError):
        return None


def recommend_price(opportunity, profile, historical):
    hours=_number(opportunity.get("estimated_hours"))
    rate=_number(profile.get("hourly_rate"))
    minimum=max(0.0,float(profile.get("minimum_budget") or 0))
    currency=opportunity.get("currency") or profile.get("currency") or "INR"
    warnings=[]
    if hours and rate:
        baseline=max(minimum,hours*rate)
        basis="Your profile hourly rate multiplied by estimated effort, subject to your minimum project budget."
    elif _number(opportunity.get("budget_max")):
        baseline=max(minimum,_number(opportunity.get("budget_max"))*0.85)
        basis="85% of the listing's maximum budget, subject to your minimum."
        warnings.append("No complete hourly-rate and effort estimate; listing budget is used as a proxy.")
    elif _number(opportunity.get("budget_min")):
        baseline=max(minimum,_number(opportunity.get("budget_min")))
        basis="Listing minimum budget, subject to your minimum."
        warnings.append("Only a minimum listing budget is available.")
    else:
        return {"opportunity_id":opportunity.get("id"),"currency":currency,"recommended_price":None,
                "range_low":None,"range_high":None,"confidence":"insufficient_data",
                "historical_samples":0,"basis":"Add an hourly rate and estimated hours, or enter a listing budget.",
                "warnings":["Insufficient price and effort data."],"requires_user_review":True}
    prices=[v for v in (_number(x.get("price")) for x in historical) if v]
    samples=len(prices)
    calibrated=baseline
    if samples>=3:
        historical_median=median(prices)
        # Limit influence of old outcomes so one unusual deal cannot radically reset price.
        bounded=max(baseline*.65,min(baseline*1.5,historical_median))
        calibrated=baseline*.7+bounded*.3
        basis += " Blended 70% with a bounded median from your own recorded won proposals."
    else:
        warnings.append(f"Only {samples} comparable won proposal prices; historical calibration is not applied until at least 3.")
    if minimum and calibrated < minimum:
        calibrated=minimum
    return {"opportunity_id":opportunity.get("id"),"currency":currency,
            "recommended_price":round(calibrated,2),"range_low":round(max(minimum,calibrated*.9),2),
            "range_high":round(calibrated*1.1,2),"baseline_price":round(baseline,2),
            "confidence":"medium" if samples>=5 and hours and rate else "low",
            "historical_samples":samples,"historical_median":round(median(prices),2) if prices else None,
            "basis":basis,"warnings":warnings,"requires_user_review":True,
            "not_a_market_quote":True}


def profitability(project, time_entries, invoices):
    minutes=sum(max(0,int(x.get("duration_minutes") or 0)) for x in time_entries)
    hours=minutes/60
    paid=sum(float(x.get("amount") or 0) for x in invoices if x.get("status")=="paid")
    invoiced=sum(float(x.get("amount") or 0) for x in invoices if x.get("status")!="cancelled")
    proxy_cost=sum((int(x.get("duration_minutes") or 0)/60)*float(x.get("hourly_rate") or 0) for x in time_entries)
    budget=float(project.get("budget") or 0)
    return {"project_id":project.get("id"),"currency":project.get("currency") or "INR",
            "contract_budget":round(budget,2),"paid_revenue":round(paid,2),
            "non_cancelled_invoiced":round(invoiced,2),"tracked_hours":round(hours,2),
            "realized_paid_revenue_per_hour":round(paid/hours,2) if hours else None,
            "internal_time_value_proxy":round(proxy_cost,2),
            "revenue_minus_time_value_proxy":round(paid-proxy_cost,2),
            "budget_remaining_vs_paid":round(budget-paid,2),
            "note":"Time value is a user-entered rate proxy, not an accounting expense or tax profit. Revenue is counted only from invoices marked paid."}


def outcome_segments(records):
    groups={}
    for row in records:
        currency=row.get("currency") or "INR"
        industry=(row.get("industry") or "unknown").strip().lower()
        work_type=(row.get("job_type") or "unknown").strip().lower()
        budget=_number(row.get("budget_max")) or _number(row.get("budget_min"))
        price=_number(row.get("price"))
        if not price:
            continue
        band="no_listing_budget"
        if budget:
            ratio=price/budget
            band="at_or_below_80_percent" if ratio<=.8 else "80_to_100_percent" if ratio<=1 else "above_listing_budget"
        key=(industry,work_type,currency,band)
        item=groups.setdefault(key,{"industry":industry,"job_type":work_type,"currency":currency,
                                    "price_band":band,"proposals":0,"wins":0,"non_wins":0,"prices":[]})
        item["proposals"]+=1;item["prices"].append(price)
        if row.get("outcome")=="won": item["wins"]+=1
        elif row.get("outcome") in {"lost","rejected","no_response"}: item["non_wins"]+=1
    output=[]
    for item in groups.values():
        decided=item["wins"]+item["non_wins"]
        item["median_proposal_price"]=round(median(item.pop("prices")),2)
        item["decided_sample_size"]=decided
        item["win_rate_percent"]=round(item["wins"]*100/decided,1) if decided else None
        output.append(item)
    return sorted(output,key=lambda x:(x["industry"],x["job_type"],x["currency"],x["price_band"]))
