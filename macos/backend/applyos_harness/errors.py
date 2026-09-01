from __future__ import annotations

from typing import Any


class HarnessError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        run_id: str | None = None,
        stage: str | None = None,
        details_ref: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.run_id = run_id
        self.stage = stage
        self.details_ref = details_ref
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "run_id": self.run_id,
            "stage": self.stage,
            "details_ref": self.details_ref,
            "details": self.details,
        }
