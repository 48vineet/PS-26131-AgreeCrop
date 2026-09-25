"""The evidence lifecycle: monitoring, field confirmation, advisories, referrals.

Creates seven tables and adds two small groups of columns. Documented in
backend/docs/EVIDENCE_LIFECYCLE.md.

**What this completes.** Phases 6-9 built image screening, expert validation, and
geospatial surveillance. The chain stopped at a reviewer's opinion. This migration
adds the rest of it: a case to watch, follow-ups on that case, ground truth when
somebody actually looks at the crop, and the sourced guidance and referral paths a
farmer needs in between.

**Consent is two questions, not one.** `image_consent_review` and
`image_consent_training` are separate columns because they ask different things of
a farmer. Review consent helps *them*; training consent helps everyone else and
cannot meaningfully be withdrawn once a model has learned from the image. Neither
defaults to true and NULL means "not asked". Nothing in the codebase reads the
training flag -- there is no training pipeline consuming stored images, and this
column exists so that when one is built it cannot quietly skip the question.

**Ground truth is scarce and stays scarce.** `field_confirmations.observation_id`
is UNIQUE and a check constraint restricts `confirmer_role` to expert, extension
officer, or laboratory. A farmer cannot confirm their own screening: that would
make the model's own suggestion its ground truth, and any accuracy figure computed
from it would be circular.

**`sensor_readings` has no write path.** It is the schema half of SIH #3. With no
real gateway, an ingestion endpoint would only be a way to insert readings nobody
measured.

**FOLLOW_UP_DUE is not stored.** `monitoring_cases.status` records what a human
did; "due" is what OPEN means once `due_at` has passed, and is derived on read. A
stored value would need a scheduler and would be wrong whenever that scheduler
failed.

Reversible. `downgrade` drops the seven tables in dependency order and removes the
added columns. No existing row in any table is read, written, or deleted in either
direction.
"""
from alembic import op
import sqlalchemy as sa

revision = '0010_evidence_lifecycle'
down_revision = '0009_expert_validation'

CASE_STATUSES = "'OPEN', 'FOLLOW_UP_SUBMITTED', 'RESOLVED', 'CLOSED'"
SYMPTOM_CHANGES = "'IMPROVED', 'UNCHANGED', 'WORSENED', 'SYMPTOMS_GONE', 'UNCERTAIN'"
ADVISORY_CATEGORIES = (
    "'monitoring', 'sanitation', 'cultural', 'resistant_variety', "
    "'mechanical', 'biological', 'chemical'"
)
REFERRAL_STATUSES = (
    "'RECOMMENDED', 'REQUESTED', 'REFERRED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'"
)

# Dropped by downgrade in this order: children before parents.
TABLES = (
    'sensor_readings',
    'referrals',
    'facilities',
    'advisory_translations',
    'advisories',
    'field_confirmations',
    'monitoring_followups',
    'monitoring_cases',
)

ADDED_COLUMNS = (
    ('disease_observations', 'image_consent_review'),
    ('disease_observations', 'image_consent_training'),
    ('disease_observations', 'image_consent_at'),
    ('disease_observations', 'image_retention_until'),
    ('disease_observations', 'image_deleted_at'),
    ('users', 'language'),
)


def upgrade():
    # ── Image consent and retention, on the screening the image belongs to ──
    op.add_column('disease_observations', sa.Column('image_consent_review', sa.Boolean))
    op.add_column('disease_observations', sa.Column('image_consent_training', sa.Boolean))
    op.add_column('disease_observations', sa.Column('image_consent_at', sa.DateTime))
    op.add_column('disease_observations', sa.Column('image_retention_until', sa.DateTime))
    op.add_column('disease_observations', sa.Column('image_deleted_at', sa.DateTime))

    # ── Language preference. Defaulted for existing rows, then made NOT NULL. ──
    op.add_column(
        'users',
        sa.Column('language', sa.String(5), nullable=False, server_default='en'),
    )

    # ── Monitoring ─────────────────────────────────────────────────────────
    op.create_table(
        'monitoring_cases',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'observation_id', sa.Integer,
            sa.ForeignKey('disease_observations.id', ondelete='CASCADE'),
            nullable=False, unique=True,
        ),
        sa.Column('farm_id', sa.Integer, sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('crop_id', sa.Integer, sa.ForeignKey('crops.id', ondelete='SET NULL')),
        sa.Column('opened_by', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('summary', sa.Text),
        sa.Column('opened_at', sa.DateTime, nullable=False),
        sa.Column('due_at', sa.DateTime),
        sa.Column('resolved_at', sa.DateTime),
        sa.Column('closed_at', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint(f'status in ({CASE_STATUSES})', name='ck_case_status'),
    )
    op.create_index('ix_monitoring_cases_farm_id', 'monitoring_cases', ['farm_id'])
    op.create_index('ix_monitoring_cases_crop_id', 'monitoring_cases', ['crop_id'])
    op.create_index('ix_monitoring_cases_opened_by', 'monitoring_cases', ['opened_by'])
    op.create_index('ix_case_farm_status', 'monitoring_cases', ['farm_id', 'status'])

    op.create_table(
        'monitoring_followups',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'case_id', sa.Integer,
            sa.ForeignKey('monitoring_cases.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('submitted_by', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('observed_at', sa.DateTime, nullable=False),
        sa.Column('symptom_change', sa.String(24), nullable=False),
        sa.Column('notes', sa.Text),
        sa.Column('image_ref', sa.Text),
        sa.Column('image_hash', sa.String(64)),
        sa.Column('next_due_at', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.CheckConstraint(
            f'symptom_change in ({SYMPTOM_CHANGES})', name='ck_followup_symptom_change'
        ),
    )
    op.create_index('ix_monitoring_followups_case_id', 'monitoring_followups', ['case_id'])
    op.create_index('ix_followup_case_observed', 'monitoring_followups', ['case_id', 'observed_at'])

    # ── Field confirmation: the only ground truth ──────────────────────────
    op.create_table(
        'field_confirmations',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'observation_id', sa.Integer,
            sa.ForeignKey('disease_observations.id', ondelete='CASCADE'),
            nullable=False, unique=True,
        ),
        sa.Column('case_id', sa.Integer, sa.ForeignKey('monitoring_cases.id', ondelete='SET NULL')),
        sa.Column(
            'confirmed_by', sa.Integer,
            sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False,
        ),
        sa.Column('confirmer_role', sa.String(40), nullable=False),
        sa.Column('outcome', sa.String(20), nullable=False),
        sa.Column('confirmed_condition', sa.String(160)),
        sa.Column('method', sa.String(30), nullable=False),
        sa.Column('evidence_notes', sa.Text, nullable=False),
        sa.Column('source_reference', sa.String(200)),
        sa.Column('confirmed_at', sa.DateTime, nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint(
            "outcome in ('CONFIRMED', 'NOT_CONFIRMED', 'UNCERTAIN')",
            name='ck_confirmation_outcome',
        ),
        sa.CheckConstraint(
            "(outcome = 'CONFIRMED' and confirmed_condition is not null) "
            "or (outcome <> 'CONFIRMED' and confirmed_condition is null)",
            name='ck_confirmation_condition_matches_outcome',
        ),
        sa.CheckConstraint(
            "method in ('VISUAL_FIELD_VISIT', 'LABORATORY', 'EXPERT_VISIT')",
            name='ck_confirmation_method',
        ),
        sa.CheckConstraint(
            'length(btrim(evidence_notes)) >= 10', name='ck_confirmation_evidence_required'
        ),
        sa.CheckConstraint(
            "confirmer_role in ('expert', 'extension_officer', 'lab')",
            name='ck_confirmation_confirmer_role',
        ),
    )
    op.create_index('ix_field_confirmations_case_id', 'field_confirmations', ['case_id'])
    op.create_index('ix_field_confirmations_confirmed_by', 'field_confirmations', ['confirmed_by'])

    # ── Advisories: curated, sourced, never generated ──────────────────────
    op.create_table(
        'advisories',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('crop', sa.String(120), nullable=False),
        sa.Column('condition', sa.String(160), nullable=False),
        sa.Column('condition_kind', sa.String(20), nullable=False),
        sa.Column('category', sa.String(30), nullable=False),
        sa.Column('recommendation', sa.Text, nullable=False),
        sa.Column('source_name', sa.String(200), nullable=False),
        sa.Column('source_url', sa.Text, nullable=False),
        sa.Column('evidence_quote', sa.Text, nullable=False),
        sa.Column('states_dose', sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column('rule_version', sa.String(20), nullable=False),
        sa.Column('active_from', sa.Date),
        sa.Column('active_to', sa.Date),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint(
            "condition_kind in ('disease', 'pest')", name='ck_advisory_condition_kind'
        ),
        sa.CheckConstraint(f'category in ({ADVISORY_CATEGORIES})', name='ck_advisory_category'),
        sa.CheckConstraint(
            'length(btrim(source_url)) > 0 and length(btrim(evidence_quote)) > 0',
            name='ck_advisory_source_required',
        ),
        sa.UniqueConstraint('crop', 'condition', 'category', 'recommendation', name='uq_advisory_text'),
    )
    op.create_index('ix_advisories_crop', 'advisories', ['crop'])
    op.create_index('ix_advisories_condition', 'advisories', ['condition'])
    op.create_index('ix_advisory_crop_condition', 'advisories', ['crop', 'condition'])

    op.create_table(
        'advisory_translations',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'advisory_id', sa.Integer,
            sa.ForeignKey('advisories.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('language', sa.String(5), nullable=False),
        sa.Column('recommendation', sa.Text, nullable=False),
        sa.Column('translated_by', sa.String(200), nullable=False),
        sa.Column('reviewed_by', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint("language in ('en', 'hi', 'mr')", name='ck_translation_language'),
        sa.UniqueConstraint('advisory_id', 'language', name='uq_translation_advisory_language'),
    )
    op.create_index('ix_advisory_translations_advisory_id', 'advisory_translations', ['advisory_id'])

    # ── Facilities and referrals ───────────────────────────────────────────
    op.create_table(
        'facilities',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('name', sa.String(250), nullable=False),
        sa.Column('kind', sa.String(30), nullable=False),
        sa.Column('organisation', sa.String(200)),
        sa.Column('state', sa.String(120)),
        sa.Column('district', sa.String(120)),
        sa.Column('website', sa.Text),
        sa.Column('source_url', sa.Text, nullable=False),
        sa.Column('note', sa.Text),
        sa.Column('active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint(
            "kind in ('extension', 'laboratory', 'research_institute', 'directory')",
            name='ck_facility_kind',
        ),
        sa.CheckConstraint('length(btrim(source_url)) > 0', name='ck_facility_source_required'),
        sa.UniqueConstraint('name', 'source_url', name='uq_facility_name_source'),
    )
    op.create_index('ix_facilities_state', 'facilities', ['state'])

    op.create_table(
        'referrals',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'case_id', sa.Integer,
            sa.ForeignKey('monitoring_cases.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('facility_id', sa.Integer, sa.ForeignKey('facilities.id', ondelete='SET NULL')),
        sa.Column('facility_note', sa.String(250)),
        sa.Column('raised_by', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('outcome_notes', sa.Text),
        sa.Column('requested_at', sa.DateTime),
        sa.Column('referred_at', sa.DateTime),
        sa.Column('completed_at', sa.DateTime),
        sa.Column('cancelled_at', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint("kind in ('extension', 'laboratory')", name='ck_referral_kind'),
        sa.CheckConstraint(f'status in ({REFERRAL_STATUSES})', name='ck_referral_status'),
        sa.CheckConstraint('length(btrim(reason)) >= 10', name='ck_referral_reason_required'),
    )
    op.create_index('ix_referrals_case_id', 'referrals', ['case_id'])
    op.create_index('ix_referrals_facility_id', 'referrals', ['facility_id'])
    op.create_index('ix_referral_case_status', 'referrals', ['case_id', 'status'])

    # ── Sensor ingestion contract. Schema only; no write endpoint exists. ──
    op.create_table(
        'sensor_readings',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('device_id', sa.String(120), nullable=False),
        sa.Column('farm_id', sa.Integer, sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('metric', sa.String(60), nullable=False),
        sa.Column('value', sa.Float, nullable=False),
        sa.Column('unit', sa.String(40), nullable=False),
        sa.Column('observed_at', sa.DateTime, nullable=False),
        sa.Column('quality', sa.String(20), nullable=False, server_default='unverified'),
        sa.Column('source', sa.String(120), nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.CheckConstraint(
            "quality in ('measured', 'estimated', 'suspect', 'unverified')",
            name='ck_sensor_quality',
        ),
        sa.UniqueConstraint('device_id', 'metric', 'observed_at', name='uq_sensor_reading'),
    )
    op.create_index('ix_sensor_readings_device_id', 'sensor_readings', ['device_id'])
    op.create_index('ix_sensor_readings_farm_id', 'sensor_readings', ['farm_id'])
    op.create_index('ix_sensor_farm_metric_time', 'sensor_readings', ['farm_id', 'metric', 'observed_at'])


def downgrade():
    for table in TABLES:
        op.drop_table(table)
    for table, column in ADDED_COLUMNS:
        op.drop_column(table, column)
