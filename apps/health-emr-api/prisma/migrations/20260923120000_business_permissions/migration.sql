-- Grants covering the money, oversight and integrations.
--
-- Added rather than replacing: the six that existed keep working, and nobody
-- gains anything by this migration running. An owner hands out the new ones
-- deliberately, which is the point of having them separately.
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'FINANCE_VIEW';
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'FINANCE_MANAGE';
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'AUDIT_READ';
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'WORKFORCE_VIEW';
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'DATA_EXPORT';
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'API_KEYS_MANAGE';
