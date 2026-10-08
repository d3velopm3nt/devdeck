# Bots, schedules and events

## Bots and routines

Bots hold goals, context, permissions and plans. Routines and scheduling provide recurring behaviour where configured. Check a bot's scope and grants before allowing it to act.

## Event stream

The event stream helps inspect activity. The event bus carries notifications between components; persistent records provide recovery context.

## Folder workflow behaviour

Current folder workflows use worker completion events to reconcile state. They do not automatically launch dependent steps. Review and accept the prerequisite, then start the next step manually.

## Tool proposals

A bot can propose skills, agents, software or self-hosted tools. Accepting a software or service proposal records a decision; the current tools page does not itself install software or start the service.
