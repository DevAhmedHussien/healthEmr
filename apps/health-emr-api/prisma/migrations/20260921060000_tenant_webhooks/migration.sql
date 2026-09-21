-- Webhook endpoints gain a name, the client's own bearer token (encrypted), and
-- enough delivery health to tell a working endpoint from a dead one.
ALTER TABLE "tenant_webhooks"
  ADD COLUMN "name" VARCHAR(120) NOT NULL DEFAULT 'Endpoint',
  ADD COLUMN "authCipher" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(6),
  ADD COLUMN "lastSuccessAt" TIMESTAMPTZ(6),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "disabledAt" TIMESTAMPTZ(6),
  ADD COLUMN "disabledReason" TEXT;

-- The defaults exist only to fill the (empty) table; every row written from now
-- on names itself and carries a credential.
ALTER TABLE "tenant_webhooks" ALTER COLUMN "name" DROP DEFAULT;
ALTER TABLE "tenant_webhooks" ALTER COLUMN "authCipher" DROP DEFAULT;

ALTER TABLE "webhook_deliveries"
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "requestId" UUID;

CREATE INDEX "webhook_deliveries_request_idx" ON "webhook_deliveries" ("requestId");
