FROM python:3.11-slim

# System packages needed to compile/run Radiance + Ladybug Tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    make \
    cmake \
    libpq-dev \
    libgeos-dev \
    libgl1 \
    libglib2.0-0 \
    curl \
    wget \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Radiance (pre-built binary release) — optional, falls back to synthetic engine
COPY worker/install_radiance.sh /install_radiance.sh
RUN bash /install_radiance.sh || echo "[install_radiance] Skipping — Radiance not available for this platform/version (synthetic fallback will be used)"

# Make Radiance binaries visible to the Python process at runtime
ENV PATH="/usr/local/radiance/bin:${PATH}"
ENV RAYPATH="/usr/local/radiance/lib"

WORKDIR /app

# Copy and install Python deps (same as backend + ladybug extras)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/app ./app
COPY backend/data ./data

# Celery worker entry point
CMD ["celery", "-A", "app.tasks.celery_app", "worker", "--loglevel=info", "--concurrency=2"]
