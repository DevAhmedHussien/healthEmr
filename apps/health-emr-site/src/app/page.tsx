import type { Metadata } from 'next';
import {
  Band,
  ClosingCta,
  Cta,
  Faq,
  Figures,
  JsonLd,
  More,
  Panel,
  SectionHead,
  Split,
  Steps,
  Tile,
  TileGrid,
} from '@/components/blocks';
import { NetworkVisual, PipelineVisual, RoutingVisual } from '@/components/visuals';
import { COMPANY, SITE_NAME, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Telehealth EMR and clinical operations platform',
  description:
    'HealthEMR runs the clinical side of a telehealth business — licensed review in the patient’s own state, pharmacy fulfilment, and an auditable record. You keep the brand and the customer.',
  alternates: { canonical: '/' },
  openGraph: {
    url: SITE_URL,
    title: 'HealthEMR — telehealth EMR and clinical operations platform',
    description: 'Licensed clinical review, contracted pharmacies and an auditable patient record.',
  },
};

const STEPS = [
  {
    title: 'Your patient submits',
    body: 'They finish your intake form, on your site. You post it to one endpoint; we match the person or open a record.',
  },
  {
    title: 'We find a licensed clinician',
    body: 'Only someone holding a current licence in the state the patient was in, and credentialled for that treatment.',
  },
  {
    title: 'They decide, line by line',
    body: 'Approve, change the dose, or decline with a reason — written onto the record as they do it.',
  },
  {
    title: 'A pharmacy fills and ships',
    body: 'The order transmits, the carrier and tracking come back, and your customer is told at every step.',
  },
];

const FAQ = [
  {
    q: 'Is HealthEMR an EMR, or a marketplace?',
    a: 'An EMR with the operational parts attached. It holds the clinical record, and it also routes visits to clinicians, transmits orders to pharmacies and tracks what shipped. The alternative is usually three systems and somebody reconciling them by hand.',
  },
  {
    q: 'Who actually prescribes?',
    a: 'A licensed clinician, every time. HealthEMR decides who is allowed to see a visit and records what they decided. It never makes a clinical decision itself and has no autoprescribe mode.',
  },
  {
    q: 'Do we have to move our existing patients?',
    a: 'No. Brands usually send new visits while their old system finishes the ones it holds. Our API takes your own order identifier, so both can run side by side and be compared before you commit to anything.',
  },
  {
    q: 'What does the integration involve?',
    a: 'One POST from your intake form. Everything after that — routing, prescribing, fulfilment, patient notifications — happens here and is reported back by webhook or by polling, whichever suits you.',
  },
  {
    q: 'Can we use our own pharmacy?',
    a: 'Yes. Partners already on the platform can take your orders immediately, and a pharmacy you bring is onboarded through the same process. There is an application form for them on this site.',
  },
  {
    q: 'Is it HIPAA compliant?',
    a: 'No software is compliant on its own — compliance is something an organisation does, and part of it is contractual. What we provide is the technical half: encrypted identifying data, role separation enforced independently of the interface, and a tamper-evident audit trail. The security page is specific about what is ours and what stays yours.',
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              // Organization *and* LocalBusiness: the company is a real one in a
              // real place, and a clinician searching "telehealth review work
              // Tampa" is a different, warmer query than "telehealth EMR".
              '@type': ['Organization', 'LocalBusiness'],
              '@id': `${SITE_URL}/#organization`,
              name: SITE_NAME,
              url: SITE_URL,
              description:
                'Clinical operations platform for licensed telehealth: routing, prescribing, pharmacy fulfilment and an auditable patient record. Based in Tampa, Florida.',
              address: {
                '@type': 'PostalAddress',
                addressLocality: COMPANY.locality,
                addressRegion: COMPANY.region,
                addressCountry: COMPANY.country,
              },
              areaServed: { '@type': 'Country', name: 'United States' },
            },
            {
              '@type': 'WebSite',
              '@id': `${SITE_URL}/#website`,
              url: SITE_URL,
              name: SITE_NAME,
              publisher: { '@id': `${SITE_URL}/#organization` },
            },
            {
              '@type': 'SoftwareApplication',
              name: SITE_NAME,
              applicationCategory: 'BusinessApplication',
              applicationSubCategory: 'Electronic Medical Records',
              operatingSystem: 'Web',
              description:
                'Multi-tenant telehealth EMR with state-licensed clinician routing, pharmacy integration and a hash-chained audit trail. Built in Tampa, Florida.',
              provider: { '@id': `${SITE_URL}/#organization` },
            },
            {
              '@type': 'FAQPage',
              mainEntity: FAQ.map((item) => ({
                '@type': 'Question',
                name: item.q,
                acceptedAnswer: { '@type': 'Answer', text: item.a },
              })),
            },
          ],
        }}
      />

      {/* Hero ---------------------------------------------------------- */}
      <Band tone="paper" size="tall" className="pb-10 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <p className="t-eyebrow">Telehealth clinical operations · Tampa, Florida</p>
          <h1 className="t-hero mt-5">
            The clinical layer behind
            <br className="hidden sm:block" /> your telehealth brand.
          </h1>
          <p className="t-lede mx-auto mt-8 max-w-xl">
            You keep the storefront, the marketing and the customer. We run
            everything between the moment a patient hits submit and the moment a
            tracking number lands.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
            <Cta href="/apply/telehealth">Book a demo</Cta>
            <More href="/platform">See how it works</More>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-4xl">
          <PipelineVisual className="w-full text-[var(--ink)]" />
        </div>

        <Figures
          figures={[
            { value: '50', label: 'States covered by the clinician network' },
            { value: 'One call', label: 'To send us a visit and get everything back' },
            { value: 'Per line', label: 'Decisions, so one visit can carry several medications' },
            { value: 'Every step', label: 'Recorded, and pushed to your systems as it happens' },
          ]}
        />
      </Band>

      {/* Routing ------------------------------------------------------- */}
      <Band tone="tint">
        <Split
          aside={<RoutingVisual className="w-full text-[var(--ink)]" />}
        >
          <SectionHead
            align="left"
            eyebrow="Licensed routing"
            title="A visit only ever reaches someone allowed to see it"
            lede="Two gates, checked on every visit: a current licence in the state the patient was in, and credentials for that treatment. Neither can be waived — not by an administrator, not by us."
          />
          <div className="mt-8">
            <More href="/platform">How routing works</More>
          </div>
        </Split>
      </Band>

      {/* Pillars ------------------------------------------------------- */}
      <Band tone="paper">
        <SectionHead
          eyebrow="What you get"
          title="Built around the parts that go wrong"
          lede="Most of this platform exists because of a specific failure — a visit that reached the wrong clinician, a record nobody could reconstruct, a patient left waiting on a queue no one was watching."
        />
        <TileGrid
          items={[
            {
              title: 'One record per patient',
              body: 'Intake answers, allergies, decisions, prescriptions, shipments and messages on one chart — not spread across a form tool, a spreadsheet and an inbox.',
            },
            {
              title: 'A trail that survives scrutiny',
              body: 'Every read and every change recorded and hash-chained, so an edited or deleted entry is detectable rather than invisible.',
            },
            {
              title: 'Your brand, your customer',
              body: 'Patients stay yours. Nothing reaches them with our name on it unless you decide it should.',
            },
            {
              title: 'Pharmacies already contracted',
              body: 'Integrated partners receive orders machine-to-machine. You do not need a dispensing agreement to launch.',
            },
            {
              title: 'Events out to your stack',
              body: 'Every step posted to your CRM as it happens — signed, and retried on failure — so sales and support see what the patient sees.',
            },
            {
              title: 'Money you can reconcile',
              body: 'Cost, price and clinician fee held apart on every line, so margin is a number you can read rather than derive.',
            },
          ]}
        />
      </Band>

      {/* The shape ----------------------------------------------------- */}
      <Band tone="deep">
        <Split
          reverse
          aside={<NetworkVisual className="w-full text-white" />}
        >
          <SectionHead
            align="left"
            onDeep
            eyebrow="Multi-tenant by design"
            title="Many brands. One network. No overlap."
            lede="Each brand keeps its own patients, catalogue and pricing, separated in the data layer itself rather than by careful querying. What is shared is the clinician and pharmacy network — which is why a new brand can offer fifty-state coverage on day one instead of in year two."
          />
          <div className="mt-8">
            <More href="/for-telehealth">For telehealth brands</More>
          </div>
        </Split>
      </Band>

      {/* How it works -------------------------------------------------- */}
      <Band tone="paper">
        <SectionHead
          eyebrow="End to end"
          title="How a prescription moves"
          lede="Four steps, in this order. A visit cannot ship before it is signed, and it cannot be signed by someone who is not licensed where the patient is."
        />
        <Steps steps={STEPS} />
      </Band>

      {/* Three doors ---------------------------------------------------- */}
      <Band tone="tint">
        <SectionHead
          eyebrow="Three ways in"
          title="The platform works because three groups meet on it"
        />
        <div className="mt-16 grid gap-4 lg:grid-cols-3">
          <Tile
            tone="paper"
            title="Telehealth brands"
            body="You have the customers and the marketing. You need licensed clinicians, contracted pharmacies and a record that stands up."
          >
            <div className="mt-6 flex flex-wrap gap-5 text-[0.95rem]">
              <More href="/apply/telehealth">Book a demo</More>
              <More href="/for-telehealth">Learn more</More>
            </div>
          </Tile>
          <Tile
            tone="paper"
            title="Clinicians"
            body="Review visits from several brands in one queue, filtered to the states you are licensed in and the treatments you are credentialled for."
          >
            <div className="mt-6 flex flex-wrap gap-5 text-[0.95rem]">
              <More href="/apply/clinician">Apply to join</More>
              <More href="/for-clinicians">Learn more</More>
            </div>
          </Tile>
          <Tile
            tone="paper"
            title="Pharmacies"
            body="Receive signed prescriptions machine-to-machine, with directions, quantity and the shipping address already on them."
          >
            <div className="mt-6 flex flex-wrap gap-5 text-[0.95rem]">
              <More href="/apply/pharmacy">Apply to join</More>
              <More href="/for-pharmacies">Learn more</More>
            </div>
          </Tile>
        </div>
      </Band>

      {/* Security ------------------------------------------------------- */}
      <Band tone="paper">
        <Split
          aside={
            <Panel
              title="In practice"
              items={[
                {
                  term: 'Identifying data encrypted before storage',
                  detail: 'AES-256-GCM at the field level, so a stolen backup is not a readable patient list.',
                },
                {
                  term: 'Roles enforced twice, independently',
                  detail: 'Once before a page renders, again at the API — so a wrong chart is never briefly on screen.',
                },
                {
                  term: 'A tamper-evident audit trail',
                  detail: 'Each entry hash-chained to the one before it: an edited or deleted record breaks the chain.',
                },
                {
                  term: 'Separation below the query',
                  detail: 'One brand cannot read another’s patients, even through a bug in the code above it.',
                },
              ]}
            />
          }
        >
          <SectionHead
            align="left"
            eyebrow="Security"
            title="Designed for the day somebody asks"
            lede="Patient data is the entire liability of a telehealth business. These controls are described plainly enough to check — including the parts that remain yours to do."
          />
          <div className="mt-8">
            <More href="/security">Read the security overview</More>
          </div>
        </Split>
      </Band>

      {/* FAQ ------------------------------------------------------------ */}
      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="The ones we are asked first" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="See it with your own workflow"
        lede="Thirty minutes, your treatment categories and your states. We will send a visit in and show you a tracking number coming out."
        primary={{ href: '/apply/telehealth', label: 'Book a demo' }}
        secondary={{ href: '/platform', label: 'Read how it works' }}
      />
    </>
  );
}
