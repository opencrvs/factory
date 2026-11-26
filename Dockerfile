# Factory Server image for the OpenCRVS non-prod cluster.
#
# The server runs agent commands in local sandboxes, inside this container.
# So the image also holds the tools that agents need to work on
# opencrvs-core: git, the Node.js version from opencrvs-core/.nvmrc, pnpm
# and native build tools. The full (not slim) Debian image has git, curl,
# python3, make and g++.
FROM node:22.23.4-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends jq ripgrep tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run check && npm run build

COPY docker-entrypoint.sh /usr/local/bin/factory-entrypoint.sh

# /data is the persistent volume. HOME is on it, so the session directories
# (~/.mastracode/web/sandboxes), git config and the pnpm store stay after a
# restart.
ENV NODE_ENV=production \
  PORT=4111 \
  MASTRA_HOST=0.0.0.0 \
  HOME=/data/home

EXPOSE 4111

# tini is PID 1. It stops the agent processes that the sandboxes start and
# collects them when they exit.
ENTRYPOINT ["tini", "--", "/usr/local/bin/factory-entrypoint.sh"]
CMD ["npm", "run", "start"]
