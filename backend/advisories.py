"""Serving the curated advisory library: IPM guidance, safe-input rules, languages.

Three things this module refuses to do, and they are the reason it exists:

1. **It never composes agronomic advice.** Every sentence a farmer reads comes
   out of an `advisories` row that a human curated from an ICAR institute, a
   State Agricultural University, or a Government of India plant-protection
   package. There is no template, no generation, and no "closest available"
   substitution.
2. **It never translates.** `advisory_translations` holds human translations and
   is empty today. A request for Hindi therefore returns the canonical English
   marked `is_fallback`, and says why. Machine-translating "spray at first
   symptom" is how a dose or a growth stage quietly changes meaning.
3. **It never presents guidance for one condition as guidance for another.** A
   screening of late blight does not get early blight advice because both say
   "blight". Advisories that match only on the crop are returned in a separate
   `general_for_crop` group, labelled as general crop practice.

Category order is a product rule
--------------------------------

`CATEGORY_ORDER` is Integrated Pest Management in the order IPM itself states:
watch the field, remove the carry-over, change the practice, plant a resistant
variety, act by hand, use a biological, and only then consider a chemical. Every
response is ordered by it, so a chemical is never the first thing a farmer sees.
The order is exported as a constant rather than left to whoever renders it.

Matching is deliberately narrow
-------------------------------

The model predicts `Tomato___Late_blight`; the library is keyed on
crop=`Tomato`, condition=`Late blight (Phytophthora infestans)`. Matching needs
crop agreement (loose, reusing `expert_validation.crop_consistency`, because the
model writes `Corn_(maize)` where a farmer writes `Maize`) **and** at least one
shared distinctive word of the condition name. Genus names in parentheses are
ignored, and symptom words that name a whole family of conditions -- `blight`,
`spot`, `rot`, `wilt` -- are not distinctive on their own. Missing a real match
is recoverable; asserting a wrong one is not.

There is no synonym table here on purpose. "Northern leaf blight" and "Turcicum
leaf blight" are the same disease, but knowing that is curated agronomic data and
belongs in the seed alongside its citation, not in a matching function.
"""
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

# Reused, not reimplemented: the loose crop comparison and the class-prefix
# reader already exist and are already tested. Two crop comparisons in one
# codebase would eventually disagree with each other.
from expert_validation import crop_consistency, predicted_crop
from fastapi import HTTPException
from models_db import (Advisory, AdvisoryTranslation, Crop, DiseaseObservation,
                       User)
# The language rule lives in translation.py so there is exactly one of them;
# the curated translation path below is otherwise untouched and stays
# human-only -- machine translation never reaches an advisory recommendation.
from translation import resolve_language
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ── Category order: the IPM rule, not a display preference ─────────────────

CATEGORY_ORDER = (
    'monitoring',
    'sanitation',
    'cultural',
    'resistant_variety',
    'mechanical',
    'biological',
    'chemical',
)

CATEGORY_MEANING = {
    'monitoring': (
        'Look before acting: scouting, traps, and economic thresholds that decide '
        'whether any control is needed at all. Nothing is applied at this step.'
    ),
    'sanitation': (
        'Remove the source that carries the problem into the next crop -- infected '
        'debris, stubble, volunteer plants, cull piles, alternate hosts.'
    ),
    'cultural': (
        'Change how the crop is grown so the condition is less favoured: spacing, '
        'water management, sowing date, rotation, nutrition, drainage.'
    ),
    'resistant_variety': (
        'Plant a variety or hybrid the cited source records as resistant or '
        'tolerant. Prevention that costs nothing after sowing.'
    ),
    'mechanical': (
        'Physical action by hand or with a device: hand-picking, barriers, traps '
        'that kill rather than only monitor, roguing, staking.'
    ),
    'biological': (
        'A living control agent or biological product named by the source -- '
        'Trichoderma, Pseudomonas, Trichogramma, NPV, neem-based preparations.'
    ),
    'chemical': (
        'A chemical control that the cited authoritative source itself recommends. '
        'Last in the order because IPM puts it last, never because it is unusual.'
    ),
}

CATEGORY_ORDER_NOTE = (
    'Integrated Pest Management orders control by escalation, and this platform '
    'returns advisories in that order always: monitoring, sanitation, cultural, '
    'resistant_variety, mechanical, biological, chemical. A chemical option is '
    'never the first thing shown, even when it is the only thing that matched.'
)

# Position lookup for sorting. Built once from the tuple so the tuple stays the
# single definition of the order.
_CATEGORY_POSITION = {category: index for index,
                      category in enumerate(CATEGORY_ORDER)}


def seed_curated_advisories(db: Session) -> int:
    """Load the repository's human-curated advisory source once per database."""
    seed_path = Path(__file__).with_name("data") / "advisories_seed.json"

    if not seed_path.exists():
        logger.warning("Curated advisory seed is missing: %s", seed_path)
        return 0

    try:
        records = json.loads(seed_path.read_text(encoding="utf-8"))
        existing = {
            (row.crop, row.condition, row.category, row.recommendation)
            for row in db.query(Advisory).all()
        }
        added = 0

        for record in records:
            key = (
                record["crop"],
                record["condition"],
                record["category"],
                record["recommendation"],
            )
            if key in existing:
                continue

            db.add(
                Advisory(
                    **record,
                    rule_version="seed-v1",
                )
            )
            existing.add(key)
            added += 1

        if added:
            db.commit()
        return added
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, SQLAlchemyError):
        db.rollback()
        logger.exception("Could not load curated advisory seed")
        return 0


# ── Languages ──────────────────────────────────────────────────────────────
# Matches the ck_translation_language check constraint and users.language.

DEFAULT_LANGUAGE = 'en'
LANGUAGES = ('en', 'hi', 'mr')
LANGUAGE_NAMES = {'en': 'English', 'hi': 'Hindi', 'mr': 'Marathi'}

# English is not a translation. `advisories.recommendation` *is* the English
# text, curated with the citation, so there is nothing to look up and nothing to
# fall back from.
CANONICAL_LANGUAGE_NOTE = (
    'English is the canonical language of the library: advisories.recommendation '
    'is the curated English text, so no translation row is needed for it.'
)

NO_TRANSLATION_POLICY = (
    'Translations are written by humans and stored per advisory. There is no '
    'machine translation in this platform: an agronomic instruction that changes '
    'meaning in translation can cost a crop or misstate a dose. Where a human '
    'translation does not exist the canonical English is returned unchanged and '
    'marked is_fallback.'
)


def _fallback_reason(language: str) -> str:
    return (
        f'No human {LANGUAGE_NAMES.get(language, language)} translation of this '
        'advisory exists yet. The canonical English is shown unchanged rather '
        'than machine-translated, because a mistranslated agronomic instruction '
        'is worse than an untranslated one.'
    )


# ── The safe-input rule ────────────────────────────────────────────────────
# Applied to every advisory in category `chemical` and to every advisory whose
# source states a dose, whatever its category -- a Trichoderma seed treatment at
# 10 g/kg is a dose and carries the same obligations as a fungicide spray.

SAFETY_STATEMENTS = {
    'dose_is_verbatim': (
        'Any dose, concentration, or rate shown is quoted verbatim from the named '
        'source and appears in evidence_quote. It has not been converted, rounded, '
        'scaled to an area, or restated.'
    ),
    'platform_does_not_compose_doses': (
        'This platform does not compose, adjust, combine, or recommend doses, '
        'brands, tank mixes, spray intervals, or pre-harvest intervals. It only '
        'repeats what the cited source published.'
    ),
    'check_the_label_and_registration': (
        'Read the product label before use and check that the input is currently '
        'registered for this crop and this pest or disease in your state. '
        'Registration and label recommendations change, and the cited document may '
        'be older than the label in your hand.'
    ),
    'consult_before_applying': (
        'Consult your Krishi Vigyan Kendra (KVK) or your state extension officer '
        'before applying any chemical or biological input. They can confirm the '
        'condition and tell you what is approved locally.'
    ),
}

# Human-reviewed translations of safety statements for Hindi and Marathi
# These translations are CRITICAL safety content and must only be updated by
# qualified translators who understand agricultural terminology.
SAFETY_STATEMENTS_HI = {
    'dose_is_verbatim': (
        'दिखाई गई कोई भी मात्रा, सांद्रता, या दर नामित स्रोत से शब्दशः उद्धृत की गई है '
        'और evidence_quote में दिखाई देती है। इसे परिवर्तित, गोल, क्षेत्र के अनुसार '
        'बदला, या पुनः बताया नहीं गया है।'
    ),
    'platform_does_not_compose_doses': (
        'यह प्लेटफ़ॉर्म मात्रा, ब्रांड, टैंक मिक्स, छिड़काव अंतराल, या फसल कटाई से '
        'पहले के अंतराल की रचना, समायोजन, संयोजन, या सिफारिश नहीं करता है। यह केवल '
        'उद्धृत स्रोत द्वारा प्रकाशित जानकारी को दोहराता है।'
    ),
    'check_the_label_and_registration': (
        'उपयोग से पहले उत्पाद लेबल पढ़ें और जाँच करें कि यह इनपुट वर्तमान में आपके '
        'राज्य में इस फसल और इस कीट या रोग के लिए पंजीकृत है। पंजीकरण और लेबल '
        'सिफारिशें बदलती रहती हैं, और उद्धृत दस्तावेज़ आपके हाथ में मौजूद लेबल से '
        'पुराना हो सकता है।'
    ),
    'consult_before_applying': (
        'किसी भी रासायनिक या जैविक इनपुट को लागू करने से पहले अपने कृषि विज्ञान केंद्र '
        '(KVK) या अपने राज्य विस्तार अधिकारी से परामर्श करें। वे स्थिति की पुष्टि '
        'कर सकते हैं और बता सकते हैं कि स्थानीय स्तर पर क्या स्वीकृत है।'
    ),
}

SAFETY_STATEMENTS_MR = {
    'dose_is_verbatim': (
        'दाखवलेला कोणताही डोस, एकाग्रता, किंवा दर नामित स्रोताकडून शब्दशः उद्धृत '
        'केला आहे आणि evidence_quote मध्ये दिसतो. तो रूपांतरित, गोलाकार, क्षेत्रानुसार '
        'मोजला, किंवा पुन्हा सांगितला गेला नाही.'
    ),
    'platform_does_not_compose_doses': (
        'हे प्लॅटफॉर्म डोस, ब्रँड, टँक मिक्स, फवारणी मध्यांतर, किंवा कापणीपूर्व '
        'मध्यांतरांची रचना, समायोजन, संयोजन, किंवा शिफारस करत नाही. हे फक्त '
        'उद्धृत स्रोताने प्रकाशित केलेली माहिती पुनरावृत्ती करते.'
    ),
    'check_the_label_and_registration': (
        'वापरापूर्वी उत्पादन लेबल वाचा आणि तपासा की हे इनपुट सध्या तुमच्या राज्यात '
        'या पिकासाठी आणि या किड किंवा रोगासाठी नोंदणीकृत आहे. नोंदणी आणि लेबल '
        'शिफारशी बदलतात, आणि उद्धृत दस्तऐवज तुमच्या हातातील लेबलपेक्षा जुना असू शकतो.'
    ),
    'consult_before_applying': (
        'कोणतेही रासायनिक किंवा जैविक इनपुट लागू करण्यापूर्वी तुमच्या कृषी विज्ञान '
        'केंद्राशी (KVK) किंवा तुमच्या राज्य विस्तार अधिकाऱ्याशी सल्लामसलत करा. '
        'ते परिस्थितीची पुष्टी करू शकतात आणि स्थानिक पातळीवर काय मंजूर आहे ते '
        'सांगू शकतात.'
    ),
}


def safety_block(advisory: Advisory, language: str = DEFAULT_LANGUAGE) -> dict | None:
    """The safe-input block for one advisory, or None where it does not apply.

    Two independent triggers, and either is enough: the category is `chemical`,
    or the source states a dose. They are reported separately so the reason the
    block is present is never guessed from the category alone.

    Returns localized safety statements for Hindi/Marathi when requested.
    """
    is_chemical = advisory.category == 'chemical'
    states_dose = bool(advisory.states_dose)
    if not (is_chemical or states_dose):
        return None
    reasons = []
    if is_chemical:
        reasons.append('this advisory is a chemical control')
    if states_dose:
        reasons.append('the cited source states a dose')

    # Select appropriate safety statements based on language
    if language == 'hi':
        safety_statements = SAFETY_STATEMENTS_HI
    elif language == 'mr':
        safety_statements = SAFETY_STATEMENTS_MR
    else:
        safety_statements = SAFETY_STATEMENTS

    return {
        'applies': True,
        'applies_because': ' and '.join(reasons),
        'is_chemical': is_chemical,
        'states_dose': states_dose,
        'language': language,
        **safety_statements,
    }


SAFETY_SUMMARY_NOTE = (
    'This response contains at least one chemical control or one advisory whose '
    'source states a dose. The per-advisory safety block carries the same '
    'statements and names which trigger applied.'
)


# ── Condition matching ─────────────────────────────────────────────────────

MIN_TOKEN_LENGTH = 4

# Words that name a symptom class rather than a condition. Two advisories sharing
# only one of these are not about the same thing: "early blight", "late blight",
# "bacterial leaf blight" and "Turcicum leaf blight" are four different diseases
# with four different managements.
GENERIC_CONDITION_TOKENS = frozenset({
    'blight', 'blights',
    'spot', 'spots', 'spotting',
    'rot', 'rots',
    'leaf', 'leaves', 'foliar',
    'wilt', 'wilts', 'wilting',
    'mold', 'mould', 'mildew',
    'virus', 'viral', 'viruses',
    'disease', 'diseases', 'pest', 'pests', 'insect', 'insects',
    'borer', 'borers', 'worm', 'worms',
    'damage', 'symptom', 'symptoms', 'infection', 'infestation',
    'complex', 'general', 'healthy', 'stem', 'root', 'fruit', 'plant',
})

_PARENTHESISED = re.compile(r'\([^)]*\)')
_NON_LETTER = re.compile(r'[^a-z]+')

MATCH_CROP_AND_CONDITION = 'crop_and_condition'
MATCH_CROP_ONLY = 'crop_only'

GENERAL_FOR_CROP_NOTE = (
    'These advisories are for the same crop but for a different condition, or for '
    'the crop generally. They are general crop practice and are NOT guidance for '
    'the condition asked about. Nothing here has been matched to that condition.'
)


def condition_tokens(condition_text: str | None, crop_name: str | None = None) -> dict:
    """Split a condition name into distinctive and generic words.

    Parenthesised text is dropped: `Late blight (Phytophthora infestans)` is
    keyed on the disease name a farmer would recognise, and two unrelated
    conditions can share a genus. The crop's own words are dropped too, so
    `Tomato leaf curl virus` on crop Tomato does not match every Tomato advisory
    through the word "tomato".
    """
    text = _PARENTHESISED.sub(' ', condition_text or '')
    words = {word for word in _NON_LETTER.split(
        text.lower()) if len(word) >= MIN_TOKEN_LENGTH}
    if crop_name:
        words -= {word for word in _NON_LETTER.split(
            crop_name.lower()) if word}
    return {
        'distinctive': words - GENERIC_CONDITION_TOKENS,
        'generic': words & GENERIC_CONDITION_TOKENS,
    }


def same_crop(crop_name: str | None, advisory_crop: str) -> bool:
    """Whether a crop name and an advisory's crop are the same crop.

    Delegates to `expert_validation.crop_consistency` by presenting the caller's
    crop in the shape that function reads -- a model class prefix -- so there is
    exactly one loose crop comparison in the codebase. That side of the
    comparison is the one that strips parentheses and underscores, which is why
    the caller's (messier) name goes there and the advisory's clean crop does not.
    """
    if not crop_name or not str(crop_name).strip():
        return False
    prefix = str(crop_name).strip().replace(' ', '_')
    return crop_consistency(f'{prefix}___n_a', advisory_crop)['state'] == 'consistent'


def class_condition(predicted_class: str | None) -> str | None:
    """The condition a model class names, or None for an unprefixed class.

    Mirrors `expert_validation.predicted_crop`, which reads the other half.
    `Corn_(maize)___Common_rust_` -> `Common rust`.
    """
    if not predicted_class or '___' not in predicted_class:
        return None
    return predicted_class.split('___', 1)[1].replace('_', ' ').strip()


# ── Reading the library ────────────────────────────────────────────────────
# The advisory library is a curated reference table of a few dozen rows, and it
# is read whole. That is deliberate: crop comparison is loose and condition
# matching is token-based, neither of which SQL can express, so doing the whole
# filter in Python keeps one matching rule instead of a SQL rule and a Python
# rule that drift apart. Revisit if the library ever reaches thousands of rows.

def _today():
    """Today in naive UTC, for the active_from/active_to window."""
    return datetime.now(timezone.utc).replace(tzinfo=None).date()


def is_active(advisory: Advisory, today=None) -> bool:
    """Whether an advisory is inside its validity window. NULL bounds are open."""
    today = today or _today()
    if advisory.active_from and today < advisory.active_from:
        return False
    if advisory.active_to and today > advisory.active_to:
        return False
    return True


def active_advisories(db: Session) -> list:
    """Every advisory currently in force, unordered."""
    today = _today()
    return [row for row in db.query(Advisory).all() if is_active(row, today)]


def crops_covered(advisories) -> list:
    """The crops the library actually holds guidance for. Computed, never listed."""
    return sorted({row.crop for row in advisories})


def _order_key(advisory: Advisory):
    """Category order first, then condition and id so ties are stable across calls."""
    return (
        _CATEGORY_POSITION.get(advisory.category, len(CATEGORY_ORDER)),
        (advisory.condition or '').lower(),
        advisory.id or 0,
    )


# ── Language resolution ────────────────────────────────────────────────────
# `resolve_language` now lives in translation.py and is imported above, so the
# advisories endpoints and the rest of the API share one rule.



def parse_category_filter(raw: str | None) -> tuple:
    """A comma-separated category filter, returned in canonical order.

    Blank means every category. An unknown category is 422 rather than an empty
    result, so a typo is never read back as "there is no guidance of that kind".
    """
    if raw is None or not raw.strip():
        return CATEGORY_ORDER
    wanted = []
    for piece in raw.split(','):
        category = piece.strip().lower()
        if not category:
            continue
        if category not in CATEGORY_ORDER:
            raise HTTPException(
                422,
                f"'{piece.strip()}' is not an advisory category. Use one or more of: "
                f'{", ".join(CATEGORY_ORDER)}.',
            )
        wanted.append(category)
    if not wanted:
        return CATEGORY_ORDER
    return tuple(category for category in CATEGORY_ORDER if category in wanted)


def _translations(db: Session, advisory_ids: list, language: str) -> dict:
    """Human translations of these advisories into this language, by advisory id.

    Skipped entirely for English: the canonical text is on the advisory itself,
    so an `en` translation row would be a duplicate and is never consulted. The
    language is re-checked in Python as well as in SQL so the mapping cannot
    contain a row for a different language.
    """
    if language == DEFAULT_LANGUAGE or not advisory_ids:
        return {}
    rows = (
        db.query(AdvisoryTranslation)
        .filter(
            AdvisoryTranslation.advisory_id.in_(advisory_ids),
            AdvisoryTranslation.language == language,
        )
        .all()
    )
    return {row.advisory_id: row for row in rows if row.language == language}


# ── Serialisation ──────────────────────────────────────────────────────────

def advisory_payload(
    advisory: Advisory,
    language: str,
    translation=None,
    match: str | None = None,
    shared_tokens: list | None = None,
) -> dict:
    """One advisory, in the requested language, with its provenance and safety.

    Provenance is not optional and is not summarised: source_name, source_url,
    evidence_quote, states_dose, and rule_version travel with every advisory in
    every response. An advisory without them is not an advisory, and a UI that
    only had the recommendation could not show a farmer where it came from.
    """
    is_fallback = translation is None and language != DEFAULT_LANGUAGE
    payload = {
        'advisory_id': advisory.id,
        'crop': advisory.crop,
        'condition': advisory.condition,
        'condition_kind': advisory.condition_kind,
        'category': advisory.category,
        'category_meaning': CATEGORY_MEANING.get(advisory.category),
        'category_position': _CATEGORY_POSITION.get(advisory.category, len(CATEGORY_ORDER)) + 1,
        'recommendation': translation.recommendation if translation else advisory.recommendation,
        'language': DEFAULT_LANGUAGE if is_fallback else language,
        'requested_language': language,
        'is_fallback': is_fallback,
        'fallback_reason': _fallback_reason(language) if is_fallback else None,
        'translated_by': translation.translated_by if translation else None,
        # Provenance. Every key here is mandatory in every response.
        'source_name': advisory.source_name,
        'source_url': advisory.source_url,
        'evidence_quote': advisory.evidence_quote,
        'states_dose': bool(advisory.states_dose),
        'rule_version': advisory.rule_version,
        'active_from': advisory.active_from.isoformat() if advisory.active_from else None,
        'active_to': advisory.active_to.isoformat() if advisory.active_to else None,
        'safety': safety_block(advisory, language),
    }
    if match is not None:
        payload['match'] = match
        payload['matched_condition_words'] = sorted(shared_tokens or [])
    return payload


REQUIRED_PROVENANCE_KEYS = (
    'source_name', 'source_url', 'evidence_quote', 'states_dose', 'rule_version',
)


def serialise(db: Session, advisories, language: str, matches=None) -> list:
    """Serialise advisories in canonical category order, resolving translations once."""
    ordered = sorted(advisories, key=_order_key)
    translations = _translations(db, [row.id for row in ordered], language)
    matches = matches or {}
    return [
        advisory_payload(
            row,
            language,
            translations.get(row.id),
            match=matches.get(row.id, (None, None))[0],
            shared_tokens=matches.get(row.id, (None, None))[1],
        )
        for row in ordered
    ]


def group_by_category(payloads: list) -> list:
    """Group serialised advisories into the canonical category order.

    Empty categories are omitted rather than returned as empty buckets: the order
    is published in `CATEGORY_ORDER` and in `/advisories/meta`, so a caller that
    wants to render every heading has the list without being told seven times
    that nothing matched.
    """
    groups = []
    for category in CATEGORY_ORDER:
        items = [payload for payload in payloads if payload['category'] == category]
        if not items:
            continue
        groups.append({
            'category': category,
            'position': _CATEGORY_POSITION[category] + 1,
            'meaning': CATEGORY_MEANING[category],
            'count': len(items),
            'advisories': items,
        })
    return groups


def response_safety(payloads, language: str = DEFAULT_LANGUAGE) -> dict | None:
    """A single safety block for a response, present only if an advisory triggers it.

    Returns localized safety statements for Hindi/Marathi when requested.
    """
    triggering = [payload for payload in payloads if payload.get('safety')]
    if not triggering:
        return None

    # Select appropriate safety statements based on language
    if language == 'hi':
        safety_statements = SAFETY_STATEMENTS_HI
    elif language == 'mr':
        safety_statements = SAFETY_STATEMENTS_MR
    else:
        safety_statements = SAFETY_STATEMENTS

    return {
        'applies': True,
        'note': SAFETY_SUMMARY_NOTE,
        'advisories_affected': len(triggering),
        'language': language,
        **safety_statements,
    }


# ── Matching ───────────────────────────────────────────────────────────────

def match_advisories(
    db: Session,
    crop_name: str | None,
    condition_text: str | None,
    language: str = DEFAULT_LANGUAGE,
) -> dict:
    """Advisories for one crop and one condition, with the strength of each match.

    Crop agreement is required for everything returned. On top of it, an advisory
    reaches `matched` only when it shares at least one distinctive word of the
    condition name -- never on a generic symptom word alone. Advisories that
    agree on the crop but not on the condition go to `general_for_crop`, labelled
    as general crop practice, because presenting them as guidance for this
    condition would be a fabricated match.

    `matched` is empty and `no_match_reason` is set when nothing matched, and the
    reason distinguishes the ways that happens: the crop is not in the library at
    all, or the crop is but this condition is not.
    """
    library = active_advisories(db)
    covered = crops_covered(library)

    for_crop = [row for row in library if same_crop(crop_name, row.crop)]
    asked_tokens = condition_tokens(condition_text, crop_name)

    matched, general, match_info = [], [], {}
    for row in for_crop:
        row_tokens = condition_tokens(row.condition, row.crop)
        shared = sorted(asked_tokens['distinctive']
                        & row_tokens['distinctive'])
        if shared:
            matched.append(row)
            match_info[row.id] = (MATCH_CROP_AND_CONDITION, shared)
        else:
            general.append(row)
            match_info[row.id] = (MATCH_CROP_ONLY, [])

    matched_payloads = serialise(db, matched, language, match_info)
    general_payloads = serialise(db, general, language, match_info)

    return {
        'requested': {
            'crop': crop_name,
            'condition': condition_text,
            'distinctive_words_used': sorted(asked_tokens['distinctive']),
            'generic_words_ignored': sorted(asked_tokens['generic']),
        },
        'total_matched': len(matched_payloads),
        'matched': matched_payloads,
        'groups': group_by_category(matched_payloads),
        'general_for_crop': {
            'note': GENERAL_FOR_CROP_NOTE,
            'total': len(general_payloads),
            'advisories': general_payloads,
        },
        'no_match_reason': _no_match_reason(
            crop_name, condition_text, covered,
            matched_payloads, general_payloads, asked_tokens,
        ),
        'crops_covered': covered,
        'safety': response_safety(matched_payloads + general_payloads, language),
    }


def _no_match_reason(crop_name, condition_text, covered, matched, general, asked_tokens):
    """Why nothing matched, or None when something did.

    Three different truths, and collapsing them into one message would hide which
    it is: the crop is absent from the library; the crop is present but the
    condition is not; or the condition name carried no distinctive word to match
    on at all.
    """
    if matched:
        return None
    crop_list = ', '.join(covered) if covered else 'no crops'
    if not general:
        return (
            f'This platform carries sourced advisories for {crop_list} only, and holds '
            f'nothing for {crop_name or "an unnamed crop"}. No unrelated advice is '
            'substituted: guidance is served only where a curated, cited advisory '
            'exists for the crop.'
        )
    if not asked_tokens['distinctive']:
        return (
            f'"{condition_text}" carries no distinctive condition word to match on -- '
            'generic words such as blight, spot, leaf, or healthy are not matched on '
            f'their own -- so no advisory has been matched to it. The {len(general)} '
            f'advisories under general_for_crop are general {crop_name} practice, not '
            'guidance for this condition.'
        )
    return (
        f'No sourced advisory in this platform names a condition matching '
        f'"{condition_text}" on {crop_name}. The {len(general)} advisories under '
        f'general_for_crop are general {crop_name} practice and are not guidance for '
        f'this condition. The library covers {crop_list}; a condition outside what it '
        'holds is reported as absent rather than answered with something else.'
    )


# ── Listing and filtering ──────────────────────────────────────────────────

def list_advisories(
    db: Session,
    crop: str | None = None,
    condition: str | None = None,
    categories: tuple = CATEGORY_ORDER,
    language: str = DEFAULT_LANGUAGE,
) -> dict:
    """The library, filtered, grouped by category in canonical order.

    `condition` requires `crop`. A condition name identifies an advisory only
    together with its crop -- "late blight" is a Potato disease and a Tomato
    disease with different sourced managements -- so matching a condition without
    a crop could only return the wrong crop's guidance.

    With a condition, this is `match_advisories` and `match` is the honest
    strength of each hit. Without one, no condition was asked about, every hit is
    `crop_only`, and there is no `general_for_crop` to separate out.
    """
    asked_condition = bool(condition and condition.strip())
    if asked_condition and not (crop and crop.strip()):
        raise HTTPException(
            422,
            'Filtering by condition also needs crop. A condition name identifies an '
            'advisory only together with its crop, and matching on the condition '
            "alone would return another crop's guidance.",
        )

    if asked_condition:
        result = _apply_category_filter(
            match_advisories(db, crop, condition, language), categories
        )
        result['filters'] = {'crop': crop, 'condition': condition,
                             'category': list(categories)}
        result['condition_requested'] = True
        return result

    library = active_advisories(db)
    covered = crops_covered(library)
    selected = [row for row in library if row.category in categories]
    if crop and crop.strip():
        selected = [row for row in selected if same_crop(crop, row.crop)]
        matches = {row.id: (MATCH_CROP_ONLY, []) for row in selected}
    else:
        matches = {}
    payloads = serialise(db, selected, language, matches)

    reason = None
    if not payloads:
        narrowed = (
            f' and the categories {", ".join(categories)}'
            if len(categories) < len(CATEGORY_ORDER) else ''
        )
        reason = (
            'No advisory in this platform matches that filter. The library covers '
            f'{", ".join(covered) if covered else "no crops"}{narrowed}. Nothing is '
            'substituted for an absent match.'
        )

    return {
        'filters': {'crop': crop, 'condition': condition, 'category': list(categories)},
        'condition_requested': False,
        'requested': {'crop': crop, 'condition': None,
                      'distinctive_words_used': [], 'generic_words_ignored': []},
        'total_matched': len(payloads),
        'matched': payloads,
        'groups': group_by_category(payloads),
        'general_for_crop': None,
        'no_match_reason': reason,
        'crops_covered': covered,
        'safety': response_safety(payloads, language),
    }


def _apply_category_filter(result: dict, categories: tuple) -> dict:
    """Narrow an already-matched result to the requested categories.

    Applied after matching, never before: the category a farmer wants to read
    must not change what counts as a match for their condition.
    """
    if set(categories) == set(CATEGORY_ORDER):
        return result
    kept = [payload for payload in result['matched']
            if payload['category'] in categories]
    general = [
        payload for payload in result['general_for_crop']['advisories']
        if payload['category'] in categories
    ]
    result['matched'] = kept
    result['total_matched'] = len(kept)
    result['groups'] = group_by_category(kept)
    result['general_for_crop'] = {
        **result['general_for_crop'], 'total': len(general), 'advisories': general,
    }
    # Extract language from result if available
    language = result.get('requested', {}).get('language', DEFAULT_LANGUAGE)
    result['safety'] = response_safety(kept + general, language)
    return result


# ── Meta ───────────────────────────────────────────────────────────────────

def library_meta(db: Session) -> dict:
    """What the library holds, and where its translations are missing.

    Translation coverage is reported as a count, not as a boolean or a label,
    because the honest number today is zero: `advisory_translations` is empty and
    every Hindi or Marathi request falls back to English. Publishing the gap is
    the point -- a UI that showed a language selector without it would imply a
    translation that does not exist.
    """
    library = active_advisories(db)
    total = len(library)

    # Counted in Python over a table of at most a few dozen rows per language, so
    # a translation row pointing at a withdrawn advisory cannot inflate coverage:
    # only advisories that are actually servable are counted.
    servable_ids = {row.id for row in library}
    per_language = {}
    for row in db.query(AdvisoryTranslation).all():
        if row.language in LANGUAGES and row.advisory_id in servable_ids:
            per_language.setdefault(row.language, set()).add(row.advisory_id)

    languages = []
    for code in LANGUAGES:
        human = len(per_language.get(code, ()))
        canonical = code == DEFAULT_LANGUAGE
        servable = total if canonical else human
        languages.append({
            'language': code,
            'name': LANGUAGE_NAMES[code],
            'is_canonical': canonical,
            'human_translations': human,
            'advisories_total': total,
            'servable_in_this_language': servable,
            'falls_back_to_english': 0 if canonical else total - human,
            'coverage_percent': round(servable / total * 100, 1) if total else 0.0,
            'meaning': (
                CANONICAL_LANGUAGE_NOTE if canonical else (
                    f'{human} of {total} advisories have a human {LANGUAGE_NAMES[code]} '
                    f'translation. The remaining {total - human} are returned as '
                    'canonical English with is_fallback true.'
                )
            ),
        })

    conditions = {}
    for row in library:
        entry = conditions.setdefault((row.crop, row.condition), {
            'crop': row.crop,
            'condition': row.condition,
            'condition_kind': row.condition_kind,
            'advisories': 0,
            'categories': set(),
        })
        entry['advisories'] += 1
        entry['categories'].add(row.category)

    return {
        'advisories_total': total,
        'category_order': list(CATEGORY_ORDER),
        'category_order_note': CATEGORY_ORDER_NOTE,
        'categories': [
            {
                'category': category,
                'position': index + 1,
                'meaning': CATEGORY_MEANING[category],
                'advisories': sum(1 for row in library if row.category == category),
            }
            for index, category in enumerate(CATEGORY_ORDER)
        ],
        'languages': languages,
        'default_language': DEFAULT_LANGUAGE,
        'translation_policy': NO_TRANSLATION_POLICY,
        'crops_covered': crops_covered(library),
        'conditions_covered': [
            {**entry,
             'categories': [c for c in CATEGORY_ORDER if c in entry['categories']]}
            for entry in sorted(conditions.values(),
                                key=lambda e: (e['crop'], e['condition']))
        ],
        'rule_versions': sorted({row.rule_version for row in library if row.rule_version}),
        'provenance_keys': list(REQUIRED_PROVENANCE_KEYS),
        'safety_rule': {
            'applies_to': ['category=chemical', 'states_dose=true'],
            **SAFETY_STATEMENTS,
        },
        'safety_translations_available': ['en', 'hi', 'mr'],
        'safety_translation_note': (
            'Safety statements are available in English, Hindi, and Marathi. These are '
            'human-reviewed translations and are returned based on the requested language. '
            'Safety content is never machine-translated.'
        ),
        'disclaimer_translations_available': ['en', 'hi', 'mr'],
        'disclaimer_translation_note': (
            'Screening disclaimers are available in English, Hindi, and Marathi. These are '
            'human-reviewed translations and are critical safety content that protects '
            'farmers from acting on unconfirmed predictions.'
        ),
        'claim': (
            'Every advisory here is a curated practice quoted from a named Indian '
            'agricultural authority. None is model-generated, and none is a diagnosis '
            'or a prescription for a particular field.'
        ),
    }


# ── For one screening ──────────────────────────────────────────────────────

SCREENING_DISCLAIMER = (
    'This screening is a machine-learning prediction from a photograph. It is not a '
    'diagnosis, and it has not been confirmed by anyone. The guidance below is '
    'general practice quoted verbatim from the cited source for this crop and '
    'condition -- it is not a prescription for your field, and it does not account '
    'for your soil, weather, variety, or crop stage. Confirm the condition with your '
    'Krishi Vigyan Kendra (KVK) or your state extension officer before acting on it, '
    'and before buying or applying any input.'
)

# Human-reviewed translations of screening disclaimer for Hindi and Marathi
# CRITICAL CONTENT: These disclaimers protect farmers from acting on unconfirmed
# predictions. Only qualified translators should update these.
SCREENING_DISCLAIMER_HI = (
    'यह स्क्रीनिंग एक तस्वीर से मशीन-लर्निंग का अनुमान है। यह निदान नहीं है, और '
    'इसकी किसी ने पुष्टि नहीं की है। नीचे दिया गया मार्गदर्शन इस फसल और स्थिति के '
    'लिए उद्धृत स्रोत से शब्दशः उद्धृत सामान्य अभ्यास है -- यह आपके खेत के लिए '
    'नुस्खा नहीं है, और यह आपकी मिट्टी, मौसम, किस्म, या फसल चरण को ध्यान में नहीं '
    'रखता है। इस पर कार्य करने से पहले, और कोई भी इनपुट खरीदने या लागू करने से पहले, '
    'अपने कृषि विज्ञान केंद्र (KVK) या अपने राज्य विस्तार अधिकारी से स्थिति की पुष्टि करें।'
)

SCREENING_DISCLAIMER_MR = (
    'ही स्क्रीनिंग एका छायाचित्रावरून मशीन-लर्निंगचा अंदाज आहे. हे निदान नाही, '
    'आणि कोणीही याची पुष्टी केली नाही. खाली दिलेला मार्गदर्शन या पिकासाठी आणि '
    'परिस्थितीसाठी उद्धृत स्रोताकडून शब्दशः उद्धृत केलेला सामान्य सराव आहे -- हे '
    'तुमच्या शेतासाठी प्रिस्क्रिप्शन नाही, आणि तुमची माती, हवामान, जात, किंवा पीक '
    'अवस्था विचारात घेत नाही. यावर कृती करण्यापूर्वी, आणि कोणतेही इनपुट खरेदी '
    'किंवा लागू करण्यापूर्वी, तुमच्या कृषी विज्ञान केंद्राशी (KVK) किंवा तुमच्या '
    'राज्य विस्तार अधिकाऱ्याकडून परिस्थितीची पुष्टी करा.'
)


def get_localized_disclaimer(language: str = DEFAULT_LANGUAGE) -> str:
    """Return the screening disclaimer in the requested language.

    Only Hindi and Marathi translations exist. These are CRITICAL CONTENT that
    must only be updated by qualified translators who understand agricultural
    terminology and the legal/safety implications.
    """
    if language == 'hi':
        return SCREENING_DISCLAIMER_HI
    elif language == 'mr':
        return SCREENING_DISCLAIMER_MR
    else:
        return SCREENING_DISCLAIMER


def advisories_for_screening(
    db: Session,
    observation: DiseaseObservation,
    language: str = DEFAULT_LANGUAGE,
) -> dict:
    """Matched advisories for one screening, with the prediction stated as such.

    The crop matched on is the crop the farmer recorded where there is one, not
    the crop the model inferred: the recorded crop is a fact about the field and
    the prediction is a guess about a photograph. `crop_consistency` is returned
    alongside so a disagreement between the two is visible rather than resolved
    silently.
    """
    crop = db.get(Crop, observation.crop_id) if observation.crop_id else None
    recorded_crop = crop.crop_name if crop else None
    model_crop = predicted_crop(observation.predicted_class)

    if recorded_crop:
        crop_used, crop_source = recorded_crop, 'recorded_crop'
    else:
        crop_used, crop_source = model_crop, 'predicted_class'

    condition = class_condition(observation.predicted_class)
    result = match_advisories(db, crop_used, condition, language)

    result['observation_id'] = observation.id
    result['screening'] = {
        'predicted_class': observation.predicted_class,
        'confidence': observation.confidence,
        'model_version': observation.model_version,
        'screened_at': observation.screened_at.isoformat() if observation.screened_at else None,
        'claim': (
            'What the model thinks the photograph resembles. Not a diagnosis, not a '
            'confirmation, and not an official determination.'
        ),
    }
    result['matched_on'] = {
        'crop': crop_used,
        'crop_source': crop_source,
        'crop_source_note': (
            'Matched on the crop recorded for this field, not on the crop the model '
            'inferred.' if crop_source == 'recorded_crop' else
            'No crop was recorded for this screening, so the crop named by the '
            'predicted class was used. A recorded crop would be more reliable.'
        ),
        'condition': condition,
    }
    result['crop_consistency'] = crop_consistency(
        observation.predicted_class, recorded_crop)
    result['disclaimer'] = get_localized_disclaimer(language)
    result['disclaimer_language'] = language
    result['category_order'] = list(CATEGORY_ORDER)
    result['category_order_note'] = CATEGORY_ORDER_NOTE
    return result
