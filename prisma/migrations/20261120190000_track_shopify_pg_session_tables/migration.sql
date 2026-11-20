-- Track the existing Shopify PostgreSQL session-storage tables.
-- These tables already exist in the development database.

CREATE TABLE "shopify_sessions" (
    "id" VARCHAR(255) NOT NULL,
    "shop" VARCHAR(255) NOT NULL,
    "state" VARCHAR(255) NOT NULL,
    "isOnline" BOOLEAN NOT NULL,
    "scope" VARCHAR(1024),
    "expires" INTEGER,
    "accessToken" VARCHAR(255),
    "refreshToken" VARCHAR(255),
    "refreshTokenExpires" BIGINT,
    "userId" BIGINT,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    "email" VARCHAR(255),
    "accountOwner" BOOLEAN,
    "locale" VARCHAR(255),
    "collaborator" BOOLEAN,
    "emailVerified" BOOLEAN,

    CONSTRAINT "shopify_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify_sessions_migrations" (
    "migration_name" VARCHAR(255) NOT NULL,

    CONSTRAINT "shopify_sessions_migrations_pkey"
        PRIMARY KEY ("migration_name")
);