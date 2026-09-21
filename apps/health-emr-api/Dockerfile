# Single container, no Lambda. Runs anywhere that runs Docker — ECS Fargate,
# EC2, or a laptop.
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/types/package.json packages/types/
COPY apps/health-emr-api/package.json apps/health-emr-api/
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN npm install --ignore-scripts
RUN npm run build -w @health-emr/types
RUN npx prisma generate --schema apps/health-emr-api/prisma/schema.prisma
RUN npm run build -w @health-emr/api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/health-emr-api/dist ./dist
COPY --from=build /repo/apps/health-emr-api/prisma ./prisma
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
