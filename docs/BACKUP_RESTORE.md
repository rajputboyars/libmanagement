# Backup, restore and recovery

## Objectives (proposed — confirm with the business)

| Objective | Target | How it is met |
|---|---|---|
| RPO (data you can lose) | 15 minutes or less | Managed point-in-time recovery / continuous backup on the MongoDB service |
| RTO (time to recover) | 4 hours or less | Practised runbook below; configuration kept as code; documented connection-string switch |
| Retention | 35 days point-in-time, 12 monthly snapshots | Configure in the provider; review annually |

These targets are **proposals**. They only become real once provider backups are enabled and a restore has been performed from them.

## What must be backed up

All MongoDB collections: memberships, payments and receipts (financial history), XP and Study Coin ledgers, SaaS subscriptions, invoices and webhook events, audit logs and student data. Secrets are not in the database and must be recoverable from the secret manager.

## Layers

1. **Provider-native backups (primary).** MongoDB Atlas Cloud Backup with continuous (point-in-time) enabled, or the equivalent on your host. Enable encryption at rest and restrict who can restore.
2. **Logical backups (portable fallback and drills).** `npm run backup -- --out backups/<date>` writes one gzip NDJSON file per collection plus a manifest with counts and SHA-256 checksums. It is read-only against the source. Store the output off-site and encrypted.
3. **Application safety nets.** Idempotent payment and webhook processing; unique indexes; financial records are kept (anonymised) when a student deletes their account.

## Restore runbook (any environment)

1. Declare the incident, freeze writes if possible (maintenance page, stop workers) and note the target recovery time.
2. Create a **new, empty** database or cluster. Never restore over the live database.
3. Restore either from a provider snapshot / point-in-time into the new cluster, **or**
   `npm run restore -- --from backups/<date> --target-uri "<new empty uri>"` (dry run verifies checksums), then add `--confirm`.
   The tool refuses non-empty targets and the live `MONGODB_URI`.
4. Verify:
   - Document counts match the manifest (the tool checks this).
   - Run the reconciliation view (`GET /api/pilot-import`) for a library: every student has a membership, payments sum to `membership.paid`, no seat overlaps.
   - Sample membership, payment and XP history for three students.
   - Start a staging build pointed at the restored database; sign in as owner and student.
5. Switch production `MONGODB_URI` to the restored database, restart web and worker processes and watch `/api/ready`.
6. Re-run webhook retries from Admin → Billing (events are idempotent). Indexes are rebuilt on connect.
7. Post-incident: record the actual RPO and RTO achieved and update this document.

## Restore drill (quarterly)

Run steps 2–4 in a scratch environment and record the date, backup used, restore duration, verification result and who ran it.

## Evidence so far

- Automated drill `tests/backup.integration.test.ts` (part of `npm run test:integration`): backs up a database with memberships, payments, 1,200 XP rows and a unique index; restores it into a **separate** database; verifies counts, exact ObjectId and Date round-trip, payment-sum reconciliation, rebuilt unique index, refusal of non-empty targets and detection of a tampered backup. **PASS** on a disposable in-memory replica set.
- **Not yet done:** a restore from the real provider snapshot or point-in-time into a staging cluster. This needs production-grade infrastructure and is listed as a blocker in RELEASE_READINESS.md.
