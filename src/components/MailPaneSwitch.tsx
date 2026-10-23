import { FilterTabs } from './ui/DesignSystem'
// Mail | Contacts, at the top of the list it switches.
//
// It used to sit in the sidebar above the accounts, where it read as a switch
// for the sidebar -- and the sidebar never changed, the list beside it did. Up
// here it sits on the thing it changes, and the account picked in the sidebar
// filters whichever of the two is showing.

import { useApp } from '../store'

export function MailPaneSwitch() {
  const mailPane = useApp((s) => s.mailPane)
  const setMailPane = useApp((s) => s.setMailPane)
  const mailContacts = useApp((s) => s.mailContacts)
  return (
<div className="ds-view-switch"><FilterTabs label="Mail views" value={mailPane} onChange={setMailPane} options={[{id:'mail',label:'Mail',icon:'mail'},{id:'contacts',label:'Contacts',icon:'contacts',count:mailContacts.length || undefined}]}/></div>
  )
}
