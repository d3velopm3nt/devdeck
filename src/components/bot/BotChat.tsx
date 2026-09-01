// A bot's own thread — the first thing you see on its page.
//
// The same record a conversation with the assistant is, marked as the bot's,
// and the same loop underneath: what differs is the voice and the permissions.
// So this is the shared `Thread` with the bot's name on it, not a second chat
// — the wake receipt, the pulled-in rule and the agents' reports all render
// the same here as they do in a feature's room, because they are the same
// messages.
//
// Why it is first: a page that opened on tabs of settings was a form with a
// bot attached. Opening on what the bot said is the other way round.

import * as ipc from '../../lib/ipc'
import { Thread } from '../thread/Thread'

export function BotChat({ bot }: { bot: ipc.Bot }) {
  const acts = bot.agent.trim().length > 0
  return (
    <Thread
      reloadKey={bot.node_id}
      load={() => ipc.botThread(bot.node_id)}
      send={(text) => ipc.botThreadSend(bot.node_id, text)}
      name={bot.name}
      placeholder={`Message ${bot.name} — @ an agent to pull one in`}
      footnote={
        acts
          ? `Runs as ${bot.agent}. Anything needing approval stops and asks you here.`
          : 'No agent named, so it can answer but not act. Name one on Settings.'
      }
      empty={
        <>
          Its wakes land here as receipts, and anything you ask it goes here too.
          {acts
            ? ` It runs as ${bot.agent}, so it can act within what that agent is allowed.`
            : ' It has no agent, so it can tell you about this space but cannot touch it.'}
        </>
      }
    />
  )
}
