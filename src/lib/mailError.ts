// What a failed mail fetch means, in words a person can act on.
//
// The server's own reply is always kept as `detail`: the explanation is a
// guess about the cause, and a guess must never hide the evidence.

export type MailProblemKind = 'password' | 'server' | 'certificate' | 'reader' | 'other'

export interface MailProblem {
  kind: MailProblemKind
  title: string
  hint: string
  detail: string
}

export function explainMailError(raw: string, host = ''): MailProblem {
  const detail = raw.trim()
  const l = detail.toLowerCase()
  const at = host || 'the server'

  if (l.includes('no password stored')) {
    return {
      kind: 'password',
      title: 'No password saved for this mailbox',
      hint: 'Edit the mailbox and type its password.',
      detail,
    }
  }
  if (
    l.includes('refused that username') ||
    l.includes('authenticationfailed') ||
    l.includes('authentication failed') ||
    l.includes('invalid credentials') ||
    l.includes('login failed') ||
    l.includes('imap login refused')
  ) {
    return {
      kind: 'password',
      title: 'The server turned down the sign-in',
      hint: 'Check the address, username and password. Most hosts want the full address as the username.',
      detail,
    }
  }
  if (l.includes('could not resolve')) {
    return {
      kind: 'server',
      title: `Couldn't find ${at}`,
      hint: 'The server name looks wrong. On cPanel hosting it is usually mail. followed by your domain.',
      detail,
    }
  }
  if (l.includes('could not reach') || l.includes('timed out') || l.includes('connection refused')) {
    return {
      kind: 'server',
      title: `Couldn't reach ${at}`,
      hint: 'Check the server name and port: 993 for incoming mail over SSL. If both are right, the server may be down or a firewall is in the way.',
      detail,
    }
  }
  if (l.includes('tls handshake') || l.includes('certificate')) {
    return {
      kind: 'certificate',
      title: "The server's certificate didn't check out",
      hint: 'Use the server name the certificate is issued to. Shared hosts often want their own name here rather than mail. and your domain.',
      detail,
    }
  }
  if (l.includes('unexpected parse') || l.includes('unable to parse') || l.includes('could not be read')) {
    const folders = [
      ...new Set(
        detail
          .split(/;\s*/)
          .map((part) => part.match(/^([^:\s][^:]{0,60}):\s/)?.[1])
          .filter((f): f is string => !!f),
      ),
    ]
    return {
      kind: 'reader',
      title: 'Signed in, but the messages could not be read',
      hint: `Your password is fine. ${
        folders.length ? folders.join(' and ') : 'The server'
      } answered in a way DevDeck did not understand. Try again, and if it happens again, copy what the server said and send it on.`,
      detail,
    }
  }
  return {
    kind: 'other',
    title: "Couldn't fetch mail",
    hint: 'What the server said is below.',
    detail,
  }
}
