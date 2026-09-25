"""DiseaseObservation — persistence for image screenings (SIH #1).

Creates the first table of the disease-observation stream. Nothing is
backfilled: screenings taken before this migration were never stored, and
inventing rows for them would fabricate evidence.

``validation_id`` is created without a foreign key because ``expert_validations``
does not exist yet; the Expert Review phase adds the constraint.
"""
from alembic import op
import sqlalchemy as sa

revision = '0006_disease_observation'
down_revision = '0005_risk_phase5'


def upgrade():
    op.create_table(
        'disease_observations',
        sa.Column('id', sa.Integer, primary_key=True),
        # SET NULL, not CASCADE: a screening is complete without farm context,
        # so deleting a farm must not erase the screenings taken there.
        sa.Column('farm_id', sa.Integer, sa.ForeignKey('farms.id', ondelete='SET NULL')),
        sa.Column('crop_id', sa.Integer, sa.ForeignKey('crops.id', ondelete='SET NULL')),
        sa.Column('submitted_by', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('image_ref', sa.Text),
        sa.Column('image_hash', sa.String(64), nullable=False),
        sa.Column('model_version', sa.String(120), nullable=False),
        sa.Column('predicted_class', sa.String(160), nullable=False),
        sa.Column('confidence', sa.Float, nullable=False),
        sa.Column('top_predictions', sa.JSON, nullable=False),
        sa.Column('screened_at', sa.DateTime, nullable=False),
        sa.Column('latitude', sa.Float),
        sa.Column('longitude', sa.Float),
        sa.Column('validation_id', sa.Integer),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.CheckConstraint('latitude is null or latitude between -90 and 90', name='ck_disease_obs_lat'),
        sa.CheckConstraint('longitude is null or longitude between -180 and 180', name='ck_disease_obs_lon'),
        sa.CheckConstraint('confidence between 0 and 100', name='ck_disease_obs_confidence'),
    )
    op.create_index('ix_disease_observations_farm_id', 'disease_observations', ['farm_id'])
    op.create_index('ix_disease_observations_crop_id', 'disease_observations', ['crop_id'])
    op.create_index('ix_disease_observations_submitted_by', 'disease_observations', ['submitted_by'])
    op.create_index('ix_disease_obs_submitter_time', 'disease_observations', ['submitted_by', 'screened_at'])


def downgrade():
    for name in (
        'ix_disease_obs_submitter_time',
        'ix_disease_observations_submitted_by',
        'ix_disease_observations_crop_id',
        'ix_disease_observations_farm_id',
    ):
        op.drop_index(name, table_name='disease_observations')
    op.drop_table('disease_observations')
