"""The advisory serving API: sourced IPM guidance, in the caller's language.

Thin by design. Every rule that matters -- the IPM category order, what counts as
a condition match, when a safety block is required, and when English is returned
in place of a translation that does not exist -- lives in `advisories.py`. This
file resolves identity, resolves ownership, and hands over.

Ownership on `/for-screening/{observation_id}` is `submitted_by`, exactly as in
`routers_screenings.py`: a screening somebody else submitted is 404, not 403. A
reviewer reading a farmer's screening goes through the validation router, which
strips identity; there is no path to a stranger's screening here.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from advisories import (
    CATEGORY_ORDER,
    CATEGORY_ORDER_NOTE,
    LANGUAGES,
    NO_TRANSLATION_POLICY,
    advisories_for_screening,
    library_meta,
    list_advisories,
    parse_category_filter,
    resolve_language,
)
from ai_advisory import generate_fallback_guidance
from auth import get_current_user
from database import get_db
from expert_validation import STATUS_MEANING, validation_for
from models_db import DiseaseObservation, User

router = APIRouter(prefix='/advisories', tags=['advisories'])

LIBRARY_CLAIM = (
    'Every advisory is a curated practice quoted from a named Indian agricultural '
    'authority, and carries its source, its URL, and the verbatim quote it rests '
    'on. Nothing here is model-generated, and nothing here is a diagnosis.'
)


@router.get('/meta')
def advisory_meta(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language: str | None = Query(default=None, description='en, hi, or mr.'),
):
    """What the library holds, in what categories, and in what languages.

    The translation coverage counts are the honest measure of the multilingual
    claim: they say how many of the N advisories a human has actually translated
    into each language, and how many will fall back to English. A client that
    renders a language picker should render this too.
    """
    resolved, source = resolve_language(language, current_user)
    meta = library_meta(db)
    meta['your_language'] = {
        'language': resolved,
        'resolved_from': source,
        'supported': list(LANGUAGES),
    }
    return meta


@router.get('')
def get_advisories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    crop: str | None = Query(default=None, description='Crop name, matched loosely.'),
    condition: str | None = Query(
        default=None, description='Condition name. Requires crop.',
    ),
    category: str | None = Query(
        default=None, description='Comma-separated categories. Blank means all.',
    ),
    language: str | None = Query(default=None, description='en, hi, or mr.'),
):
    """Filtered advisories, grouped by category in the IPM order.

    422 when `condition` is given without `crop`, and 422 on an unknown category
    or language -- an unrecognised filter must not read back as an empty library.
    """
    resolved, source = resolve_language(language, current_user)
    categories = parse_category_filter(category)
    result = list_advisories(db, crop, condition, categories, resolved)
    result['language'] = {
        'language': resolved,
        'resolved_from': source,
        'supported': list(LANGUAGES),
        'policy': NO_TRANSLATION_POLICY,
    }
    result['category_order'] = list(CATEGORY_ORDER)
    result['category_order_note'] = CATEGORY_ORDER_NOTE
    result['claim'] = LIBRARY_CLAIM
    return result


@router.get('/for-screening/{observation_id}')
def advisories_for_one_screening(
    observation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language: str | None = Query(default=None, description='en, hi, or mr.'),
):
    """Guidance matched to one of the caller's own screenings.

    404 for a screening the caller did not submit, matching every other router: a
    record the caller does not own is a record that does not exist.
    """
    resolved, source = resolve_language(language, current_user)
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None or observation.submitted_by != current_user.id:
        raise HTTPException(404, 'Screening not found')

    validation = validation_for(db, observation.id)
    result = advisories_for_screening(db, observation, resolved)
    review_status = validation.status if validation else 'PENDING'
    result['review_status'] = review_status
    result['review_status_meaning'] = STATUS_MEANING.get(review_status, review_status)
    result['awaiting_officer_review'] = review_status == 'PENDING' or validation is None
    result['language'] = {
        'language': resolved,
        'resolved_from': source,
        'supported': list(LANGUAGES),
        'policy': NO_TRANSLATION_POLICY,
    }
    result['claim'] = LIBRARY_CLAIM

    # Only when the curated library truly has nothing (no_match_reason is set):
    # a distinct, clearly-labelled AI fallback, never merged into `matched` or
    # `general_for_crop`. See ai_advisory.py for why this is safe to add.
    if result.get('no_match_reason'):
        result['ai_fallback'] = generate_fallback_guidance(
            result['matched_on']['crop'],
            result['matched_on']['condition'],
            resolved,
        )

    return result
