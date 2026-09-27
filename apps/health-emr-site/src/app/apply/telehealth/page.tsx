import type { Metadata } from 'next';
import { SectionHead } from '@/components/blocks';
import { TelehealthForm } from './form';

export const metadata: Metadata = {
  title: 'Book a demo',
  description:
    'See HealthEMR with your own treatment categories and states: a visit routed to a licensed clinician, signed, and fulfilled through to a tracking number.',
  alternates: { canonical: '/apply/telehealth' },
};

export default function Page() {
  return (
    <>
      <SectionHead
        as="h1"
        align="left"
        size="display"
        eyebrow="For telehealth brands"
        title="Book a demo"
        lede="Thirty minutes. Bring a treatment category and a state you operate in, and we will route a real visit through to a tracking number in front of you."
      />
      <div className="mt-14">
        <TelehealthForm />
      </div>
    </>
  );
}
