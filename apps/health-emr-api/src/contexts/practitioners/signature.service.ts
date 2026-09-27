import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SignatureInput } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';

/**
 * The clinician's handwritten signature.
 *
 * Drawn once and kept, rather than redrawn for every prescription. That is not
 * a shortcut — a clinician reviewing sixty visits in an afternoon would sign
 * sixty times, and a signature drawn in a hurry sixty times is worth less than
 * one drawn carefully and applied deliberately. What makes each signing an act
 * rather than a rubber stamp is the confirmation at the point of signing, not
 * the redrawing.
 *
 * Encrypted with the same field key as PHI. It is not a patient's data, but it
 * is the mark that makes a prescription theirs, and a readable copy sitting in
 * a database dump is a forgery kit.
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly phi: PhiCryptoService,
  ) {}

  /** What the clinician has on file, decrypted for them to look at. */
  async forProvider(providerId: string) {
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: { signatureImage: true, signatureName: true, signatureCapturedAt: true },
    });
    if (!provider) throw new NotFoundException('That provider does not exist');

    return {
      hasSignature: Boolean(provider.signatureImage),
      image: provider.signatureImage ? this.phi.decrypt(provider.signatureImage) : null,
      name: provider.signatureName,
      capturedAt: provider.signatureCapturedAt?.toISOString() ?? null,
    };
  }

  /**
   * Store or replace it.
   *
   * Replacing does not touch anything already signed: every prescription holds
   * its own copy from the moment it was signed, so a clinician who redraws
   * their signature today has not altered what they put on a prescription last
   * March.
   */
  async capture(providerId: string, input: SignatureInput, actorUserId: string) {
    const existing = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: { signatureCapturedAt: true },
    });
    if (!existing) throw new NotFoundException('That provider does not exist');

    const capturedAt = new Date();
    await this.prisma.raw.providerProfile.update({
      where: { id: providerId },
      data: {
        signatureImage: this.phi.encrypt(input.image),
        signatureName: input.name,
        signatureCapturedAt: capturedAt,
      },
    });

    // The image itself is never written to the audit log — it is the secret
    // being protected. That it changed, and when, is the auditable fact.
    await this.audit.record({
      action: 'USER_UPDATED',
      entityType: 'ProviderProfile',
      entityId: providerId,
      actorUserId,
      before: { signatureOnFile: Boolean(existing.signatureCapturedAt) },
      after: { signatureOnFile: true, capturedAt: capturedAt.toISOString() },
    });

    return { capturedAt: capturedAt.toISOString(), name: input.name };
  }

  /**
   * The signature to stamp onto a prescription being signed now.
   *
   * Returns the encrypted form, because the caller writes it straight to the
   * prescription — decrypting it in between would put a clinician's signature
   * in memory for no reason.
   *
   * Refuses when there is none. A prescription without a signature is not a
   * prescription, and discovering that at the pharmacy is worse than being
   * stopped here.
   */
  async forSigning(providerId: string) {
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: { signatureImage: true, signatureName: true },
    });

    if (!provider?.signatureImage || !provider.signatureName) {
      throw new BadRequestException(
        'Add your signature before signing a prescription. It is on your profile and takes a moment.',
      );
    }

    return {
      signatureSnapshot: provider.signatureImage,
      signatureNameSnapshot: provider.signatureName,
    };
  }

  /** The signature on one prescription, as it was signed. */
  async onPrescription(prescriptionId: string) {
    const prescription = await this.prisma.raw.prescription.findUnique({
      where: { id: prescriptionId },
      select: {
        signatureSnapshot: true,
        signatureNameSnapshot: true,
        providerNameSnapshot: true,
        licenseNumberSnapshot: true,
        licenseStateSnapshot: true,
        signedAt: true,
      },
    });
    if (!prescription) throw new NotFoundException('That prescription does not exist');

    return {
      image: prescription.signatureSnapshot
        ? this.phi.decrypt(prescription.signatureSnapshot)
        : null,
      name: prescription.signatureNameSnapshot ?? prescription.providerNameSnapshot,
      provider: prescription.providerNameSnapshot,
      licence: `${prescription.licenseNumberSnapshot} (${prescription.licenseStateSnapshot})`,
      signedAt: prescription.signedAt.toISOString(),
    };
  }
}
