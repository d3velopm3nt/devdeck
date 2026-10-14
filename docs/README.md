# Documentation index

The current guides describe the unmerged source in [PR #25](https://github.com/d3velopm3nt/devdeck/pull/25),
checked at `f016757`. Features in this checkout are not automatically available
in the latest release installer. This documentation refresh is a separate change
stacked on PR #25; it neither merges nor releases the application.

## Current guides

| Guide | Audience / scope |
|---|---|
| [User guide](USER-GUIDE.md) | Complete library → agent → team → workflow → issue dispatch → review example |
| [Windows setup](../CONTRIBUTING.md) | Native prerequisites, source build and meaningful checks |
| [CLI subscriptions](CLI-SUBSCRIPTION-SETUP.md) | Installation, authentication, inference and worker differences |
| [Mobile companion](../mobile/README.md) | Pairing, HTTP/HTTPS limitations, voice, offline boundaries and physical-device tests |
| [Workflow reference](folder-workflow-routing.md) | Files, intake, dispatch, recovery and verification boundaries |
| [Architecture](ARCHITECTURE.md) | Shared definition ownership, host callbacks and permission gates |
| [Activity and timeline](ACTIVITY-TIMELINE.md) | Local/GitHub views, linked work and recorded progress |
| [Sessions](session-visibility.md) | Product connections, external checkpoints and freshness |
| [Work/Life and handoffs](WORK-LIFE-HANDOFF.md) | Onboarding and continuing a workflow with another assistant |
| [Background monitoring direction](BACKGROUND-MONITOR.md) | Implemented issue-monitor subset versus broader planned service |
| [Current scope / roadmap](../ROADMAP.md) | In-review capabilities, backlog links and historical design archive |

## How to read evidence

CI186 passed the Windows app build/native tests and browser fixtures for
`f016757`. Browser tests use mocked native boundaries; they do not sign into
vendor accounts, execute live worker tasks or establish Android microphone
behavior. Follow the physical-device checklist in the mobile guide and exercise
real worker review/recovery on Windows before accepting end-to-end behavior.

Historical reports and screenshots are retained as evidence at their named
revision. They are not current navigation instructions or proof of later fixes.
This refresh introduces no new screenshots because the live Windows/phone flow
has not been visually verified here. Source and existing fixture coverage are
the basis for the written walkthrough.

## Historical designs and verification

- [AI Workspace implementation](../DEVDECK_AI_WORKSPACE_IMPLEMENTATION.md)
- [September review](REVIEW-2026-09.md), [loop experiments](LOOP-QUEUE.md),
  [chat hub design](CHAT-HUB-DESIGN.md)
- [Beta five business flow](BETA5-BUSINESS-FLOW.md),
  [manager-team verification](MANAGER-TEAMS-VERIFICATION.md)
- [State onboarding recovery](STATE-ONBOARDING-VERIFICATION.md),
  [Deck design checks](DECK-DESIGN-VERIFICATION.md)
- [General test report](TEST-REPORT.md), [mail report](TEST-REPORT-MAIL.md),
  [machine setup report](machine-setup/TEST_REPORT.md)

Design mockups under `design/` and reports under `test-results/` document their
own experiments. Do not treat their old “Team”, “Workers” or “AI Workspace”
screen names as current user navigation. Current agent configuration is under
**Agents**, and folder workflows are under **Work → Team workflows**.

For docs changes, check relative files/anchors, source control labels, runnable
commands, release status, and the distinction between fixture and device
verification. Keep one primary user walkthrough; link to it instead of copying
another slightly different setup sequence.
