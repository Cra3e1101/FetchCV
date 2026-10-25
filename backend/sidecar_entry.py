from __future__ import annotations

from applyos_api.startup_trace import mark_python_entry

mark_python_entry()

import argparse
import multiprocessing


def main() -> None:
    parser = argparse.ArgumentParser(description="Job Agent local API sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    # freeze_support runs before the web stack is imported in frozen workers.
    import uvicorn
    from applyos_api.main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
