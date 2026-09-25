from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geography
revision='0001_phase1'; down_revision=None
def upgrade():
    op.execute('CREATE EXTENSION IF NOT EXISTS postgis')
    op.create_table('users',sa.Column('id',sa.Integer,primary_key=True),sa.Column('name',sa.String(200),nullable=False),sa.Column('phone',sa.String(40)),sa.Column('email',sa.String(320)),sa.Column('role',sa.String(40),nullable=False),sa.Column('created_at',sa.DateTime),sa.Column('updated_at',sa.DateTime))
    op.create_table('farms',sa.Column('id',sa.Integer,primary_key=True),sa.Column('user_id',sa.Integer,sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('farm_name',sa.String(200),nullable=False),sa.Column('area',sa.Float,nullable=False),sa.Column('area_unit',sa.String(20),nullable=False),sa.Column('created_at',sa.DateTime),sa.Column('updated_at',sa.DateTime),sa.CheckConstraint('area > 0',name='ck_farm_area_positive'))
    op.create_table('farm_locations',sa.Column('id',sa.Integer,primary_key=True),sa.Column('farm_id',sa.Integer,sa.ForeignKey('farms.id',ondelete='CASCADE'),nullable=False),sa.Column('latitude',sa.Float,nullable=False),sa.Column('longitude',sa.Float,nullable=False),sa.Column('address',sa.Text),sa.Column('village',sa.String(120)),sa.Column('district',sa.String(120)),sa.Column('state',sa.String(120)),sa.Column('postal_code',sa.String(20)),sa.Column('point',Geography('POINT',srid=4326)),sa.CheckConstraint('latitude between -90 and 90',name='ck_lat'),sa.CheckConstraint('longitude between -180 and 180',name='ck_lon'))
    op.create_index('ix_farm_locations_point','farm_locations',['point'],postgresql_using='gist')
    op.create_table('crops',sa.Column('id',sa.Integer,primary_key=True),sa.Column('farm_id',sa.Integer,sa.ForeignKey('farms.id',ondelete='CASCADE'),nullable=False),sa.Column('crop_name',sa.String(120),nullable=False),sa.Column('variety',sa.String(120)),sa.Column('sowing_date',sa.Date),sa.Column('transplanting_date',sa.Date),sa.Column('current_stage',sa.String(80)),sa.Column('archived_at',sa.DateTime),sa.Column('created_at',sa.DateTime),sa.Column('updated_at',sa.DateTime))
def downgrade():
    for t in ('crops','farm_locations','farms','users'): op.drop_table(t)
