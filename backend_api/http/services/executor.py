"""Shared thread pool executor for long-running computational and simulation tasks."""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor
import os

JOB_WORKER_POOL_SIZE = int(os.getenv("JOB_WORKER_POOL_SIZE", "10"))

job_executor = ThreadPoolExecutor(
    max_workers=JOB_WORKER_POOL_SIZE,
    thread_name_prefix="labcd-job-worker",
)


def shutdown_executor(wait: bool = False) -> None:
    job_executor.shutdown(wait=wait, cancel_futures=True)


atexit.register(shutdown_executor)
