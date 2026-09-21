import { ProviderApplicationForm } from './form';

export const metadata = { title: 'Apply as a provider — HealthEMR' };

export default function ApplyProvider() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-medium">Join the provider roster</h1>
        <p className="mt-2 text-[var(--ar-text-muted)]">
          Add every state you are licensed in. Routing depends entirely on these — a request is only
          ever offered to a clinician holding a current licence in the state the patient was in when
          they submitted.
        </p>
      </div>
      <ProviderApplicationForm />
    </div>
  );
}
