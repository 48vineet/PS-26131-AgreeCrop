from alembic import op
import sqlalchemy as sa
revision='0004_risk'; down_revision='0003_weather'
def upgrade():
    op.create_table('disease_risk_rules',sa.Column('id',sa.Integer,primary_key=True),sa.Column('crop',sa.String(120),nullable=False),sa.Column('disease',sa.String(160),nullable=False),sa.Column('rule_version',sa.String(20),nullable=False),sa.Column('source',sa.String(240),nullable=False),sa.Column('source_url',sa.Text,nullable=False),sa.Column('active',sa.Boolean,nullable=False,server_default=sa.true()))
    op.create_table('risk_assessments',sa.Column('id',sa.Integer,primary_key=True),sa.Column('farm_id',sa.Integer,sa.ForeignKey('farms.id',ondelete='CASCADE'),nullable=False),sa.Column('crop_id',sa.Integer,sa.ForeignKey('crops.id',ondelete='CASCADE'),nullable=False),sa.Column('risk_level',sa.String(30),nullable=False),sa.Column('factors',sa.JSON,nullable=False),sa.Column('explanation',sa.Text,nullable=False),sa.Column('calculated_at',sa.DateTime,nullable=False),sa.Column('weather_time',sa.DateTime),sa.Column('weather_source',sa.String(80)),sa.Column('rule_version',sa.String(20)))
def downgrade():
    op.drop_table('risk_assessments'); op.drop_table('disease_risk_rules')
