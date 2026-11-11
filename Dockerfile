FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
# Electron is a devDependency (desktop app); the server image does not need its binary
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
