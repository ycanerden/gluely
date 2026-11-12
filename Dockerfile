# One container that keeps a Gluely workspace's runs moving. The workspace lives on a disk
# mounted at /data, so a restart or a redeploy loses nothing.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin bin
COPY src src
COPY library library
COPY templates templates
COPY skills skills
COPY site/fonts site/fonts
RUN ln -s /app/bin/gluely.js /usr/local/bin/gluely && chmod +x /app/bin/gluely.js
ENV NODE_ENV=production GLUELY_WORKSPACE=/data/brain
# git refuses to work in a folder another user owns, and the disk is mounted as root.
RUN git config --system --add safe.directory /data/brain
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gluely", "worker", "--pull"]
