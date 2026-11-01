"""The newest performance review as the marketing planner reads it (the old
lib/performance-review/past-performance.ts and stored-review.ts):
<past_performance>, its period, each finding with the numbers it cites,
the recommendations and the limits. Core sends only what the review kept
(every number in it was checked against what the platforms gave), with the
post or group each number names. Every text escaped, card numbers hidden;
a post's topic and a group's name cut as the review's own request sent them."""

from typing import Annotated, Literal

from pydantic import Field

from brain.cofounder.common import Strict, redacted_and_cut, text_for_prompt
from brain.text import escape_html

PROMPT_RULE = (
    "<past_performance>, when present: the newest review of how the business's posts did, measured by the platforms, "
    'with the numbers each finding rests on and what was recommended then (simulated="yes": numbers made up to test the app, not measured). '
    "Build on what worked; never invent other results, and never write a number it doesn't hold."
)

TEXT_MAX = 500
LIMIT_TEXT_MAX = 300
TOPIC_CHARACTERS = 200
NAME_CHARACTERS = 200

PLATFORM_LABELS = {"linkedin": "LinkedIn", "facebook": "Facebook", "x": "X", "youtube": "YouTube"}
FORMAT_LABELS = {"post": "Text post", "image_post": "Post with an image", "video": "Video"}
METRIC_COLUMNS = ["views", "reach", "reactions", "comments", "shares", "clicks", "video_views"]
METRIC_LABELS = {"views": "Views", "reach": "Reach", "reactions": "Reactions", "comments": "Comments", "shares": "Shares", "clicks": "Clicks", "video_views": "Video views"}
# What each platform calls a number (the old lib/metric-definitions.ts);
# one it doesn't offer keeps our own name.
PLATFORM_METRIC_LABELS = {
    "linkedin": {"views": "Impressions", "reach": "Members reached", "shares": "Reposts", "clicks": "Link clicks"},
    "facebook": {"reach": "Viewers"},
    "x": {"views": "Impressions", "reactions": "Likes", "comments": "Replies", "shares": "Reposts and quotes", "clicks": "Link clicks"},
    "youtube": {"reactions": "Likes"},
}

Date = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class PastPost(Strict):
    label: str = Field(max_length=20)
    platform: Literal["linkedin", "facebook", "x", "youtube"]
    format: Literal["post", "image_post", "video"]
    topic: str = Field(max_length=20_000)
    weekday: str = Field(max_length=20)
    hour: str = Field(max_length=10)


class PastGroup(Strict):
    label: str = Field(max_length=20)
    kind: Literal["platform", "pillar", "no_pillar"]
    name: str = Field(max_length=20_000)
    posts: int = Field(ge=0)


class PastNumber(Strict):
    metric: str = Field(max_length=100)
    value: float
    post: PastPost | None = None
    group: PastGroup | None = None
    group_label: str = Field(default="", max_length=100)


class PastFinding(Strict):
    text: str = Field(max_length=5_000)
    numbers: list[PastNumber] = Field(max_length=50)


class PastPerformance(Strict):
    reviewed_on: Date
    posts_from: Date
    posts_to: Date
    posts_with_numbers: int = Field(ge=0)
    simulated: bool
    findings: list[PastFinding] = Field(max_length=50)
    recommendations: list[str] = Field(max_length=50)
    limits: list[str] = Field(max_length=50)


def past_performance_block(past: PastPerformance) -> str:
    simulated = ' simulated="yes"' if past.simulated else ""
    opening = f'<past_performance reviewed_on="{past.reviewed_on}" posts_from="{past.posts_from}" posts_to="{past.posts_to}" posts_with_numbers="{past.posts_with_numbers}"{simulated}>'
    findings = [f"<finding>{text_for_prompt(finding.text, TEXT_MAX)}\n" + "\n".join(_number(number) for number in finding.numbers) + "\n</finding>" for finding in past.findings]
    recommendations = [f"<recommendation>{text_for_prompt(text, TEXT_MAX)}</recommendation>" for text in past.recommendations]
    limits = [f"<limit>{text_for_prompt(text, LIMIT_TEXT_MAX)}</limit>" for text in past.limits]
    return "\n".join([opening, *findings, *recommendations, *limits, "</past_performance>"])


def _number(number: PastNumber) -> str:
    if number.post is not None:
        source, metric = describe_post(number.post), _post_metric(number.post.platform, number.metric)
    else:
        source = describe_group(number.group) if number.group is not None else number.group_label
        metric = describe_group_metric(number.metric)
    return f'<number source="{escape_html(source)}" metric="{escape_html(metric)}" value="{js_number(number.value)}"/>'


def describe_post(post: PastPost) -> str:
    """"P3: “Our sourdough”, LinkedIn text post, Tuesday 09:00"."""
    topic = redacted_and_cut(post.topic, TOPIC_CHARACTERS)
    return f"{post.label}: “{topic}”, {PLATFORM_LABELS[post.platform]} {FORMAT_LABELS[post.format].lower()}, {post.weekday} {post.hour}"


def describe_group(group: PastGroup) -> str:
    name = redacted_and_cut(group.name, NAME_CHARACTERS)
    count = f"{group.posts} {'post' if group.posts == 1 else 'posts'}"
    if group.kind == "platform":
        return f"{group.label}: all {name} posts ({count})"
    if group.kind == "pillar":
        return f"{group.label}: pillar “{name}” ({count})"
    return f"{group.label}: posts without a pillar ({count})"


def _post_metric(platform: str, metric: str) -> str:
    if metric not in METRIC_COLUMNS:
        return metric
    return PLATFORM_METRIC_LABELS[platform].get(metric, METRIC_LABELS[metric])


def describe_group_metric(metric: str) -> str:
    """"views_total" -> "Views (all posts)", "views_per_post" -> "Views per post",
    "views_posts" -> "Posts with views", "posts" -> "Posts"."""
    if metric == "posts":
        return "Posts"
    for column in METRIC_COLUMNS:
        label = METRIC_LABELS[column]
        if metric == f"{column}_total":
            return f"{label} (all posts)"
        if metric == f"{column}_per_post":
            return f"{label} per post"
        if metric == f"{column}_posts":
            return f"Posts with {label.lower()}"
    return metric


def js_number(value: float) -> str:
    """A number as JavaScript writes it: 12, 3.4."""
    return str(int(value)) if float(value).is_integer() and abs(value) < 1e21 else repr(float(value))
