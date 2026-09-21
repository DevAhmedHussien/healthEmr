/**
 * The LifeFile order contract.
 *
 * Transcribed from the integration JoeyMed already runs in production against
 * First Choice, so a pharmacy that accepts their orders accepts ours unchanged.
 * Field lengths matter: LifeFile rejects an order whose `lastName` exceeds 30
 * characters rather than truncating it, so everything is clipped on the way out.
 */
export interface LifeFileRx {
  rxType: 'new' | 'refill';
  uuid: string;
  drugName: string;
  drugStrength?: string;
  drugForm?: string;
  foreignPmsId?: number;
  /** Our own reference on the line, so a response can be matched back. */
  foreignRxNumber: string;
  quantity: string;
  quantityUnits: string;
  /** The SIG. Never an internal note — see LifeFileService for why. */
  directions: string;
  refills: number;
  dateWritten: string;
  daysSupply: number;
  clinicalDifferenceStatement?: string;
}

export interface LifeFileOrder {
  message: { id: string; sentTime: string };
  order: {
    general: { memo: string; referenceId: string };
    prescriber: {
      npi: string;
      licenseState: string;
      licenseNumber: string;
      lastName: string;
      firstName: string;
      address1?: string;
      city?: string;
      state?: string;
      zip?: string;
      phone?: string;
      email?: string;
      dea?: string;
    };
    practice: { id: number };
    patient: {
      lastName: string;
      firstName: string;
      gender: 'm' | 'f' | 'u';
      dateOfBirth: string;
      address1: string;
      address2?: string;
      city: string;
      state: string;
      zip: string;
      country: 'US';
      phoneMobile: string;
      email: string;
    };
    shipping: {
      recipientType: 'patient';
      recipientLastName: string;
      recipientFirstName: string;
      recipientPhone: string;
      recipientEmail: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      zipCode: string;
      country: 'US';
      service?: string;
    };
    /** `doc` means the clinic is billed, not the patient. */
    billing: { payorType: 'doc' };
    rxs: LifeFileRx[];
  };
}

export interface LifeFileResult {
  ok: boolean;
  status: number;
  orderId: string | null;
  rxNumber: string | null;
  error: string | null;
  /** False for a 4xx: the request is wrong, and sending it again will not fix it. */
  retryable: boolean;
}
