"""Give a located observation a real PostGIS point, and index it.

`disease_observations` and `pest_observations` already store `latitude` /
`longitude` as checked doubles, and those columns stay the source of truth --
they are what the API accepts, validates, and returns. This migration adds the
*spatial* representation the geospatial layer needs to do spatial work:
clustering, projection, and geodesic distance, computed by PostGIS rather than
by hand-rolled trigonometry in Python.

Three decisions worth stating.

**Generated, not written.** `point` is `GENERATED ALWAYS AS ... STORED`, derived
from the two coordinate columns. It therefore cannot drift from them, no
application code has to remember to populate it, and no backfill can be missed.
A NULL position stays NULL: the `CASE` yields NULL when either coordinate is
absent, so an observation with no recorded position gets no point rather than a
point at (0, 0) off the coast of Ghana.

**SRID 4326.** WGS84, matching `farm_locations.point` from 0001 and the
coordinates the API already accepts. `geography` rather than `geometry` so that
`ST_Distance` returns metres on the ellipsoid without a projection step; the
clustering path projects to a local azimuthal-equidistant CRS explicitly, where
planar geometry is required.

**Partial GiST index.** Spatial predicates only ever ask about rows that have a
position, and most rows today do not, so the index carries `WHERE point IS NOT
NULL`. Honest note: at current row counts the planner will sequential-scan these
tables regardless -- the index is here because a geography column that spatial
predicates read should be spatially indexed, not because it changes a plan
today.

`ix_disease_obs_farm_screened` is a plain btree, added for parity with
`ix_pest_obs_farm_observed` from 0007. It matches how both the map and the
cluster query actually filter: farm scope first, then a time window.

Reversible: `downgrade` drops the indexes and the generated columns and leaves
`latitude` / `longitude` untouched, so no observation data can be lost either
way.
"""
from alembic import op

revision = '0008_observation_geometry'
down_revision = '0007_pest_observation'

# (table, spatial index name)
SPATIAL = (
    ('disease_observations', 'ix_disease_observations_point'),
    ('pest_observations', 'ix_pest_observations_point'),
)


def upgrade():
    for table, index in SPATIAL:
        op.execute(
            f'ALTER TABLE {table} ADD COLUMN point geography(Point, 4326) '
            'GENERATED ALWAYS AS ('
            '  CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL '
            '       THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography '
            '  END'
            ') STORED'
        )
        op.execute(
            f'CREATE INDEX {index} ON {table} USING gist (point) WHERE point IS NOT NULL'
        )
    op.execute(
        'CREATE INDEX ix_disease_obs_farm_screened '
        'ON disease_observations (farm_id, screened_at)'
    )


def downgrade():
    op.execute('DROP INDEX IF EXISTS ix_disease_obs_farm_screened')
    for table, index in SPATIAL:
        op.execute(f'DROP INDEX IF EXISTS {index}')
        op.execute(f'ALTER TABLE {table} DROP COLUMN IF EXISTS point')
