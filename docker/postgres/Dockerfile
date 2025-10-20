FROM postgres:17

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    postgresql-server-dev-17 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pgvector
RUN cd /tmp && \
    git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git && \
    cd pgvector && \
    make && \
    make install && \
    cd .. && \
    rm -rf pgvector

# Install pgmq
RUN cd /tmp && \
    git clone https://github.com/tembo-io/pgmq.git && \
    cd pgmq/pgmq-extension && \
    make && \
    make install && \
    cd ../.. && \
    rm -rf pgmq

# Cleanup
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy initialization script
COPY init-extensions.sql /docker-entrypoint-initdb.d/02-extensions.sql