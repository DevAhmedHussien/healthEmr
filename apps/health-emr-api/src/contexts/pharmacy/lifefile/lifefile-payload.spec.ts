import { randomBytes } from 'node:crypto';
import { LifeFileService } from './lifefile.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import type { AppConfig } from '@/shared/config/configuration';
import type { LifeFileOrder } from './lifefile.types';

/**
 * The order body posted to a LifeFile pharmacy.
 *
 * This is a contract with somebody else's system: a field we stop sending, or
 * send in the wrong shape, is an order the pharmacy rejects — or worse, fills
 * wrongly. It is asserted field by field rather than against a snapshot,
 * because a snapshot test tells you something changed without telling you
 * whether it was allowed to.
 */
describe('the LifeFile order body', () => {
  const config = { phiEncryptionKey: randomBytes(32).toString('base64') } as AppConfig;
  const phi = new PhiCryptoService(config);

  const signedAt = new Date('2026-09-18T19:38:13.905Z');

  const order = {
    id: '9cf8e1f8-95cc-469e-a2ce-8cea0926398c',
    tenantId: 'ten-1',
    externalOrderId: null,
    pharmacy: {
      name: 'First Choice Pharmacy',
      config: {
        isEnabled: true,
        baseUrl: 'https://api.lifefile.test/v1/',
        credentialRef: 'first-choice',
        credentialCipher: null,
        practiceId: '4321',
        defaultShippingService: 'FEDEX_2DAY',
      },
    },
    prescription: {
      id: 'a2d87598-9b37-4d09-b07c-4863f8e8c474',
      patientId: 'pat-1',
      dose: '0.25mg',
      quantity: '1',
      refills: 2,
      daysSupply: 30,
      sig: 'Inject 0.25mg subcutaneously once weekly for 4 weeks.',
      signedAt,
      licenseNumberSnapshot: 'TX-23456',
      licenseStateSnapshot: 'TX',
      medication: {
        name: 'Semaglutide 2.5mg/mL',
        strength: '2.5mg/mL',
        form: 'INJECTABLE',
        isCompounded: true,
      },
      patient: {
        firstName: 'Yusuf',
        lastName: 'Adeyemi',
        dob: phi.encrypt('1988-07-04'),
        sexAtBirth: 'MALE',
        phone: '5555572924',
        email: 'yusuf@example.test',
        addressLine1: '44 Colorado St',
        addressLine2: null,
        city: 'Austin',
        residenceState: 'TX',
        postalCode: '73301',
      },
      provider: {
        npi: '2345678901',
        deaNumber: null,
        user: {
          firstName: 'Ndidi',
          lastName: 'Okafor',
          email: 'dr.okafor@healthemr.test',
          phone: null,
        },
      },
    },
  };

  /** Runs `transmit` far enough to capture what would have gone over the wire. */
  async function send(
    over: Partial<Record<keyof typeof order.prescription, unknown>> = {},
  ): Promise<LifeFileOrder> {
    const subject = { ...order, prescription: { ...order.prescription, ...over } };

    const prisma = {
      raw: {
        pharmacyOrder: {
          findUnique: jest.fn().mockResolvedValue(subject),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    };
    const credentials = {
      resolve: jest.fn().mockResolvedValue({ username: 'u', password: 'p' }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const events = { publish: jest.fn() };

    let sent: LifeFileOrder | undefined;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url: unknown, init?: unknown) => {
        sent = JSON.parse((init as { body: string }).body) as LifeFileOrder;
        return Promise.resolve(
          new Response(JSON.stringify({ orderId: 'LF-1', rxNumber: 'RX-1' }), { status: 200 }),
        );
      });

    const service = new LifeFileService(
      prisma as never,
      phi,
      audit as never,
      credentials as never,
      events as never,
    );

    await service.transmit('order-1');
    fetchSpy.mockRestore();

    if (!sent) throw new Error('nothing was posted');
    return sent;
  }

  it('identifies the order on both sides, so a reply can be matched back', async () => {
    const body = await send();

    expect(body.message.id).toEqual(expect.any(String));
    expect(body.order.general.referenceId).toBe(order.id);
    // Our own id on the line. Their answer names it, and that is how a
    // dispense notice finds the prescription it belongs to.
    expect(body.order.rxs[0].foreignRxNumber).toBe(order.prescription.id);
  });

  it('sends the directions the clinician signed, and nothing else in their place', async () => {
    const body = await send();

    // The one field the patient reads off the label. An internal note reaching
    // it would be a clinical error, not a formatting one.
    expect(body.order.rxs[0].directions).toBe(
      'Inject 0.25mg subcutaneously once weekly for 4 weeks.',
    );
  });

  it('names the prescriber by the licence they signed under', async () => {
    const body = await send();

    expect(body.order.prescriber).toMatchObject({
      npi: '2345678901',
      licenseNumber: 'TX-23456',
      licenseState: 'TX',
      lastName: 'Okafor',
      firstName: 'Ndidi',
    });
    // Frozen at signature, not read live: a licence renewed since must not
    // change what this order says was relied on.
    expect(body.order.prescriber.licenseNumber).toBe(order.prescription.licenseNumberSnapshot);
  });

  it('decrypts the date of birth, because the pharmacy matches the patient on it', async () => {
    const body = await send();
    expect(body.order.patient.dateOfBirth).toBe('1988-07-04');
  });

  it('bills the clinic, never the patient', async () => {
    // The patient already paid the client business. A pharmacy charging them
    // again is the failure this field exists to prevent.
    const body = await send();
    expect(body.order.billing.payorType).toBe('doc');
  });

  it('ships to the patient, at the address on their chart', async () => {
    const body = await send();

    expect(body.order.shipping).toMatchObject({
      recipientType: 'patient',
      recipientLastName: 'Adeyemi',
      addressLine1: '44 Colorado St',
      city: 'Austin',
      state: 'TX',
      zipCode: '73301',
      country: 'US',
      service: 'FEDEX_2DAY',
    });
  });

  it('carries the practice the pharmacy files the order under', async () => {
    const body = await send();
    expect(body.order.practice.id).toBe(4321);
  });

  it('declares a compounded product as one', async () => {
    const compounded = await send();
    expect(compounded.order.rxs[0].clinicalDifferenceStatement).toContain('Compounded');

    const branded = await send({
      medication: { ...order.prescription.medication, isCompounded: false },
    });
    expect(branded.order.rxs[0].clinicalDifferenceStatement).toBeUndefined();
  });

  it('clips a name to what LifeFile accepts rather than having the order refused', async () => {
    // They reject an over-length field outright instead of truncating it.
    const body = await send({
      patient: { ...order.prescription.patient, lastName: 'A'.repeat(60) },
    });

    expect(body.order.patient.lastName).toHaveLength(30);
  });

  it('falls back to a month of supply rather than sending none', async () => {
    const body = await send({ daysSupply: null });
    expect(body.order.rxs[0].daysSupply).toBe(30);
  });
});
