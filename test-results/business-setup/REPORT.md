# Adding a business: test report

Branch `feat/business-setup`, night of 14 to 15 September 2026. Goal:
`design/goals/business-setup.md`. Design: `design/business-setup/`.

**Everything here ran on a throwaway profile** (`DEVDECK_HOME` pointing at a
scratch folder) with the **mock provider** and **example GitHub repositories**
(`DEVDECK_GITHUB_FAKE=1`). Your real profile, mail, repositories and
workspaces were not touched. Nothing from your mail was sent to a model, and
GitHub was never called with your credentials.

**Real:** Innotrack's name and innotrack.co.za. The app read the site live,
as the goal allows, and what it quotes is on the site. **Made up:** the
partner Alex Mokoena, the mailboxes' mail, the five organisations and their
people, the repositories, and every summary and fact the mock provider wrote
(each one says "scripted by the mock provider").

## Automated

| Suite | Result |
|---|---|
| Rust, `cargo test --lib` | **589 passed, 0 failed** |
| Frontend, `npx tsc -b` | clean |

New tests, by what they hold:

- `a_quote_that_is_not_on_the_site_stops_calling_itself_a_quote`: a line
  claiming to quote the site is checked against its words.
- `a_page_becomes_the_words_a_person_reads`: title, description, headings and
  same-site links from HTML, scripts left out.
- `the_mock_quotes_only_what_is_on_the_page_and_says_when_it_guesses`.
- `a_new_read_keeps_what_you_decided_and_replaces_what_you_did_not`.
- `only_what_was_agreed_reaches_the_managers`: an open guess never reaches
  the business's knowledge.
- `a_project_gets_its_commands_and_services_once`,
  `an_example_repository_is_a_real_git_repository_with_its_origin`,
  `every_address_github_hands_out_names_the_same_repository`.
- `a_ranking_can_be_kept_to_some_mailboxes`: a business's learn run reads
  only its mailboxes.
- `a_business_reads_one_organisation_at_a_time`: three people at one firm are
  one card; free mail is a person.
- `an_organisation_summary_carries_its_role_and_what_it_relates_to`.
- `roles_are_suggested_from_what_the_business_has_never_per_project`.
- `a_file_survives_a_round_trip`: a manager keeps the businesses it works for.
- `a_repository_inside_the_folder_is_seen_whatever_the_slashes`,
  `a_subtree_is_everything_under_a_node`: clearing never deletes code.

## The build, step by step

| # | Step | State | How it was checked |
|---|---|---|---|
| 1 | A business record, Add a business on Today and in Spaces | done | `02`, `15`; the Spaces business starter opens the same flow |
| 2 | Read the website, plain and in a hidden browser window | done | `03` plain read; `04` browser read of **4 real pages, 18,740 characters** (home, About, AssetX, MineX) |
| 3 | What it sells: products and services, suggested, agreed, yours | done | `05` |
| 4 | Link the code: list repositories, link to products as projects | done on examples | `06`, `07`; 4 local example repositories made, each with 3 commands and 1 service read back by the scan, under AssetX, MineX and Marketing |
| 5 | Mail on the domain | done, not against a real server | `08` shows two seeded mailboxes; adding one saves it and its password, and Fetch mail runs a real sync, which was not run tonight |
| 6 | Learn for a business, one organisation at a time | done | `09`, `10`, `11`, `11b`; keeping a card made `Clients/Ridgeback Mining`, wrote its summary to the business's knowledge and filed its facts with the business |
| 7 | Team roles, and managers from another business offered | done | `12`, `13`; four manager files written with `businesses: [Innotrack]` and their heartbeats set; the engineering lead has `stop_at: [before any push]` |
| 8 | The space afterwards | done | `14` |
| 9 | Clearing old workspaces | done on the throwaway profile only | `16`, `17`; Old Develtech's vault folder, manager and heartbeat were removed, its code folder was left where it was, and Home was never offered |

## Screens

| File | What it shows |
|---|---|
| `01-today.png` | The seeded tree: Home tagged Personal, Innotrack and an old Develtech workspace tagged Business |
| `02-add-a-business.png` | Adding a business: name and website, nothing kept until agreed |
| `03-business-website-read.png` | After a plain read. The site's own description is quoted; the mock's other lines say they are guesses; Where is left for you because the site does not say |
| `04-business-read-in-browser.png` | After reading the site in a hidden browser window: 4 pages read |
| `05-what-it-sells.png` | AssetX and MineX quoted from their own pages, two services marked as guesses, Site surveys typed in |
| `06-code-picked.png` | Example repositories picked for AssetX, MineX and Marketing, nothing cloned yet |
| `07-code-linked.png` | Linked: each became a project with its commands and a service |
| `08-mail.png` | Two mailboxes on innotrack.co.za; the next one only needs an address and password |
| `09-learn-approve.png` | One approval: 9 threads with 5 organisations, only Innotrack's mailboxes, sent to the mock |
| `10-learn-nothing-new.png` | A second read with nothing new: 18 already read by the first run. This screen had a disabled button; it now offers See the cards |
| `11-learn-cards.png` | Five organisation cards; TagWorks' two contacts are one card; role and what it relates to on each |
| `11b-learn-card-kept.png` | Ridgeback Mining kept, the next card up |
| `12-team.png` | Roles suggested from what Innotrack sells and has; Finance and Sales kept by the directors; a Finance manager from Old Develtech offered, optional |
| `13-team-made.png` | Four roles on the team |
| `14-space-team-tab.png` | The Innotrack space: what it does, the team with rhythms, products with their projects, services, 2 clients |
| `15-today.png` | Today: Your businesses, Add a business, and the old Develtech workspace flagged |
| `16-clear-preview.png` | What clearing Old Develtech removes and what it never touches |
| `17-cleared.png` | Cleared: 2 folders, 1 project, 1 manager |

## Not done, and what to know

- **The reading screen of a business learn run was not photographed.** The
  mock reads five organisations in about six seconds; the captures caught the
  approval before it and the cards after it.
- **Nothing ran against a real model, real GitHub or a real mail server.**
  The GitHub listing is written against the documented API and uses your
  pasted token; the mail step uses the existing IMAP code; the site and learn
  prompts are written for a real model and were only answered by the mock.
- **The mock calls every organisation a client** and relates each to the first
  product. A real model is asked for the role and the products and services
  from the mail, and a role it cannot tell is left for you.
- **An organisation's name comes from its domain** (`tagworks-supply` becomes
  Tagworks Supply) until a model or you says otherwise.
- **The organisation card's Change** lets you untick lines and pick the role
  and what it relates to. It does not yet have the personal card's "update
  summary" or "add a line".
- **Not built from the design:** "A role that is not here" on the team step,
  and products or services suggested from mail coming back to the What it
  sells list.
- **Managers wake straight away** when made, and with nothing on their plan
  they have nothing to do yet. The engineering lead names the agents dev-a and
  qa; if those do not exist on your profile its wake will say so.
- **Two cards were kept in `11b`, not one.** The capture harness keeps the
  first card on mount, and React mounts twice in development. The harness
  only; the button keeps one.
- **Clearing was never run on your profile.** It will offer your Develtech
  and Innotrack workspaces ticked, Demo unticked, and never Home or Life.

## For you tomorrow

1. Your real DevDeck is restarted on your own profile.
2. **Today, Your businesses, Start them again.** Read the preview before the
   red button.
3. **Add a business:** Innotrack, `innotrack.co.za`. After the plain read,
   press **Read it in a browser window**. With Anthropic as the provider the
   suggestions come from a real model; AssetX and MineX should be offered
   from their pages.
4. **Code:** paste a GitHub token with `repo` and `read:org`, pick the
   repositories and their products, Link.
5. **Mail:** add your innotrack.co.za mailboxes with their server, then
   Fetch mail.
6. **Learn:** the approval shows the cost before anything is sent.
7. **Team:** make it. Then do the same for Develtech.
