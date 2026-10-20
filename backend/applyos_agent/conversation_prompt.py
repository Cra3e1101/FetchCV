from __future__ import annotations

from applyos_domain.models import Job

from .config import AgentSettings
from .prompt_contract import build_system_prompt


def build_conversation_request(
    settings: AgentSettings,
    job: Job,
    message: str,
    context: str,
    thinking_level: str,
) -> tuple[str, str]:
    """Build the provider-independent FetchCV conversation contract.

    This module deliberately has no Agent runtime dependency. Both the legacy
    Python runtime and the Pi runtime bridge use the same system contract while
    the migration is in progress.
    """

    context_prompt = (
        "<active_workspace>\n"
        f"job_id: {job.id}\ncompany: {job.company}\nrole: {job.role}\n"
        "这里只标识当前桌面工作区，不包含 JD 或候选人事实。\n"
        "</active_workspace>\n"
        "<conversation_history>\n"
        f"{context}\n"
        "</conversation_history>\n"
    )
    prompt = f"{context_prompt}<user_message>\n{message}\n</user_message>"
    system_prompt = build_system_prompt(settings, workspace=True, thinking_level=thinking_level)
    return prompt, system_prompt
