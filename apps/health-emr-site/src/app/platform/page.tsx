import type { Metadata } from 'next';
import {
  Band,
  ClosingCta,
  Faq,
  JsonLd,
  More,
  Panel,
  SectionHead,
  Split,
  Steps,
  TileGrid,
} from '@/components/blocks';
import { PipelineVisual, RecordVisual, RoutingVisual } from '@/components/visuals';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'A visit from intake to tracking number: licensed routing, per-medication decisions, pharmacy transmission, and the events your systems receive along the way.',
  alternates: { canonical: '/platform' },
};

const STEPS = [
  {
    title: 'Intake arrives',
    body: 'You post the completed questionnaire with your own order id. We match the patient or open a record, and that id stays attached for the life of the visit.',
  },
  {
    title: 'Routing picks a clinician',
    body: 'The roster narrows to current licences in the patient’s state and credentials for the treatment, then the least-loaded of those is chosen.',
  },
  {
    title: 'The clinician decides',
    body: 'They see the questionnaire, allergies, conditions and history, then approve, change the dose, decline with a reason, or ask the patient for more.',
  },
  {
    title: 'The pharmacy fills',
    body: 'Signing transmits the order. The pharmacy acknowledges, dispenses, and returns a carrier and tracking number that flows back to you and the patient.',
  },
];

const FAQ = [
  {
    q: 'What happens when no clinician can take a visit?',
    a: 'The platform separates two cases. If everyone is merely busy, the visit is retried automatically until somebody frees up. If nobody is licensed in that state for that treatment, retrying will never help — so it is surfaced to the operator, who can recruit or place it by hand with a named clinician who does qualify.',
  },
  {
    q: 'Can one visit carry several medications?',
    a: 'Yes, and each is decided on its own. A clinician can approve one line and decline another. If two lines need different credentials and no single clinician holds both, the visit is split so each line reaches someone qualified.',
  },
  {
    q: 'What if the patient never replies to a question?',
    a: 'The visit waits on them, in a state that says so, rather than disappearing back into the queue. You can see everything that is waiting and chase it.',
  },
  {
    q: 'How do we know what happened to a visit?',
    a: 'Every visit carries its own history: who was considered and why they were passed over, who decided what, when it transmitted, and what the pharmacy said back. Read it through the API, or receive each step as a webhook.',
  },
  {
    q: 'Which state is used — where they live, or where they were?',
    a: 'Where they were when they submitted. Routing is a statement about that moment, and a patient who later moves must not retroactively change who was allowed to review them.',
  },
];

export default function PlatformPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        }}
      />

      <Band tone="paper" size="tall" className="pb-8 md:pb-12">
        <SectionHead
          as="h1"
          size="hero"
          eyebrow="How it works"
          title="From a submitted form to a tracking number"
          lede="One integration point, then four things happen in a fixed order. This is what each of them actually does."
        />
        <div className="mx-auto mt-20 max-w-4xl">
          <PipelineVisual className="w-full text-[var(--ink)]" />
        </div>
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="The sequence" title="Four steps, and nothing skips ahead" />
        <Steps steps={STEPS} />
      </Band>

      <Band tone="paper">
        <Split aside={<RoutingVisual className="w-full text-[var(--ink)]" />}>
          <SectionHead
            align="left"
            eyebrow="Routing"
            title="Who is allowed to see this patient"
            lede="Routing carries the regulatory weight, so it is the part with the least flexibility. Licence and credentialling are checked on every visit and cannot be waived by anyone — not an administrator, not the platform operator."
          />
          <div className="prose-block mt-8">
            <p>
              Capacity is different in kind. It is a limit we set ourselves to
              keep caseloads workable, so it can be overridden deliberately by a
              named person with a reason recorded against the visit. That
              distinction — what is law and what is policy — runs through the
              whole system.
            </p>
            <p>
              Every clinician considered is recorded along with the reason they
              were not chosen. A visit refused forty times for the same reason
              is not a mystery; it is the signal that you need somebody licensed
              in that state.
            </p>
          </div>
        </Split>
      </Band>

      <Band tone="tint">
        <Split reverse aside={<RecordVisual className="w-full text-[var(--ink)]" />}>
          <SectionHead
            align="left"
            eyebrow="The record"
            title="One chart, whichever brand they came through"
            lede="A patient who buys from two of your brands is still one person with one medication history — and the clinician reviewing the second visit needs to see the first."
          />
          <div className="mt-8">
            <More href="/security">How access to it is controlled</More>
          </div>
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead
          eyebrow="What sits on it"
          title="Enough to reconstruct the decision years later"
        />
        <TileGrid
          items={[
            {
              title: 'The questionnaire as answered',
              body: 'Stored question by question, so what the patient actually said is recoverable — not a summary of it.',
            },
            {
              title: 'Allergies and conditions, structured',
              body: 'Lifted out of free text into real fields, because the pharmacy’s dispensing screen reads those fields. Left in prose, a patient who wrote “Sulfa” shows as having no allergies.',
            },
            {
              title: 'Every decision, with its reason',
              body: 'Per medication — approved, modified or declined — with the directions signed and the licence the clinician held at that moment.',
            },
            {
              title: 'Fulfilment and tracking',
              body: 'Which pharmacy, what it cost, when it shipped, and the carrier and tracking number returned.',
            },
            {
              title: 'The conversation',
              body: 'Messages between patient and clinician, including anything the patient uploaded, on the same chart.',
            },
            {
              title: 'Who looked at it',
              body: 'Reads as well as writes. “Who opened this chart, and when” is a question with an answer.',
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
              title="Events you can receive"
              items={[
                { term: 'visit.received', detail: 'We have it, and it is being routed.' },
                { term: 'visit.assigned', detail: 'A named clinician now owns it.' },
                { term: 'visit.approved / denied', detail: 'With the reason, per medication.' },
                { term: 'prescription.signed', detail: 'Legally signed; fulfilment begins.' },
                { term: 'order.submitted', detail: 'Sent to the pharmacy.' },
                { term: 'order.shipped / delivered', detail: 'With carrier and tracking number.' },
              ]}
            />
          }
        >
          <SectionHead
            align="left"
            onDeep
            eyebrow="Integration"
            title="One call in. A stream of events out."
            lede="Sending a visit is a single POST carrying your own order id, which doubles as the idempotency key — a retry is safe and never produces a duplicate."
          />
          <div className="prose-block mt-8">
            <p className="text-white/60">
              After that you need not poll unless you want to. Each step is
              posted to endpoints you control, so your CRM shows a patient’s
              progress without anyone copying it across. Deliveries carry your
              own bearer token and a signature over the exact bytes sent, and a
              failure is retried on a backoff rather than dropped.
            </p>
            <p className="text-white/60">
              Because your identifier travels with the visit, you can run us
              alongside whatever you use today and compare the two before moving
              anything.
            </p>
          </div>
        </Split>
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="What people ask about the mechanics" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="Walk a real visit through it"
        lede="Bring one of your treatment categories and a state you operate in. We will route a visit, sign it, and show you what your systems would have received."
        primary={{ href: '/apply/telehealth', label: 'Book a demo' }}
        secondary={{ href: '/security', label: 'How it is secured' }}
      />
    </>
  );
}
