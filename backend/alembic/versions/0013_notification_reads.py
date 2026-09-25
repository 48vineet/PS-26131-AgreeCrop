"""Persist per-user acknowledgement state for derived in-app notifications."""

from alembic import op
import sqlalchemy as sa


revision = '0013_notification_reads'
down_revision = '0012_ai_pest_observation_metadata'


def upgrade():
    op.create_table(
        'notification_reads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(length=40), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'kind', name='uq_notification_user_kind'),
        sa.CheckConstraint(
            "kind in ('high_risk', 'pest_observation', 'followup_due', 'referral_update', 'validation_pending')",
            name='ck_notification_kind',
        ),
    )


def downgrade():
    op.drop_table('notification_reads')
