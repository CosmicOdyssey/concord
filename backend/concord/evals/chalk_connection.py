"""No-side-effect readiness and explicit optional Chalk Compute execution."""
from datetime import datetime, timezone
import importlib.util
import json
import os
from concord.evals.chalk_eval import CHALK_SCENARIOS, DATASET_SHA256, DATASET_VERSION, runtime_sources_current


def get_chalk_status():
    required = {'chalkcompute installation': importlib.util.find_spec('chalkcompute') is not None,
        'pyarrow installation': importlib.util.find_spec('pyarrow') is not None,
        'CHALK_CLIENT_ID': bool(os.environ.get('CHALK_CLIENT_ID')), 'CHALK_CLIENT_SECRET': bool(os.environ.get('CHALK_CLIENT_SECRET')),
        'CHALK_ENVIRONMENT_ID': bool(os.environ.get('CHALK_ENVIRONMENT_ID'))}
    missing = [key for key, value in required.items() if not value]
    return {'provider_status': 'IMPLEMENTED_UNVERIFIED', 'readiness': 'MISSING_CREDENTIALS' if missing else 'CONFIGURED_UNVERIFIED',
        'auth_status': 'NOT_VERIFIED', 'missing_prerequisites': missing, 'local_scenarios': len(CHALK_SCENARIOS),
        'remote_execution_enabled': os.environ.get('CONCORD_ALLOW_CHALK_RUN') == '1',
        'remote_requirements': ['Evaluations enabled', 'Authenticated Function queue', 'Dataset storage', 'Authorized compute budget'],
        'execution_disclosure': 'Local acceptance is independent. Explicit remote run deploys two bounded Functions and executes the 15 real cases on Chalk; no model inference.'}


def _json_ref(reference):
    if reference is None:
        return None
    fields = ('dataset_id', 'revision_id', 'id', 'name')
    return {key: str(getattr(reference, key)) for key in fields if getattr(reference, key, None) is not None}


def validate_remote_rows(rows):
    wanted = {case.id for case in CHALK_SCENARIOS}
    ids = [row.get('scenario_id') for row in rows]
    errors = [row.get('scenario_id') for row in rows if row.get('output_error') or any(value for key, value in row.items() if key.endswith('_error'))]
    values = []
    for row in rows:
        scores = [value for key, value in row.items() if key.endswith('_value')]
        values.append(bool(scores) and all(isinstance(value, (int, float)) and not isinstance(value, bool) and value == 1. for value in scores))
    complete = all('output_error' in row and any(key.endswith('_error') and key != 'output_error' for key in row) for row in rows) and len(rows) == len(wanted) and len(set(ids)) == len(wanted) and set(ids) == wanted and not errors
    return {'row_count': len(rows), 'row_errors': errors, 'passed_scenarios': sum(values), 'failed_scenarios': len(rows)-sum(values),
            'complete_and_passing': complete and all(values)}


def run_remote_chalk():
    if not runtime_sources_current():
        raise ValueError('Source changed since runtime start; restart before evaluation')
    if os.environ.get('CONCORD_ALLOW_CHALK_RUN') != '1' or get_chalk_status()['missing_prerequisites']:
        raise ValueError('Chalk prerequisites are missing')
    # Chalk decorators deploy in the background on import. This MUST remain below
    # the operator/auth/budget gate in the API, never ordinary app initialization.
    from concord.evals.chalk_remote import concord_acceptance_task, concord_acceptance_scorer
    import chalkcompute as cc
    rows = [{'scenario_id': case.id, 'expected': json.dumps(case.expected_outcome, sort_keys=True)} for case in CHALK_SCENARIOS]
    client = cc.DatasetClient()
    dataset = client.upload(f'concord-{DATASET_VERSION}-{DATASET_SHA256[:12]}', rows, timeout=120)
    evaluation = cc.Evaluation.create(f'concord-{DATASET_SHA256[:12]}', dataset=dataset,
        task=concord_acceptance_task, scorers=[concord_acceptance_scorer], metadata={'dataset_sha256': DATASET_SHA256})
    # A successful queue status can still contain row errors. Always read results.
    run = evaluation.run(metadata={'dataset_sha256': DATASET_SHA256, 'data_mode': 'SYNTHETIC_ACCEPTANCE_INPUTS'}).wait(timeout=180, poll_interval=2, raise_on_failure=True)
    table = client.read(run.result_dataset)
    actual = table.to_pylist()
    checks = validate_remote_rows(actual)
    return {'provider_status': 'EXECUTED', 'execution_mode': 'REMOTE_CHALK_COMPUTE', 'readiness': 'CONNECTED_AND_VERIFIED',
        'auth_status': 'REMOTE_RESULT_DATASET_READ', 'dataset_version': DATASET_VERSION, 'dataset_sha256': DATASET_SHA256,
        'evaluation_id': str(evaluation.id), 'run_id': str(run.id), 'run_status': str(run.status),
        'input_dataset': _json_ref(dataset), 'result_dataset': _json_ref(run.result_dataset),
        'recorded_at': datetime.now(timezone.utc).isoformat(), 'provider_usage': None,
        'data_mode': 'SYNTHETIC_ACCEPTANCE_INPUTS_REAL_REMOTE_EXECUTION', **checks, 'rows': actual}
