---
name: factory-verification
description: Independently verify a factory change against acceptance criteria and record evidence for its exact commit.
---

Verify the handed-off branch and HEAD before testing. Derive checks from acceptance criteria rather than the builder's account. Include relevant failure paths and regressions.

For UI changes, exercise the live behavior and retain screenshots or a recording where useful. For backend or CLI changes, retain reproducible inputs and outputs. Store generated evidence in the project's ignored artifact location; keep sensitive data out of shared evidence.

Report each criterion as passed, failed or unverified, with commands, actual outcomes, environment and evidence locations. Name the exact commit tested. A changed HEAD invalidates affected results. Send defects to the builder through the coordinator; do not repair the implementation during independent verification.
