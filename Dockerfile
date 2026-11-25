FROM node:22-bookworm-slim

WORKDIR /app

# Prisma's Linux query engine needs OpenSSL libraries. Install them explicitly
# so Prisma can select the correct engine target instead of guessing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Database migrations run as a one-off release/pre-deploy command:
# npm run setup
CMD ["npm", "run", "start"]
