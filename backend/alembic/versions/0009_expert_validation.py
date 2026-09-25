"""Expert validation: the review layer over image screenings.

Creates ``expert_validations`` and drops the vestigial
``disease_observations.validation_id``.

**Why the column goes.** Phase 6 (0006) left ``validation_id`` in place as a
planned pointer from a screening to its review, noting that "the constraint is
added by the Expert Review phase". Building that phase settled the shape:
``expert_validations.observation_id`` is UNIQUE, which already gives every
screening at most one review and makes the reverse pointer redundant. Two
mutually-referencing foreign keys for a one-to-one relationship are a drift
hazard and nothing else -- there is no query the pair answers that the single
constraint does not. The column is NULL in every existing row, so no information
is lost, and ``downgrade`` restores it (as a plain nullable integer, exactly as
0006 declared it).

**Why there is no PENDING row.** A screening with no row in this table has not
been reviewed. Storing ``PENDING`` explicitly would mean backfilling every
existing screening, would let a stored status disagree with reality, and would
blur two different things: a queue position, and a reviewer's finding that the
evidence is insufficient (which is ``NEEDS_REVIEW``).

**Delete behaviour is deliberately asymmetric.** ``observation_id`` cascades: a
review of a screening that no longer exists reviews nothing. ``reviewer_id``
restricts: an account that has recorded conclusions about other people's evidence
cannot be deleted out from under them.

**Constraints carry the semantics.** The status vocabulary, the rule that only
``VALIDATED`` names a condition, the requirement that a rejection or escalation
states a reason, and the restriction of conclusions to reviewing roles are all
enforced here as well as in ``expert_validation.py``. A future script or console
session cannot write a row that contradicts the documented meaning.

Reversible. ``downgrade`` drops the table and restores the column; no screening,
weather record, risk assessment, pest observation, farm, or location is touched
in either direction.
"""
from alembic import op
import sqlalchemy as sa

revision = '0009_expert_validation'
down_revision = '0008_observation_geometry'


def upgrade():
    op.create_table(
        'expert_validations',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'observation_id', sa.Integer,
            sa.ForeignKey('disease_observations.id', ondelete='CASCADE'),
            nullable=False, unique=True,
        ),
        sa.Column(
            'reviewer_id', sa.Integer,
            sa.ForeignKey('users.id', ondelete='RESTRICT'),
            nullable=False,
        ),
        sa.Column('reviewer_role', sa.String(40), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('validated_class', sa.String(160)),
        sa.Column('review_notes', sa.Text),
        sa.Column('agrees_with_model', sa.Boolean),
        sa.Column('reviewed_at', sa.DateTime, nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint(
            "status in ('VALIDATED', 'REJECTED', 'NEEDS_REVIEW')",
            name='ck_expert_validation_status',
        ),
        sa.CheckConstraint(
            "(status = 'VALIDATED' and validated_class is not null) "
            "or (status <> 'VALIDATED' and validated_class is null)",
            name='ck_expert_validation_class_matches_status',
        ),
        sa.CheckConstraint(
            "status = 'VALIDATED' "
            "or (review_notes is not null and length(btrim(review_notes)) >= 10)",
            name='ck_expert_validation_reason_required',
        ),
        sa.CheckConstraint(
            "reviewer_role in ('expert', 'extension_officer')",
            name='ck_expert_validation_reviewer_role',
        ),
    )
    op.create_index('ix_expert_validations_reviewer_id', 'expert_validations', ['reviewer_id'])
    op.create_index(
        'ix_expert_validation_status_time', 'expert_validations', ['status', 'reviewed_at']
    )
    # Redundant now that observation_id is UNIQUE. NULL in every existing row.
    op.drop_column('disease_observations', 'validation_id')


def downgrade():
    op.add_column('disease_observations', sa.Column('validation_id', sa.Integer))
    op.drop_index('ix_expert_validation_status_time', table_name='expert_validations')
    op.drop_index('ix_expert_validations_reviewer_id', table_name='expert_validations')
    op.drop_table('expert_validations')
