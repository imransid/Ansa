"""What core sends the brain for one comment. Strict: an unknown field is
refused (core is the only sender). The business's details are the ones the
chat assistant reads (brain.assistant.models)."""

from typing import Literal

from pydantic import Field

from brain.assistant.models import Business, DishName, Hours, MenuItem, Ordering, Orders, Strict


class CommentRequest(Strict):
    """One business's slice for one comment: never an id, the commenter's
    name or another company's data."""

    kind: Literal["business"]
    business: Business
    hours: Hours | None = None
    ordering: Ordering = Ordering()
    orders: Orders = Orders()
    menu: list[MenuItem] = Field(default_factory=list, max_length=600)
    not_available_today: list[DishName] = Field(default_factory=list, max_length=600)
    instructions: str = Field(default="", max_length=4_000)
    # Escaped <article> blocks, built by core from the company's approved articles.
    knowledge: str = Field(default="", max_length=10_000)
    categories: list[str] = Field(default_factory=list, max_length=200)
    # The post the comment is under (the business's own words, "" when core
    # couldn't read it) and the comment itself, both cut by core.
    post: str = Field(default="", max_length=1_000)
    comment: str = Field(min_length=1, max_length=2_000)
    # Which AI answers: the Claude API (the business's own key, or None for
    # ansa's), or Claude Code on this computer (development only).
    engine: Literal["api_key", "claude_code"] = "api_key"
    api_key: str | None = Field(default=None, max_length=300)
