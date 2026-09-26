import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PermanentDeleteService,
  TENANT_DELETE_BLOCKERS,
  TENANT_DELETE_CASCADE_OK,
} from './permanent-delete.service';

/**
 * Deleting a tenant cascades into fifteen tables. What stops it must know all
 * of them.
 *
 * Two halves, and both are needed. The schema half reads the Prisma DMMF and
 * fails when a model carrying a tenant key is classified nowhere — that is the
 * check that catches the next table somebody adds. The service half proves the
 * classification is not merely written down: each blocker is counted by a
 * query the service actually makes, so a name can be listed and still be
 * unenforced for exactly as long as it takes this file to run.
 */

/** Prisma's model name (`PrescriptionRequest`) as the client spells it (`prescriptionRequest`). */
const asClientKey = (model: string) => model[0].toLowerCase() + model.slice(1);

describe('tenant delete blockers', () => {
  const modelsWithTenantKey = Prisma.dmmf.datamodel.models
    .filter((model) =>
      model.fields.some((field) => field.name === 'tenantId' || field.name === 'primaryTenantId'),
    )
    .map((model) => model.name)
    .sort();

  it('classifies every model that carries a tenant key', () => {
    const unaccounted = modelsWithTenantKey.filter(
      (name) =>
        !TENANT_DELETE_BLOCKERS.includes(name as never) && !(name in TENANT_DELETE_CASCADE_OK),
    );
    expect(unaccounted).toEqual([]);
  });

  it('blocks on nothing that has no tenant key', () => {
    const spurious = TENANT_DELETE_BLOCKERS.filter((name) => !modelsWithTenantKey.includes(name));
    expect(spurious).toEqual([]);
  });

  it('gives every cascade a written reason', () => {
    for (const [model, reason] of Object.entries(TENANT_DELETE_CASCADE_OK)) {
      expect(`${model}: ${reason}`.length).toBeGreaterThan(60);
    }
  });

  /**
   * The five that were missing. Named individually rather than left to the
   * count above, because this is the regression: each one is clinical or
   * financial, each cascades, and each was silently destroyed.
   */
  it('blocks on the clinical and financial tables that cascade', () => {
    for (const model of [
      'Encounter',
      'QaSubmission',
      'ChatThread',
      'PharmacyOrder',
      'ProviderEarning',
    ]) {
      expect(TENANT_DELETE_BLOCKERS).toContain(model);
    }
  });

  it('never allows an audit log to be classified as disposable', () => {
    expect(TENANT_DELETE_BLOCKERS).not.toContain('AuditLog');
    expect(TENANT_DELETE_CASCADE_OK.AuditLog).toMatch(/SET NULL|never deleted/i);
  });
});

describe('PermanentDeleteService.inspect', () => {
  /**
   * A Prisma stand-in where every count answers zero unless asked to answer
   * otherwise, so one test can say "only this table has rows" and read back
   * what the service concluded.
   */
  function serviceWith(counts: Record<string, number>) {
    const raw: Record<string, unknown> = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    };

    for (const model of TENANT_DELETE_BLOCKERS) {
      const key = asClientKey(model);
      raw[key] = {
        ...(typeof raw[key] === 'object' ? raw[key] : {}),
        count: jest.fn().mockResolvedValue(counts[model] ?? 0),
      };
    }

    const prisma = { raw } as never;
    const audit = { record: jest.fn() } as never;
    return { service: new PermanentDeleteService(prisma, audit), raw };
  }

  it('reports a clean tenant as deletable', async () => {
    const { service } = serviceWith({});
    const result = await service.inspect('tenant', 't1');

    expect(result.deletable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.alternative).toBeNull();
  });

  it.each(TENANT_DELETE_BLOCKERS)('counts %s when deciding', async (model) => {
    const { service } = serviceWith({ [model]: 3 });
    const result = await service.inspect('tenant', 't1');

    // The label is prose and may be reworded; that a blocker was raised at all
    // is the contract, and it is the half that was missing.
    expect(result.deletable).toBe(false);
    expect(result.blockers.map((blocker) => blocker.count)).toContain(3);
  });

  it('names each blocker in the singular when there is one of it', async () => {
    const { service } = serviceWith({ Encounter: 1, PharmacyOrder: 2 });
    const result = await service.inspect('tenant', 't1');

    expect(result.blockers).toEqual([
      { count: 1, what: 'clinical encounter' },
      { count: 2, what: 'pharmacy orders' },
    ]);
  });

  it('refuses a tenant that does not exist', async () => {
    const { service, raw } = serviceWith({});
    (raw.tenant as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);

    await expect(service.inspect('tenant', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to remove while anything refers to it, and deletes nothing', async () => {
    const { service, raw } = serviceWith({ Encounter: 1 });
    (raw as { tenant: { delete?: jest.Mock } }).tenant.delete = jest.fn();

    await expect(service.remove('tenant', 't1', 'created in error', 'actor')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((raw as { tenant: { delete: jest.Mock } }).tenant.delete).not.toHaveBeenCalled();
  });
});
