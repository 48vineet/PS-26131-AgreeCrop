"""Periodic deletion of screening images whose recorded retention has expired."""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import text

from database import SessionLocal, engine
from image_store import expired_images, purge_image, store_configured

logger = logging.getLogger(__name__)

# Access already stops at the exact retention deadline. The hourly sweep bounds
# how long an expired object may remain pending physical deletion.
RETENTION_PURGE_INTERVAL_SECONDS = 60 * 60

# A session-level PostgreSQL advisory lock prevents duplicate work when uvicorn
# runs multiple workers. The lock is automatically released if a worker exits.
RETENTION_PURGE_LOCK_KEY = 0x43524F50494D4750


def run_retention_purge_once(now: datetime | None = None) -> dict:
    """Delete one snapshot of expired images, once across all API workers."""
    if not store_configured():
        return {'status': 'storage_unconfigured', 'selected': 0, 'deleted': 0, 'failed': 0}

    with engine.connect() as lock_connection:
        acquired = bool(
            lock_connection.execute(
                text('SELECT pg_try_advisory_lock(:lock_key)'),
                {'lock_key': RETENTION_PURGE_LOCK_KEY},
            ).scalar_one()
        )
        if not acquired:
            return {'status': 'already_running', 'selected': 0, 'deleted': 0, 'failed': 0}

        try:
            db = SessionLocal()
            try:
                observations = expired_images(db, now=now)
                deleted = 0
                failed = 0
                for observation in observations:
                    if purge_image(db, observation):
                        deleted += 1
                    else:
                        failed += 1
                logger.info(
                    'Screening image retention purge completed: selected=%s deleted=%s failed=%s',
                    len(observations), deleted, failed,
                )
                return {
                    'status': 'completed',
                    'selected': len(observations),
                    'deleted': deleted,
                    'failed': failed,
                }
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        finally:
            lock_connection.execute(
                text('SELECT pg_advisory_unlock(:lock_key)'),
                {'lock_key': RETENTION_PURGE_LOCK_KEY},
            )


async def retention_purge_worker(
    stop_event: asyncio.Event,
    interval_seconds: float = RETENTION_PURGE_INTERVAL_SECONDS,
) -> None:
    """Run the purge at startup and periodically until application shutdown."""
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(run_retention_purge_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('Screening image retention purge failed')

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue

