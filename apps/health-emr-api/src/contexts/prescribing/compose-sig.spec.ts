import { composeSig } from '@health-emr/types';

/**
 * The directions a patient reads off the label.
 *
 * Worth pinning word for word. A sig that reads "into the muscle into the thigh"
 * is not a cosmetic problem — it is an instruction somebody has to interpret,
 * and the interpretation is a needle going somewhere.
 *
 * The same function runs in the clinician's form to preview the sentence and on
 * the server to store it, so these assertions cover both.
 */
describe('composeSig', () => {
  it('states depth and site for a subcutaneous injection', () => {
    expect(
      composeSig({
        dose: '0.25mg',
        route: 'SUBCUTANEOUS',
        site: 'abdomen, rotating sites',
        frequency: 'once weekly',
        daysSupply: 28,
      }),
    ).toBe('Inject 0.25mg subcutaneously into the abdomen, rotating sites once weekly for 28 days.');
  });

  it('does not stack prepositions on an intramuscular site', () => {
    expect(
      composeSig({
        dose: '2.5mg',
        route: 'INTRAMUSCULAR',
        site: 'upper outer thigh',
        frequency: 'every 2 weeks',
      }),
    ).toBe('Inject 2.5mg intramuscularly into the upper outer thigh every 2 weeks.');
  });

  it('lets the site stand alone for something applied', () => {
    // "Apply a thin layer to the skin to the affected area" is the failure this
    // guards: the route word is dropped because the site already says where.
    expect(
      composeSig({ dose: 'a thin layer', route: 'TOPICAL', site: 'affected area', frequency: 'nightly' }),
    ).toBe('Apply a thin layer to the affected area nightly.');
  });

  it('uses the verb the route actually takes', () => {
    expect(composeSig({ dose: '50mg', route: 'ORAL', frequency: 'once daily' })).toBe(
      'Take 50mg by mouth once daily.',
    );
    expect(composeSig({ dose: '10mg', route: 'SUBLINGUAL', frequency: 'as needed' })).toBe(
      'Dissolve 10mg under the tongue as needed.',
    );
    expect(composeSig({ dose: '1 spray', route: 'NASAL', frequency: 'twice daily' })).toBe(
      'Spray 1 spray into the nostril twice daily.',
    );
  });

  it('omits a duration that was not given rather than inventing one', () => {
    const sig = composeSig({ dose: '0.5mg', route: 'SUBCUTANEOUS', site: 'thigh', frequency: 'weekly' });
    expect(sig).not.toMatch(/days/);
    expect(sig).toBe('Inject 0.5mg subcutaneously into the thigh weekly.');
  });

  it('ignores a site on a route where it means nothing', () => {
    // A site on an oral dose is a data-entry slip, not an instruction.
    expect(composeSig({ dose: '50mg', route: 'ORAL', site: 'abdomen', frequency: 'daily' })).toBe(
      'Take 50mg by mouth daily.',
    );
  });

  it('always ends in a full stop, and never two', () => {
    expect(composeSig({ dose: '5mg', route: 'ORAL', frequency: 'daily.' })).toBe(
      'Take 5mg by mouth daily.',
    );
  });

  it('still produces something usable with only a dose', () => {
    expect(composeSig({ dose: '5mg' })).toBe('Use 5mg.');
  });
});
