import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@health-emr/types';
import { ROLES_KEY } from '@/shared/auth/decorators/roles.decorator';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

/**
 * Removing a platform administrator.
 *
 * This path had no checks at all: it hard-deleted the row, and the delete
 * rules did the rest — provider notes cascade, chat messages are stripped of
 * their author. A super admin who broke the glass has written into patient
 * records, and attribution on a medical record is not ours to remove.
 */

function harness(
  user: Record<string, unknown> | null,
  references: Partial<Record<'note' | 'message' | 'participant', number>> = {},
) {
  const raw = {
    user: {
      findUnique: jest.fn(async () => user),
      delete: jest.fn(async () => ({ id: 'sa-1' })),
    },
    providerNote: { count: jest.fn(async () => references.note ?? 0) },
    chatMessage: { count: jest.fn(async () => references.message ?? 0) },
    chatParticipant: { count: jest.fn(async () => references.participant ?? 0) },
  };

  const audit = { record: jest.fn() };
  const invites = { send: jest.fn() };
  return {
    service: new OwnerService({ raw } as never, audit as never, invites as never),
    raw,
    audit,
  };
}

const SUPER_ADMIN = {
  id: 'sa-1',
  email: 'ops@healthemr.test',
  role: Role.SUPER_ADMIN,
  permissions: [],
};

describe('OwnerService.remove', () => {
  it('removes a super admin who wrote nothing clinical', async () => {
    const { service, raw } = harness(SUPER_ADMIN);

    const result = await service.remove('sa-1', 'left the company', 'owner-1');

    expect(result.removed).toBe(true);
    expect(raw.user.delete).toHaveBeenCalledWith({ where: { id: 'sa-1' } });
  });

  it('refuses to delete the account making the request', async () => {
    const { service, raw } = harness(SUPER_ADMIN);

    await expect(service.remove('sa-1', 'tidying up', 'sa-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(raw.user.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['wrote clinical notes', { note: 3 }, /clinical note/],
    ['sent messages', { message: 12 }, /message/],
    ['sat in a patient conversation', { participant: 1 }, /conversation/],
  ])('refuses an account that %s', async (_label, references, message) => {
    const { service, raw } = harness(SUPER_ADMIN, references);

    await expect(service.remove('sa-1', 'left the company', 'owner-1')).rejects.toThrow(message);
    expect(raw.user.delete).not.toHaveBeenCalled();
  });

  it('points at archiving rather than leaving the refusal as a dead end', async () => {
    const { service } = harness(SUPER_ADMIN, { note: 1 });

    await expect(service.remove('sa-1', 'left the company', 'owner-1')).rejects.toThrow(
      /Archive it instead/,
    );
  });

  it('refuses an owner, as it already did', async () => {
    const { service } = harness({ ...SUPER_ADMIN, role: Role.OWNER });

    await expect(service.remove('sa-1', 'tidying up', 'owner-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/**
 * Granting is the authority to divide authority, so it is the one place the
 * role is matched exactly rather than as a superset. A super admin standing in
 * for an owner here would make the whole division one request deep.
 */
describe('who may grant', () => {
  it('reserves the entire owner console to OWNER', () => {
    const roles = new Reflector().get<Role[]>(ROLES_KEY, OwnerController);
    expect(roles).toEqual([Role.OWNER]);
  });

  it('does not let a super admin satisfy it by seniority', () => {
    const roles = new Reflector().get<Role[]>(ROLES_KEY, OwnerController);
    expect(roles).not.toContain(Role.SUPER_ADMIN);
  });
});
