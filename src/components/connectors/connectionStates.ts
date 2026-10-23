import type {Connection} from '../../lib/connectors'
export const connectionStates: Record<Connection['state'],{label:string;detail:string}> = {
 configured:{label:'Configured · unverified',detail:'Saved configuration exists. Authentication and service health have not been verified.'},
 authenticated:{label:'Authenticated · unchecked',detail:'Authentication is established. Service health has not been verified.'},
 verified:{label:'Verified',detail:'The last recorded check succeeded. This is historical evidence, not continuous monitoring.'},
 degraded:{label:'Needs attention',detail:'The last recorded check or control-state read reported a problem.'},
 reconnect:{label:'Reconnect needed',detail:'Review authentication in the connection owner before use.'},
 'missing-dependency':{label:'Missing dependency',detail:'A required local dependency is unavailable.'},
 paused:{label:'Paused',detail:'DevDeck use is paused.'},disconnected:{label:'Disconnected',detail:'DevDeck use is disconnected. Saved data and credentials may remain with their owners.'},
}
