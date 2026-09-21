# HealthEMR

A multi-tenant telehealth EMR platform. A telehealth business posts an intake to
our API; we route it to a clinician licensed in the patient's state, they approve
or decline it, the pharmacy fills and ships it, and the patient is told — without
their medication name travelling by SMS.

## Run it

```bash
docker compose up -d postgres
cp .env.example .env            # then fill in the secrets
npm install
npm run db:migrate
npm run db:seed                 # prints logins and tenant API keys

npm run dev                     # api on :4000, web on :3000
```

Swagger: http://localhost:4000/docs · App: http://localhost:3000

## Seeded logins

| Role | Email | Password |
|---|---|---|
| Super Admin | `super@healthemr.test` | `Super!2026` |
| Admin (joeyMed) | `admin@joeymed.test` | `Admin!2026` |
| Admin (acmeHealth) | `admin@acmehealth.test` | `Admin!2026` |
| Provider (CA/NV/AZ) | `dr.reyes@healthemr.test` | `Provider!2026` |
| Provider (TX/FL/GA) | `dr.okafor@healthemr.test` | `Provider!2026` |
| Pharmacy | `rx@firstchoice.test` | `Pharmacy!2026` |

Two tenants are seeded on purpose: with only one, every isolation bug looks like
correct behaviour.

## Shape

```
apps/health-emr-api     NestJS · Prisma · PostgreSQL     one container, no Lambda
apps/health-emr-web     Next.js App Router · Tailwind
packages/types          Zod schemas → validators, TS types and OpenAPI
```

The API is one deployable made of bounded contexts that talk through a domain
event bus, never by reaching into each other's tables — so any context can be
lifted into its own service later without rewriting its callers.

```
src/contexts/  identity · tenancy · patients · practitioners · prescribing
               pharmacy · messaging · notifications · onboarding · admin
               partner-api · health
```

## Decisions worth knowing

**Tenant isolation is enforced by the data layer.** A Prisma extension injects
`tenantId` into every query on a tenant-scoped model, read from AsyncLocalStorage.
A service that forgets its `where` clause returns that tenant's rows, not
everyone's. A test reads the Prisma DMMF and fails the build if a model with
`tenantId` is added without being registered or explicitly exempted.

**Licensure gates routing, and is re-checked at signature.** A request only ever
reaches a provider holding a current licence in the state the patient was in when
they submitted — not their mailing address. The licence is checked again when
they sign, because it can lapse in between, and snapshotted onto the prescription.

**Clinical content is withheld from the telehealth business.** One declared
redaction policy, read by the services. An admin sees who ordered, what shipped
and what it cost; not the questionnaire, the notes or the images. The response
names what was withheld so the UI can say so rather than imply the patient has
no allergies.

**Outbound email and SMS carry no PHI.** In-app names the medication and the
tracking number because the reader is authenticated. Email and SMS say there is
an update and where to see it. A `CommunicationConsent` row lets a patient opt in
to full content after being warned — the documented consent HIPAA expects.

**The audit trail is hash-chained.** Each row's hash covers its content plus the
previous row's, so an edited or deleted entry breaks the chain. Hashing is
canonical because Postgres `jsonb` does not preserve key order — without that,
verification failed on every row.

## Tests

```bash
npm test                                  # 56 unit
npm run test:e2e -w @health-emr/api       # 12, full flow against a real database
```

The e2e suite is the one that matters: intake → routing → signature → dispatch →
shipping → patient visibility, plus the negative cases (wrong provider, wrong
tenant, bad tracking number, PHI in an SMS).
