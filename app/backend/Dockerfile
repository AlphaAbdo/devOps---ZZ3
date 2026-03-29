# multi-stage pour garder l'image finale légère
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# npm install car on a pas forcément le lockfile au premier build
# une fois qu'on a un package-lock.json, on peut passer à npm ci
RUN npm install --omit=dev --ignore-scripts

# stage 2 : image finale sans outils de build
FROM node:20-alpine AS runner
WORKDIR /app

# uid numérique pour que runAsNonRoot marche dans K8s
RUN addgroup -S pixelwar && adduser -S -G pixelwar -u 1001 pixelwar

COPY --from=deps  --chown=pixelwar:pixelwar /app/node_modules ./node_modules
COPY              --chown=pixelwar:pixelwar server.js         ./

USER 1001
EXPOSE 3000
CMD ["node", "server.js"]
