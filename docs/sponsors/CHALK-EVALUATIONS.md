# Chalk evaluations

Concord has two separate execution paths. Both use the versioned **15-case** dataset and actual Concord engine/boundary functions. Neither is an evaluation of clinical efficacy.

## Local acceptance

`POST /api/evals/chalk/run` explicitly runs the deterministic local suite. `GET /api/evals/chalk/latest` returns 404 before a run exists. The result is `LOCAL_DETERMINISTIC`; no Chalk cloud request occurs. The [dataset](../operations/grand-mobilization/acceptance-dataset-v2.json) and [earlier local HTTP receipt](../operations/grand-mobilization/local-evaluation-receipt.json) retain their original provenance.

## Optional Chalk Compute execution

Install `backend/requirements-sponsors.txt` (chalkcompute 2.13.7, pyarrow 23.0.1). Configure `CHALK_CLIENT_ID`, `CHALK_CLIENT_SECRET`, `CHALK_ENVIRONMENT_ID`, `CONCORD_SPONSOR_OPERATOR_TOKEN` and `CONCORD_ALLOW_CHALK_RUN=1`. The environment must support Compute Evaluations, dataset storage and an active authenticated Function queue. Confirm included compute eligibility before enabling it.

`GET /api/evals/chalk/status` only reports configuration and prerequisites. It does not import cloud function decorators, deploy functions or execute evaluations.

`POST /api/evals/chalk/remote-run`, with `X-Concord-Operator-Token` and `{"confirm_live":true}`, lazily loads two bounded authenticated Functions, uploads the pinned input dataset, creates an Evaluation with a real task and scorer, waits for the run and reads its result dataset. The task executes existing Concord acceptance functions; the deterministic scorer checks typed expected fields. There is no LLM scorer. The public image contains explicitly selected source/fixture files, never `.env`, private receipts or the developer home directory.

Function limits: 60 seconds per call, zero retries, zero minimum replicas, one maximum replica. Upload timeout: 120 seconds; evaluation wait: 180 seconds. Provider setup/build time is additional. Stop or clean up remote resources through the provider after the exercise; a local HTTP timeout alone does not establish remote cancellation.

A receipt includes evaluation/run IDs, input/result dataset revisions, source/dataset hashes, actual rows and row errors. `complete_and_passing` requires all 15 unique scenario IDs, no task/scorer errors and every returned score equal to 1. An executed failing suite remains failing. Upload or queue acceptance alone never establishes completion, and no usage price is invented.

**Observed status:** OAuth token exchange succeeded on 2026-10-18. No cloud Function deployment, evaluation job or remote result dataset was observed in this repair. Token authentication is not compute verification. See [verification](LIVE-INTEGRATION-VERIFICATION.md).

These bounded software checks do not restore missing historical as-of datasets, calibrate synthetic operational inputs or validate acceleration claims.

Official contracts: [Compute Evaluations quick start](https://docs.chalk.ai/docs/evaluations/quick-start), [evaluation results](https://docs.chalk.ai/docs/evaluations/results), [Functions](https://docs.chalk.ai/docs/functions/defining-a-function).
