import type { Metadata } from 'next';
import {
  Band,
  ClosingCta,
  Faq,
  JsonLd,
  Panel,
  SectionHead,
  Split,
  TileGrid,
} from '@/components/blocks';
import { SecurityVisual } from '@/components/visuals';

export const metadata: Metadata = {
  title: 'Security and HIPAA',
  description:
    'How HealthEMR protects patient data: field-level encryption, role separation enforced independently of the interface, tenant isolation below the query layer, and a hash-chained audit trail.',
  alternates: { canonical: '/security' },
};

const FAQ = [
  {
    q: 'Are you HIPAA compliant?',
    a: 'Compliance is something an organisation achieves, not something software possesses — a large part of it is contractual and procedural. What we can say precisely is which technical safeguards exist, and that is what this page does. Anyone who tells you their software is compliant on its own is describing a certificate, not a control.',
  },
  {
    q: 'Will you sign a BAA?',
    a: 'Yes, and you will also need them with your own hosting, email and any pharmacy you introduce. We can tell you which of ours are already in place.',
  },
  {
    q: 'Where is the data held?',
    a: 'In a single primary database in a region we agree with you, encrypted at rest at the disk level, with identifying fields separately encrypted by the application before they are ever written.',
  },
  {
    q: 'Can your staff read our patients’ records?',
    a: 'A platform operator can, because somebody has to be able to investigate a stuck order or a complaint. The control is not that it cannot happen — it is that it cannot happen invisibly. Every such access is recorded against that patient, attributed to the person, and visible to you.',
  },
  {
    q: 'What happens if an employee is dismissed?',
    a: 'Their access ends immediately, and the audit entries they created remain. Attribution is frozen into each entry as text when it is written, so deleting an account cannot erase what that account did.',
  },
  {
    q: 'Has this been penetration tested?',
    a: 'The automated suite proves the controls behave as designed, and includes checks that every role is refused every other role’s data at both layers. What it cannot tell you is what was never designed — that is what a penetration test is for, and we would expect you to commission one.',
  },
];

export default function SecurityPage() {
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
          eyebrow="Security"
          title="Every control here exists for a named failure."
          lede="Listing the failure first is the only honest way to tell a real safeguard from a box being ticked. So this page names the thing that goes wrong, and then what stops it."
        />
      </Band>

      <Band tone="tint">
        <Split aside={<SecurityVisual className="w-full text-[var(--ink)]" />}>
          <SectionHead
            align="left"
            eyebrow="Defence in depth"
            title="Five layers, each assuming the one above it failed"
            lede="No single control is asked to carry the whole weight. The audit trail assumes someone got in; the tenant filter assumes a query forgot its clause; the encryption assumes the database left the building."
          />
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead
          eyebrow="What goes wrong, and what stops it"
          title="The failures we designed against"
        />
        <TileGrid
          items={[
            {
              eyebrow: 'Cross-tenant leak',
              title: 'One brand reads another’s patients',
              body: 'Almost always a forgotten clause in one query. The tenant filter is applied by the data layer beneath the code, so a developer who forgets cannot leak — and crossing it deliberately requires a function named so it can be found.',
            },
            {
              eyebrow: 'The wrong chart',
              title: 'A clinician is shown a patient who is not theirs',
              body: 'Even for 200ms, that is an incident rather than a flicker. The role is checked before any HTML is sent and again at the API, independently, so nothing renders while the question is still open.',
            },
            {
              eyebrow: 'Quiet insider access',
              title: 'Someone with real credentials reads what they should not',
              body: 'Reads are recorded, not only writes. “Who opened this chart, and when” is a question with an answer — which is the only control that works against a person who is legitimately logged in.',
            },
            {
              eyebrow: 'A stolen database',
              title: 'A backup or a disk leaves the building',
              body: 'Identifying fields are encrypted by the application with AES-256-GCM before they are written, so a dump without the key is not a patient list. The key belongs in a secret manager, backed up separately from the data.',
            },
            {
              eyebrow: 'Rewritten history',
              title: 'Someone edits the record of what they did',
              body: 'Each audit entry is hash-chained to the one before it and carries a monotonic position. An edit breaks every hash after it; a deletion leaves a gap. Both are detectable, and there is a routine that walks the chain and reports where it first breaks.',
            },
            {
              eyebrow: 'Token theft',
              title: 'A script on the page steals the session',
              body: 'The access token is held server-side and attached to requests there. It is never readable by JavaScript in the browser, so the realistic route to stealing one yields nothing reusable.',
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
              title="Leaving the building"
              items={[
                {
                  term: 'To pharmacies',
                  detail: 'Only what is needed to dispense. Not the questionnaire, not the history.',
                },
                {
                  term: 'To your CRM',
                  detail: 'Only events for your own patients, to endpoints only an operator can configure.',
                },
                {
                  term: 'Signed and timestamped',
                  detail: 'Each delivery carries your bearer token and a signature over the exact bytes sent.',
                },
                {
                  term: 'To logs',
                  detail: 'No patient identifiers. A log line names a visit by an id meaningless without the database.',
                },
              ]}
            />
          }
        >
          <SectionHead
            align="left"
            onDeep
            eyebrow="Outbound"
            title="The data that leaves is the data that leaks"
            lede="Most breaches are not intrusions; they are disclosures that were configured on purpose by somebody who did not think it through. So a webhook — an instruction to send patient events somewhere — can only be created by a platform operator, never by the brand receiving it, and every change is audited."
          />
        </Split>
      </Band>

      <Band tone="paper">
        <SectionHead
          eyebrow="Being straight with you"
          title="What is not ours to solve"
          lede="A vendor who claims to hand you compliance is selling you a problem you will discover during an audit."
        />
        <div className="mx-auto mt-14 max-w-3xl">
          <Panel
            items={[
              {
                term: 'Business Associate Agreements',
                detail: 'With us, and with your hosting, your email provider and every pharmacy you introduce. Without them the technical controls do not matter legally.',
              },
              {
                term: 'Key management',
                detail: 'The encryption key belongs in a managed secret store with rotation, and must be backed up separately from the database. A database restored without its key is unreadable; the two stolen together are not.',
              },
              {
                term: 'Workforce controls',
                detail: 'Training, sanction policy and access reviews are organisational. The audit log is your evidence they are working — but somebody has to read it.',
              },
              {
                term: 'Backup drills',
                detail: 'Encrypted backups are necessary. A restore that has actually been rehearsed is what makes them real.',
              },
              {
                term: 'A penetration test',
                detail: 'Our tests prove the controls behave as designed. They cannot tell you what was never designed.',
              },
            ]}
          />
        </div>
      </Band>

      <Band tone="tint">
        <SectionHead eyebrow="Questions" title="What compliance officers ask" />
        <Faq items={FAQ} />
      </Band>

      <ClosingCta
        title="Send us your security questionnaire"
        lede="We would rather answer it in detail before you commit than discover a gap together afterwards."
        primary={{ href: '/apply/telehealth', label: 'Book a demo' }}
        secondary={{ href: '/platform', label: 'How the platform works' }}
      />
    </>
  );
}
