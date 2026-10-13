# Custom benchmark packaging, NOT an official Zinder release image.
# Override BASE_IMAGE with a verified Debian 12 digest before the recorded run.
ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE}
ARG ZINDER_ARCHIVE_SHA256=860c21198198c0df6f3c7de5e71ca8b8ea75758fad93f628e935eb502cf48ce8
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libstdc++6 python3 \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 2 \
      https://github.com/ZcashFoundation/zinder/releases/download/v0.6.0/zinder-0.6.0-x86_64-v3-unknown-linux-gnu.tar.gz \
      --output /tmp/zinder.tar.gz \
    && printf '%s  /tmp/zinder.tar.gz\n' "$ZINDER_ARCHIVE_SHA256" | sha256sum --check - \
    && mkdir -p /opt/zinder-release \
    && tar -xzf /tmp/zinder.tar.gz --strip-components=1 -C /opt/zinder-release \
    && rm /tmp/zinder.tar.gz
COPY config/ /etc/zeer-zinder/
COPY supervisor.py /opt/zeer-zinder/supervisor.py
ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python3", "/opt/zeer-zinder/supervisor.py"]
