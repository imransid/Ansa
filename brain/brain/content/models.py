"""What core sends for one content studio draft: one company's slice, read
strictly (an unknown field, such as a company id, is refused)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TOPIC_KEY = r"^[a-z_]{1,40}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FeedCut(Strict):
    characters: int = Field(ge=1, le=1_000)
    more_label: str = Field(max_length=40)


class PlatformRules(Strict):
    key: Literal["linkedin", "facebook", "x", "youtube"]
    name: str = Field(max_length=40)
    accepted_formats: str = Field(max_length=200)
    title_max: int = Field(ge=0, le=1_000)
    text_label: str = Field(max_length=40)
    text_max: int = Field(ge=1, le=100_000)
    text_counting: Literal["x", "characters", "utf8-bytes"]
    refuses_angle_brackets: bool
    hashtags_max: int = Field(ge=0, le=100)
    hashtags_recommended: int = Field(ge=0, le=100)
    feed_cut: FeedCut | None = None


class Pillar(Strict):
    name: str = Field(max_length=1_000)
    description: str | None = Field(default=None, max_length=5_000)
    example_topics: list[str] = Field(default_factory=list, max_length=50)


class Campaign(Strict):
    name: str = Field(max_length=1_000)
    objective: str | None = Field(default=None, max_length=5_000)
    timing: str | None = Field(default=None, max_length=5_000)
    call_to_action: str | None = Field(default=None, max_length=5_000)


class Audience(Strict):
    name: str = Field(max_length=1_000)
    needs: str = Field(max_length=5_000)
    where_to_reach: str = Field(max_length=5_000)


class Plan(Strict):
    positioning: str = Field(max_length=5_000)
    audiences: list[Audience] = Field(default_factory=list, max_length=20)


class Fact(Strict):
    topic: str = Field(pattern=TOPIC_KEY)
    label: str = Field(max_length=100)
    value: str = Field(max_length=10_000)


class DraftRequest(Strict):
    """One company's slice for one draft: never an id or another company's data."""

    platform: PlatformRules
    format: Literal["post", "image_post", "video"]
    format_name: str = Field(max_length=60)
    topic: str = Field(max_length=2_000)
    pillar: Pillar | None = None
    campaign: Campaign | None = None
    plan: Plan | None = None
    facts: list[Fact] = Field(default_factory=list, max_length=40)
    words_to_avoid: list[str] = Field(default_factory=list, max_length=100)
    # Approved marketing articles, already in escaped <article> tags (core's knowledge slice).
    knowledge_slice: str = Field(default="", max_length=20_000)
    topic_keys: list[str] = Field(max_length=40)
