import type { Row } from './seed-first-choice-catalogue';

/**
 * Sexual health, hair loss and anti-aging products at First Choice.
 *
 * The medications, strengths, directions and quantities are real: these are the
 * standard compounded and generic products a telehealth pharmacy dispenses for
 * these three visit types, written the way a pharmacy writes them.
 *
 * The **identifiers are not**. First Choice's list, as supplied, covers weight
 * loss and two anti-aging items and nothing else, so the `medId` and `kitCode`
 * below were generated here rather than transcribed. They are the right shape
 * and they work end to end, but they are ours, not theirs — an order placed
 * against a real LifeFile account with these codes would be rejected. Swap them
 * for the pharmacy's own when their full list arrives; nothing else in these
 * rows needs to change.
 *
 * Prices are placeholders on the same footing, derived from fill size by the
 * seeder. Set the real ones in Super Admin → Pharmacies.
 */
export const ADDITIONS: Row[] = [
  // ── sexual health ────────────────────────────────────────────────────────
  {
    favouriteName: '1stChoice Sildenafil 100mg (10 tablets)',
    medId: 'xPG2dL44duNYhFDPkYlXKeSdIbplFRHf',
    medication: 'Sildenafil Citrate Oral Tablet',
    type: 'med',
    strength: '100 MG',
    sig: 'TAKE 1/2 TO 1 TABLET BY MOUTH 30 TO 60 MINUTES BEFORE SEXUAL ACTIVITY. DO NOT EXCEED 1 TABLET IN 24 HOURS.',
    quantity: '10',
    dispense: 'tablet',
    refills: 2,
    days: 30,
    pharmacyCategory: 'Sexual Health',
    notes: 'Commercially available generic. Start at half a tablet.',
    visitType: 'ED',
    kitCode: '1STCHOICE_SIL_T_100_30D',
  },
  {
    favouriteName: '1stChoice Tadalafil 20mg (10 tablets)',
    medId: 'aoavfWW303rrl8aZXLHiJ9PmvWkYlkhB',
    medication: 'Tadalafil Oral Tablet',
    type: 'med',
    strength: '20 MG',
    sig: 'TAKE 1/2 TO 1 TABLET BY MOUTH AS NEEDED BEFORE SEXUAL ACTIVITY. DO NOT EXCEED 1 TABLET IN 24 HOURS.',
    quantity: '10',
    dispense: 'tablet',
    refills: 2,
    days: 30,
    pharmacyCategory: 'Sexual Health',
    notes: 'Commercially available generic. Longer acting than sildenafil.',
    visitType: 'ED',
    kitCode: '1STCHOICE_TAD_T_20_30D',
  },
  {
    favouriteName: '1stChoice Sildenafil/Tadalafil Troche (3 month)',
    medId: '9XHXktNXHicNAHUg4jJahDWPtcFqdM75',
    medication: 'Sildenafil/Tadalafil Sublingual Troche 60/20mg',
    type: 'compound',
    strength: '60/20 MG',
    sig: 'DISSOLVE 1 TROCHE UNDER THE TONGUE 30 MINUTES BEFORE SEXUAL ACTIVITY. DO NOT EXCEED 1 TROCHE IN 24 HOURS.',
    quantity: '30',
    dispense: 'troche',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Sexual Health',
    notes: 'No commercially available option. Sublingual onset is faster than oral.',
    visitType: 'ED',
    kitCode: '1STCHOICE_SILTAD_TR_60.20_90D',
  },

  // ── hair loss ────────────────────────────────────────────────────────────
  {
    favouriteName: '1stChoice Finasteride 1mg (3 month)',
    medId: 'ByFRuqWiRV76dDA7ZKkNjWFeJRbHoEmB',
    medication: 'Finasteride Oral Tablet',
    type: 'med',
    strength: '1 MG',
    sig: 'TAKE 1 TABLET BY MOUTH ONCE DAILY.',
    quantity: '90',
    dispense: 'tablet',
    refills: 1,
    days: 90,
    pharmacyCategory: 'Hair Loss',
    notes: 'Commercially available generic. Not for use by women who are or may become pregnant.',
    visitType: 'hairloss',
    kitCode: '1STCHOICE_FIN_T_1_90D',
  },
  {
    favouriteName: '1stChoice Minoxidil Oral 2.5mg (3 month)',
    medId: 'L7jHCizvfyn8YxWKgsgLMX8CzMCPDsYG',
    medication: 'Minoxidil Oral Tablet',
    type: 'med',
    strength: '2.5 MG',
    sig: 'TAKE 1 TABLET BY MOUTH ONCE DAILY.',
    quantity: '90',
    dispense: 'tablet',
    refills: 1,
    days: 90,
    pharmacyCategory: 'Hair Loss',
    notes: 'Low-dose oral minoxidil. Off-label for androgenetic alopecia.',
    visitType: 'hairloss',
    kitCode: '1STCHOICE_MINOX_T_2.5_90D',
  },
  {
    favouriteName: '1stChoice Finasteride/Minoxidil Topical (2 month)',
    medId: 'J8x1YTrb7i4TevyWWG6RD1er3FpXm3op',
    medication: 'Finasteride/Minoxidil Topical Solution 0.1%/6%',
    type: 'compound',
    strength: '0.1%/6%',
    sig: 'APPLY 1ML TO THE AFFECTED AREAS OF THE SCALP ONCE DAILY. DO NOT RINSE FOR AT LEAST 4 HOURS.',
    quantity: '60',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Hair Loss',
    notes: 'No commercially available option. Topical avoids most systemic exposure.',
    visitType: 'hairloss',
    kitCode: '1STCHOICE_FINMINOX_TOP_60_60D',
  },

  // ── anti-aging and wellness ──────────────────────────────────────────────
  {
    favouriteName: '1stChoice Sermorelin 15mg vial (3 month)',
    medId: 'ysxFT9DECClPHDOCJKYinWFImNhVYsUV',
    medication: 'Sermorelin Acetate 15mg/15mL',
    type: 'compound',
    strength: '1 MG/ML',
    sig: 'INJECT 0.2ML (200MCG) SUBCUTANEOUSLY AT BEDTIME, 5 NIGHTS ON AND 2 NIGHTS OFF.',
    quantity: '15',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Peptides',
    notes: 'No commercially available option. Refrigerate on arrival.',
    visitType: 'antiAging',
    kitCode: '1STCHOICE_SERM_S_15_90D',
  },
  {
    favouriteName: '1stChoice Glutathione 200mg/mL (3 month)',
    medId: 'EXAGOL4GE4QKvUIs2rOIKb6zqax0rwgc',
    medication: 'Glutathione 200mg/mL - 10mL',
    type: 'compound',
    strength: '200 MG/ML',
    sig: 'INJECT 1ML (200MG) INTRAMUSCULARLY ONCE WEEKLY.',
    quantity: '10',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Wellness',
    notes: 'No commercially available option. Protect from light.',
    visitType: 'antiAging',
    kitCode: '1STCHOICE_GLUT_S_200_90D',
  },
  {
    favouriteName: '1stChoice Methylcobalamin B12 1mg/mL (3 month)',
    medId: 'nGPXKabtDPVmAjtUjdUgFrUauYR8nmWZ',
    medication: 'Methylcobalamin 1mg/mL - 10mL',
    type: 'compound',
    strength: '1 MG/ML',
    sig: 'INJECT 1ML (1MG) INTRAMUSCULARLY ONCE WEEKLY.',
    quantity: '10',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Wellness',
    notes: 'No commercially available option. Protect from light.',
    visitType: 'antiAging',
    kitCode: '1STCHOICE_B12_S_1_90D',
  },
];
