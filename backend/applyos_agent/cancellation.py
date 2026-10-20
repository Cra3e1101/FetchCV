from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from threading import RLock
from typing import Callable, Iterator


_request_scope: ContextVar[str | None] = ContextVar("fetchcv_provider_request_scope", default=None)


class ProviderRequestRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._handles: dict[str, dict[int, Callable[[], None]]] = {}
        self._signals: dict[str, str] = {}
        self._counter = 0

    def register(self, request_id: str | None, cancel: Callable[[], None]) -> tuple[str, int] | None:
        if not request_id:
            return None
        with self._lock:
            self._counter += 1
            key = (request_id, self._counter)
            self._handles.setdefault(request_id, {})[self._counter] = cancel
            signal = self._signals.get(request_id)
        if signal:
            self._invoke(cancel)
        return key

    def unregister(self, key: tuple[str, int] | None) -> None:
        if not key:
            return
        request_id, handle_id = key
        with self._lock:
            handles = self._handles.get(request_id)
            if handles:
                handles.pop(handle_id, None)
                if not handles:
                    self._handles.pop(request_id, None)

    def cancel(self, request_id: str, *, signal: str) -> bool:
        with self._lock:
            self._signals[request_id] = signal
            handles = list(self._handles.get(request_id, {}).values())
        for cancel in handles:
            self._invoke(cancel)
        return bool(handles)

    def signal(self, request_id: str | None = None) -> str | None:
        key = request_id or _request_scope.get()
        with self._lock:
            return self._signals.get(key) if key else None

    def clear(self, request_id: str) -> None:
        with self._lock:
            self._signals.pop(request_id, None)

    @staticmethod
    def _invoke(cancel: Callable[[], None]) -> None:
        try:
            cancel()
        except Exception:
            pass


provider_requests = ProviderRequestRegistry()


def current_request_id(explicit: str | None = None) -> str | None:
    return explicit or _request_scope.get()


def bind_request_scope(request_id: str) -> Token:
    provider_requests.clear(request_id)
    return _request_scope.set(request_id)


def reset_request_scope(token: Token) -> None:
    _request_scope.reset(token)


@contextmanager
def cancellable_handle(cancel: Callable[[], None], *, request_id: str | None = None) -> Iterator[None]:
    resolved = current_request_id(request_id)
    key = provider_requests.register(resolved, cancel)
    try:
        signal = provider_requests.signal(resolved)
        if signal:
            raise ProviderRequestCancelled(signal)
        yield
        signal = provider_requests.signal(resolved)
        if signal:
            raise ProviderRequestCancelled(signal)
    except ProviderRequestCancelled:
        raise
    except BaseException as exc:
        # Closing an in-flight transport generally surfaces as a socket/HTTP
        # error first. Preserve the user's pause/cancel intent at this boundary.
        signal = provider_requests.signal(resolved)
        if signal:
            raise ProviderRequestCancelled(signal) from exc
        raise
    finally:
        provider_requests.unregister(key)


class ProviderRequestCancelled(Exception):
    def __init__(self, signal: str):
        super().__init__(signal)
        self.signal = signal


def raise_if_cancelled(request_id: str | None = None) -> None:
    signal = provider_requests.signal(current_request_id(request_id))
    if signal:
        raise ProviderRequestCancelled(signal)
