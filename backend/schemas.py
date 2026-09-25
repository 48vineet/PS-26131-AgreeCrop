from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field
class UserIn(BaseModel):
    """What a caller may supply about themselves.

    ``role`` is deliberately absent. It is a privilege, not a profile field: a
    farmer must not be able to make themselves a reviewer by putting
    ``"role": "expert"`` in a request body. The column is written server-side
    only -- ``auth.py`` sets ``farmer`` when it first sees an account, and any
    promotion to ``expert`` or ``extension_officer`` is an operator action taken
    directly against the database. No endpoint changes it.

    Previously this field existed and was never applied, because
    ``POST /profile/users`` returns early for an account that already exists and
    ``get_current_user`` always creates the row first. That made the safety an
    accident of ordering rather than a property of the schema, which is not a
    safety property at all.
    """
    name: str
    phone: str | None = None
    email: str | None = None
class UserOut(UserIn):
    """A user record as returned. ``role`` is readable, just never writable."""
    id: int
    role: str = 'farmer'

class RoleAssignmentIn(BaseModel):
    role: Literal['farmer', 'extension_worker', 'official']
class FarmIn(BaseModel): user_id:int|None=None; farm_name:str; area:float=Field(gt=0); area_unit:str
class FarmOut(FarmIn): id:int
class LocationIn(BaseModel): latitude:float=Field(ge=-90,le=90); longitude:float=Field(ge=-180,le=180); address:str|None=None; village:str|None=None; district:str|None=None; state:str|None=None; postal_code:str|None=None
class CropIn(BaseModel): crop_name:str; variety:str|None=None; sowing_date:date|None=None; transplanting_date:date|None=None; current_stage:str|None=None
class CropOut(CropIn): id:int; farm_id:int


class CollectionStartIn(BaseModel):
    """Optional context for a new explicit physical collection event."""

    farm_id: int | None = None
    crop_id: int | None = None

class PestObservationIn(BaseModel):
    """One recorded pest observation.

    Only what the observer supplies. Ownership and provenance are derived
    server-side from the authenticated user, so they are deliberately absent
    here -- a client cannot claim a farm or label its own record as extension
    data.

    Field-level checks are the cheap structural ones. Agricultural rules
    (ownership, method vocabulary, timestamp sanity) live in pest_surveillance.py
    so they can return specific, actionable messages.
    """
    farm_id: int
    crop_id: int | None = None
    observed_at: datetime
    method: str
    method_detail: str | None = None
    pest_name: str = Field(min_length=1, max_length=160)
    count: int | None = Field(default=None, ge=0)
    unit: str
    trap_id: str | None = Field(default=None, max_length=60)
    latitude: float | None = None
    longitude: float | None = None
    notes: str | None = Field(default=None, max_length=2000)


class CropHealthConfirmationIn(BaseModel):
    """The small human-in-the-loop decision after AI analysis."""

    confirmation: Literal['correct', 'not_correct', 'unknown_pest', 'manual_fallback']
    correction: Literal['retake_photo', 'unknown_pest', 'manual_fallback'] | None = None


class LanguageIn(BaseModel):
    """The caller's own interface language.

    Unlike ``role``, this is a preference rather than a privilege, so its owner may
    set it. Constrained to the languages the platform actually has content or
    interface strings for -- accepting an arbitrary tag would promise a translation
    that does not exist.
    """

    language: Literal['en', 'hi', 'mr']
