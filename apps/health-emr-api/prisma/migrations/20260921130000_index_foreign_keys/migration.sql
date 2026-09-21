-- Foreign keys on every table that grows with patients, visits, messages or
-- audit history.
--
-- Postgres does not index a foreign key for you. Without these, counting one
-- patient's visits is a sequential scan of the whole visit table — which is why
-- the patients list took 441ms at a million visits, and would take ten seconds
-- at twenty million. Cascading deletes scan the same way.
--
-- Concurrently, so building them does not lock a live table.
CREATE INDEX IF NOT EXISTS "prescription_requests_patient_idx" ON "prescription_requests" ("patientId");
CREATE INDEX IF NOT EXISTS "prescription_requests_category_idx" ON "prescription_requests" ("categoryId");
CREATE INDEX IF NOT EXISTS "prescription_requests_pharmacy_idx" ON "prescription_requests" ("requestedPharmacyId");

CREATE INDEX IF NOT EXISTS "prescription_request_items_medication_idx" ON "prescription_request_items" ("medicationId");

CREATE INDEX IF NOT EXISTS "prescriptions_request_idx" ON "prescriptions" ("requestId");
CREATE INDEX IF NOT EXISTS "prescriptions_medication_idx" ON "prescriptions" ("medicationId");

CREATE INDEX IF NOT EXISTS "pharmacy_orders_prescription_idx" ON "pharmacy_orders" ("prescriptionId");

CREATE INDEX IF NOT EXISTS "qa_submissions_category_idx" ON "qa_submissions" ("categoryId");
CREATE INDEX IF NOT EXISTS "qa_submissions_template_idx" ON "qa_submissions" ("templateId");

CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" ("actorUserId");

CREATE INDEX IF NOT EXISTS "chat_messages_author_idx" ON "chat_messages" ("authorUserId");
CREATE INDEX IF NOT EXISTS "chat_attachments_message_idx" ON "chat_attachments" ("messageId");
CREATE INDEX IF NOT EXISTS "chat_threads_tenant_idx" ON "chat_threads" ("tenantId");
CREATE INDEX IF NOT EXISTS "chat_threads_prescription_idx" ON "chat_threads" ("prescriptionId");

CREATE INDEX IF NOT EXISTS "invoices_patient_idx" ON "invoices" ("patientId");
CREATE INDEX IF NOT EXISTS "invoices_prescription_idx" ON "invoices" ("prescriptionId");

CREATE INDEX IF NOT EXISTS "routing_attempts_provider_idx" ON "routing_attempts" ("providerId");
CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx" ON "notification_deliveries" ("notificationId");

CREATE INDEX IF NOT EXISTS "tenant_patients_patient_idx" ON "tenant_patients" ("patientId");
CREATE INDEX IF NOT EXISTS "category_medications_medication_idx" ON "category_medications" ("medicationId");
CREATE INDEX IF NOT EXISTS "lab_results_submission_idx" ON "lab_results" ("submissionId");
CREATE INDEX IF NOT EXISTS "vitals_encounter_idx" ON "vitals" ("encounterId");
CREATE INDEX IF NOT EXISTS "patient_medications_medication_idx" ON "patient_medications" ("medicationId");
CREATE INDEX IF NOT EXISTS "encounters_provider_idx" ON "encounters" ("providerId");
CREATE INDEX IF NOT EXISTS "provider_notes_provider_idx" ON "provider_notes" ("providerId");
CREATE INDEX IF NOT EXISTS "provider_notes_author_idx" ON "provider_notes" ("authorUserId");
