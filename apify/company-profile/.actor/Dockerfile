# Build stage: compile TypeScript with the dev dependencies.
FROM apify/actor-node:24 AS builder
COPY --chown=myuser:myuser package*.json ./
RUN npm ci --include=dev --audit=false
COPY --chown=myuser:myuser . ./
RUN npm run build

# Run stage: production dependencies and the compiled code only.
FROM apify/actor-node:24
COPY --chown=myuser:myuser package*.json ./
RUN npm ci --omit=dev --omit=optional --audit=false \
    && echo "Node.js version:" && node --version \
    && echo "NPM version:" && npm --version
COPY --from=builder --chown=myuser:myuser /usr/src/app/dist ./dist
COPY --chown=myuser:myuser . ./
CMD ["node", "dist/main.js"]
