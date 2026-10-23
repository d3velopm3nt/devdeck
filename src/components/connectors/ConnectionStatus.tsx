import type {Connection} from '../../lib/connectors'
import {connectionStates} from './connectionStates'
export function ConnectionStatus({state}:{state:Connection['state']}){const status=connectionStates[state];return <span className="connector-status" data-state={state} title={status.detail}><span className="connector-status-dot" aria-hidden="true"/>{status.label}</span>}
