"""Private SDK-to-engine bridge; never accepts shell commands or clinical edits."""
import json
import sys
from concord.agents.boundary import StrictModel
from concord.agents.droid import tool_inspect_protocol, tool_identify_operational_bottlenecks, tool_simulate_operational_variant
from pydantic import Field


class ToolInput(StrictModel):
    tool: str
    trial_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    activation_lag: float = Field(12., ge=0., le=12.)
    outreach_budget: float = Field(0., ge=0., le=50000.)


def dispatch(raw):
    req = ToolInput.model_validate(raw)
    trace = []
    if req.tool == 'inspect_protocol':
        result = tool_inspect_protocol(req.trial_id, trace)
    elif req.tool == 'identify_operational_bottlenecks':
        result = tool_identify_operational_bottlenecks(req.trial_id, trace)
    elif req.tool == 'simulate_operational_variant':
        result = tool_simulate_operational_variant(req.trial_id, req.activation_lag, req.outreach_budget, trace)
    else:
        raise ValueError('Unsupported tool')
    return {'result': result, 'trace': [t.model_dump() for t in trace]}


if __name__ == '__main__':
    try:
        raw = sys.stdin.read(16385)
        if len(raw) > 16384:
            raise ValueError('Tool input too large')
        print(json.dumps(dispatch(json.loads(raw))))
    except Exception:
        print(json.dumps({'error': 'TOOL_INPUT_OR_EXECUTION_REJECTED'}))
        sys.exit(1)
