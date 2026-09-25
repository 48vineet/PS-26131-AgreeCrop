from datetime import date, datetime
from sqlalchemy import Boolean, Column, Computed, Date, DateTime, Float, ForeignKey, Integer, String, Text, CheckConstraint, Index, UniqueConstraint, JSON, text
from sqlalchemy.orm import relationship
from geoalchemy2 import Geography
from database import Base

class User(Base):
    __tablename__='users'; id=Column(Integer,primary_key=True); auth_user_id=Column(String(64),nullable=True,unique=True,index=True); name=Column(String(200),nullable=False); phone=Column(String(40)); email=Column(String(320)); role=Column(String(40),nullable=False,default='farmer'); language=Column(String(5),nullable=False,default='en'); created_at=Column(DateTime,default=datetime.utcnow); updated_at=Column(DateTime,default=datetime.utcnow,onupdate=datetime.utcnow); farms=relationship('Farm',back_populates='user',cascade='all, delete-orphan')
class Farm(Base):
    __tablename__='farms'; id=Column(Integer,primary_key=True); user_id=Column(Integer,ForeignKey('users.id',ondelete='CASCADE'),nullable=False); farm_name=Column(String(200),nullable=False); area=Column(Float,nullable=False); area_unit=Column(String(20),nullable=False); created_at=Column(DateTime,default=datetime.utcnow); updated_at=Column(DateTime,default=datetime.utcnow,onupdate=datetime.utcnow); user=relationship('User',back_populates='farms'); locations=relationship('FarmLocation',back_populates='farm',cascade='all, delete-orphan'); crops=relationship('Crop',back_populates='farm',cascade='all, delete-orphan'); __table_args__=(CheckConstraint('area > 0','ck_farm_area_positive'),)
class FarmLocation(Base):
    __tablename__='farm_locations'; id=Column(Integer,primary_key=True); farm_id=Column(Integer,ForeignKey('farms.id',ondelete='CASCADE'),nullable=False); latitude=Column(Float,nullable=False); longitude=Column(Float,nullable=False); address=Column(Text); village=Column(String(120)); district=Column(String(120)); state=Column(String(120)); postal_code=Column(String(20)); point=Column(Geography('POINT',srid=4326)); farm=relationship('Farm',back_populates='locations'); __table_args__=(CheckConstraint('latitude between -90 and 90','ck_lat'),CheckConstraint('longitude between -180 and 180','ck_lon'))
class Crop(Base):
    __tablename__='crops'; id=Column(Integer,primary_key=True); farm_id=Column(Integer,ForeignKey('farms.id',ondelete='CASCADE'),nullable=False); crop_name=Column(String(120),nullable=False); variety=Column(String(120)); sowing_date=Column(Date); transplanting_date=Column(Date); current_stage=Column(String(80)); archived_at=Column(DateTime); created_at=Column(DateTime,default=datetime.utcnow); updated_at=Column(DateTime,default=datetime.utcnow,onupdate=datetime.utcnow); farm=relationship('Farm',back_populates='crops')
class WeatherRecord(Base):
    __tablename__='weather_records'; id=Column(Integer,primary_key=True); farm_id=Column(Integer,ForeignKey('farms.id',ondelete='CASCADE'),nullable=False,index=True); source=Column(String(80),nullable=False); data_type=Column(String(80),nullable=False); source_url=Column(Text,nullable=False); latitude=Column(Float,nullable=False); longitude=Column(Float,nullable=False); model_time=Column(DateTime,nullable=False); fetched_at=Column(DateTime,nullable=False); payload=Column(Text,nullable=False)
class RiskAssessment(Base):
    __tablename__='risk_assessments'; id=Column(Integer,primary_key=True); farm_id=Column(Integer,ForeignKey('farms.id',ondelete='CASCADE'),nullable=False,index=True); crop_id=Column(Integer,ForeignKey('crops.id',ondelete='CASCADE'),nullable=False,index=True); risk_level=Column(String(30),nullable=False); assessment_type=Column(String(20),nullable=False,default='current'); disease=Column(String(160)); weather_period=Column(String(160)); weather_timestamp=Column(DateTime); weather_source=Column(String(80)); rule_version=Column(String(20)); factors=Column(JSON,nullable=False); explanation=Column(Text,nullable=False); calculated_at=Column(DateTime,nullable=False)

class DiseaseObservation(Base):
    """A submitted image screening, retained so it can be reviewed later.

    Specified in backend/docs/PRODUCT_ARCHITECTURE.md section 4. The nullability here is
    the specification's substance, not an accident:

    ``farm_id`` / ``crop_id`` are optional because image screening is an
    independent evidence stream -- a screening submitted with no farm and no
    crop is a complete, valid record. Both use ``SET NULL`` rather than the
    ``CASCADE`` used by risk assessments: a risk assessment is meaningless
    without its farm, but a screening stands on its own, so deleting a farm must
    not erase the screenings taken there.

    ``submitted_by`` is required. A screening only becomes an observation once it
    belongs to someone; anonymous screenings are returned to the caller and not
    stored.

    ``model_version`` is mandatory. A predicted class is only interpretable
    alongside the model that produced it.

    ``image_hash`` is the SHA-256 of the uploaded bytes. ``image_ref`` is nullable:
    it holds a random object key in the private ``screenings`` bucket only when
    review consent was granted and backend storage succeeded. Anonymous, refused,
    legacy, expired, and unconfigured-storage screenings keep it NULL.

    ``collection_group_id`` is an immutable identifier supplied by the collection
    workflow for one physical specimen or real-world collection event. It is never
    derived from the prediction, timestamp, filename, or image hash. Historical
    rows stay NULL because unknown provenance must not be invented; those rows are
    excluded from leakage-safe evaluation and future training-data preparation.

    ``latitude`` / ``longitude`` are where the photograph was taken. They are
    never defaulted from the farm's centroid: a leaf photo may come from any
    corner of a field, so an unknown position stays NULL.

    ``validation_id`` is gone, dropped by 0009. Phase 6 planned it as a pointer
    to the review of this screening, but ``expert_validations.observation_id`` is
    UNIQUE, which makes the reverse pointer redundant -- and two
    mutually-referencing keys for a one-to-one relationship can only drift apart.
    A screening reaches its review through that constraint. If validations ever
    become append-only, a ``current_validation_id`` pointer earns its place back.
    """

    __tablename__ = 'disease_observations'

    id = Column(Integer, primary_key=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='SET NULL'), index=True)
    crop_id = Column(Integer, ForeignKey('crops.id', ondelete='SET NULL'), index=True)
    submitted_by = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    image_ref = Column(Text)
    image_hash = Column(String(64), nullable=False)
    collection_group_id = Column(String(64))
    # Two separate consents, added by 0010, because they are two different
    # questions. Review consent lets a qualified reviewer see the photograph to
    # help this farmer. Training consent lets it become a labelled example for a
    # future model, which benefits other people and is irreversible in effect.
    # Neither is implied by the other, neither is defaulted to true, and NULL
    # means 'not asked' rather than 'no'. The leakage-safe evaluation/export layer
    # reads image_consent_training and accepts only an explicit True; it still does
    # not train a model or copy an image into a dataset.
    image_consent_review = Column(Boolean)
    image_consent_training = Column(Boolean)
    image_consent_at = Column(DateTime)
    # When the stored object becomes eligible for deletion. Set from
    # IMAGE_RETENTION_DAYS at upload; see backend/docs/EVIDENCE_LIFECYCLE.md.
    image_retention_until = Column(DateTime)
    image_deleted_at = Column(DateTime)
    model_version = Column(String(120), nullable=False)
    predicted_class = Column(String(160), nullable=False)
    confidence = Column(Float, nullable=False)
    top_predictions = Column(JSON, nullable=False)
    screened_at = Column(DateTime, nullable=False)
    latitude = Column(Float)
    longitude = Column(Float)
    # Spatial twin of latitude/longitude, added by migration 0008. Generated
    # ALWAYS AS ... STORED, so it cannot drift from the two coordinate columns
    # and no write path has to remember it -- SQLAlchemy therefore never
    # includes it in an INSERT. NULL whenever either coordinate is NULL: an
    # unknown position must not become a point. `spatial_index=False` because
    # the migration creates a *partial* GiST index that geoalchemy2's implicit
    # one would duplicate.
    point = Column(
        Geography('POINT', srid=4326, spatial_index=False),
        Computed(
            'CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL '
            'THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END',
            persisted=True,
        ),
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint('latitude is null or latitude between -90 and 90', name='ck_disease_obs_lat'),
        CheckConstraint('longitude is null or longitude between -180 and 180', name='ck_disease_obs_lon'),
        # predict.py reports confidence as a percentage, and the stored value is
        # the same number the API returned.
        CheckConstraint('confidence between 0 and 100', name='ck_disease_obs_confidence'),
        CheckConstraint(
            "collection_group_id is null or length(btrim(collection_group_id)) > 0",
            name='ck_disease_obs_collection_group_not_blank',
        ),
        # The review queue and a farmer's own history both read newest-first.
        Index('ix_disease_obs_submitter_time', 'submitted_by', 'screened_at'),
        Index('ix_disease_obs_collection_group', 'collection_group_id'),
    )

class PestObservation(Base):
    """A pest-trap, scouting, or farmer-confirmed AI image observation.

    Specified in backend/docs/PRODUCT_ARCHITECTURE.md section 4. Manual rows are
    user-generated field evidence. Confirmed AI rows retain local model
    provenance in ``ai_metadata`` and are never treated as expert confirmation.

    ``farm_id`` is required, unlike DiseaseObservation's. A photograph can be
    screened with no farm context, but a trap count is meaningless without
    knowing which field the trap stands in. ``crop_id`` stays optional because a
    trap often monitors a whole field rather than one crop.

    ``observed_at`` is when the observation happened; ``created_at`` is when it
    was typed in. They are deliberately separate -- a farmer may record on
    Tuesday what they saw on Monday, and collapsing the two would corrupt every
    future time series built on this table.

    ``count`` is nullable so presence-without-a-count stays recordable ("whitefly
    seen on the sticky trap, not counted"). ``unit`` says what the number means;
    a bare integer is not interpretable across trap types.

    ``pest_name`` is free text, recorded exactly as entered. There is no curated
    crop-to-pest vocabulary in this project yet, and offering a dropdown would
    imply an authority that does not exist. A validated vocabulary is a
    prerequisite for any future threshold logic.

    ``latitude``/``longitude`` are the trap's own position, and are never
    defaulted from the farm centroid -- a trap sits somewhere specific, and
    copying the farm's centre would fabricate a location. When absent, the farm's
    recorded location is what downstream code should use, via ``farm_id``.

    ``source`` is derived server-side, never accepted from the client. Manual rows
    use the submitter's role; confirmed AI rows use ``AI_IMAGE_ANALYSIS``.

    ``photo_ref`` is nullable and points at the existing private screening image
    when the farmer granted review consent. ``ai_metadata`` is nullable so old
    manual rows remain unchanged; AI rows carry local model provenance, confidence,
    detection/count provenance, and the farmer confirmation decision.
    """

    __tablename__ = 'pest_observations'

    id = Column(Integer, primary_key=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=False, index=True)
    crop_id = Column(Integer, ForeignKey('crops.id', ondelete='SET NULL'), index=True)
    observer_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    observed_at = Column(DateTime, nullable=False)
    method = Column(String(40), nullable=False)
    method_detail = Column(String(120))
    pest_name = Column(String(160), nullable=False)
    count = Column(Integer)
    unit = Column(String(40), nullable=False)
    trap_id = Column(String(60))
    latitude = Column(Float)
    longitude = Column(Float)
    # Spatial twin of latitude/longitude, added by migration 0008. Generated
    # ALWAYS AS ... STORED, so it cannot drift from the two coordinate columns
    # and no write path has to remember it -- SQLAlchemy therefore never
    # includes it in an INSERT. NULL whenever either coordinate is NULL: an
    # unknown position must not become a point. `spatial_index=False` because
    # the migration creates a *partial* GiST index that geoalchemy2's implicit
    # one would duplicate.
    point = Column(
        Geography('POINT', srid=4326, spatial_index=False),
        Computed(
            'CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL '
            'THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END',
            persisted=True,
        ),
    )
    notes = Column(Text)
    photo_ref = Column(Text)
    source = Column(String(40), nullable=False)
    ai_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # A negative count is not a low count, it is a data error.
        CheckConstraint('"count" is null or "count" >= 0', name='ck_pest_obs_count_non_negative'),
        CheckConstraint('latitude is null or latitude between -90 and 90', name='ck_pest_obs_lat'),
        CheckConstraint('longitude is null or longitude between -180 and 180', name='ck_pest_obs_lon'),
        # A trap identifier is unique per farm, not globally: two farms may both
        # label a trap "TRAP-001". Partial, because trap_id is optional.
        Index(
            'ix_pest_obs_farm_trap',
            'farm_id', 'trap_id',
            postgresql_where=text('trap_id is not null'),
        ),
        # The history view and any future aggregation both read newest-first
        # within a farm.
        Index('ix_pest_obs_farm_observed', 'farm_id', 'observed_at'),
        Index('ix_pest_obs_observer_observed', 'observer_user_id', 'observed_at'),
    )

class ExpertValidation(Base):
    """One authorised reviewer's conclusion about one image screening.

    Specified in backend/docs/PRODUCT_ARCHITECTURE.md section 4 and documented in
    backend/docs/EXPERT_VALIDATION.md. The semantics that shape this table:

    ``observation_id`` is UNIQUE. One current conclusion per screening, enforced
    in the database rather than by a read-then-write, so two reviewers submitting
    at the same instant cannot both succeed. This is also the *only* link between
    the two tables: ``disease_observations.validation_id`` was dropped in 0009,
    because with this constraint it was redundant and two mutually-referencing
    keys for a one-to-one relationship can only drift apart.

    There is no ``PENDING`` row. A screening with no row here has not been
    reviewed, which is a fact about the queue rather than a finding about the
    crop. Storing it would have required backfilling every existing screening and
    would let the stored status disagree with reality.

    ``reviewer_id`` uses ``RESTRICT``: an account that has reviewed evidence
    cannot be deleted out from under its conclusions. ``ondelete='CASCADE'`` on
    ``observation_id`` is the opposite choice for the opposite reason -- a review
    of a screening that no longer exists reviews nothing.

    ``reviewer_role`` records the role *at the time of review*. Roles can change;
    what a conclusion was made under cannot be reconstructed from the current
    ``users.role``, and a reader needs to know whether a verdict came from an
    expert or an extension officer.

    ``validated_class`` is free text, not one of the model's 38 classes. A
    reviewer may recognise a condition the model has no class for -- it covers 14
    crops, and this platform's farmers grow others -- and forcing their conclusion
    into the model's vocabulary would corrupt it. NULL for every status except
    ``VALIDATED``, where the check constraint requires it.

    ``agrees_with_model`` is derived server-side by comparing ``validated_class``
    with the screening's ``predicted_class``, never submitted. It is stored rather
    than computed on read because it is the basis of any future model-accuracy
    measurement, and that measurement must reflect the class the reviewer chose at
    the time -- not a later re-comparison against a re-trained model.

    ``reviewed_at`` is when the conclusion was reached; ``created_at`` is when the
    first conclusion for this screening was recorded, and ``updated_at`` moves on
    revision. Only the latest conclusion is kept; a full revision history is a
    separate feature with its own retention question.

    Deliberately absent: any expert confidence score. A reviewer's subjective
    certainty is not calibrated against anything, so a number would invite
    averaging and thresholding it cannot support.
    """

    __tablename__ = 'expert_validations'

    id = Column(Integer, primary_key=True)
    observation_id = Column(
        Integer,
        ForeignKey('disease_observations.id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
    )
    reviewer_id = Column(
        Integer, ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True
    )
    reviewer_role = Column(String(40), nullable=False)
    status = Column(String(20), nullable=False)
    validated_class = Column(String(160))
    review_notes = Column(Text)
    agrees_with_model = Column(Boolean)
    reviewed_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # PENDING is the absence of a row and must never be stored as one.
        CheckConstraint(
            "status in ('VALIDATED', 'REJECTED', 'NEEDS_REVIEW')",
            name='ck_expert_validation_status',
        ),
        # The status semantics, enforced in the database and not only in Python:
        # a validated screening states a condition, and the other two conclude
        # that none was reached.
        CheckConstraint(
            "(status = 'VALIDATED' and validated_class is not null) "
            "or (status <> 'VALIDATED' and validated_class is null)",
            name='ck_expert_validation_class_matches_status',
        ),
        # A rejection or an escalation without a stated reason is not reviewable.
        CheckConstraint(
            "status = 'VALIDATED' or (review_notes is not null and length(btrim(review_notes)) >= 10)",
            name='ck_expert_validation_reason_required',
        ),
        # Only a reviewing role may hold a conclusion, at the time it was made.
        CheckConstraint(
            "reviewer_role in ('expert', 'extension_officer')",
            name='ck_expert_validation_reviewer_role',
        ),
        # The queue reads by status, newest first.
        Index('ix_expert_validation_status_time', 'status', 'reviewed_at'),
    )

# ══════════════════════════════════════════════════════════════════════════
#  Evidence lifecycle: monitoring -> field confirmation -> evaluation
#  plus advisories, referrals, and the sensor ingestion contract.
#  Created by migration 0010. See backend/docs/EVIDENCE_LIFECYCLE.md.
# ══════════════════════════════════════════════════════════════════════════

class MonitoringCase(Base):
    """An open thread of attention on one screened crop problem.

    Originates only from a `DiseaseObservation`: a case is follow-up *on
    something*, and inventing one from nothing would give the farmer a task with
    no evidence behind it. `observation_id` is UNIQUE, so re-opening a case on the
    same screening revises the existing one rather than forking the history.

    ``status`` stores only what a human actually did: OPEN, FOLLOW_UP_SUBMITTED,
    RESOLVED, CLOSED. **FOLLOW_UP_DUE is derived**, not stored -- it is what OPEN
    or FOLLOW_UP_SUBMITTED means once `due_at` has passed. Storing it would need a
    scheduler to flip rows and would drift the moment that scheduler failed;
    deriving it cannot be wrong. See `monitoring.effective_status`.

    RESOLVED is the farmer saying the problem no longer needs watching. It is
    **not** a claim that a treatment worked, and nothing here infers one.
    """

    __tablename__ = 'monitoring_cases'

    id = Column(Integer, primary_key=True)
    observation_id = Column(
        Integer, ForeignKey('disease_observations.id', ondelete='CASCADE'),
        nullable=False, unique=True,
    )
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=False, index=True)
    crop_id = Column(Integer, ForeignKey('crops.id', ondelete='SET NULL'), index=True)
    opened_by = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    status = Column(String(24), nullable=False)
    summary = Column(Text)
    opened_at = Column(DateTime, nullable=False)
    due_at = Column(DateTime)
    resolved_at = Column(DateTime)
    closed_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "status in ('OPEN', 'FOLLOW_UP_SUBMITTED', 'RESOLVED', 'CLOSED')",
            name='ck_case_status',
        ),
        Index('ix_case_farm_status', 'farm_id', 'status'),
    )


class MonitoringFollowup(Base):
    """One recorded check on an open case. Append-only.

    ``symptom_change`` is the farmer's own observation of their own field, in
    their own terms. ``SYMPTOMS_GONE`` is deliberately not called "recovered" or
    "cured": the platform records what was seen, and has no basis for a claim
    about why.

    Follow-ups are never edited or deleted -- a monitoring history that can be
    rewritten is not a history. A mistake is corrected by adding a follow-up.
    """

    __tablename__ = 'monitoring_followups'

    id = Column(Integer, primary_key=True)
    case_id = Column(
        Integer, ForeignKey('monitoring_cases.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    submitted_by = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    observed_at = Column(DateTime, nullable=False)
    symptom_change = Column(String(24), nullable=False)
    notes = Column(Text)
    # Same storage contract as a screening image: a path in the private bucket, or
    # NULL when none was attached. Never a fabricated path.
    image_ref = Column(Text)
    image_hash = Column(String(64))
    next_due_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "symptom_change in ('IMPROVED', 'UNCHANGED', 'WORSENED', 'SYMPTOMS_GONE', 'UNCERTAIN')",
            name='ck_followup_symptom_change',
        ),
        Index('ix_followup_case_observed', 'case_id', 'observed_at'),
    )


class FieldConfirmation(Base):
    """What was actually found on the ground. The only stream that is ground truth.

    Kept rigorously distinct from the two weaker claims it sits above:

    * a **screening** is a model's prediction from an image;
    * an **expert validation** is a qualified human's conclusion about that
      evidence, usually without visiting the field;
    * a **field confirmation** is what someone found by looking at the crop, or
      what a laboratory reported.

    Only this table may enter model evaluation, and only rows with
    ``outcome = 'CONFIRMED'``. `expert_validations` never can: a reviewer judging
    a prediction is not independent evidence of the prediction's correctness.

    ``observation_id`` is UNIQUE. Ground truth about one screening is one fact;
    two competing confirmations would make evaluation arbitrary. A revision
    replaces the row and moves ``updated_at``.

    ``confirmer_role`` records the role at confirmation time, as
    `ExpertValidation` does, because roles change and a conclusion must stay
    interpretable.
    """

    __tablename__ = 'field_confirmations'

    id = Column(Integer, primary_key=True)
    observation_id = Column(
        Integer, ForeignKey('disease_observations.id', ondelete='CASCADE'),
        nullable=False, unique=True,
    )
    case_id = Column(Integer, ForeignKey('monitoring_cases.id', ondelete='SET NULL'), index=True)
    confirmed_by = Column(
        Integer, ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True
    )
    confirmer_role = Column(String(40), nullable=False)
    outcome = Column(String(20), nullable=False)
    confirmed_condition = Column(String(160))
    method = Column(String(30), nullable=False)
    evidence_notes = Column(Text, nullable=False)
    # A laboratory report number, a visit reference -- whatever makes this
    # traceable outside the platform. Never generated.
    source_reference = Column(String(200))
    confirmed_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "outcome in ('CONFIRMED', 'NOT_CONFIRMED', 'UNCERTAIN')",
            name='ck_confirmation_outcome',
        ),
        # Only a CONFIRMED outcome names a condition; the other two conclude that
        # none was established, so a condition would contradict the outcome.
        CheckConstraint(
            "(outcome = 'CONFIRMED' and confirmed_condition is not null) "
            "or (outcome <> 'CONFIRMED' and confirmed_condition is null)",
            name='ck_confirmation_condition_matches_outcome',
        ),
        CheckConstraint(
            "method in ('VISUAL_FIELD_VISIT', 'LABORATORY', 'EXPERT_VISIT')",
            name='ck_confirmation_method',
        ),
        # Ground truth without stated evidence is not ground truth.
        CheckConstraint(
            'length(btrim(evidence_notes)) >= 10', name='ck_confirmation_evidence_required'
        ),
        # Confirming is a field act, so an extension officer and a laboratory may
        # do it as well as an expert. A farmer may not: self-confirmation would
        # make the model's own suggestion its ground truth.
        CheckConstraint(
            "confirmer_role in ('expert', 'extension_officer', 'lab')",
            name='ck_confirmation_confirmer_role',
        ),
    )


class Advisory(Base):
    """One curated, sourced agronomic practice. Never model-generated.

    Every row must cite an authoritative source -- an ICAR institute, a State
    Agricultural University, or an Indian government body -- with a URL and a
    verbatim quote that supports it. This is the same evidentiary bar
    `risk_engine.py` meets by citing UMN Extension.

    ``states_dose`` is false unless the cited source itself gives a dose, and the
    quote contains it. The platform never composes a dose, concentration, brand,
    spray schedule, or pre-harvest interval. A ``chemical`` category exists only
    because some authoritative sources do recommend chemical control; it is never
    the first thing shown.

    ``recommendation`` is the canonical English text. Other languages live in
    `AdvisoryTranslation` and are absent until a human writes them.
    """

    __tablename__ = 'advisories'

    id = Column(Integer, primary_key=True)
    crop = Column(String(120), nullable=False, index=True)
    condition = Column(String(160), nullable=False, index=True)
    condition_kind = Column(String(20), nullable=False)
    category = Column(String(30), nullable=False)
    recommendation = Column(Text, nullable=False)
    source_name = Column(String(200), nullable=False)
    source_url = Column(Text, nullable=False)
    evidence_quote = Column(Text, nullable=False)
    states_dose = Column(Boolean, nullable=False, default=False)
    rule_version = Column(String(20), nullable=False)
    active_from = Column(Date)
    active_to = Column(Date)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("condition_kind in ('disease', 'pest')", name='ck_advisory_condition_kind'),
        CheckConstraint(
            "category in ('monitoring', 'sanitation', 'cultural', 'resistant_variety', "
            "'mechanical', 'biological', 'chemical')",
            name='ck_advisory_category',
        ),
        # No advisory without a citable source behind it.
        CheckConstraint(
            "length(btrim(source_url)) > 0 and length(btrim(evidence_quote)) > 0",
            name='ck_advisory_source_required',
        ),
        UniqueConstraint('crop', 'condition', 'category', 'recommendation', name='uq_advisory_text'),
        Index('ix_advisory_crop_condition', 'crop', 'condition'),
    )


class AdvisoryTranslation(Base):
    """A human translation of one advisory into one language.

    Machine translation is deliberately impossible here: nothing writes this table
    except a curation script carrying human-reviewed text, and `translated_by`
    records which human or published source produced it.

    An absent row is an absent translation. The API says so and falls back to the
    canonical English rather than translating on the fly -- silently
    machine-translating "spray at first symptom" is how agricultural meaning gets
    corrupted between languages.
    """

    __tablename__ = 'advisory_translations'

    id = Column(Integer, primary_key=True)
    advisory_id = Column(
        Integer, ForeignKey('advisories.id', ondelete='CASCADE'), nullable=False, index=True
    )
    language = Column(String(5), nullable=False)
    recommendation = Column(Text, nullable=False)
    translated_by = Column(String(200), nullable=False)
    reviewed_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("language in ('en', 'hi', 'mr')", name='ck_translation_language'),
        UniqueConstraint('advisory_id', 'language', name='uq_translation_advisory_language'),
    )


class Facility(Base):
    """A real, officially-listed extension office, laboratory, or institute.

    Every row cites the official page that lists it. No row is ever composed: no
    invented district office, no invented address, and no invented telephone
    number. Where only a national directory can be verified, the directory itself
    is the row (`kind = 'directory'`), which is honest and still useful.
    """

    __tablename__ = 'facilities'

    id = Column(Integer, primary_key=True)
    name = Column(String(250), nullable=False)
    kind = Column(String(30), nullable=False)
    organisation = Column(String(200))
    state = Column(String(120), index=True)
    district = Column(String(120))
    website = Column(Text)
    source_url = Column(Text, nullable=False)
    note = Column(Text)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "kind in ('extension', 'laboratory', 'research_institute', 'directory')",
            name='ck_facility_kind',
        ),
        CheckConstraint("length(btrim(source_url)) > 0", name='ck_facility_source_required'),
        UniqueConstraint('name', 'source_url', name='uq_facility_name_source'),
    )


class Referral(Base):
    """A case handed to an extension officer or a laboratory.

    A referral is a request for help. It is **never** evidence about the crop: a
    referred case is not a confirmed case, and the API and UI both say so.

    ``facility_id`` is nullable because a farmer may be referred before a specific
    facility is chosen, and because this platform's facility directory is
    deliberately incomplete -- only officially-listed facilities are in it.
    ``facility_note`` carries a free-text destination in that case.
    """

    __tablename__ = 'referrals'

    id = Column(Integer, primary_key=True)
    case_id = Column(
        Integer, ForeignKey('monitoring_cases.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    facility_id = Column(Integer, ForeignKey('facilities.id', ondelete='SET NULL'), index=True)
    facility_note = Column(String(250))
    raised_by = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    kind = Column(String(20), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False)
    outcome_notes = Column(Text)
    requested_at = Column(DateTime)
    referred_at = Column(DateTime)
    completed_at = Column(DateTime)
    cancelled_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("kind in ('extension', 'laboratory')", name='ck_referral_kind'),
        CheckConstraint(
            "status in ('RECOMMENDED', 'REQUESTED', 'REFERRED', 'IN_PROGRESS', "
            "'COMPLETED', 'CANCELLED')",
            name='ck_referral_status',
        ),
        CheckConstraint('length(btrim(reason)) >= 10', name='ck_referral_reason_required'),
        Index('ix_referral_case_status', 'case_id', 'status'),
    )


class NotificationRead(Base):
    """Latest acknowledgement for one derived notification kind."""

    __tablename__ = 'notification_reads'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    kind = Column(String(40), nullable=False)
    read_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "kind in ('high_risk', 'pest_observation', 'followup_due', 'referral_update', 'validation_pending')",
            name='ck_notification_kind',
        ),
        UniqueConstraint('user_id', 'kind', name='uq_notification_user_kind'),
    )


class SensorReading(Base):
    """The ingestion contract for in-field instruments. **No data source exists.**

    This table is the schema half of SIH requirement #3 and nothing more. There is
    deliberately **no write endpoint**: with no real gateway, an ingestion route
    would only ever be a way to inject readings nobody measured, and the risk
    engine already declines to guess when leaf wetness is unknown.

    The unique constraint makes a future ingestion idempotent -- a gateway that
    re-sends a batch cannot double-count it. `quality` and `source` exist because
    a reading with no provenance is not a measurement.

    Documented as a future integration point in backend/docs/EVIDENCE_LIFECYCLE.md.
    """

    __tablename__ = 'sensor_readings'

    id = Column(Integer, primary_key=True)
    device_id = Column(String(120), nullable=False, index=True)
    farm_id = Column(Integer, ForeignKey('farms.id', ondelete='CASCADE'), nullable=False, index=True)
    metric = Column(String(60), nullable=False)
    value = Column(Float, nullable=False)
    unit = Column(String(40), nullable=False)
    observed_at = Column(DateTime, nullable=False)
    quality = Column(String(20), nullable=False, default='unverified')
    source = Column(String(120), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "quality in ('measured', 'estimated', 'suspect', 'unverified')",
            name='ck_sensor_quality',
        ),
        UniqueConstraint('device_id', 'metric', 'observed_at', name='uq_sensor_reading'),
        Index('ix_sensor_farm_metric_time', 'farm_id', 'metric', 'observed_at'),
    )
