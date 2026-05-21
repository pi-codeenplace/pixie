#!/usr/bin/env node
import { execSync } from 'child_process'

const {
  EXE_DEV_TOKEN, EXE_SSH_KEY_PATH, GH_TOKEN, MOONSHOT_API_KEY,
  LLM_PROVIDER, LLM_MODEL, BASE_BRANCH,
  EVENT_NAME, EVENT_ACTION, REPO,
  ISSUE_NUMBER, PR_NUMBER, LABEL_NAME,
} = process.env

const token = EXE_DEV_TOKEN.replace(/\s/g, '')

const exe = async (cmd) => {
  const r = await fetch('https://exe.dev/exec', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: cmd,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`exe.dev error ${r.status} for '${cmd}': ${text}`)
  return text
}

const exeJson = async (cmd) => {
  const text = await exe(cmd)
  try { return JSON.parse(text) }
  catch { throw new Error(`exe.dev non-JSON for '${cmd}': ${text}`) }
}

const repoSlug = REPO.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const num = ISSUE_NUMBER || PR_NUMBER
const kind = EVENT_NAME === 'pull_request' ? 'pr' : 'issue'

const role = (() => {
  if (EVENT_NAME === 'issues') {
    if (EVENT_ACTION === 'closed') return null
    if (EVENT_ACTION === 'labeled' && LABEL_NAME?.toLowerCase().includes('ready for impl')) return 'implementer'
    if (['opened', 'edited', 'reopened'].includes(EVENT_ACTION)) return 'refiner'
  }
  if (EVENT_NAME === 'pull_request') {
    if (EVENT_ACTION === 'closed') return null
    if (['opened', 'synchronize', 'reopened'].includes(EVENT_ACTION)) return 'reviewer'
  }
  return null
})()

if (!role) {
  console.log(`No role for ${EVENT_NAME}:${EVENT_ACTION} — skipping`)
  process.exit(0)
}

const vmName = `pixie-${repoSlug}-${kind}-${num}-${role}`.slice(0, 63)
console.log(`Role: ${role}, VM: ${vmName}`)

const { vms } = await exeJson('ls --json')
const existing = vms.find(v => v.vm_name === vmName)

let vm
if (existing) {
  console.log(`Found existing VM: ${vmName} (${existing.status})`)
  vm = existing
} else {
  console.log(`Creating VM: ${vmName} (forking pixie-base)`)
  const result = await exe(`cp pixie-base ${vmName} --copy-tags=false --json`)
  vm = JSON.parse(result)

  // wait for running
  let attempts = 0
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 5000))
    const { vms: updated } = await exeJson('ls --json')
    const current = updated.find(v => v.vm_name === vmName)
    if (current?.status === 'running') { vm = current; break }
    attempts++
  }
  if (vm.status !== 'running') throw new Error(`VM ${vmName} did not start in time`)

  // apply tags
  const tags = ['pixie', repoSlug, `${kind}-${num}`, `role-${role}`].join(' ')
  await exe(`tag ${vmName} ${tags}`)
  console.log(`Tagged: ${tags}`)
}

// env vars to inject on the VM (written to a file, not baked into image)
const envVars = {
  GH_TOKEN,
  MOONSHOT_API_KEY,
  PIXIE_REPO: REPO,
  PIXIE_ISSUE_NUMBER: ISSUE_NUMBER || '',
  PIXIE_PR_NUMBER: PR_NUMBER || '',
  PIXIE_ROLE: role,
  PIXIE_BASE_BRANCH: BASE_BRANCH,
  PIXIE_LLM_PROVIDER: LLM_PROVIDER,
  PIXIE_LLM_MODEL: LLM_MODEL,
}

const envExports = Object.entries(envVars)
  .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
  .join('\n')

// kick agent: write env, then run pi backgrounded + detached
const agentScript = [
  'set -e',
  envExports,
  'source ~/.nvm/nvm.sh',
  `PROMPT="$(cat /opt/pixie/prompts/${role}.md)"`,
  `nohup pi --provider "$PIXIE_LLM_PROVIDER" --model "$PIXIE_LLM_MODEL" --no-session --print "$PROMPT" </dev/null >>~/pixie-agent.log 2>&1 &`,
  'disown',
].join('\n')

const sshKey = EXE_SSH_KEY_PATH ? `-i ${EXE_SSH_KEY_PATH} ` : ''
console.log(`Kicking agent on ${vm.ssh_dest}`)
execSync(
  `ssh ${sshKey}-o StrictHostKeyChecking=no -o BatchMode=yes ${vm.ssh_dest} 'bash -s'`,
  { input: agentScript, stdio: ['pipe', 'inherit', 'inherit'] }
)
console.log('Agent kicked — exiting')
