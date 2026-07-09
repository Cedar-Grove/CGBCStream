# Build context is the repo root (see docker-compose.yml) so this stage
# can reach ../frontend.
FROM node:20-alpine AS frontend-build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build
# vite's outDir (../backend/public) lands the build at /repo/backend/public

FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm run build

COPY --from=frontend-build /repo/backend/public ./public

EXPOSE 3000

CMD ["npm", "start"]
