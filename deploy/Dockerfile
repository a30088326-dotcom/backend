FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
RUN apk upgrade --no-cache && apk add --no-cache tzdata
ENV NODE_ENV=production PORT=3001 TZ=Asia/Colombo
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node deploy/start.cjs deploy/runtime-config.cjs ./deploy/
RUN mkdir uploads && chown node:node uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.cjs"]
