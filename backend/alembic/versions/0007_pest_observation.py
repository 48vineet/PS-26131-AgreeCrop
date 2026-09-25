"""PestObservation — pest-trap and scouting inputs (SIH: pest-trap inputs).

Creates the pest observation stream. Nothing is seeded: every row must be a real
observation somebody actually made, and no public pest-trap API exists for India
to import from (see backend/docs/PRODUCT_ARCHITECTURE.md section 4a).

Reversible: downgrade drops the table and its indexes, touching nothing else.
"""
from alembic import op
import sqlalchemy as sa

revision = '0007_pest_observation'
down_revision = '0006_disease_observation'


def upgrade():
    op.create_table(
        'pest_observations',
        sa.Column('id', sa.Integer, primary_key=True),
        # Required: a trap count without a field is not interpretable.
        sa.Column('farm_id', sa.Integer, sa.ForeignKey('farms.id', ondelete='CASCADE'), nullable=False),
        # Optional, and SET NULL: a trap often monitors the field rather than one
        # crop, and removing a crop must not erase what was observed.
        sa.Column('crop_id', sa.Integer, sa.ForeignKey('crops.id', ondelete='SET NULL')),
        sa.Column('observer_user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        # When it was seen, not when it was typed in.
        sa.Column('observed_at', sa.DateTime, nullable=False),
        sa.Column('method', sa.String(40), nullable=False),
        sa.Column('method_detail', sa.String(120)),
        sa.Column('pest_name', sa.String(160), nullable=False),
        sa.Column('count', sa.Integer),
        sa.Column('unit', sa.String(40), nullable=False),
        sa.Column('trap_id', sa.String(60)),
        sa.Column('latitude', sa.Float),
        sa.Column('longitude', sa.Float),
        sa.Column('notes', sa.Text),
        sa.Column('photo_ref', sa.Text),
        sa.Column('source', sa.String(40), nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint('"count" is null or "count" >= 0', name='ck_pest_obs_count_non_negative'),
        sa.CheckConstraint('latitude is null or latitude between -90 and 90', name='ck_pest_obs_lat'),
        sa.CheckConstraint('longitude is null or longitude between -180 and 180', name='ck_pest_obs_lon'),
    )
    op.create_index('ix_pest_observations_farm_id', 'pest_observations', ['farm_id'])
    op.create_index('ix_pest_observations_crop_id', 'pest_observations', ['crop_id'])
    op.create_index('ix_pest_observations_observer_user_id', 'pest_observations', ['observer_user_id'])
    op.create_index('ix_pest_obs_farm_observed', 'pest_observations', ['farm_id', 'observed_at'])
    op.create_index('ix_pest_obs_observer_observed', 'pest_observations', ['observer_user_id', 'observed_at'])
    # Trap labels are unique per farm, not globally, and are optional.
    op.create_index(
        'ix_pest_obs_farm_trap',
        'pest_observations',
        ['farm_id', 'trap_id'],
        postgresql_where=sa.text('trap_id is not null'),
    )


def downgrade():
    for name in (
        'ix_pest_obs_farm_trap',
        'ix_pest_obs_observer_observed',
        'ix_pest_obs_farm_observed',
        'ix_pest_observations_observer_user_id',
        'ix_pest_observations_crop_id',
        'ix_pest_observations_farm_id',
    ):
        op.drop_index(name, table_name='pest_observations')
    op.drop_table('pest_observations')
