import { BadRequestException } from '@nestjs/common';

/**
 * The partner error vocabulary, kept byte-compatible with the incumbent's so an
 * existing integration's error handling keeps working after repointing.
 */
export const PartnerError = {
  NO_COMPANY: 'No company found',
  VISIT_TYPE_NOT_ENABLED: 'Company does not have that visit type',
  NO_MED_MATCH: (medId: string) => `No match for ${medId}`,
  PHARMACY_MISMATCH: 'Pharmacy mismatch in patientPreference',
  /**
   * The chosen pharmacy does not carry that medication. Names the medId,
   * because "mismatch" alone leaves an integrator guessing which line was
   * wrong when a visit requests several.
   */
  NOT_STOCKED: (medId: string, pharmacy: string) =>
    `${pharmacy} does not stock ${medId}. Call GET /partner/v1/pharmacies/{pharmacyId}/medications for what it carries.`,
  BRANDED_WITH_COMPOUNDING: 'Branded med with compounding pharmacy',
  STATE_NOT_VALID: 'State not valid',
  DUPLICATE_MASTER_ID: 'Duplicate masterId',
  NOT_ELIGIBLE: 'Patient not eligible for new visit',
  MISSING_VALUES: 'Missing values',
  /** No visit with that masterId on this account — or it has been withdrawn. */
  VISIT_NOT_FOUND: 'No visit found for that masterId',
  /**
   * A clinician has already read the chart and decided against what it said.
   * Editing it now would leave the decision and the record disagreeing.
   */
  VISIT_ALREADY_DECIDED: 'That visit has already been decided and can no longer be changed',
  GENERIC: 'Something went wrong, please check all data',
} as const;

/** Partner responses are `{ status, error }`, not Nest's default envelope. */
export function partnerBadRequest(error: string): BadRequestException {
  return new BadRequestException({ status: 400, error });
}
