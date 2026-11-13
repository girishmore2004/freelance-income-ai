"""Explainable business intelligence derived from the user's own records."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone


def _number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _outcome_counts(feedback):
    counts = defaultdict(int)
    for item in feedback:
        counts[str(item.outcome or "unknown").lower()] += 1
    wins = counts.get("won", 0)
    losses = sum(counts.get(x, 0) for x in ("lost", "rejected", "no_response"))
    decided = wins + losses
    return dict(counts), wins, losses, decided


def build_funnel(opportunities, proposals, applications, feedback):
    counts, wins, losses, decided = _outcome_counts(feedback)
    applied_ids = {x.opportunity_id for x in applications if x.status in ("submitted", "viewed", "interviewing", "hired", "lost", "rejected")}
    proposal_ids = {x.opportunity_id for x in proposals}
    return {
        "opportunities": len(opportunities),
        "opportunities_with_proposals": len(proposal_ids),
        "application_records": len(applications),
        "recorded_submissions": len(applied_ids),
        "feedback_records": len(feedback),
        "wins": wins,
        "non_wins": losses,
        "decided_outcomes": decided,
        "win_rate_percent": round(wins * 100 / decided, 1) if decided else None,
        "proposal_coverage_percent": round(len(proposal_ids) * 100 / len(opportunities), 1) if opportunities else None,
        "note": "Based on saved records and manually entered feedback. Marketplace submission states are not provider-verified.",
    }


def build_source_performance(opportunities, applications, feedback, projects=(), invoices=(),
                             cost_entries=(), minimum_sample=5):
    """Source outcomes and paid-revenue ROI, using only explicitly linked project records.

    Costs without a project link are intentionally excluded because they cannot be
    attributed to an opportunity source. Revenue and costs remain currency-separated.
    """
    if minimum_sample < 2:
        raise ValueError("minimum_sample must be at least 2")
    opps = {x.id: x for x in opportunities}
    grouped = defaultdict(lambda: {
        "opportunities": set(), "applications": 0, "submitted_opportunities": set(),
        "wins": 0, "losses": 0, "unknown": 0,
    })
    latest_feedback = {}
    for item in sorted(feedback, key=lambda x: getattr(x, "created_at", datetime.min.replace(tzinfo=timezone.utc))):
        if item.opportunity_id:
            latest_feedback[item.opportunity_id] = item
    for opp in opportunities:
        grouped[str(opp.source or "unknown").strip().lower() or "unknown"]["opportunities"].add(opp.id)
    for app in applications:
        if app.opportunity_id in opps:
            bucket = grouped[str(opps[app.opportunity_id].source or "unknown").strip().lower() or "unknown"]
            bucket["applications"] += 1
            if app.status in ("submitted", "viewed", "interviewing", "hired", "lost", "rejected"):
                bucket["submitted_opportunities"].add(app.opportunity_id)
    for oid, fb in latest_feedback.items():
        if oid not in opps:
            continue
        bucket = grouped[str(opps[oid].source or "unknown").strip().lower() or "unknown"]
        outcome = str(fb.outcome or "").lower()
        if outcome == "won":
            bucket["wins"] += 1
        elif outcome in ("lost", "rejected"):
            bucket["losses"] += 1
        else:
            bucket["unknown"] += 1

    project_by_id = {x.id: x for x in projects}
    revenue_by_source = defaultdict(lambda: defaultdict(float))
    costs_by_source = defaultdict(lambda: defaultdict(float))
    for invoice in invoices:
        if invoice.status != "paid" or not invoice.project_id:
            continue
        project = project_by_id.get(invoice.project_id)
        if project and project.origin_opportunity_id in opps:
            source = str(opps[project.origin_opportunity_id].source or "unknown").strip().lower() or "unknown"
            revenue_by_source[source][invoice.currency or "INR"] += _number(invoice.amount)
    for cost in cost_entries:
        # Client-level overhead is not assigned to a source. Only project-linked costs
        # with an explicit project -> opportunity link are eligible for attribution.
        if not getattr(cost, "project_id", None):
            continue
        project = project_by_id.get(cost.project_id)
        if project and project.origin_opportunity_id in opps:
            source = str(opps[project.origin_opportunity_id].source or "unknown").strip().lower() or "unknown"
            costs_by_source[source][getattr(cost, "currency", None) or "INR"] += _number(cost.amount)

    result = []
    for source, data in grouped.items():
        decided = data["wins"] + data["losses"]
        revenue = {currency: round(amount, 2) for currency, amount in revenue_by_source[source].items()}
        costs = {currency: round(amount, 2) for currency, amount in costs_by_source[source].items()}
        roi = {}
        for currency in sorted(set(revenue) | set(costs)):
            rev, cost = revenue.get(currency, 0.0), costs.get(currency, 0.0)
            roi[currency] = {
                "paid_revenue": round(rev, 2), "attributed_project_costs": round(cost, 2),
                "net_after_attributed_costs": round(rev - cost, 2) if rev > 0 and cost > 0 else None,
                "roi_percent": round((rev - cost) * 100 / cost, 1) if rev > 0 and cost > 0 else None,
                "status": ("partial_attributed_cost_roi" if rev > 0 and cost > 0
                           else "insufficient_currency_matched_revenue_and_cost"),
            }
        result.append({
            "source": source, "opportunities": len(data["opportunities"]),
            "application_records": data["applications"],
            "recorded_submissions": len(data["submitted_opportunities"]),
            "wins": data["wins"], "losses": data["losses"], "unknown_or_undecided": data["unknown"],
            "decided_sample_size": decided,
            "minimum_sample": minimum_sample,
            "minimum_sample_met": decided >= minimum_sample,
            "win_rate_percent": round(data["wins"] * 100 / decided, 1) if decided >= minimum_sample else None,
            "descriptive_win_rate_percent": round(data["wins"] * 100 / decided, 1) if decided else None,
            "paid_revenue_by_currency": revenue,
            "attributed_project_costs_by_currency": costs,
            "roi_by_currency": roi,
            "revenue_attribution": "paid invoices linked through project.origin_opportunity_id; unlinked revenue is excluded",
            "cost_attribution": "only manually recorded costs linked to a project that is explicitly linked to an originating opportunity; client-level/unlinked costs excluded",
        })
    return sorted(result, key=lambda x: (-x["wins"], -x["opportunities"], x["source"]))


def build_capacity(time_entries, weekly_hours, today=None, lookback_days=28):
    today = today or date.today()
    start = today - timedelta(days=lookback_days - 1)
    total_minutes = 0
    billable_minutes = 0
    by_week = defaultdict(int)
    for entry in time_entries:
        try:
            work_date = date.fromisoformat(str(entry.work_date)[:10])
        except (TypeError, ValueError):
            continue
        if work_date < start or work_date > today:
            continue
        minutes = max(0, int(entry.duration_minutes or 0))
        total_minutes += minutes
        if entry.billable:
            billable_minutes += minutes
        week = work_date - timedelta(days=work_date.weekday())
        by_week[week.isoformat()] += minutes
    weekly_target = max(0, int(weekly_hours or 0)) * 60
    weeks = max(1, lookback_days / 7)
    target_minutes = weekly_target * weeks
    return {
        "as_of": today.isoformat(), "lookback_days": lookback_days,
        "weekly_capacity_hours": round(weekly_target / 60, 1),
        "logged_hours": round(total_minutes / 60, 2),
        "billable_hours": round(billable_minutes / 60, 2),
        "non_billable_hours": round((total_minutes - billable_minutes) / 60, 2),
        "capacity_hours_in_period": round(target_minutes / 60, 1),
        "logged_capacity_utilization_percent": round(total_minutes * 100 / target_minutes, 1) if target_minutes else None,
        "weekly_logged_hours": [{"week_start": key, "hours": round(value / 60, 2)} for key, value in sorted(by_week.items())],
        "note": "Utilization compares recorded time entries with the profile weekly-hours target. Missing time entries are not assumed to be idle time.",
    }


def build_project_profitability(projects, invoices, time_entries):
    invoices_by_project = defaultdict(lambda: defaultdict(float))
    for invoice in invoices:
        if invoice.project_id and invoice.status == "paid":
            invoices_by_project[invoice.project_id][invoice.currency or "INR"] += _number(invoice.amount)
    time_by_project = defaultdict(lambda: {"minutes": 0, "billable_minutes": 0, "cost_by_currency": defaultdict(float), "rate_known": True})
    for entry in time_entries:
        item = time_by_project[entry.project_id]
        item["minutes"] += max(0, int(entry.duration_minutes or 0))
        if entry.billable:
            item["billable_minutes"] += max(0, int(entry.duration_minutes or 0))
            rate = _number(entry.hourly_rate)
            if rate > 0:
                item["cost_by_currency"][entry.currency or "INR"] += max(0, int(entry.duration_minutes or 0)) / 60 * rate
            else:
                item["rate_known"] = False
    result = []
    for project in projects:
        time = time_by_project[project.id]
        paid = invoices_by_project[project.id]
        cost_by_currency = {c: round(v, 2) for c, v in time["cost_by_currency"].items()}
        revenue_by_currency = {c: round(v, 2) for c, v in paid.items()}
        all_currencies = set(revenue_by_currency) | set(cost_by_currency)
        single_currency = len(all_currencies) <= 1
        currency = next(iter(all_currencies), project.currency or "INR") if single_currency else "MIXED"
        revenue = revenue_by_currency.get(currency, 0.0) if single_currency else None
        estimated_cost = cost_by_currency.get(currency, 0.0) if single_currency and time["rate_known"] and time["billable_minutes"] > 0 else None
        if not time["billable_minutes"]:
            quality = "insufficient_billable_time_data"
        elif not single_currency:
            quality = "mixed_currency"
        elif not time["rate_known"]:
            quality = "insufficient_rate_data"
        else:
            quality = "partial_estimate"
        result.append({
            "project_id": project.id, "project": project.title, "client": project.client_name,
            "currency": currency, "project_budget": _number(project.budget),
            "paid_invoice_revenue": round(revenue, 2) if revenue is not None else None,
            "paid_invoice_revenue_by_currency": revenue_by_currency,
            "logged_hours": round(time["minutes"] / 60, 2),
            "estimated_billable_labor_cost": estimated_cost,
            "estimated_labor_cost_by_currency": cost_by_currency,
            "margin_after_logged_labor": round(revenue - estimated_cost, 2) if revenue is not None and estimated_cost is not None else None,
            "profitability_status": quality,
        })
    return result


def build_earnings_outlook(invoices, schedules, opportunities, proposals, feedback, horizon_days=90, today=None):
    today = today or date.today()
    horizon = today + timedelta(days=horizon_days)
    by_currency = defaultdict(lambda: {"paid_recorded": 0.0, "overdue_invoices": 0.0, "invoices_due_in_horizon": 0.0, "approved_schedules_not_invoiced": 0.0, "open_proposal_value": 0.0})
    for inv in invoices:
        currency = inv.currency or "INR"
        amount = _number(inv.amount)
        if inv.status == "paid":
            by_currency[currency]["paid_recorded"] += amount
        elif inv.status not in ("cancelled", "void"):
            due = _date(inv.due_date)
            if due and due < today:
                by_currency[currency]["overdue_invoices"] += amount
            elif due and today <= due <= horizon:
                by_currency[currency]["invoices_due_in_horizon"] += amount
    for schedule in schedules:
        if schedule.status == "approved" and not schedule.invoice_id:
            due = _date(schedule.due_date)
            if due and today <= due <= horizon:
                by_currency[schedule.currency or "INR"]["approved_schedules_not_invoiced"] += _number(schedule.amount)
    latest = {}
    for fb in sorted(feedback, key=lambda x: getattr(x, "created_at", datetime.min.replace(tzinfo=timezone.utc))):
        if fb.opportunity_id:
            latest[fb.opportunity_id] = fb
    decided = [x for x in latest.values() if str(x.outcome).lower() in ("won", "lost", "rejected", "no_response")]
    wins = sum(1 for x in decided if str(x.outcome).lower() == "won")
    empirical_rate = wins / len(decided) if len(decided) >= 5 else None
    latest_proposals = {}
    for proposal in sorted(proposals, key=lambda x: (x.opportunity_id, getattr(x, "created_at", datetime.min.replace(tzinfo=timezone.utc)))):
        latest_proposals[proposal.opportunity_id] = proposal
    opps = {x.id: x for x in opportunities}
    pipeline_by_currency = defaultdict(float)
    for oid, proposal in latest_proposals.items():
        opp = opps.get(oid)
        if not opp or proposal.proposed_price is None:
            continue
        if proposal.status in ("draft", "pending", "approved", "submitted"):
            pipeline_by_currency[proposal.currency or opp.currency or "INR"] += _number(proposal.proposed_price)
    for currency, value in pipeline_by_currency.items():
        by_currency[currency]["open_proposal_value"] += value
    result = {}
    for currency, data in by_currency.items():
        committed = data["invoices_due_in_horizon"] + data["approved_schedules_not_invoiced"]
        data["committed_due_in_horizon"] = round(committed, 2)
        data["open_proposal_value"] = round(data["open_proposal_value"], 2)
        data["empirical_win_rate_percent"] = round(empirical_rate * 100, 1) if empirical_rate is not None else None
        data["weighted_pipeline_estimate"] = round(data["open_proposal_value"] * empirical_rate, 2) if empirical_rate is not None else None
        for key in ("paid_recorded", "overdue_invoices", "invoices_due_in_horizon", "approved_schedules_not_invoiced"):
            data[key] = round(data[key], 2)
        result[currency] = data
    return {
        "as_of": today.isoformat(), "horizon_days": horizon_days,
        "by_currency": result,
        "empirical_win_rate_sample_size": len(decided),
        "weighted_pipeline_policy": "Shown only when at least five manually recorded decided outcomes exist. It is a rough historical estimate, not guaranteed revenue.",
        "note": "Open proposal value is not booked revenue. Approved schedules/invoices are kept separate from unsubmitted pipeline. No exchange-rate conversion is applied.",
    }


def _date(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _as_datetime(value):
    """Normalize database timestamps and ISO date strings to aware UTC datetimes."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def build_time_windowed_source_intelligence(opportunities, proposals, applications, feedback,
                                             projects=(), invoices=(), payment_events=(),
                                             windows=(30, 90, 180), today=None):
    """Activity-based source comparisons. Each stage uses its own recorded event date.

    This is a period-activity view, not a cohort conversion model: a proposal or payment
    in the period may relate to an opportunity first seen before the period.
    """
    today = today or date.today()
    if isinstance(today, datetime):
        today = today.date()
    opps = {item.id: item for item in opportunities}
    projects_by_id = {item.id: item for item in projects}
    invoices_by_id = {item.id: item for item in invoices}
    result = {}
    for days in windows:
        if int(days) < 1 or int(days) > 730:
            raise ValueError("window days must be between 1 and 730")
        start = datetime.combine(today - timedelta(days=int(days) - 1), datetime.min.time(), tzinfo=timezone.utc)
        end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        buckets = defaultdict(lambda: {
            "opportunities_added": 0, "proposals_created": 0, "submitted_applications": 0,
            "wins_recorded": 0, "losses_recorded": 0, "unknown_outcomes_recorded": 0,
            "receipts_by_currency": defaultdict(float), "refunds_by_currency": defaultdict(float),
            "opportunity_ids": set(),
        })

        def source_for(oid):
            opp = opps.get(oid)
            return (str(getattr(opp, "source", None) or "unknown").strip().lower() or "unknown") if opp else None

        for opp in opportunities:
            stamp = _as_datetime(getattr(opp, "created_at", None))
            if stamp and start <= stamp < end:
                buckets[source_for(opp.id)]["opportunities_added"] += 1
                buckets[source_for(opp.id)]["opportunity_ids"].add(opp.id)
        for proposal in proposals:
            stamp = _as_datetime(getattr(proposal, "created_at", None))
            source = source_for(getattr(proposal, "opportunity_id", None))
            if source and stamp and start <= stamp < end:
                buckets[source]["proposals_created"] += 1
        for application in applications:
            stamp = _as_datetime(getattr(application, "submitted_at", None))
            source = source_for(getattr(application, "opportunity_id", None))
            if source and stamp and start <= stamp < end:
                buckets[source]["submitted_applications"] += 1
        for item in feedback:
            stamp = _as_datetime(getattr(item, "created_at", None))
            source = source_for(getattr(item, "opportunity_id", None))
            if not source or not stamp or not (start <= stamp < end):
                continue
            outcome = str(getattr(item, "outcome", "") or "").lower()
            if outcome == "won":
                buckets[source]["wins_recorded"] += 1
            elif outcome in ("lost", "rejected"):
                buckets[source]["losses_recorded"] += 1
            else:
                buckets[source]["unknown_outcomes_recorded"] += 1
        for event in payment_events:
            stamp = _as_datetime(getattr(event, "occurred_at", None))
            invoice = invoices_by_id.get(getattr(event, "invoice_id", None))
            project = projects_by_id.get(getattr(invoice, "project_id", None)) if invoice else None
            source = source_for(getattr(project, "origin_opportunity_id", None)) if project else None
            if not source or not stamp or not (start <= stamp < end):
                continue
            currency = getattr(event, "currency", None) or (getattr(invoice, "currency", None) if invoice else None) or "INR"
            event_type = str(getattr(event, "event_type", "") or "").lower()
            if event_type == "receipt":
                buckets[source]["receipts_by_currency"][currency] += _number(getattr(event, "amount", 0))
            elif event_type == "refund":
                buckets[source]["refunds_by_currency"][currency] += _number(getattr(event, "amount", 0))

        rows = []
        for source, data in buckets.items():
            proposals_n = data["proposals_created"]
            submitted_n = data["submitted_applications"]
            decided = data["wins_recorded"] + data["losses_recorded"]
            currencies = set(data["receipts_by_currency"]) | set(data["refunds_by_currency"])
            net_received = {c: round(data["receipts_by_currency"].get(c, 0) - data["refunds_by_currency"].get(c, 0), 2) for c in sorted(currencies)}
            rows.append({
                "source": source, "opportunities_added": data["opportunities_added"],
                "proposals_created": proposals_n, "submitted_applications": submitted_n,
                "wins_recorded": data["wins_recorded"], "losses_recorded": data["losses_recorded"],
                "unknown_outcomes_recorded": data["unknown_outcomes_recorded"],
                "decided_outcomes_recorded": decided,
                "recorded_win_rate_percent": round(data["wins_recorded"] * 100 / decided, 1) if decided else None,
                "proposal_to_submission_activity_percent": round(submitted_n * 100 / proposals_n, 1) if proposals_n else None,
                "receipts_by_currency": {c: round(v, 2) for c, v in sorted(data["receipts_by_currency"].items())},
                "refunds_by_currency": {c: round(v, 2) for c, v in sorted(data["refunds_by_currency"].items())},
                "net_recorded_receipts_by_currency": net_received,
                "data_quality": "period activity; stages are dated independently and are not a same-cohort conversion rate",
            })
        result[str(days)] = {
            "window_days": int(days), "start_date": start.date().isoformat(), "end_date": today.isoformat(),
            "sources": sorted(rows, key=lambda x: (-x["opportunities_added"], -x["proposals_created"], x["source"])),
        }
    return {
        "as_of": today.isoformat(), "windows": result,
        "method": "Activity is grouped by the opportunity source and each event's own timestamp. Receipts/refunds use append-only manual invoice payment events and require invoice → project → originating opportunity links.",
        "limitations": [
            "This is a period-activity comparison, not a cohort funnel; stages may relate to opportunities created in earlier periods.",
            "Only manually recorded receipt/refund events are counted; invoice status alone is not treated as cash received.",
            "Unlinked invoices, projects, payment events and outcomes are excluded. Currencies are never combined or converted.",
            "No activity is inferred when a timestamp is missing.",
        ],
    }


def build_source_cohort_intelligence(opportunities, proposals, applications, feedback,
                                    projects=(), invoices=(), payment_events=(),
                                    windows=(30, 90, 180), today=None):
    """Opportunity-created cohorts with downstream milestones attributed to the same lead.

    Cohort membership is fixed by Opportunity.created_at. Later milestones are counted
    only when their event timestamp is on/after that opportunity's creation timestamp.
    This is an observed-to-date cohort, not a forecast; recent cohorts are less mature.
    """
    today = today or date.today()
    if isinstance(today, datetime):
        today = today.date()
    as_of_end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    opps = {o.id: o for o in opportunities}
    proposals_by_opp = defaultdict(list)
    applications_by_opp = defaultdict(list)
    feedback_by_opp = defaultdict(list)
    projects_by_opp = defaultdict(list)
    invoices_by_id = {i.id: i for i in invoices}
    projects_by_id = {x.id: x for x in projects}
    for item in proposals:
        if item.opportunity_id in opps:
            proposals_by_opp[item.opportunity_id].append(item)
    for item in applications:
        if item.opportunity_id in opps:
            applications_by_opp[item.opportunity_id].append(item)
    for item in feedback:
        if item.opportunity_id in opps:
            feedback_by_opp[item.opportunity_id].append(item)
    for project in projects:
        if project.origin_opportunity_id in opps:
            projects_by_opp[project.origin_opportunity_id].append(project)

    payments_by_opp = defaultdict(lambda: defaultdict(float))
    for event in payment_events:
        invoice = invoices_by_id.get(getattr(event, "invoice_id", None))
        project = projects_by_id.get(getattr(invoice, "project_id", None)) if invoice else None
        oid = getattr(project, "origin_opportunity_id", None) if project else None
        if oid not in opps:
            continue
        occurred = _as_datetime(getattr(event, "occurred_at", None))
        opp_created = _as_datetime(getattr(opps[oid], "created_at", None))
        if not occurred or not opp_created or occurred < opp_created or occurred >= as_of_end:
            continue
        kind = str(getattr(event, "event_type", "") or "").lower()
        if kind not in ("receipt", "refund"):
            continue
        currency = getattr(event, "currency", None) or getattr(invoice, "currency", None) or "INR"
        sign = -1 if kind == "refund" else 1
        payments_by_opp[oid][currency] += sign * _number(getattr(event, "amount", 0))

    result = {}
    for days in windows:
        days = int(days)
        if days < 1 or days > 730:
            raise ValueError("window days must be between 1 and 730")
        cohort_start = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), tzinfo=timezone.utc)
        cohort_end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        groups = defaultdict(list)
        for opp in opportunities:
            created = _as_datetime(getattr(opp, "created_at", None))
            if created and cohort_start <= created < cohort_end:
                source = str(getattr(opp, "source", None) or "unknown").strip().lower() or "unknown"
                groups[source].append(opp)

        rows = []
        for source, cohort in groups.items():
            total = len(cohort)
            with_proposal = submitted = decided = wins = losses = with_project = 0
            revenue = defaultdict(float)
            ages = []
            for opp in cohort:
                created = _as_datetime(getattr(opp, "created_at", None))
                if not created:
                    continue
                ages.append(max(0, (datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) - created).days))
                if any((stamp := _as_datetime(getattr(x, "created_at", None))) and created <= stamp < as_of_end
                       for x in proposals_by_opp[opp.id]):
                    with_proposal += 1
                if any((stamp := _as_datetime(getattr(x, "submitted_at", None))) and created <= stamp < as_of_end
                       and str(getattr(x, "status", "")).lower() in
                       ("submitted", "viewed", "interviewing", "hired", "lost", "rejected")
                       for x in applications_by_opp[opp.id]):
                    submitted += 1
                eligible_feedback = [x for x in feedback_by_opp[opp.id]
                    if (stamp := _as_datetime(getattr(x, "created_at", None))) and created <= stamp < as_of_end]
                latest_feedback = sorted(eligible_feedback,
                    key=lambda x: _as_datetime(getattr(x, "created_at", None)))
                latest = latest_feedback[-1] if latest_feedback else None
                latest_at = _as_datetime(getattr(latest, "created_at", None)) if latest else None
                if latest and latest_at:
                    outcome = str(getattr(latest, "outcome", "") or "").lower()
                    if outcome in ("won", "lost", "rejected"):
                        decided += 1
                        wins += outcome == "won"
                        losses += outcome in ("lost", "rejected")
                if any((stamp := _as_datetime(getattr(x, "created_at", None))) and created <= stamp < as_of_end
                       for x in projects_by_opp[opp.id]):
                    with_project += 1
                for currency, amount in payments_by_opp[opp.id].items():
                    revenue[currency] += amount
            rows.append({
                "source": source, "cohort_opportunities": total,
                "with_proposal": with_proposal, "proposal_conversion_percent": round(with_proposal * 100 / total, 1) if total else None,
                "submitted": submitted, "submission_conversion_percent": round(submitted * 100 / total, 1) if total else None,
                "decided_outcomes": decided, "wins": wins, "losses": losses,
                "win_rate_of_decided_percent": round(wins * 100 / decided, 1) if decided else None,
                "projects_created": with_project,
                "project_conversion_percent": round(with_project * 100 / total, 1) if total else None,
                "net_recorded_cash_by_currency": {c: round(v, 2) for c, v in sorted(revenue.items())},
                "average_cohort_age_days": round(sum(ages) / len(ages), 1) if ages else None,
                "data_quality": "same-opportunity cohort; downstream events observed through the report date",
            })
        result[str(days)] = {
            "window_days": days,
            "cohort_start_date": cohort_start.date().isoformat(),
            "as_of": today.isoformat(),
            "sources": sorted(rows, key=lambda x: (-x["cohort_opportunities"], x["source"])),
        }
    return {
        "as_of": today.isoformat(), "windows": result,
        "method": "Opportunities are assigned to cohorts by created_at. Proposal, submitted-application, latest decided-feedback, project and recorded payment milestones are linked back to that same opportunity and must occur on/after its creation. Cash is net receipts less refunds, attributed through invoice → project → originating opportunity.",
        "limitations": [
            "Recent cohorts have had less time to convert; compare average cohort age and avoid treating immature cohorts as final.",
            "Only the latest feedback record per opportunity is used for the decided outcome.",
            "Only manually recorded receipt/refund events are counted. Invoice status is not proof of cash received.",
            "Unlinked records and events with missing timestamps are excluded; currencies are not combined or converted.",
        ],
    }
