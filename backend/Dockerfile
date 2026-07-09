FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
