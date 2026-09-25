"""Add immutable collection provenance for leakage-safe evaluation.

Existing observations are deliberately left NULL. A collection group represents
one physical specimen or real-world collection event and cannot be reconstructed
honestly from timestamps, filenames, predictions, confidence, or image hashes.

The migration is reversible and changes no existing value. Downgrade removes only
the new index, constraint, and nullable column.
"""
from alembic import op
import sqlalchemy as sa


revision = '0011_collection_group_id'
down_revision = '0010_evidence_lifecycle'


def upgrade():
    op.add_column(
        'disease_observations',
        sa.Column('collection_group_id', sa.String(length=64), nullable=True),
    )
    op.create_check_constraint(
        'ck_disease_obs_collection_group_not_blank',
        'disease_observations',
        'collection_group_id is null or length(btrim(collection_group_id)) > 0',
    )
    op.create_index(
        'ix_disease_obs_collection_group',
        'disease_observations',
        ['collection_group_id'],
    )


def downgrade():
    op.drop_index('ix_disease_obs_collection_group', table_name='disease_observations')
    op.drop_constraint(
        'ck_disease_obs_collection_group_not_blank',
        'disease_observations',
        type_='check',
    )
    op.drop_column('disease_observations', 'collection_group_id')
