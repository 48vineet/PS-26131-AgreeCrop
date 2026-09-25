"""Indexes to support duplicate-hash and daily-cap abuse checks on screenings."""

from alembic import op


revision = '0014_screening_abuse_indexes'
down_revision = '0013_notification_reads'


def upgrade():
    # Duplicate-hash lookback: find existing screenings with the same image.
    op.create_index(
        'ix_disease_observations_image_hash',
        'disease_observations',
        ['image_hash'],
    )
    # Daily pending-cap: count unreviewed scans per user within a time window.
    op.create_index(
        'ix_disease_observations_submitted_by_screened_at',
        'disease_observations',
        ['submitted_by', 'screened_at'],
    )


def downgrade():
    op.drop_index('ix_disease_observations_submitted_by_screened_at', table_name='disease_observations')
    op.drop_index('ix_disease_observations_image_hash', table_name='disease_observations')
