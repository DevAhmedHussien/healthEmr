import { PrismaClient } from '@prisma/client';
import type { Questionnaire } from '@health-emr/types';
import imported from '../prisma/seed-data/questionnaires.json';

/**
 * A questionnaire for each category.
 *
 * Weight loss, wellness and sexual health are the real production sets, lifted
 * from the forms already in use — including their question ids, so an answer
 * recorded here means the same thing as one recorded there, and their consent
 * text verbatim, because that wording has been through review and mine has not.
 *
 * The rest are a working starting point built from the same option lists. Every
 * questionnaire should be read by the clinicians who will rely on it before a
 * real patient sees one.
 */
const prisma = new PrismaClient();

const GENERAL: Questionnaire['questions'] = [
  {
    id: 'pregnant',
    prompt: 'Are you currently pregnant, breastfeeding, or trying to conceive?',
    kind: 'yesNo',
    required: true,
    disqualifyIf: ['Yes'],
    disqualifyMessage:
      'These medications are not prescribed during pregnancy or breastfeeding. Please speak to your own doctor.',
  },
  {
    id: 'conditions',
    prompt: 'Do you have any of these conditions?',
    kind: 'multiple',
    required: false,
    options: [
      'High blood pressure',
      'Diabetes',
      'Heart disease',
      'Kidney disease',
      'Liver disease',
      'Thyroid disease',
      'Depression or anxiety',
      'None of these',
    ],
  },
  {
    id: 'surgeries',
    prompt: 'Have you had any surgery in the last 12 months?',
    kind: 'longText',
    required: false,
    help: 'If none, write “None”.',
  },
];

const TEMPLATES: Record<string, Questionnaire> = {
  weightloss: {
    title: 'About your weight',
    intro:
      'A clinician reads every answer before deciding. Answer as accurately as you can — this is the only chance to tell them something that matters.',
    requiresPhotoId: true,
    questions: [
      { id: 'height', prompt: 'How tall are you?', kind: 'height', required: true },
      { id: 'weight', prompt: 'What do you weigh?', kind: 'weight', required: true, unit: 'lb' },
      { id: 'goalWeight', prompt: 'What weight would you like to reach?', kind: 'weight', required: false, unit: 'lb' },
      {
        id: 'priorGlp1',
        prompt: 'Have you taken a GLP-1 medication before (Ozempic, Wegovy, Mounjaro, Zepbound)?',
        kind: 'yesNo',
        required: true,
      },
      {
        id: 'priorGlp1Detail',
        prompt: 'Which one, at what dose, and when did you last take it?',
        kind: 'longText',
        required: true,
        showWhen: { questionId: 'priorGlp1', equals: 'Yes' },
      },
      {
        id: 'thyroidCancer',
        prompt:
          'Have you or anyone in your family had medullary thyroid cancer or Multiple Endocrine Neoplasia type 2?',
        kind: 'yesNo',
        required: true,
        disqualifyIf: ['Yes'],
        disqualifyMessage:
          'GLP-1 medications carry a boxed warning against use with this history. A clinician cannot prescribe one here.',
      },
      {
        id: 'pancreatitis',
        prompt: 'Have you ever had pancreatitis?',
        kind: 'yesNo',
        required: true,
      },
      {
        id: 'eatingDisorder',
        prompt: 'Have you ever been diagnosed with an eating disorder?',
        kind: 'yesNo',
        required: true,
      },
      ...GENERAL,
    ],
  },

  ED: {
    title: 'About your sexual health',
    requiresPhotoId: true,
    questions: [
      {
        id: 'duration',
        prompt: 'How long have you had difficulty with erections?',
        kind: 'single',
        required: true,
        options: ['Less than 6 months', '6–12 months', '1–3 years', 'More than 3 years'],
      },
      {
        id: 'nitrates',
        prompt: 'Do you take nitrates for chest pain (nitroglycerin, isosorbide)?',
        kind: 'yesNo',
        required: true,
        disqualifyIf: ['Yes'],
        disqualifyMessage:
          'Taking these medications with nitrates can cause a dangerous drop in blood pressure. A clinician cannot prescribe one here.',
      },
      {
        id: 'cardiac',
        prompt: 'Have you had a heart attack, stroke, or heart failure in the last 6 months?',
        kind: 'yesNo',
        required: true,
        disqualifyIf: ['Yes'],
        disqualifyMessage: 'This needs to be assessed in person before these medications can be prescribed.',
      },
      { id: 'bloodPressure', prompt: 'Do you know your usual blood pressure?', kind: 'text', required: false },
      {
        id: 'priorTreatment',
        prompt: 'Have you tried medication for this before? Which, and how did it go?',
        kind: 'longText',
        required: false,
      },
      ...GENERAL,
    ],
  },

  hairloss: {
    title: 'About your hair',
    requiresPhotoId: true,
    questions: [
      {
        id: 'pattern',
        prompt: 'Where are you noticing thinning?',
        kind: 'multiple',
        required: true,
        options: ['Hairline / temples', 'Crown', 'All over', 'Patches'],
      },
      {
        id: 'duration',
        prompt: 'How long has this been happening?',
        kind: 'single',
        required: true,
        options: ['Less than 6 months', '6–12 months', '1–3 years', 'More than 3 years'],
      },
      {
        id: 'suddenLoss',
        prompt: 'Did the hair loss come on suddenly, or in patches?',
        kind: 'yesNo',
        required: true,
        help: 'Sudden or patchy loss can point to a cause that needs a different treatment.',
      },
      {
        id: 'priorTreatment',
        prompt: 'Have you used finasteride or minoxidil before?',
        kind: 'longText',
        required: false,
      },
      ...GENERAL,
    ],
  },

  antiNausea: {
    title: 'About your nausea',
    requiresPhotoId: true,
    questions: [
      {
        id: 'cause',
        prompt: 'What do you think is causing the nausea?',
        kind: 'single',
        required: true,
        options: ['A GLP-1 medication', 'Motion sickness', 'Migraine', 'Something else', 'I am not sure'],
      },
      { id: 'howLong', prompt: 'How long has it been going on?', kind: 'text', required: true },
      {
        id: 'vomiting',
        prompt: 'Are you able to keep fluids down?',
        kind: 'yesNo',
        required: true,
        disqualifyIf: ['No'],
        disqualifyMessage:
          'If you cannot keep fluids down you need to be seen in person today, not treated online.',
      },
      {
        id: 'heartRhythm',
        prompt: 'Have you been told you have a heart rhythm problem or a long QT interval?',
        kind: 'yesNo',
        required: true,
      },
      ...GENERAL,
    ],
  },

  antiAging: {
    title: 'About your wellness goals',
    requiresPhotoId: true,
    questions: [
      {
        id: 'goals',
        prompt: 'What are you hoping to improve?',
        kind: 'multiple',
        required: true,
        options: ['Energy', 'Sleep', 'Focus', 'Recovery from exercise', 'Skin', 'Something else'],
      },
      { id: 'currentSupplements', prompt: 'What supplements do you take now?', kind: 'longText', required: false },
      ...GENERAL,
    ],
  },

  menopause: {
    title: 'About your symptoms',
    requiresPhotoId: true,
    questions: [
      {
        id: 'symptoms',
        prompt: 'Which symptoms are you having?',
        kind: 'multiple',
        required: true,
        options: ['Hot flushes', 'Night sweats', 'Sleep problems', 'Mood changes', 'Vaginal dryness', 'Joint aches'],
      },
      { id: 'lastPeriod', prompt: 'When was your last period?', kind: 'text', required: true },
      {
        id: 'breastCancer',
        prompt: 'Have you ever been diagnosed with breast cancer?',
        kind: 'yesNo',
        required: true,
        disqualifyIf: ['Yes'],
        disqualifyMessage: 'Hormone therapy after breast cancer has to be decided with your own specialist.',
      },
      {
        id: 'clots',
        prompt: 'Have you ever had a blood clot in your leg or lung?',
        kind: 'yesNo',
        required: true,
      },
      ...GENERAL,
    ],
  },

  testVisitType: {
    title: 'Integration test',
    intro: 'A minimal questionnaire, for checking an integration end to end.',
    requiresPhotoId: false,
    questions: [
      { id: 'ping', prompt: 'Is this a test submission?', kind: 'yesNo', required: true },
    ],
  },
};

/** A follow-up asks how the last course went, then the original questions. */
function followUp(base: Questionnaire, label: string): Questionnaire {
  return {
    title: `Your ${label} follow-up`,
    intro: 'A clinician reviews how the last course went before continuing or changing it.',
    requiresPhotoId: false,
    questions: [
      {
        id: 'howItWent',
        prompt: 'How has the treatment been going?',
        kind: 'single',
        required: true,
        options: ['Working well', 'Working, but side effects', 'Not working', 'I stopped taking it'],
      },
      {
        id: 'sideEffects',
        prompt: 'What side effects have you had?',
        kind: 'longText',
        required: false,
        help: 'If none, write “None”.',
      },
      {
        id: 'changesSince',
        prompt: 'Has anything changed in your health since last time?',
        kind: 'longText',
        required: true,
        help: 'New conditions, new medications, a hospital visit. If nothing, write “Nothing”.',
      },
      ...base.questions.filter((question) => question.disqualifyIf?.length),
    ],
  };
}

// The imported sets replace the drafts for the categories that have one.
for (const [slug, questionnaire] of Object.entries(imported as Record<string, Questionnaire>)) {
  TEMPLATES[slug] = questionnaire;
}

TEMPLATES.weightlossfollowup = followUp(TEMPLATES.weightloss, 'weight');
TEMPLATES.EDfollowup = followUp(TEMPLATES.ED, 'sexual health');
TEMPLATES.hairlossfollowup = followUp(TEMPLATES.hairloss, 'hair');
TEMPLATES.antiNauseaFollowup = followUp(TEMPLATES.antiNausea, 'nausea');
TEMPLATES.antiAgingFollowup = followUp(TEMPLATES.antiAging, 'wellness');
TEMPLATES.menopauseFollowup = followUp(TEMPLATES.menopause, 'menopause');

async function main() {
  for (const [slug, questionnaire] of Object.entries(TEMPLATES)) {
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      console.log(`  skipped ${slug} — no such category`);
      continue;
    }

    const latest = await prisma.questionnaireTemplate.findFirst({
      where: { categoryId: category.id },
      orderBy: { version: 'desc' },
    });

    // A template is versioned, never edited: a submission points at the version
    // it was answered against, so a question changed today cannot rewrite what
    // a patient was asked last month.
    const same = latest && JSON.stringify(latest.schemaJson) === JSON.stringify(questionnaire);
    if (same) {
      console.log(`  ${slug}: unchanged (v${latest.version})`);
      continue;
    }

    const version = (latest?.version ?? 0) + 1;
    await prisma.$transaction([
      prisma.questionnaireTemplate.updateMany({
        where: { categoryId: category.id },
        data: { isActive: false },
      }),
      prisma.questionnaireTemplate.create({
        data: {
          categoryId: category.id,
          version,
          schemaJson: questionnaire as never,
          isActive: true,
        },
      }),
    ]);
    console.log(`  ${slug}: v${version} · ${questionnaire.questions.length} questions`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
