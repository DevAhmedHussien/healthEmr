-- Registering or repointing an outbound endpoint decides where a patient's
-- information is sent, which is not the same event as any other settings change.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WEBHOOK_CHANGED';
