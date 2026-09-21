import {
  currentTenantId,
  runInContext,
  runWithoutTenantScope,
  setTenantScope,
  type RequestContext,
} from './request-context';

const baseContext = (): RequestContext => ({
  requestId: 'req-1',
  userId: null,
  role: null,
  tenantId: null,
  isPartnerRequest: false,
  audited: false,
  ip: null,
  userAgent: null,
});

describe('request context', () => {
  it('has no tenant outside a request', () => {
    expect(currentTenantId()).toBeNull();
  });

  it('keeps the scope across awaits', async () => {
    await runInContext(baseContext(), async () => {
      setTenantScope('tenant-a');
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(currentTenantId()).toBe('tenant-a');
    });
  });

  it('does not leak the scope between concurrent requests', async () => {
    const seen: string[] = [];

    const request = (tenantId: string, delay: number) =>
      runInContext(baseContext(), async () => {
        setTenantScope(tenantId);
        await new Promise((resolve) => setTimeout(resolve, delay));
        seen.push(currentTenantId()!);
      });

    await Promise.all([request('tenant-a', 20), request('tenant-b', 5), request('tenant-c', 12)]);

    expect(seen.sort()).toEqual(['tenant-a', 'tenant-b', 'tenant-c']);
  });

  it('restores the tenant after a platform-scoped block', async () => {
    await runInContext(baseContext(), async () => {
      setTenantScope('tenant-a');
      await runWithoutTenantScope(async () => {
        expect(currentTenantId()).toBeNull();
      });
      expect(currentTenantId()).toBe('tenant-a');
    });
  });

  it('restores the tenant even when the block throws', async () => {
    await runInContext(baseContext(), async () => {
      setTenantScope('tenant-a');
      await expect(
        runWithoutTenantScope(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(currentTenantId()).toBe('tenant-a');
    });
  });
});
