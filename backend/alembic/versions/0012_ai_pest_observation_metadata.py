"""Add nullable provenance metadata for confirmed AI pest observations.

Historical manual observations are left untouched. The JSON value is intentionally
nullable and stores only normalized provider metadata and farmer confirmation facts.
"""
from alembic import op
import sqlalchemy as sa


revision = '0012_ai_pest_observation_metadata'
down_revision = '0011_collection_group_id'


def upgrade():
    op.add_column(
        'pest_observations',
        sa.Column('ai_metadata', sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_column('pest_observations', 'ai_metadata')
