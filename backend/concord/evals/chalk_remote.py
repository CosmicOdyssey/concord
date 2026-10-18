"""Optional Chalk Compute definitions. IMPORTING THIS MODULE DEPLOYS FUNCTIONS.

Only the authenticated, explicitly enabled remote endpoint may import it.
No uploads, evaluation creation or runs occur at module import. No LLM scorer is
used: the remote task runs actual Concord checks, with a deterministic scorer.
Official contract: https://docs.chalk.ai/docs/evaluations/quick-start
"""
import json
from pathlib import Path
import chalkcompute as cc

ROOT = Path(__file__).resolve().parents[3]
# Explicit public code/fixtures only. Never upload repository root, .env, private
# SQLite databases, node_modules, previous receipts or a developer's home folder.
IMAGE = (cc.Image.debian_slim(python_version='3.14')
    .pip_install_from_requirements(str(ROOT / 'backend/requirements.txt'))
    .add_local_dir(str(ROOT / 'backend/concord'), '/app/backend/concord', exclude=['__pycache__', '*.pyc'])
    .add_local_file(str(ROOT / 'backend/requirements.txt'), '/app/backend/requirements.txt', strategy='copy')
    .add_local_file(str(ROOT / 'data/portfolio/context.json'), '/app/data/portfolio/context.json', strategy='copy')
    .add_local_file(str(ROOT / 'data/demo/hackharvard-request.json'), '/app/data/demo/hackharvard-request.json', strategy='copy')
    .add_local_file(str(ROOT / 'scripts/factory-droid-runner.mjs'), '/app/scripts/factory-droid-runner.mjs', strategy='copy')
    .env({'PYTHONPATH': '/app/backend', 'CONCORD_DATA_DIR': '/tmp/concord-acceptance-data'})
    .workdir('/app'))


@cc.function(image=IMAGE, call_timeout=60., min_replicas=0, max_replicas=1, retries=0, authenticated=True)
def concord_acceptance_task(scenario_id: str) -> str:
    import json
    from concord.evals.chalk_eval import CHALK_SCENARIOS, execute_concord_agent_task
    scenario = next(case for case in CHALK_SCENARIOS if case.id == scenario_id)
    return json.dumps(execute_concord_agent_task(scenario), sort_keys=True, allow_nan=False)


@cc.function(image=IMAGE, call_timeout=60., min_replicas=0, max_replicas=1, retries=0, authenticated=True)
def concord_acceptance_scorer(output: str, expected: str) -> float:
    import json
    try:
        actual, wanted = json.loads(output), json.loads(expected)
        return float(bool(wanted) and all(key in actual and type(actual[key]) is type(value) and actual[key] == value for key, value in wanted.items()))
    except (ValueError, TypeError, AttributeError):
        return 0.
