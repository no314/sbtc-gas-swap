FROM node:22-alpine
WORKDIR /app
COPY sdk /sdk
COPY relay/package.json relay/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY relay/dist ./dist
ENV PORT=8787 STATE_FILE=/state/relay-state.json
VOLUME ["/state"]
EXPOSE 8787
CMD ["node", "dist/src/adapters/node.js"]
