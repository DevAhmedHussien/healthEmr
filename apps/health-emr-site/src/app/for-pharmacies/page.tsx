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
import { NetworkVisual } from '@/components/visuals';

export const metadata: Metadata = {
  title: 'For pharmacies',
  description:
    'Fill telehealth prescriptions for multiple brands through one contract. Signed orders arrive machine-to-machine with directions, quantity, days supply and ship-to already on them. LifeFile or generic HTTP.',
  alternates: { canonical: '/for-pharmacies' },
};

const FAQ = [
  {
    q: 'Do we have to change our systems?',
    a: 'No. If you run LifeFile we speak it natively, using your own vendor and location identifiers. If you use something else there is a generic HTTP integration, and if you would rather not integrate at all there is a dispensary screen your team can work from directly.',
  },
  {
    q: 'What do you send us?',
    a: 'Only what is needed to dispense: patient name and shipping address, the product and its code in your catalogue, directions, quantity, days supply, refills, and the prescriber’s identity and licence. Not the questionnaire, not their history, not what else they are being treated for.',
  },
  {
    q: 'How do you know which product to order?',
    a: 'From your own catalogue codes, not ours. We keep our identifier and yours as separate fields on purpose — the same clinical product has different codes at different pharmacies, and conflating them is how the wrong item ships.',
  },
  {
    q: 'What if we cannot fill something?',
    a: 'Reject it with a reason and it comes back to us immediately, visible as a problem rather than a silence. The platform can then route it to another contracted pharmacy without the patient starting again.',
  },
  {
    q: 'How do we report shipping?',
    a: 'Post the carrier and tracking number back, or enter it on the dispensary screen. It flows straight through to the brand and the patient — you are not asked to notify anyone separately.',
  },
  {
    q: 'Do we deal with several brands separately?',
    a: 'No. Orders arrive from every brand contracted to you through one connection and one queue. You hold one relationship — with us — rather than one per telehealth company.',
  },
];

export default function ForPharmaciesPage() {
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
          eyebrow="For pharmacies"
          title="Orders that arrive ready to fill."
          lede="Signed prescriptions, machine to machine, with directions, quantity, days supply and the shipping address already on them. One connection, every brand we work with."
        />
        <div className="mt-11 flex flex-wrap items-center justify-center gap-6">
          <More href="/apply/pharmacy">Apply to join the network</More>
        </div>

        <Figures
          figures={[
            { value: 'One contract', label: 'Not one per telehealth company you fill for' },
            { value: 'Ready to fill', label: 'Directions, quantity and ship-to already on the order' },
            { value: 'Your codes', label: 'Ordered against your catalogue, never ours' },
            { value: 'Cost agreed', label: 'Per product, before anything is orderable' },
          ]}
        />
      </Band>

      <Band tone="tint">
        <Split reverse aside={<NetworkVisual className="w-full text-[var(--ink)]" />}>
          <SectionHead
            align="left"
            eyebrow="One relationship"
            title="Not one contract per telehealth company"
            lede="Brands come and go, rebrand and merge. Contracting with each of them separately means renegotiating constantly and maintaining a different ordering path for each."
          />
          <div className="prose-block mt-8">
            <p>
              Here you hold one agreement and one connection. Brands are added
              to it as they contract with us, and their orders arrive in the same
              queue in the same shape as everyone else’s.
            </p>
          </div>
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead
          eyebrow="What arrives"
          title="Everything needed to dispense. Nothing that is not."
          lede="A dispensing pharmacist needs the prescription and the patient’s safety information. They do not need the consultation, and sending it anyway would be a disclosure nobody asked for."
        />
        <TileGrid
          items={[
            {
              title: 'The prescription',
              body: 'Product, strength, quantity, days supply and refills — against your own catalogue code, not ours.',
            },
            {
              title: 'Directions as signed',
              body: 'The exact sig the clinician signed, not a default from the product record.',
            },
            {
              title: 'The prescriber',
              body: 'Name, credentials, NPI, and the licence number and state they held when they signed.',
            },
            {
              title: 'Ship-to details',
              body: 'The patient’s name and address as verified at intake, ready for the label.',
            },
            {
              title: 'Allergies',
              body: 'Structured, so your dispensing check has them — the one piece of clinical history that genuinely belongs with the fill.',
            },
            {
              title: 'Nothing else',
              body: 'No questionnaire, no history, no other treatments. What you are not sent cannot leak from your systems.',
            },
          ]}
        />
      </Band>

      <Band tone="deep">
        <Split
          aside={
            <Panel
              onDeep
              title="Three ways to connect"
              items={[
                {
                  term: 'LifeFile',
                  detail: 'Spoken natively, with your own vendor, location and practice identifiers.',
                },
                {
                  term: 'Generic HTTP',
                  detail: 'Your endpoint, your authentication, a payload mapped to your fields.',
                },
                {
                  term: 'No integration',
                  detail: 'Work the dispensary screen directly — queue, order detail, and a box for tracking.',
                },
              ]}
            />
          }
        >
          <SectionHead
            align="left"
            onDeep
            eyebrow="Integration"
            title="We adapt to your system, not the other way round"
            lede="Nothing is transmitted to a live pharmacy system until the connection is switched on deliberately, so a half-configured integration cannot send a real order to anybody."
          />
          <div className="mt-8">
            <More href="/apply/pharmacy">Start an application</More>
          </div>
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead eyebrow="Joining" title="What the process looks like" />
        <Steps
          steps={[
            {
              title: 'Apply',
              body: 'Legal name, contacts, the states you ship into, and whether you dispense compounded, branded or both.',
            },
            {
              title: 'Documents',
              body: 'The list is built from what you tell us — a licence per state you ship into, non-resident licences where they apply, and FDA registration for a 503B.',
            },
            {
              title: 'Catalogue and pricing',
              body: 'Your products with your own codes and an agreed cost per item — weight management, hormones, peptides, sexual health, whatever you carry. Nothing is orderable until this is settled.',
            },
            {
              title: 'Connect and go live',
              body: 'We configure the integration with you, test it end to end, and switch it on when you say so.',
            },
          ]}
        />
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="What pharmacies ask first" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="Join the pharmacy network"
        lede="Tell us what you dispense and where you ship. We will tell you which brands and categories that covers before you send a single document."
        primary={{ href: '/apply/pharmacy', label: 'Apply as a pharmacy' }}
        secondary={{ href: '/platform', label: 'How fulfilment works' }}
      />
    </>
  );
}
