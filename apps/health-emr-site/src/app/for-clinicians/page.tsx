import type { Metadata } from 'next';
import {
  Band,
  ClosingCta,
  Faq,
  Figures,
  JsonLd,
  More,
  Panel,
  SectionHead,
  Split,
  Steps,
  TileGrid,
} from '@/components/blocks';
import { RoutingVisual } from '@/components/visuals';
import { COMPANY, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Review prescriptions online and get paid per visit',
  description:
    'Approve telehealth prescriptions online, on your own schedule. One queue across several brands, filtered to the states you are licensed in, with a fee recorded for every review you complete.',
  alternates: { canonical: '/for-clinicians' },
  openGraph: {
    title: 'Work with us — review prescriptions online, paid per visit',
    description:
      'Asynchronous telehealth review for licensed clinicians. No shifts, no minimums, a fee on every completed review.',
  },
};

const FAQ = [
  {
    q: 'How am I paid, and when?',
    a: 'A fee is recorded against each review the moment you complete it. Your earnings page lists every one — what it was, which brand sent it, what it paid, and whether it has been paid out — counted from the decisions themselves rather than from a separate tally that can drift out of step.',
  },
  {
    q: 'Does a decline still pay?',
    a: 'Yes. You are paid for the clinical review, not for prescribing. A decline is a clinical decision and takes judgement, and paying only for approvals would put a thumb on the scale of every borderline case — which is precisely what nobody involved should want.',
  },
  {
    q: 'Is this employment?',
    a: 'No. You review as an independent clinician on your own schedule, paid per completed review. There is no minimum, no shift roster and no obligation to take any particular volume.',
  },
  {
    q: 'How long does a review take?',
    a: 'Most take a few minutes. The questionnaire, the patient’s history, their allergies and what is being requested are on one screen, so your time goes on the decision rather than on assembling the picture from four places.',
  },
  {
    q: 'How do I know I am allowed to see a visit?',
    a: 'Because you could not have been sent one otherwise. Your queue only ever contains visits where you hold a current licence in the patient’s state and are credentialled for the treatment. It is not a filter you apply — it is the only thing that reaches you.',
  },
  {
    q: 'I am licensed in a new state. How do I add it?',
    a: 'Add it yourself with the number and expiry. It is recorded immediately and checked against the state board before it starts routing visits — so nobody, including you, can switch on a state nobody has verified.',
  },
  {
    q: 'What if I am not comfortable prescribing?',
    a: 'Decline and say why, or ask the patient for more — a clearer photograph, an answer they skipped. The visit waits on them rather than on you, and returns to your queue when they reply.',
  },
  {
    q: 'Do I need to be in Florida?',
    a: 'No. We are based in Tampa, but the network is national: what matters is which states you hold licences in, not where you sit.',
  },
];

export default function ForCliniciansPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'FAQPage',
              mainEntity: FAQ.map((item) => ({
                '@type': 'Question',
                name: item.q,
                acceptedAnswer: { '@type': 'Answer', text: item.a },
              })),
            },
            {
              // This page is, in substance, a role posting — so it says so in
              // the vocabulary a crawler indexes work with.
              '@type': 'JobPosting',
              title: 'Telehealth clinician — asynchronous prescription review',
              employmentType: 'CONTRACTOR',
              description:
                'Review telehealth visits asynchronously and decide whether to prescribe. Work is routed only in states where you hold a current licence and are credentialled for the treatment. Paid per completed review, with no minimum volume and no shift roster.',
              hiringOrganization: { '@id': `${SITE_URL}/#organization` },
              jobLocationType: 'TELECOMMUTE',
              applicantLocationRequirements: { '@type': 'Country', name: 'United States' },
              jobLocation: {
                '@type': 'Place',
                address: {
                  '@type': 'PostalAddress',
                  addressLocality: COMPANY.locality,
                  addressRegion: COMPANY.region,
                  addressCountry: COMPANY.country,
                },
              },
            },
          ],
        }}
      />

      <Band tone="paper" size="tall" className="pb-10 md:pb-14">
        <SectionHead
          as="h1"
          size="hero"
          eyebrow="Work with us"
          title="Review prescriptions online. Get paid for every one."
          lede="Approve, adjust or decline telehealth visits on your own schedule — one queue across several brands, containing only the visits you are licensed and credentialled to take."
        />
        <div className="mt-11 flex flex-wrap items-center justify-center gap-6">
          <More href="/apply/clinician">Apply to join the network</More>
        </div>

        <Figures
          figures={[
            { value: 'Per review', label: 'A fee recorded the moment you complete one' },
            { value: 'No shifts', label: 'No roster, no minimum, no obligation to take volume' },
            { value: 'Minutes', label: 'A typical review, with everything on one screen' },
            { value: 'Your states', label: 'Nothing outside them ever reaches your queue' },
          ]}
        />
      </Band>

      <Band tone="tint">
        <SectionHead
          eyebrow="The arrangement"
          title="Paid for the judgement, not for the prescription"
          lede="A fee is attached to every completed review — including the ones you decline. Paying only for approvals would put a thumb on the scale of every borderline case, and that is the last place an incentive belongs."
        />
        <TileGrid
          items={[
            {
              title: 'Recorded as you finish',
              body: 'The fee is written against the decision itself, at the moment you make it — not assembled later from a report that can disagree with what you did.',
            },
            {
              title: 'Every line accounted for',
              body: 'Your earnings page shows what each review was, which brand sent it, what it paid, and whether it has been paid out yet.',
            },
            {
              title: 'Declines pay the same',
              body: 'You are paid for the clinical review. Saying no is a clinical decision and takes as much judgement as saying yes.',
            },
            {
              title: 'Counted from the decisions',
              body: 'Reviews and earnings are counted separately and compared, so a review whose fee failed to record shows as unrecorded rather than quietly missing.',
            },
            {
              title: 'Rates per category',
              body: 'Agreed before you start, per treatment area. You know what a review pays before you take one.',
            },
            {
              title: 'Nothing to chase',
              body: 'No invoices to raise and no timesheets. The work you did is the record of what you are owed.',
            },
          ]}
        />
      </Band>

      <Band tone="paper">
        <Split aside={<RoutingVisual className="w-full text-[var(--ink)]" />}>
          <SectionHead
            align="left"
            eyebrow="What reaches you"
            title="Nothing you are not allowed to see"
            lede="A visit is offered to you only if you hold a current, unexpired licence in the state the patient was in and are credentialled for that treatment. Both are checked on every single visit."
          />
          <div className="prose-block mt-8">
            <p>
              That protects you as much as the patient. You are never put in the
              position of noticing halfway through a chart that you should not
              be reading it, and you never have to check a state list yourself
              before deciding.
            </p>
          </div>
        </Split>
      </Band>

      <Band tone="tint">
        <SectionHead
          eyebrow="The work"
          title="Everything on one screen"
          lede="Asynchronous review gets a bad name because of the time spent assembling the picture from four places. This is the fix."
        />
        <TileGrid
          items={[
            {
              title: 'The questionnaire as answered',
              body: 'Every question in the patient’s own words, including free text — not a summary written by something else.',
            },
            {
              title: 'Allergies and conditions',
              body: 'Pulled out as structured fields, so a reported allergy is impossible to miss in a wall of prose.',
            },
            {
              title: 'Their history here',
              body: 'Previous visits and what was prescribed, across every brand they have used on the platform — because they are one patient.',
            },
            {
              title: 'Decide line by line',
              body: 'Each medication with dose, quantity and refills, decided on its own. Approve one and decline another.',
            },
            {
              title: 'Directions you control',
              body: 'A sensible default for the product, which you edit. What you sign is what is recorded — never the default.',
            },
            {
              title: 'A way to ask',
              body: 'Message the patient for a clearer photo or a missing answer. The visit waits on them and comes back when they reply.',
            },
          ]}
        />
      </Band>

      <Band tone="deep">
        <Split
          reverse
          aside={
            <Panel
              onDeep
              title="What you control"
              items={[
                { term: 'Your states', detail: 'Add a licence yourself; we verify it before it routes.' },
                { term: 'Your categories', detail: 'Weight management, hormones, peptides, sexual health and more — only what you choose.' },
                { term: 'Your caseload', detail: 'A ceiling on open visits, so the queue cannot bury you.' },
                { term: 'Your availability', detail: 'Stop receiving new visits without leaving the network.' },
              ]}
            />
          }
        >
          <SectionHead
            align="left"
            onDeep
            eyebrow="On your terms"
            title="You set the boundaries. The system respects them."
            lede="A cap on open visits is not a suggestion — past it, routing skips you and finds somebody else. Nobody can hand you a fiftieth chart because the queue is long."
          />
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead eyebrow="Joining" title="What the process looks like" />
        <Steps
          steps={[
            {
              title: 'Apply',
              body: 'Your details, your NPI, and the states you hold licences in — number and expiry for each.',
            },
            {
              title: 'Upload documents',
              body: 'The list is built from what you told us: a licence per state, your DEA where relevant, and insurance.',
            },
            {
              title: 'We verify',
              body: 'Each licence is checked against its issuing board. One we cannot verify does not route visits, and we tell you why.',
            },
            {
              title: 'Start reviewing',
              body: 'Your queue opens with the states and categories that cleared. Add more whenever you like.',
            },
          ]}
        />
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="What clinicians ask first" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="Start reviewing"
        lede="Tell us your states and we will tell you honestly how much volume to expect in them — before you upload a single document."
        primary={{ href: '/apply/clinician', label: 'Apply as a clinician' }}
        secondary={{ href: '/platform', label: 'How routing works' }}
      />
    </>
  );
}
