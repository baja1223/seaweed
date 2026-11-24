FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

USER node

EXPOSE 4000 4001 4002 4003 4173

CMD ["node", "auth_server.js"]
