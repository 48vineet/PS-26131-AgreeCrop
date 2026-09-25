from alembic import op
import sqlalchemy as sa
revision='0005_risk_phase5'; down_revision='0004_risk'
def upgrade():
    op.add_column('risk_assessments',sa.Column('assessment_type',sa.String(20),nullable=False,server_default='current')); op.add_column('risk_assessments',sa.Column('disease',sa.String(160))); op.add_column('risk_assessments',sa.Column('weather_period',sa.String(160))); op.add_column('risk_assessments',sa.Column('weather_timestamp',sa.DateTime))
def downgrade():
    for c in ['weather_timestamp','weather_period','disease','assessment_type']: op.drop_column('risk_assessments',c)
