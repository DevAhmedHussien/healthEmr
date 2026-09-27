import type { Metadata } from 'next';
import {
  Band,
  ClosingCta,
  Faq,
  JsonLd,
  Panel,
  TileGrid,
  SectionHead,
  Split,
  Steps,
} from '@/components/blocks';

export const metadata: Metadata = {
  title: 'For telehealth brands',
  description:
    'Launch or move a telehealth brand without building a clinical operation: licensed clinicians, contracted pharmacies, patient records and billing you can reconcile.',
  alternates: { canonical: '/for-telehealth' },
};

const FAQ = [
  {
    q: 'How long does it take to go live?',
    a: 'The integration itself is one endpoint and is usually done in a day. What sets the date is the commercial side — which treatment categories you are offering, which states, and agreeing pricing per product. Brands with those settled are typically live in two to three weeks.',
  },
  {
    q: 'Do our patients know about HealthEMR?',
    a: 'Only if you want them to. Patient-facing messages carry your brand. The clinician sees which account a visit came from because they have to, but nothing goes to the patient with our name on it by default.',
  },
  {
    q: 'What does it cost?',
    a: 'Per visit reviewed and per product dispensed, agreed per category before you launch. Your cost of goods and your rate are set per account, so what you pay is not what another brand pays. We do not take a percentage of your revenue — you never tell us what you charge your customer.',
  },
  {
    q: 'What happens if a clinician declines a patient we already charged?',
    a: 'The decline and its reason are on the record and pushed to you immediately, so you can refund on your own terms. You are billed for the clinical review that happened; there is no product cost, because nothing was dispensed.',
  },
  {
    q: 'Can we keep our current pharmacy?',
    a: 'Yes. Either they join the platform through the pharmacy application, or you use partners already contracted here. Most brands do both — an existing relationship for their core product, ours for the states or categories that relationship does not cover.',
  },
  {
    q: 'What if we outgrow you or want to leave?',
    a: 'The record is yours and exportable — patients, visits, decisions, prescriptions and the audit trail. We would rather you could leave and chose not to.',
  },
];

export default function ForTelehealthPage() {
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

      <Band tone="paper" className="pb-8 pt-14 md:pb-12 md:pt-20">
        <SectionHead
          as="h1"
          eyebrow="For telehealth brands"
          title="Everything behind the prescribe button"
          lede="You have the customers, the marketing and the storefront. The hard part is the regulated middle — finding clinicians licensed in fifty states, contracting pharmacies, and keeping a record that survives an audit. That is the part we run."
        />
      </Band>

      <Band tone="tint">
        <SectionHead
          eyebrow="The alternative"
          title="What you would otherwise be building"
          lede="Every brand that tries this alone builds the same six things, and usually discovers the last two only after launch."
        />
        <TileGrid
          items={[
            {
              title: 'A clinician network',
              body: 'Recruited, credentialled and licence-verified per state, with cover for holidays and volume spikes. Then re-verified as licences expire.',
            },
            {
              title: 'Pharmacy contracts',
              body: 'Negotiated per product and per state, each with a different ordering system and a different code for the same medication.',
            },
            {
              title: 'A routing engine',
              body: 'That never sends a visit to someone unlicensed where the patient is — the failure that ends telehealth businesses.',
            },
            {
              title: 'A patient record',
              body: 'Structured well enough that a pharmacy sees the allergy and a regulator sees the decision.',
            },
            {
              title: 'An audit trail',
              body: 'Covering reads as well as writes, and tamper-evident, because "we have logs" is not the same as "we can prove nothing was changed".',
            },
            {
              title: 'Reconciliation',
              body: 'Tying every shipment to what it cost, what it earned and which clinician was paid for the review behind it.',
            },
          ]}
        />
      </Band>

      <Band tone="paper">
        <Split
          aside={
            <Panel
              title="What you keep"
              items={[
                { term: 'The customer', detail: 'Your patients, your list, your relationship.' },
                { term: 'The brand', detail: 'Patient messaging goes out as you, not as us.' },
                { term: 'Your prices', detail: 'You set what your customer pays; we never see it.' },
                { term: 'The record', detail: 'Exportable in full, whenever you ask.' },
              ]}
            />
          }
        >
          <SectionHead
            eyebrow="The arrangement"
            title="We are infrastructure, not a competitor"
            lede="We have no storefront, no consumer brand and no direct-to-patient business. There is nothing for us to gain from your customer list, which is the question every brand asks second."
          />
          <div className="prose-block mt-6">
            <p>
              Each brand on the platform is separated in the data layer itself
              rather than by careful querying — one account cannot read another
              account’s patients even through a bug, because the filter is
              applied beneath the code that would have forgotten it.
            </p>
            <p>
              The one thing shared across brands is the clinician network, and
              that is deliberate: it is why a new brand can offer fifty-state
              coverage on day one instead of in year two.
            </p>
          </div>
        </Split>
      </Band>

      <Band tone="tint">
        <SectionHead
          eyebrow="Getting started"
          title="From first call to first shipment"
        />
        <Steps
          steps={[
            {
              title: 'Scope',
              body: 'Which treatment categories, which states, which products. We tell you honestly where the network is thin.',
            },
            {
              title: 'Account and catalogue',
              body: 'Your account is created with your products and your agreed rates. You see your cost per product before you launch.',
            },
            {
              title: 'Integrate',
              body: 'One POST from your intake form, and the webhook endpoints you want events on. Sandbox first, with your own order ids.',
            },
            {
              title: 'Go live in stages',
              body: 'Most brands send one state or one category first, watch it end to end, then open the rest.',
            },
          ]}
        />
      </Band>

      <Band tone="paper">
        <SectionHead
          eyebrow="What you see"
          title="Your own console, not a shared inbox"
          lede="Every brand gets its own view of its own operation."
        />
        <TileGrid
          items={[
            {
              title: 'Visits and their stage',
              body: 'What has arrived, what is with a clinician, what is waiting on a patient, and what is stuck — with the reason.',
            },
            {
              title: 'Prescriptions and shipments',
              body: 'What was signed, by whom, under which licence, and where the parcel is.',
            },
            {
              title: 'Patients',
              body: 'The full chart for anyone who came through you, including the questionnaire as they answered it.',
            },
            {
              title: 'What you owe',
              body: 'Invoices per period, with the lines behind them — never our margin, and never another brand’s rates.',
            },
            {
              title: 'Approval rates',
              body: 'How many visits convert, how long review takes, and which categories decline most.',
            },
            {
              title: 'Your staff',
              body: 'Your own team members, with access limited to your account.',
            },
          ]}
        />
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="What brands ask before signing" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="Bring us a category and a state"
        lede="Thirty minutes. We will route a real visit through to a tracking number and show you exactly what your systems would receive at each step."
        primary={{ href: '/apply/telehealth', label: 'Book a demo' }}
        secondary={{ href: '/platform', label: 'See how it works' }}
      />
    </>
  );
}
