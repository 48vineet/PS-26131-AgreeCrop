from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from expert_validation import validations_for
from models_db import DiseaseObservation, Farm, MonitoringCase, NotificationRead, PestObservation, Referral, RiskAssessment, User


def _iso(value):
    return value.isoformat() if value else None


def _item(kind, severity, title, body, target, occurred_at):
    return {
        "kind": kind,
        "severity": severity,
        "title": title,
        "body": body,
        "target_path": target,
        "read": False,
        "occurred_at": _iso(occurred_at),
        "source": "database",
    }


def acknowledged_kinds(db: Session, user_id: int) -> dict[str, datetime]:
    rows = db.query(NotificationRead).filter(NotificationRead.user_id == user_id).all()
    return {row.kind: row.read_at for row in rows}


def notifications_for(db: Session, user: User) -> dict:
    items = []
    read_kinds = acknowledged_kinds(db, user.id)
    farm_ids = [row[0] for row in db.query(Farm.id).filter(Farm.user_id == user.id).all()]
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if farm_ids:
        for risk in db.query(RiskAssessment).filter(RiskAssessment.farm_id.in_(farm_ids), RiskAssessment.risk_level == "HIGH").order_by(RiskAssessment.calculated_at.desc()).limit(5):
            items.append(_item("high_risk", "high", "High environmental risk", risk.explanation, f"/risk?farm_id={risk.farm_id}&crop_id={risk.crop_id}", risk.calculated_at))

        for pest in db.query(PestObservation).filter(PestObservation.farm_id.in_(farm_ids)).order_by(PestObservation.observed_at.desc()).limit(5):
            items.append(_item("pest_observation", "important", "Pest observation recorded", f"{pest.pest_name} was recorded on one of your farms.", "/pest-surveillance", pest.observed_at))

        cases = db.query(MonitoringCase).filter(MonitoringCase.farm_id.in_(farm_ids), MonitoringCase.status.in_(("OPEN", "FOLLOW_UP_SUBMITTED")), or_(MonitoringCase.due_at.is_(None), MonitoringCase.due_at <= now)).order_by(MonitoringCase.id.desc()).limit(5)
        for case in cases:
            items.append(_item("followup_due", "important", "Crop follow-up due", case.summary or "A monitoring case is ready for its next field check.", "/monitoring", case.due_at or case.updated_at))

        case_ids = [row[0] for row in db.query(MonitoringCase.id).filter(MonitoringCase.farm_id.in_(farm_ids)).all()]
        if case_ids and user.role not in ("expert", "extension_officer"):
            for referral in db.query(Referral).filter(Referral.case_id.in_(case_ids)).order_by(Referral.updated_at.desc()).limit(5):
                items.append(_item("referral_update", "important", f"Referral {referral.status.lower().replace('_', ' ')}", referral.outcome_notes or "The referral status changed.", "/referrals", referral.updated_at))

    if user.role in ("expert", "extension_officer"):
        for referral in db.query(Referral).order_by(Referral.updated_at.desc()).limit(5):
            items.append(_item("referral_update", "important", f"Referral {referral.status.lower().replace('_', ' ')}", referral.outcome_notes or "The referral status changed.", "/referrals", referral.updated_at))
        pending = 0
        for screening in db.query(DiseaseObservation).order_by(DiseaseObservation.created_at.desc()).limit(25):
            if validations_for(db, screening.id) is None:
                items.append(_item("validation_pending", "important", "Expert validation pending", "A submitted screening is waiting for review.", "/validation", screening.created_at))
                pending += 1
                if pending >= 5:
                    break

    items.sort(key=lambda item: item["occurred_at"] or "", reverse=True)
    visible = items[:30]
    for item in visible:
        read_at = read_kinds.get(item["kind"])
        if read_at and read_at.isoformat() >= (item["occurred_at"] or ""):
            item["read"] = True
    unread = [item for item in visible if not item["read"]]
    return {"notifications": visible, "unread_count": len(unread), "read_state": "database"}
