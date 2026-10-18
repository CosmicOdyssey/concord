/** Server-only Factory 0.9.1 session. No local imitation of an SDK execution. */
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const names = ['inspect_protocol', 'identify_operational_bottlenecks', 'simulate_operational_variant'];
const serverName = 'concord_protocol_tools';

export function allowedToolId(id) {
  return names.some(name => id === `mcp__${serverName}__${name}` || id === `${serverName}.${name}`);
}

export async function runFactoryDroid(trialId = 'NCT05800015', maxIterations = 3, injected = {}) {
  const environment = injected.env ?? process.env;
  if (environment.CONCORD_ALLOW_FACTORY_RUN !== '1' || !environment.FACTORY_API_KEY || !environment.FACTORY_MODEL_ID || /claude|astra|^auto$/i.test(environment.FACTORY_MODEL_ID)) throw new Error('Factory live execution/model authorization is missing');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(trialId) || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 3) throw new Error('Unsupported bounded request');
  const sdk = injected.sdk ?? await import(require.resolve('@factory/droid-sdk/node'));
  const { z } = injected.zod ?? require('zod');
  const trace = [];
  let count = 0;
  const bridge = injected.bridge ?? (arguments_ => pythonBridge(arguments_, environment));
  const call = async (toolName, args) => {
    if (++count > maxIterations * 3 + 2) throw new Error('Tool-call budget exceeded');
    const output = await bridge({ tool: toolName, trial_id: trialId, ...args });
    if (output.error) throw new Error('Concord rejected tool execution');
    trace.push({ tool_name: toolName, arguments: { trial_id: trialId, ...args }, timestamp: new Date().toISOString(), result: output.result });
    return JSON.stringify(output.result);
  };
  const server = sdk.createSdkMcpServer({ name: serverName, tools: [
    sdk.tool(names[0], 'Read registry context; clinical and enrollment evidence may be UNKNOWN.', {}, () => call(names[0], {})),
    sdk.tool(names[1], 'Read entered synthetic operational assumptions only.', {}, () => call(names[1], {})),
    sdk.tool(names[2], 'Evaluate a paired variant with the original Concord engine; may show no benefit.', {
      activation_lag: z.number().finite().min(0).max(12), outreach_budget: z.number().finite().min(0).max(50000),
    }, args => call(names[2], args)),
  ] });
  const privateDir = await mkdtemp(path.join(tmpdir(), 'concord-factory-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Factory bounded timeout')), 120000);
  let session;
  let allowed = new Set();
  try {
    session = await sdk.createSession({ execPath: environment.FACTORY_DROID_EXEC_PATH, apiKey: environment.FACTORY_API_KEY, modelId: environment.FACTORY_MODEL_ID,
      cwd: privateDir, env: { HOME: privateDir, XDG_CONFIG_HOME: privateDir }, disableBuiltinSkills: true,
      autonomyLevel: sdk.AutonomyLevel.Off, abortSignal: controller.signal, mcpServers: [server],
      systemPrompt: 'Propose bounded operational changes using only concord_protocol_tools. Never modify clinical eligibility, invent evidence, use shell/files/network tools or claim guaranteed benefits. All figures are synthetic assumptions. Return proposals for independent computation; no protocol mutation is authorized.',
      permissionHandler({ toolUses, options }) {
        const safe = toolUses.length > 0 && toolUses.every(use => allowed.has(use.name));
        const desired = safe ? sdk.ToolConfirmationOutcome.ProceedOnce : sdk.ToolConfirmationOutcome.Cancel;
        if (!options.some(option => option.value === desired)) throw new Error('Required permission outcome absent');
        return desired;
      },
    });
    const tools = await session.listTools();
    allowed = new Set(tools.filter(tool => allowedToolId(tool.id)).map(tool => tool.id));
    if (allowed.size !== names.length) throw new Error('Cannot establish restrictive Concord tool identity');
    await session.updateSettings({ disabledToolIds: tools.filter(tool => !allowed.has(tool.id)).map(tool => tool.id) });
    const verified = await session.listTools();
    if (verified.some(tool => tool.allowed && !allowed.has(tool.id))) throw new Error('Unexpected tool remains enabled');
    const schema = { type: 'object', additionalProperties: false, required: ['proposals'], properties: {
      proposals: { type: 'array', minItems: 1, maxItems: maxIterations, items: { type: 'object', additionalProperties: false,
        required: ['proposal_id', 'trial_id', 'category', 'description', 'activation_lag_months', 'monthly_outreach_budget', 'modifies_clinical_inclusion_exclusion'],
        properties: { proposal_id: { type: 'string', minLength: 3, maxLength: 64 }, trial_id: { type: 'string', enum: [trialId] },
          category: { type: 'string', enum: ['OPERATIONAL', 'SITE_ACTIVATION'] }, description: { type: 'string', minLength: 10, maxLength: 500 },
          activation_lag_months: { type: 'number', minimum: 0, maximum: 12 }, monthly_outreach_budget: { type: 'number', minimum: 0, maximum: 50000 },
          modifies_clinical_inclusion_exclusion: { type: 'boolean', enum: [false] } } } },
    } };
    let terminal;
    for await (const message of session.stream(`Inspect ${trialId}; call the original-engine simulation tool before proposing at most ${maxIterations} operational variants. It is valid to find no benefit.`, {
      abortSignal: controller.signal, outputFormat: { type: sdk.OutputFormatType.JsonSchema, schema },
    })) if (message.type === 'result') terminal = message;
    if (!terminal?.success || terminal.subtype !== 'success' || !terminal.sessionId || !Array.isArray(terminal.structuredOutput?.proposals) || !trace.some(row => row.tool_name === 'simulate_operational_variant')) throw new Error('No successful tool-backed Factory proposal result');
    return { status: 'SUCCEEDED', session_id: terminal.sessionId, proposals: terminal.structuredOutput.proposals,
      duration_ms: terminal.durationMs, turn_count: terminal.turnCount, token_usage: terminal.tokenUsage ?? null, tool_trace: trace };
  } finally {
    clearTimeout(timer);
    try { if (session) await session.close(); } finally { try { await server.close(); } finally { await rm(privateDir, { recursive: true, force: true }); } }
  }
}

// Stdin bridge is deliberately fixed to a private Python module, never a model command.
export async function pythonBridge(arguments_, environment = process.env) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(environment.CONCORD_BACKEND_PYTHON, ['-m', 'concord.agents.factory_tools'], {
      cwd: root, env: { PATH: environment.PATH, PYTHONPATH: path.join(root, 'backend') }, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let text = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Concord tool timeout')); }, 15000);
    child.on('error', reject);
    child.stdout.on('data', chunk => { text += chunk; if (text.length > 100000) child.kill('SIGKILL'); });
    child.on('close', code => { clearTimeout(timer); if (code || text.length > 100000) reject(new Error('Concord tool failed')); else { try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid tool result')); } } });
    child.stdin.end(JSON.stringify(arguments_));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = flag => args[args.indexOf(flag) + 1];
  runFactoryDroid(get('--trial-id'), Number(get('--max-iterations')), { bridge: args => pythonBridge(args) })
    .then(result => process.stdout.write(JSON.stringify(result)))
    .catch(() => { process.stderr.write('Factory execution rejected or failed; no result claimed.\n'); process.exitCode = 1; });
}
