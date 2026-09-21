import { Role } from '@health-emr/types';
import { ChartSection, canSee, redactChart, visibleSections } from './redaction.policy';

describe('chart redaction policy', () => {
  it('keeps the clinician\'s own record from the telehealth business', () => {
    expect(canSee(Role.ADMIN, ChartSection.PROVIDER_NOTES)).toBe(false);
    expect(canSee(Role.ADMIN, ChartSection.LAB_RESULTS)).toBe(false);
  });

  it('gives the telehealth business back the intake it collected', () => {
    for (const section of [
      ChartSection.DEMOGRAPHICS,
      ChartSection.ORDER_STATUS,
      ChartSection.SHIPPING,
      ChartSection.BILLING,
      ChartSection.PRESCRIPTIONS,
      ChartSection.ID_PHOTO,
      ChartSection.QA_ANSWERS,
      ChartSection.CLINICAL_IMAGES,
      ChartSection.ALLERGIES,
    ]) {
      expect(canSee(Role.ADMIN, section)).toBe(true);
    }
  });

  it('gives the treating provider the whole picture', () => {
    for (const section of Object.values(ChartSection)) {
      expect(canSee(Role.PROVIDER, section)).toBe(true);
    }
  });

  it('gives the pharmacy allergies but not the questionnaire', () => {
    expect(canSee(Role.PHARMACY, ChartSection.ALLERGIES)).toBe(true);
    expect(canSee(Role.PHARMACY, ChartSection.QA_ANSWERS)).toBe(false);
    expect(canSee(Role.PHARMACY, ChartSection.PROVIDER_NOTES)).toBe(false);
  });

  it('actually removes the field, not just hides it', () => {
    const chart = {
      firstName: 'Nadia',
      qaAnswers: [{ q: 'Prior GLP-1?', a: 'No' }],
      providerNotes: ['Reviewed and approved'],
      labResults: [{ panel: 'HbA1c', value: '5.4' }],
    };

    const seen = redactChart(Role.ADMIN, chart, {
      firstName: ChartSection.DEMOGRAPHICS,
      qaAnswers: ChartSection.QA_ANSWERS,
      providerNotes: ChartSection.PROVIDER_NOTES,
      labResults: ChartSection.LAB_RESULTS,
    });

    expect(seen.firstName).toBe('Nadia');
    // The business collected this questionnaire, so it comes back.
    expect(seen.qaAnswers).toEqual(chart.qaAnswers);
    // What a clinician wrote about it does not.
    expect('providerNotes' in seen).toBe(false);
    expect('labResults' in seen).toBe(false);
    expect(seen.redactedSections).toEqual(
      expect.arrayContaining([ChartSection.PROVIDER_NOTES, ChartSection.LAB_RESULTS]),
    );
  });

  it('reports what was withheld rather than silently dropping it', () => {
    const seen = redactChart(
      Role.PHARMACY,
      { qa: 'secret' },
      { qa: ChartSection.QA_ANSWERS },
    );
    expect(seen.redactedSections).toContain(ChartSection.QA_ANSWERS);
  });

  it('withholds nothing from a provider', () => {
    const seen = redactChart(
      Role.PROVIDER,
      { qa: 'visible', notes: 'visible' },
      { qa: ChartSection.QA_ANSWERS, notes: ChartSection.PROVIDER_NOTES },
    );
    expect(seen.qa).toBe('visible');
    expect(seen.redactedSections).toEqual([]);
  });

  it('gives every role a defined policy, so a new role cannot default to open', () => {
    for (const role of Object.values(Role)) {
      expect(visibleSections(role).length).toBeGreaterThan(0);
    }
  });
});
