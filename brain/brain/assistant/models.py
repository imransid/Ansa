"""What core sends the brain for one reply, and what the brain answers. Strict:
an unknown field is refused (core is the only sender)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Business(Strict):
    name: str = Field(max_length=500)
    description: str = Field(default="", max_length=2_000)
    address: str = Field(default="", max_length=2_000)
    phone: str | None = Field(default=None, max_length=100)


class Hours(Strict):
    time_zone: str = Field(max_length=100)
    now: str = Field(max_length=200)
    weekly: list[str] = Field(default_factory=list, max_length=14)


class Ordering(Strict):
    delivery: bool = False
    delivery_note: str = Field(default="", max_length=2_000)
    pickup: bool = True
    payment_note: str = Field(default="", max_length=2_000)


class Orders(Strict):
    takes_orders: bool = False
    delivery_fee: str | None = Field(default=None, max_length=50)
    in_progress: list[str] = Field(default_factory=list, max_length=60)
    placed: list[str] = Field(default_factory=list, max_length=5)


class MenuItem(Strict):
    label: str = Field(max_length=10)
    category: str = Field(default="", max_length=200)
    name: str = Field(max_length=500)
    description: str = Field(default="", max_length=2_000)
    price: str = Field(max_length=50)


class Line(Strict):
    sender: Literal["customer", "restaurant"]
    text: str = Field(max_length=20_000)


class ReplyRequest(Strict):
    """One company's slice for one answer: never an id or another company's data."""

    kind: Literal["business", "personal"]
    business: Business
    hours: Hours | None = None
    ordering: Ordering = Ordering()
    orders: Orders = Orders()
    menu: list[MenuItem] = Field(default_factory=list, max_length=600)
    instructions: str = Field(default="", max_length=4_000)
    # Escaped <article> blocks, built by core from the company's approved articles.
    knowledge: str = Field(default="", max_length=10_000)
    categories: list[str] = Field(default_factory=list, max_length=200)
    conversation: list[Line] = Field(max_length=40)
    # The business's own Claude key (decrypted by core), or None for ansa's.
    api_key: str | None = Field(default=None, max_length=300)
