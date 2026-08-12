FROM oven/bun:1 AS base

WORKDIR /app

# Doctor and the subtask exporter run as bounded Python subprocesses. Keep
# their dependencies in an isolated venv instead of modifying system Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/lerobot-python
ENV PYTHON_BIN=/opt/lerobot-python/bin/python

# Install Python dependencies before application sources for layer caching.
COPY scripts/requirements.txt scripts/requirements-doctor.txt ./scripts/
RUN /opt/lerobot-python/bin/pip install --no-cache-dir \
    -r scripts/requirements.txt \
    -r scripts/requirements-doctor.txt

# Install dependencies first for better layer caching.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# The container expects local LeRobot datasets to be mounted at /data/lerobot,
# either via `-v ~/.cache/huggingface/lerobot:/data/lerobot` on the host or
# a Docker named volume.
ENV LOCAL_DATASET_ROOT=/data/lerobot
VOLUME ["/data/lerobot"]

EXPOSE 7860
ENV PORT=7860

CMD ["bun", "start"]
