from alembic import op
import sqlalchemy as sa
revision='0002_auth_user_id'; down_revision='0001_phase1'
def upgrade():
    op.add_column('users', sa.Column('auth_user_id', sa.String(64), nullable=True))
    op.create_index('ix_users_auth_user_id', 'users', ['auth_user_id'], unique=True)
def downgrade():
    op.drop_index('ix_users_auth_user_id', table_name='users'); op.drop_column('users','auth_user_id')
