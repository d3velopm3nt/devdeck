# Troubleshooting

## A tool is missing

Check your app version and selected space. Some tools need a configured account, provider or local executable. This first edition includes development-branch features.

## A worker failed

Open its receipt and inspect any partial output before retrying. Check permissions, the runner, target path and budget.

## A workflow is waiting

A successful worker still requires review. Accept all prerequisites, supply evidence and manually start the next step. See the [workflow guide](#workflows).

## Accepted files are missing in the next step

Acceptance does not transfer or merge worktrees. Make the reviewed output available at a real path or commit and update the handoff evidence.

## Documentation differs from the app

Report the guide title, app version and expected versus observed behaviour in a [GitHub issue](https://github.com/d3velopm3nt/devdeck/issues).
