#!/usr/bin/env node
import { execSync } from 'child_process'

const {
  EXE_DEV_TOKEN, GH_TOKEN, MOONSHOT_API_KEY,
  LLM_PROVIDER, LLM_MODEL, BASE_BRANCH,
  EVENT_NAME, EVENT_ACTION, REPO,
  ISSUE_NUMBER, PR_NUMBER, LABEL_NAME,
} = process.env

const exe = (cmd) =>
  fetch('https://exe.dev/exec', {
    method: 'POST',
    headers: { Authorization: `Bearer ${EXE_DEV_TOKEN}` },
    body: cmd,
  }).then(r => r.text())

const exeJson = async (cmd) => JSON.parse(await exe(cmd))

const repoSlug = REPO.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const num = ISSUE_NUMBER || PR_NUMBER

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

const vmName = `pixie-${repoSlug}-${EVENT_NAME === 'pull_request' ? 'pr' : 'issue'}-${num}-${role}`
  .slice(0, 63)

console.log(`Role: ${role}, VM: ${vmName}`)

const { vms } = await exeJson('ls --json')
const existing = vms.find(v => v.vm_name === vmName)

let vm
if (existing) {
  console.log(`Found existing VM: ${vmName} (${existing.status})`)
  vm = existing
} else {
  console.log(`Creating VM: ${vmName}`)
  const tags = ['pixie', repoSlug, `${EVENT_NAME === 'pull_request' ? 'pr' : 'issue'}-${num}`, `role-${role}`].join(',')
  const envFlags = [
    `--env GH_TOKEN=${GH_TOKEN}`,
    `--env MOONSHOT_API_KEY=${MOONSHOT_API_KEY}`,
    `--env PIXIE_REPO=${REPO}`,
    `--env PIXIE_ISSUE_NUMBER=${ISSUE_NUMBER || ''}`,
    `--env PIXIE_PR_NUMBER=${PR_NUMBER || ''}`,
    `--env PIXIE_ROLE=${role}`,
    `--env PIXIE_BASE_BRANCH=${BASE_BRANCH}`,
    `--env PIXIE_LLM_PROVIDER=${LLM_PROVIDER}`,
    `--env PIXIE_LLM_MODEL=${LLM_MODEL}`,
  ].join(' ')

  const result = await exe(`cp pixie-base --name=${vmName} --tag=${tags} ${envFlags} --no-email --json`)
  vm = JSON.parse(result)
  console.log(`Created VM: ${JSON.stringify(vm)}`)

  let attempts = 0
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 5000))
    const { vms: updated } = await exeJson('ls --json')
    const current = updated.find(v => v.vm_name === vmName)
    if (current?.status === 'running') { vm = current; break }
    attempts++
  }
  if (vm.status !== 'running') throw new Error(`VM ${vmName} did not start in time`)
}

// kick agent — source nvm then run pi backgrounded, fully detached
const promptFile = `/opt/pixie/prompts/${role}.md`
const agentCmd = [
  'source ~/.nvm/nvm.sh',
  `nohup pi --provider $PIXIE_LLM_PROVIDER --model $PIXIE_LLM_MODEL --no-session --prompt "$(cat ${promptFile})"`,
  '</dev/null >>/var/log/pixie-agent.log 2>&1 &',
  'disown',
].join(' && ')

console.log(`Kicking agent on ${vm.ssh_dest}`)
execSync(`ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${vm.ssh_dest} 'bash -c ${JSON.stringify(agentCmd)}'`, { stdio: 'inherit' })
console.log('Agent kicked — exiting')
