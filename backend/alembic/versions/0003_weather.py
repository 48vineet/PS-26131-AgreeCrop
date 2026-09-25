from alembic import op
import sqlalchemy as sa
revision='0003_weather'; down_revision='0002_auth_user_id'
def upgrade():
    op.create_table('weather_records',sa.Column('id',sa.Integer,primary_key=True),sa.Column('farm_id',sa.Integer,sa.ForeignKey('farms.id',ondelete='CASCADE'),nullable=False),sa.Column('source',sa.String(80),nullable=False),sa.Column('data_type',sa.String(80),nullable=False),sa.Column('source_url',sa.Text,nullable=False),sa.Column('latitude',sa.Float,nullable=False),sa.Column('longitude',sa.Float,nullable=False),sa.Column('model_time',sa.DateTime,nullable=False),sa.Column('fetched_at',sa.DateTime,nullable=False),sa.Column('payload',sa.Text,nullable=False)); op.create_index('ix_weather_records_farm_id','weather_records',['farm_id'])
def downgrade():
    op.drop_index('ix_weather_records_farm_id',table_name='weather_records'); op.drop_table('weather_records')
