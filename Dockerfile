FROM oven/bun:1.3.8-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

USER bun

CMD ["bun", "run", "src/http.ts"]
