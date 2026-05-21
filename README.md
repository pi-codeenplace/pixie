# pixie

Reusable GitHub Actions workflow that dispatches AI agents to exe.dev VMs for issue refinement, implementation, and PR review.

## How it works

```
GitHub event (issue / PR)
  → caller workflow in your repo
    → pixie reusable workflow
      → finds or creates an exe.dev VM for this issue/role
      → SSHes in, kicks pi agent in background
      → exits immediately (no GHA minutes wasted waiting)
        → agent posts comments / opens PRs / reviews via gh CLI
        → VM persists for the lifetime of the issue/PR
      → on issue/PR close: cleanup job destroys the VM
```

## Three agents

| Agent | Trigger | Output |
|---|---|---|
| **refiner** | Issue opened / edited | GH comment with clarifying questions + acceptance criteria |
| **implementer** | Issue labelled `ready for impl` | Branch + PR linking to issue |
| **reviewer** | PR opened / updated | Formal GH review (inline comments + summary) |

## Setup

### 1. Secrets

Add these to your repo secrets:

| Secret | Value |
|---|---|
| `EXE_DEV_TOKEN` | exe.dev HTTPS API bearer token |
| `GH_TOKEN` | GitHub token with repo + issues + pull-requests scope |
| `MOONSHOT_API_KEY` | Moonshot API key |

### 2. Caller workflow

Copy [`example/.github/workflows/caller.yml`](example/.github/workflows/caller.yml) into your repo's `.github/workflows/` and adjust `bot_login` and `base_branch` as needed.

### 3. Labels

Create a label named `ready for impl` (or similar) in your repo. Adding it to an issue triggers the implementer agent.

## Base image

Agent VMs are forked from a pre-configured exe.dev base image (`pixie-base`) that has:
- Node.js + pi CLI installed
- `MOONSHOT_API_KEY` configured
- gh CLI authenticated as `pi-codeenplace`
- git identity set to `pixie-bot <pi-codeenplace@users.noreply.github.com>`
- This repo's prompts at `/opt/pixie/prompts/`

## Requirements

- An [exe.dev](https://exe.dev) account
- The `pixie-base` VM image (see above)
