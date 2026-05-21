#!/usr/bin/env node
const { EXE_DEV_TOKEN, EVENT_NAME, REPO, ISSUE_NUMBER, PR_NUMBER } = process.env

const exe = async (cmd) => {
  const r = await fetch('https://exe.dev/exec', {
    method: 'POST',
    headers: { Authorization: `Bearer ${EXE_DEV_TOKEN}` },
    body: cmd,
  })
  return r.text()
}

const repoSlug = REPO.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const num = ISSUE_NUMBER || PR_NUMBER
const kind = EVENT_NAME === 'pull_request' ? 'pr' : 'issue'
const prefix = `pixie-${repoSlug}-${kind}-${num}-`

console.log(`Cleaning up VMs with prefix: ${prefix}`)

const { vms } = JSON.parse(await exe('ls --json'))
const targets = vms.filter(v => v.vm_name.startsWith(prefix))

if (!targets.length) {
  console.log('No VMs to clean up')
  process.exit(0)
}

for (const vm of targets) {
  console.log(`Removing ${vm.vm_name}`)
  await exe(`rm ${vm.vm_name}`)
}

console.log(`Removed ${targets.length} VM(s)`)
