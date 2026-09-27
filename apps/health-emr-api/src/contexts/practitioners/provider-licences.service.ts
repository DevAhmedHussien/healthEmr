import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProviderLicenceInput, ProviderLicenceUpdate } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

const LICENCE_FIELDS = {
  id: true,
  state: true,
  licenseNumber: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
} as const;

type Licence = {
  id: string;
  state: string;
  licenseNumber: string;
  status: string;
  issuedAt: Date | null;
  expiresAt: Date;
};

const shape = (licence: Licence) => ({
  ...licence,
  issuedAt: licence.issuedAt?.toISOString() ?? null,
  expiresAt: licence.expiresAt.toISOString(),
});

/**
 * Adding, changing and removing the states a clinician may prescribe in.
 *
 * Until now licences could only be created during onboarding, which meant a
 * clinician who qualified in a new state had no way to be given it — the only
 * route was to re-apply. Both seats can reach this: the platform, which
 * credentials people, and the clinician, who knows first.
 *
 * The two are not equivalent, and that asymmetry is the whole design. Routing
 * admits a provider only on a licence that is ACTIVE, so what the platform adds
 * can be routable immediately and what a clinician adds for themselves arrives
 * PENDING and is not. Otherwise typing a licence number into a form would be
 * enough to start receiving patients in a state nobody had checked.
 */
@Injectable()
export class ProviderLicencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every licence a provider holds, soonest to expire first. */
  async list(providerId: string) {
    await this.mustExist(providerId);
    const licences = await this.prisma.raw.providerLicense.findMany({
      where: { providerId },
      select: LICENCE_FIELDS,
      orderBy: [{ expiresAt: 'asc' }, { state: 'asc' }],
    });
    return { data: licences.map(shape) };
  }

  /**
   * Add one.
   *
   * `verified` says which seat is asking. The platform credentials clinicians,
   * so what it adds is live; a clinician adding their own gets PENDING, which
   * routing will not accept until somebody checks it.
   */
  async add(
    providerId: string,
    input: ProviderLicenceInput,
    actorUserId: string,
    verified: boolean,
  ) {
    await this.mustExist(providerId);

    const expiresAt = new Date(input.expiresAt);
    if (expiresAt <= new Date()) {
      throw new BadRequestException('That licence has already expired');
    }

    // One row per state is a database constraint; catching it here says which
    // state rather than surfacing a unique-violation.
    const existing = await this.prisma.raw.providerLicense.findUnique({
      where: { providerId_state: { providerId, state: input.state } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `This clinician already has a ${input.state} licence. Edit that one instead.`,
      );
    }

    const licence = await this.prisma.raw.providerLicense.create({
      data: {
        providerId,
        state: input.state,
        licenseNumber: input.licenseNumber,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        expiresAt,
        status: verified ? 'ACTIVE' : 'PENDING',
      },
      select: LICENCE_FIELDS,
    });

    await this.audit.record({
      action: 'USER_UPDATED',
      entityType: 'ProviderLicense',
      entityId: licence.id,
      actorUserId,
      after: { providerId, ...shape(licence) },
    });

    return shape(licence);
  }

  /** Change a licence, including whether it counts. */
  async update(
    providerId: string,
    licenceId: string,
    input: ProviderLicenceUpdate,
    actorUserId: string,
  ) {
    const before = await this.mustOwn(providerId, licenceId);
    const { reason, state, licenseNumber, issuedAt, expiresAt, status } = input;

    const after = await this.prisma.raw.providerLicense.update({
      where: { id: licenceId },
      data: {
        ...(state ? { state } : {}),
        ...(licenseNumber ? { licenseNumber } : {}),
        ...(issuedAt !== undefined ? { issuedAt: issuedAt ? new Date(issuedAt) : null } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
        ...(status ? { status } : {}),
      },
      select: LICENCE_FIELDS,
    });

    await this.audit.record({
      action: 'USER_UPDATED',
      entityType: 'ProviderLicense',
      entityId: licenceId,
      actorUserId,
      before: shape(before),
      after: { ...shape(after), ...(reason ? { reason } : {}) },
    });

    return shape(after);
  }

  /**
   * Remove one.
   *
   * Deleting is right here rather than archiving: a licence entered against the
   * wrong clinician is a mistake to erase, not history to keep. A licence that
   * lapsed should be marked EXPIRED instead, which `update` does, and the audit
   * entry written here records what was removed either way.
   */
  async remove(providerId: string, licenceId: string, actorUserId: string) {
    const before = await this.mustOwn(providerId, licenceId);
    await this.prisma.raw.providerLicense.delete({ where: { id: licenceId } });

    await this.audit.record({
      action: 'USER_UPDATED',
      entityType: 'ProviderLicense',
      entityId: licenceId,
      actorUserId,
      before: { providerId, ...shape(before) },
    });

    return { removed: true, state: before.state };
  }

  private async mustExist(providerId: string) {
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true },
    });
    if (!provider) throw new NotFoundException('That provider does not exist');
  }

  /** A licence id alone is not enough — it has to belong to this provider. */
  private async mustOwn(providerId: string, licenceId: string) {
    const licence = await this.prisma.raw.providerLicense.findFirst({
      where: { id: licenceId, providerId },
      select: LICENCE_FIELDS,
    });
    if (!licence) throw new NotFoundException('That licence does not exist');
    return licence;
  }
}
