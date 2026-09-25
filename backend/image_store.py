"""Private image storage and image consent for screenings (SIH #7).

Expert review is the platform's only route from a machine guess to a human
conclusion, and until now a reviewer could not see the photograph. `POST /predict`
hashed the bytes and threw them away, so `review_context` had to say so in words:
*the platform has no image store, so the submitted photograph cannot be shown.*
This module is the store that sentence was waiting for.

Three decisions shape the whole file.

**Inert until an operator turns it on.** This deployment has no Supabase
service-role key -- only the publishable key the browser uses, which cannot write
to a private bucket. Rather than pretend, or invent a local directory that would
not survive a redeploy, every function here checks `store_configured()` first and
returns ``None`` / ``False`` when it is not. The code path is complete and
correct; it simply does nothing until the Supabase URL, service-role key, and
`SUPABASE_STORAGE_BUCKET=screenings` exist in backend/.env. Nothing claims an image
is available when it is not.

**Storage is subordinate to screening.** `record_screening` already swallows
database faults rather than turning a completed prediction into a 500, and the
same rule holds here: a failed, refused, or unconfigured upload leaves `image_ref`
NULL, logs, and reports that nothing was stored. A screening that succeeded must
never become an error because object storage was down.

**Consent is two questions.** Review consent is what makes an image storable at
all: without it there is no upload, and the screening is still recorded -- just
without a photograph. Training consent is a separate, independent decision about
whether the image may become a labelled example for a future model, which benefits
other people and cannot be taken back once a model has learned from it. The
leakage-safe evaluation/export layer now reads `image_consent_training` only to
exclude anything except explicit consent. It does not download an image, build a
training dataset, or train a model.

Object paths are random: ``evidence/<256-bit-token>.<ext>`` inside the private
``screenings`` bucket. The key carries no farmer, farm, date, filename, or image
digest, and cannot be guessed from database metadata. The separate
`disease_observations.image_hash` remains the SHA-256 of the exact bytes screened.
That correspondence is *checked*, not assumed: bytes whose SHA-256 is not the
screening's `image_hash` are refused before anything is written, because a
different photograph must never be shown as the evidence the model inspected.

Retention defaults to 90 days (`IMAGE_RETENTION_DAYS`). That is long enough for a
reviewer to reach the queue and for one monitoring follow-up cycle to close, and
short enough that the platform does not become an indefinite archive of farmers'
field photographs. It is a deliberately conservative figure: the images are of
someone else's land, held to help them, and the default should expire on its own
rather than depend on anyone remembering to clean up.
"""
import hashlib
import io
import json
import logging
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models_db import DiseaseObservation

logger = logging.getLogger(__name__)

# database.py loads this same file at import; repeating it keeps image_store
# usable when imported on its own (a retention sweep, a shell session) and is
# harmless because python-dotenv does not overwrite variables already set.
load_dotenv(Path(__file__).with_name('.env'))


# -- Limits ----------------------------------------------------------------
# Identical to the limits `POST /predict` already enforces on the upload. They
# are restated rather than imported because main.py is the caller, not the
# authority: the store must refuse oversized or non-image bytes even if some
# future caller forgets to check first.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Content type to file extension. The extension is cosmetic, but a wrong one
# would mislead an operator inspecting the private bucket.
ALLOWED_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}

STORAGE_BUCKET = 'screenings'
OBJECT_PREFIX = 'evidence'

# Signed URLs are short-lived because they are bearer credentials: anyone holding
# one can fetch the photograph without authenticating. Five minutes is enough to
# render an image in a review screen; fifteen is the most this module will mint.
DEFAULT_SIGNED_URL_TTL = 300
MIN_SIGNED_URL_TTL = 30
MAX_SIGNED_URL_TTL = 900

DEFAULT_RETENTION_DAYS = 90

# Storage is a side quest for every request that touches it, so it never waits
# long. A slow bucket must not hold a screening response open.
STORE_TIMEOUT_SECONDS = 10.0


# -- Reasons ---------------------------------------------------------------
# Every "no image" answer names its own cause, because "unavailable" alone tells
# a reviewer nothing about whether to escalate, wait, or record NEEDS_REVIEW.
REASON_UNCONFIGURED = (
    'Image storage is not configured on this deployment, so no photograph was '
    'retained for this screening and none can be shown. The screening itself is '
    'complete; there is simply no stored file.'
)
REASON_NO_IMAGE = (
    'No photograph is stored for this screening. It may have been submitted before '
    'image storage existed, the consent question may never have been put, or the '
    'upload may not have completed. The screening itself is complete.'
)
REASON_CONSENT_WITHDRAWN = (
    'The farmer withdrew consent for this photograph, so it is not shown to '
    'anyone. Any conclusion recorded from it earlier stands on its own record.'
)
REASON_SIGNING_FAILED = (
    'A photograph is stored for this screening, but the storage service did not '
    'return a link for it. This is a temporary fault, not a missing image.'
)
REASON_NO_CONSENT = (
    'The farmer did not consent to the photograph being stored for review, so it '
    'was discarded. The screening was still recorded.'
)
REASON_UPLOAD_FAILED = (
    'The photograph could not be stored because the storage service did not '
    'accept it. The screening was still recorded.'
)
REASON_REJECTED_BYTES = (
    'The photograph was not stored because it is not an accepted image type or '
    'exceeds the size limit. The screening was still recorded.'
)
REASON_RETENTION_EXPIRED = (
    'The photograph reached the end of its retention period and was deleted, so it '
    'can no longer be shown. The screening, and any review recorded while the image '
    'was still available, stand exactly as recorded.'
)
REASON_CONSENT_UNRECORDED = (
    'A photograph is stored for this screening, but no record exists of the farmer '
    'agreeing to have it reviewed, so it is not shown. Consent has to be on record '
    'before anyone is shown a photograph taken in a field that is not theirs.'
)
REASON_HASH_MISMATCH = (
    'The photograph offered for storage is not the one that was screened -- its '
    'SHA-256 does not match the screening record -- so it was not stored. The '
    'screening was still recorded.'
)


# -- Configuration ---------------------------------------------------------

def _env(name: str) -> str | None:
    """A set, non-blank environment variable, or None.

    Read on every call rather than captured at import, so an operator adding the
    key does not need a code change and a test can substitute one.
    """
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _service_key() -> str | None:
    """The service-role key. Private by name and never returned or logged.

    It bypasses row-level security on the bucket, so it exists in exactly one
    place: the Authorization header this module builds. It is never put in a
    response body, a log line, or an exception message.
    """
    return _env('SUPABASE_SERVICE_ROLE_KEY')


def _bucket() -> str | None:
    configured = _env('SUPABASE_STORAGE_BUCKET')
    if configured is None:
        return None
    if configured != STORAGE_BUCKET:
        logger.warning(
            'Ignoring SUPABASE_STORAGE_BUCKET: private screening images must use %s',
            STORAGE_BUCKET,
        )
        return None
    return configured


def _base_url() -> str | None:
    """The Supabase project URL, without a trailing slash.

    `SUPABASE_URL` wins if an operator sets a backend-only name, but the project
    URL is not a secret and `NEXT_PUBLIC_SUPABASE_URL` is already in backend/.env,
    so it is accepted as the fallback rather than made a second thing to
    configure.
    """
    raw = _env('SUPABASE_URL') or _env('NEXT_PUBLIC_SUPABASE_URL')
    if raw is None:
        return None
    raw = raw.rstrip('/')
    if not raw.startswith(('https://', 'http://')):
        # A URL that is not a URL would be handed to urllib anyway; refuse it here
        # so the failure reads as "unconfigured" rather than a stack trace.
        logger.warning('Ignoring malformed Supabase URL: expected an http(s) scheme')
        return None
    return raw


def store_configured() -> bool:
    """Whether an upload could actually happen.

    True only once `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` are
    both set -- the two variables this deployment lacks. The project URL is also
    required, but it is already present in backend/.env, so in practice those two
    names are the whole of what an operator adds.
    """
    return bool(_service_key() and _bucket() and _base_url())


def store_status() -> dict:
    """A description of the store that is safe to put in an API response.

        Deliberately contains no key, no bucket name, and no URL: a client needs to
    know whether images can be shown, not how the server reaches them.
    """
    configured = store_configured()
    return {
        'configured': configured,
        'meaning': (
            'Photographs submitted with review consent are stored privately and '
            'shown only through short-lived signed links.' if configured else
            'Photographs are not retained by this deployment. A screening records '
            'only the SHA-256 of the bytes that were screened.'
        ),
        'retention_days': retention_days(),
        'max_signed_url_seconds': MAX_SIGNED_URL_TTL,
        'requires_private_bucket': True,
    }


def retention_days() -> int:
    """How long a stored photograph may be kept, in days.

    Falls back to the 90-day default for a missing, unparseable, or non-positive
    value. A misconfigured variable must not silently become "keep forever".
    """
    raw = _env('IMAGE_RETENTION_DAYS')
    if raw is None:
        return DEFAULT_RETENTION_DAYS
    try:
        days = int(raw)
    except ValueError:
        logger.warning(
            'IMAGE_RETENTION_DAYS is not an integer; using %s days', DEFAULT_RETENTION_DAYS
        )
        return DEFAULT_RETENTION_DAYS
    if days <= 0:
        logger.warning(
            'IMAGE_RETENTION_DAYS must be positive; using %s days', DEFAULT_RETENTION_DAYS
        )
        return DEFAULT_RETENTION_DAYS
    return days


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def retention_until(now: datetime | None = None) -> datetime:
    """When an image stored now becomes eligible for deletion."""
    return (now or _now()) + timedelta(days=retention_days())


# -- Paths and limits ------------------------------------------------------

def object_path(digest: str, content_type: str) -> str:
    """A cryptographically random object key for one screened image.

    ``digest`` is validated because the caller must already have bound the bytes
    to a DiseaseObservation, but it is deliberately not included in the key.
    Knowing a screening's SHA-256 must not reveal or predict its storage address.
    """
    digest = (digest or '').strip().lower()
    if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise HTTPException(
            422, 'An image reference requires the SHA-256 hex digest of the image.'
        )
    extension = ALLOWED_CONTENT_TYPES.get(_normalised_type(content_type))
    if extension is None:
        raise HTTPException(415, _unsupported_type_message())
    return f'{OBJECT_PREFIX}/{secrets.token_hex(32)}.{extension}'


def _normalised_type(content_type: str | None) -> str:
    """The bare media type, without a charset or boundary parameter."""
    return (content_type or '').split(';')[0].strip().lower()


def _unsupported_type_message() -> str:
    return 'An image must be one of: ' + ', '.join(sorted(ALLOWED_CONTENT_TYPES)) + '.'


def validate_upload(content_type: str | None, size: int) -> str:
    """Check bytes against the limits *before* storing, returning the extension.

    Raises 415 for a type the model and the bucket do not accept and 413 for
    oversize, which is the right shape for a caller that can still refuse the
    request. Callers that run *after* a successful screening must not use this --
    see `attach_screening_image`, which turns the same failures into "not stored".
    """
    extension = ALLOWED_CONTENT_TYPES.get(_normalised_type(content_type))
    if extension is None:
        raise HTTPException(415, _unsupported_type_message())
    if size > MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f'An image may be at most {MAX_IMAGE_BYTES // (1024 * 1024)} MB. '
            f'This one is {size / (1024 * 1024):.1f} MB.',
        )
    if size <= 0:
        raise HTTPException(422, 'The uploaded image is empty.')
    return extension


def validated_image_type(
    data: bytes,
    content_type: str | None,
    *,
    require_declared_match: bool = True,
) -> str:
    """Verify size, declared MIME, decoded image bytes, and their agreement.

    Filenames and extensions are never consulted. PIL identifies the encoded
    format from the bytes, and only the three formats supported by the scanner
    are accepted. By default a declared JPEG containing PNG bytes is rejected
    rather than stored with misleading metadata. The crop-health upload path
    may explicitly allow a browser's stale declaration, but still receives the
    verified actual MIME returned by this function.
    """
    declared = _normalised_type(content_type)
    validate_upload(declared, len(data or b''))
    try:
        with Image.open(io.BytesIO(data)) as image:
            actual = Image.MIME.get(image.format)
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, 'The uploaded file is not a valid image.')
    if actual not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(415, _unsupported_type_message())
    if require_declared_match and actual != declared:
        raise HTTPException(
            415,
            f'The uploaded bytes are {actual}, not the declared {declared}.',
        )
    return actual


def _bytes_match(data: bytes | None, digest: str | None) -> bool:
    """Whether these bytes are the ones the screening recorded.

    Two claims rest on this and neither is safe to assume. The object path is
    ``screenings/<image_hash>.<ext>``, so bytes that hash to something else are
    filed under another screening's identity; and a viewer is told the link shows
    the evidence the model looked at, which is false the moment the stored file is
    not the screened file. It is also what makes the 409-means-already-stored
    shortcut in `upload_screening_image` sound: only if the path really is the hash
    of the body does an object already there hold these bytes.
    """
    expected = (digest or '').strip().lower()
    if len(expected) != 64:
        return False
    return hashlib.sha256(data or b'').hexdigest() == expected


def _acceptable(data: bytes, content_type: str | None) -> bool:
    """The non-raising form of `validated_image_type`, for post-screening callers."""
    try:
        validated_image_type(data, content_type)
        return True
    except HTTPException:
        return False


# -- The HTTP seam ---------------------------------------------------------

def _auth_headers() -> dict:
    """Headers carrying the service key. Never logged, never returned."""
    key = _service_key()
    return {'Authorization': f'Bearer {key}', 'apikey': key}


def _loggable(url: str) -> str:
    """A URL with its query string removed.

    A signed URL carries its access token in the query, so a log line built from
    a full URL would put a credential in a log file.
    """
    return url.split('?', 1)[0]


def _request(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    headers: dict | None = None,
    timeout: float = STORE_TIMEOUT_SECONDS,
) -> tuple[int, bytes]:
    """The single point where this module touches the network.

    Every store operation goes through here, which is what makes the configured
    path testable without a bucket: a test substitutes this one function. Standard
    library only -- the Supabase Storage REST API is three plain HTTP calls and
    does not justify a dependency.

    Returns ``(status, body)``. A transport failure is ``(0, b'')`` rather than an
    exception, because no caller here has anything better to do with an exception
    than treat it as "the store did not answer". Headers are never logged; one of
    them is the service key.
    """
    request = urllib.request.Request(url, data=data, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        # An HTTP error is still an answer: 404 and 409 in particular are
        # meaningful to the callers below.
        return exc.code, exc.read() or b''
    except (urllib.error.URLError, OSError, ValueError) as exc:
        logger.warning(
            'Storage request failed: %s %s (%s)',
            method, _loggable(url), exc.__class__.__name__,
        )
        return 0, b''


def _object_url(path: str, *, verb: str = 'object') -> str:
    """A Storage REST URL for one object path.

    `verb` is `object` for upload and delete, `object/sign` for signing. The path
    is percent-encoded but keeps its slashes, so ``screenings/<hash>.jpg`` stays a
    nested key rather than collapsing into one flat name.
    """
    return (
        f'{_base_url()}/storage/v1/{verb}/{urllib.parse.quote(_bucket(), safe="")}/'
        f'{urllib.parse.quote(path, safe="/")}'
    )


def _bucket_url() -> str:
    return f'{_base_url()}/storage/v1/bucket/{urllib.parse.quote(_bucket(), safe="")}'


def bucket_is_private() -> bool:
    """Confirm that the configured bucket exists and is not public.

    Storage is fail-closed: credentials alone are not enough. Uploading or signing
    is refused unless Supabase reports ``public: false`` for the exact
    ``screenings`` bucket. The adapter never creates a bucket because creation is
    an operator action whose privacy setting must be deliberate.
    """
    if not store_configured():
        return False
    status, body = _request('GET', _bucket_url(), headers=_auth_headers())
    if not 200 <= status < 300:
        logger.warning('Could not verify that the screening bucket is private: status=%s', status)
        return False
    try:
        payload = json.loads(body.decode() or '{}')
    except (ValueError, UnicodeDecodeError):
        logger.warning('Storage bucket verification returned unreadable JSON')
        return False
    if not isinstance(payload, dict) or payload.get('public') is not False:
        logger.error('Refusing screening image access because the storage bucket is public')
        return False
    return True


# -- Operations ------------------------------------------------------------

def upload_screening_image(data: bytes, content_type: str, digest: str) -> str | None:
    """Store one screening image. Returns its object path, or None.

    ``None`` is a normal answer, not an error: the store may be unconfigured (the
    current state of this deployment), the bytes may be refused, or the bucket may
    be unreachable. Every caller treats None as "no image was stored" and leaves
    `image_ref` NULL. Nothing here raises, because the screening that produced
    these bytes has already succeeded and must not be turned into a 500 by object
    storage -- the same rule `record_screening` follows for the database.
    """
    if not store_configured():
        return None
    try:
        verified_content_type = validated_image_type(data, content_type)
    except HTTPException:
        logger.warning('Refusing to store an image of unsupported type or size')
        return None
    try:
        path = object_path(digest, verified_content_type)
    except HTTPException:
        logger.warning('Refusing to store an image without a valid SHA-256 digest')
        return None
    if not _bytes_match(data, digest):
        # The path is the digest. Writing these bytes there would file one image
        # under another's identity and make every later claim about the object
        # false -- including the one a reviewer is shown.
        logger.warning('Refusing to store bytes whose SHA-256 is not the digest given')
        return None
    if not bucket_is_private():
        return None

    headers = _auth_headers()
    headers['Content-Type'] = verified_content_type
    # Every screening has its own random key. Never overwrite an existing object;
    # a 409 is treated as a collision and refused.
    headers['x-upsert'] = 'false'
    status, body = _request('POST', _object_url(path), data=data, headers=headers)

    if 200 <= status < 300:
        logger.info('Stored screening image at %s (%s bytes)', path, len(data))
        return path
    logger.warning(
        'Storage upload rejected: status=%s bytes=%s detail=%s',
        status, len(data), _detail(body),
    )
    return None


def signed_url(
    object_path_value: str, ttl_seconds: int = DEFAULT_SIGNED_URL_TTL
) -> str | None:
    """A short-lived URL for one stored object, or None.

    The bucket is private, so this is the only way a photograph reaches a browser.
    The link is a bearer credential with no identity attached, which is why the
    TTL is clamped here as well as validated at the route: a link that outlives
    the review session is an image anyone can fetch.
    """
    if not store_configured() or not object_path_value or not bucket_is_private():
        return None
    try:
        requested = int(ttl_seconds)
    except (TypeError, ValueError):
        requested = DEFAULT_SIGNED_URL_TTL
    ttl = max(MIN_SIGNED_URL_TTL, min(requested, MAX_SIGNED_URL_TTL))

    headers = _auth_headers()
    headers['Content-Type'] = 'application/json'
    status, body = _request(
        'POST',
        _object_url(object_path_value, verb='object/sign'),
        data=json.dumps({'expiresIn': ttl}).encode(),
        headers=headers,
    )
    if not 200 <= status < 300:
        logger.warning(
            'Storage signing rejected: status=%s path=%s detail=%s',
            status, object_path_value, _detail(body),
        )
        return None
    try:
        payload = json.loads(body.decode() or '{}')
    except (ValueError, UnicodeDecodeError):
        logger.warning('Storage signing returned a body that is not JSON')
        return None
    if not isinstance(payload, dict):
        logger.warning('Storage signing returned an unexpected body shape')
        return None

    signed = payload.get('signedURL') or payload.get('signedUrl')
    if not signed:
        logger.warning('Storage signing returned no URL')
        return None
    if signed.startswith(('https://', 'http://')):
        return signed
    # Supabase returns a project-relative path such as
    # `/object/sign/<bucket>/screenings/<hash>.jpg?token=...`.
    if not signed.startswith('/'):
        signed = '/' + signed
    if signed.startswith('/storage/v1'):
        return f'{_base_url()}{signed}'
    return f'{_base_url()}/storage/v1{signed}'


def delete_object(object_path_value: str) -> bool:
    """Remove one stored object. True when the object is gone.

    404 counts as success: the goal is that the file no longer exists, and it does
    not. That makes consent withdrawal and retention expiry safely repeatable --
    both may run twice, and neither should report a failure the second time.

    False means the object may still exist, and callers must not claim a deletion
    that did not happen.
    """
    if not store_configured() or not object_path_value:
        return False
    status, body = _request(
        'DELETE', _object_url(object_path_value), headers=_auth_headers()
    )
    if 200 <= status < 300 or status == 404:
        logger.info('Removed stored image %s (status=%s)', object_path_value, status)
        return True
    logger.warning(
        'Storage delete rejected: status=%s path=%s detail=%s',
        status, object_path_value, _detail(body),
    )
    return False


def _detail(body: bytes) -> str:
    """A short, safe fragment of an error body, for a log line.

    Truncated and never parsed for meaning. Storage errors sometimes echo parts of
    the request, so this is capped rather than logged whole.
    """
    return (body or b'').decode(errors='replace')[:200]


# -- Consent ---------------------------------------------------------------

_TRUE = {'true', '1', 'yes', 'y', 'on'}
_FALSE = {'false', '0', 'no', 'n', 'off'}


def _tristate(value, field: str) -> bool | None:
    """Parse one consent answer into yes / no / not asked.

    Accepts a real boolean and the strings a multipart form produces, because
    `POST /predict` is multipart and its consent fields arrive as text. Anything
    else is a 422 rather than a guess: reading an unrecognised answer as consent
    would store a photograph nobody agreed to store.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if not text:
        return None
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise HTTPException(
        422,
        f'{field} must be true or false, or omitted if the question was not asked.',
    )


def normalise_consent(review, training) -> tuple[bool | None, bool | None, datetime | None]:
    """The two consent decisions and when they were made.

    Returns ``(review, training, decided_at)``. Three states each, and the third
    matters: ``None`` means *not asked*, which is different from a refusal. A
    screening submitted by a client that has no consent UI yet must not be
    recorded as though the farmer said no, and must not be recorded as though
    they said yes.

    `decided_at` is set only when at least one question was actually answered. A
    timestamp on a row where nothing was asked would assert a conversation that
    never happened.

    The two are never conflated and neither implies the other. Review consent
    permits a qualified reviewer to see the photograph in order to help this
    farmer. Training consent permits it to become a labelled example for a future
    model, which helps other people and cannot be undone once a model has learned
    from it. A farmer may reasonably say yes to the first and no to the second,
    and this function is the only place that distinction is interpreted.
    """
    review_value = _tristate(review, 'image_consent_review')
    training_value = _tristate(training, 'image_consent_training')
    if review_value is None and training_value is None:
        return None, None, None
    return review_value, training_value, _now()


# -- The orchestrator's entry point ----------------------------------------

def attach_screening_image(
    db: Session,
    observation: DiseaseObservation | int | None,
    image_bytes: bytes,
    content_type: str | None,
    consent_review=None,
    consent_training=None,
) -> dict:
    """Record the consent decisions for one screening, and store the image if allowed.

    Called from the screening path once the observation row exists. Returns a
    report; it never raises, and it never changes what `POST /predict` answers --
    the six-key response contract of that endpoint is not this module's business.

    Takes either the row or its id, because `record_screening` returns an id and
    also returns ``None`` when it stored nothing. Both are handled here so the
    caller needs no branch: with no screening record there is nothing an image
    could belong to, and storing the photograph anyway would leave a file nothing
    references and no consent row to justify it.

    The order is the policy. Consent is recorded first and unconditionally,
    because the farmer's answer is a fact worth keeping whether or not an upload
    follows. Only then, and only for an explicit yes, are the bytes offered to the
    store. A no, an unanswered question, an unconfigured store, refused bytes, or
    a bucket that will not answer all end the same way: `image_ref` stays NULL,
    the screening stands, and the report names which of those happened.
    """
    if isinstance(observation, int):
        observation = db.get(DiseaseObservation, observation)
    if observation is None:
        return {
            'stored': False,
            'object_path': None,
            'consent_review': None,
            'retention_until': None,
            'reason': (
                'The screening was not recorded, so there is nothing for an image to '
                'belong to. No photograph was stored.'
            ),
        }

    try:
        review, training, decided_at = normalise_consent(consent_review, consent_training)
    except HTTPException as exc:
        # Even an unreadable consent answer cannot fail a completed screening.
        # Nothing is recorded and nothing is stored: an answer that cannot be read
        # is not an answer, and "not asked" is the honest state to leave behind.
        logger.warning('Ignoring unreadable consent answer: %s', exc.detail)
        return {
            'stored': False,
            'object_path': None,
            'consent_review': None,
            'retention_until': None,
            'reason': str(exc.detail),
        }

    observation.image_consent_review = review
    observation.image_consent_training = training
    observation.image_consent_at = decided_at

    path = None
    reason = None
    retain_until = None
    if review is not True:
        reason = REASON_NO_CONSENT
    elif not store_configured():
        reason = REASON_UNCONFIGURED
    elif not _acceptable(image_bytes, content_type):
        reason = REASON_REJECTED_BYTES
    elif not _bytes_match(image_bytes, observation.image_hash):
        # The screening hashed the bytes it screened. Anything else is a different
        # photograph, and storing it under this screening's hash would turn the
        # reviewer's "this is what the model looked at" into a false statement.
        logger.warning(
            'Refusing to store bytes that are not the ones screened (observation %s)',
            observation.id,
        )
        reason = REASON_HASH_MISMATCH
    else:
        path = upload_screening_image(image_bytes, content_type, observation.image_hash)
        if path is None:
            reason = REASON_UPLOAD_FAILED
        else:
            retain_until = retention_until()
            observation.image_ref = path
            observation.image_retention_until = retain_until

    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception('Could not record image consent for observation %s', observation.id)
        if path is not None:
            # The object exists but nothing now references it, so nothing will
            # ever expire it. Remove it rather than leave an unreferenced
            # photograph in the bucket with no retention date attached to it.
            delete_object(path)
        return {
            'stored': False,
            'object_path': None,
            'consent_review': review,
            'retention_until': None,
            'reason': 'The consent decision could not be recorded, so no image was kept.',
        }

    return {
        'stored': path is not None,
        'object_path': path,
        'consent_review': review,
        'retention_until': retain_until.isoformat() if retain_until else None,
        'reason': reason,
    }


# -- What a viewer is given ------------------------------------------------

MEANING_AVAILABLE = (
    'A short-lived link to the photograph that was screened. It is the evidence '
    'the model looked at, and nothing more: being able to see it does not make '
    'the screening a diagnosis, and it is not a confirmation of any condition. '
    'The link expires and is not a permanent address for the image.'
)
MEANING_UNAVAILABLE = (
    'No photograph can be shown for this screening. This says nothing about the '
    'crop: the screening, its prediction, and any review of it stand exactly as '
    'recorded. A reviewer who needs the image to conclude should record '
    'NEEDS_REVIEW rather than guess.'
)


def image_accessible(observation: DiseaseObservation, now: datetime | None = None) -> bool:
    """Whether policy currently permits this stored object to be signed."""
    if observation.image_ref is None or observation.image_consent_review is not True:
        return False
    if (
        observation.image_retention_until is not None
        and observation.image_retention_until <= (now or _now())
    ):
        return False
    return store_configured()


def screening_image(
    observation: DiseaseObservation,
    ttl_seconds: int = DEFAULT_SIGNED_URL_TTL,
    viewer: str = 'submitter',
) -> dict:
    """The image answer for one screening: a link, or the reason there is none.

    Always a 200-shaped body, never an error. "There is no image" is a normal,
    frequent, and permanent state on this deployment -- the store is unconfigured
    -- and a reviewer screen that has to distinguish a 404 route from a 404 image
    from a 503 bucket learns nothing useful from any of them. One `available`
    flag and one specific `reason` is the whole contract.

    Consent is checked before the store: an image whose consent was withdrawn is
    never shown, even in the window where the object itself has not yet been
    removed from the bucket.
    """
    unavailable = {
        'observation_id': observation.id,
        'available': False,
        'url': None,
        'expires_at': None,
        'ttl_seconds': None,
        'image_sha256': observation.image_hash,
        'viewer': viewer,
        'meaning': MEANING_UNAVAILABLE,
    }

    if observation.image_ref is None:
        if observation.image_consent_review is False:
            # Refusal and withdrawal both leave consent False; only a withdrawal
            # deleted a file. `image_deleted_at` cannot carry that distinction on
            # its own, because the retention sweep sets it too.
            unavailable['reason'] = (
                REASON_CONSENT_WITHDRAWN if observation.image_deleted_at is not None
                else REASON_NO_CONSENT
            )
        elif observation.image_deleted_at is not None:
            # Deleted while consent still stands: the retention period ended.
            # Calling that a withdrawal would assert a decision the farmer never
            # made.
            unavailable['reason'] = REASON_RETENTION_EXPIRED
        elif not store_configured():
            unavailable['reason'] = REASON_UNCONFIGURED
        else:
            unavailable['reason'] = REASON_NO_IMAGE
        return unavailable

    if observation.image_consent_review is not True:
        # The object may still be in the bucket -- a withdrawal whose delete call
        # failed keeps `image_ref` so an operator can finish the job -- but nobody
        # sees it without consent on record. `is not True`, not `is False`: an
        # answer that was never recorded is not permission either, so a stored
        # object with a NULL consent column stays unshown.
        unavailable['reason'] = (
            REASON_CONSENT_WITHDRAWN if observation.image_consent_review is False
            else REASON_CONSENT_UNRECORDED
        )
        return unavailable

    if (
        observation.image_retention_until is not None
        and observation.image_retention_until <= _now()
    ):
        # Access stops at the recorded retention boundary even if the operator's
        # purge job has not removed the object yet. The retained reference lets
        # that job find and delete the object without extending viewing access.
        unavailable['reason'] = REASON_RETENTION_EXPIRED
        return unavailable

    if not store_configured():
        unavailable['reason'] = REASON_UNCONFIGURED
        return unavailable

    ttl = max(MIN_SIGNED_URL_TTL, min(int(ttl_seconds), MAX_SIGNED_URL_TTL))
    url = signed_url(observation.image_ref, ttl)
    if url is None:
        unavailable['reason'] = REASON_SIGNING_FAILED
        return unavailable

    return {
        'observation_id': observation.id,
        'available': True,
        'url': url,
        'expires_at': (_now() + timedelta(seconds=ttl)).isoformat(),
        'ttl_seconds': ttl,
        'image_sha256': observation.image_hash,
        'viewer': viewer,
        # So a reviewer can see the image is a photograph the farmer agreed to
        # have reviewed, rather than something collected without asking.
        'consent_review': observation.image_consent_review,
        'retention_until': (
            observation.image_retention_until.isoformat()
            if observation.image_retention_until else None
        ),
        'reason': None,
        'meaning': MEANING_AVAILABLE,
    }


def withdraw_image_consent(db: Session, observation: DiseaseObservation) -> dict:
    """The submitting farmer withdraws review consent for their photograph.

    Idempotent, and safe to call on a screening that never had an image: the
    withdrawal is a statement about what may be done with the farmer's
    photograph, so it is recorded whether or not there is a file to delete.

    Two outcomes, reported apart because they are different facts:

    * the object was removed (or there was none), so `image_ref` is cleared and
      `image_deleted_at` records when the image stopped existing;
    * the delete call failed or the store is unconfigured, so `image_ref` is
      *kept*. Clearing it would discard the only pointer to a file that still
      exists, leaving a photograph nothing can ever find. Consent is still
      withdrawn, which is what stops it being shown, and the response says
      plainly that an operator has to finish the removal.

    `image_deleted_at` is never moved once set. The first deletion is the true
    one, and a second withdrawal must not rewrite when the image ceased to exist.
    """
    had_image = observation.image_ref is not None
    removed = True
    if had_image:
        removed = delete_object(observation.image_ref)

    observation.image_consent_review = False
    observation.image_consent_at = _now()
    if removed:
        if had_image:
            observation.image_deleted_at = observation.image_deleted_at or _now()
        observation.image_ref = None
        observation.image_retention_until = None
    db.commit()

    logger.info(
        'Image consent withdrawn for observation %s (object_removed=%s)',
        observation.id, removed,
    )
    return {
        'observation_id': observation.id,
        'consent_review': False,
        'image_available': False,
        'object_removed': bool(removed and had_image),
        'nothing_to_remove': not had_image,
        'pending_operator_deletion': not removed,
        'image_deleted_at': (
            observation.image_deleted_at.isoformat()
            if observation.image_deleted_at else None
        ),
        'meaning': (
            'Review consent for this photograph is withdrawn. It is not shown to '
            'anyone from now on, including reviewers.'
            + (
                '' if removed else
                ' The stored file could not be removed yet, so its reference is '
                'kept for an operator to delete; it remains hidden in the '
                'meantime.'
            )
            + ' Any review already recorded from the image is unchanged: a '
            'conclusion a reviewer reached stands on its own record.'
        ),
    }


# -- Retention -------------------------------------------------------------

def expired_images(db: Session, now: datetime | None = None) -> list[DiseaseObservation]:
    """Screenings whose stored image is past its retention date.

    Read-only: the FastAPI lifespan worker selects from this query and calls
    `purge_image` per row. Keeping selection separate from deletion makes the
    deadline rule directly testable and prevents a failed object deletion from
    losing its database reference.
    """
    cutoff = now or _now()
    return (
        db.query(DiseaseObservation)
        .filter(
            DiseaseObservation.image_ref.isnot(None),
            DiseaseObservation.image_retention_until.isnot(None),
            DiseaseObservation.image_retention_until <= cutoff,
        )
        .order_by(DiseaseObservation.image_retention_until)
        .all()
    )


def purge_image(db: Session, observation: DiseaseObservation) -> bool:
    """Delete one stored object and clear its reference. True when the object is gone.

    On failure the reference is kept: clearing `image_ref` while the file may still
    exist would lose the only pointer to it, leaving a photograph in the bucket
    that nothing can find or remove afterwards.
    """
    path = observation.image_ref
    if path is None:
        return True
    if not delete_object(path):
        return False
    observation.image_ref = None
    observation.image_deleted_at = observation.image_deleted_at or _now()
    db.commit()
    logger.info('Purged image for observation %s', observation.id)
    return True
