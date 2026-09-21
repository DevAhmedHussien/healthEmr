import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS, TENANT_SCOPE_EXEMPT } from './tenant-models';

/**
 * The list the tenant extension trusts must match reality.
 *
 * Adding a model with a `tenantId` column and forgetting to list it is the one
 * way to create a silent cross-tenant leak, so this reads the Prisma DMMF and
 * fails the build on drift. A model may be left unscoped only by appearing in
 * TENANT_SCOPE_EXEMPT with a written reason.
 */
describe('TENANT_SCOPED_MODELS', () => {
  const modelsWithTenantId = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name)
    .sort();

  it('accounts for every model that has a tenantId column', () => {
    const unaccounted = modelsWithTenantId.filter(
      (name) => !TENANT_SCOPED_MODELS.includes(name as never) && !(name in TENANT_SCOPE_EXEMPT),
    );
    expect(unaccounted).toEqual([]);
  });

  it('lists no model that lacks a tenantId column', () => {
    const spurious = TENANT_SCOPED_MODELS.filter((name) => !modelsWithTenantId.includes(name));
    expect(spurious).toEqual([]);
  });

  it('exempts only models that really do have a tenantId column', () => {
    const stale = Object.keys(TENANT_SCOPE_EXEMPT).filter(
      (name) => !modelsWithTenantId.includes(name),
    );
    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const [model, reason] of Object.entries(TENANT_SCOPE_EXEMPT)) {
      expect(reason.length).toBeGreaterThan(40);
      expect(model).toBeTruthy();
    }
  });

  it('scopes the models that actually carry patient data', () => {
    for (const model of ['QaSubmission', 'PrescriptionRequest', 'Prescription', 'Encounter', 'ChatThread', 'TenantPatient']) {
      expect(TENANT_SCOPED_MODELS).toContain(model);
    }
  });
});
