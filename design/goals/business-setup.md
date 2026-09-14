# Goal: add a business, built to completion

Branch `feat/business-setup`, cut from `main` after `feat/mail-learn-run` was
merged. Design: `design/business-setup/` (seven artboards, canvas at
https://claude.ai/code/artifact/3c05974f-7bdd-42d5-8d73-0708b1064f0a).
Decisions taken on 14 September 2026:

- **A new business starts clean.** Nothing from another business, Home or
  Your life is copied in. It gets its own space, mail and team.
- **The business is a space tagged Business**, with Clients, Suppliers,
  Advisers, Partner firms, Products, Services, Money and Marketing.
- **Directors are people in the business.** The owner and any partner are
  kept with the business, never in Your life. A partner's own mailbox is added
  only if they share it.
- **The website suggests, the user agrees.** Every suggestion names its source:
  the site's words quoted, a suggestion from them, or a guess labelled as one.
  Nothing is kept until agreed. A plain fetch of innotrack.co.za returns only
  its tagline, because the site is drawn by script.
- **Products and services are different things.** A product is built and can
  hold projects. A project is a linked repository. A service is work done for a
  customer and has no code.
- **Mail is IMAP, many mailboxes per domain.** The domain ties a mailbox to its
  business. After the first mailbox on a domain, only an address and password
  are asked for.
- **Learn is one card per organisation**, grouped by email domain. Each card
  has a kind (client, supplier, adviser, partner firm) and the products and
  services it relates to. A line about the user personally goes to Your life.
- **The team is company roles, never a manager per project.** Operations,
  product, engineering lead, client success, finance, sales and marketing,
  suggested from what the business does. Each role is on the team or marked
  "you do this". A role owns work across every project it touches. Everyone
  reports to the directors.
- **A manager can work for more than one business.** On the team step, managers
  already working for another business are offered as an option: "use for this
  business too". It is never assumed and never the default. Such a manager
  works in each business under that business's permissions, and its receipts
  say which business the work was for.
- **Clearing is the user's call.** The existing Develtech and Innotrack
  workspaces are cleared, not archived. Build the screen. Never run it against
  the real profile.

## What already exists, reuse it

`spaces::space_create` and the starters, `db::node_delete`,
`scan::scan_project` and `setup::detect_project_setup`, `setup::clone_repo`,
`github::github_token_paste`, `mail_accounts.space`, the learn run with
`learn_people`, `learn_facts`, `review` and the card screen in
`setup/LearnStep.tsx`, `setup/steps.ts` and `Frame`, and `managers.rs`, whose
`Manager` already has `role`, `team` and `stop_at`. The manager design in
`ROADMAP.md` ("Managers, roles and the one-to-one") is the model for roles.

## The build, in order

Each step is done when its tests pass, `npx tsc -b` is clean,
`cargo test --lib` is green, and the report has a screenshot where there is a
screen.

1. **A business record.** A business deck file holds name, what it does,
   website, where, and directors. There is an **Add a business** entry point on
   Today and in Spaces, and the setup steps bar gets the business steps.
2. **Read the website.** Do a plain fetch first. When it returns almost
   nothing, read the rendered pages in a hidden WebView2 window, adding its
   label to `capabilities/default.json`. Suggestions are what it does, who it
   serves, industry and where, each carrying its source kind. Agree, Change and
   the "Read it in a browser window" action all work.
3. **What it sells.** Products and services are records in the business deck,
   each suggested, agreed or added by you, with Agree, Change and No. A
   suggestion from mail later comes back to this list, never added quietly.
4. **Link the code.** List repositories from GitHub for the user and their
   organisations with the pasted token. This is new: nothing lists
   repositories today. Tick a repository and pick its product. It becomes a
   project node under that product, cloned into the chosen folder or used where
   it is already cloned. Commands and services are restored with
   `scan_project`. A website repository is offered to Marketing. A readme-based
   link is a labelled suggestion.
5. **Mail on the domain.** Add several IMAP mailboxes to one business. The
   second and later mailboxes on a domain reuse the server settings.
   Passwords go to Credential Manager.
6. **Learn for a business.** Read only that business's mailboxes, and only
   after the approval screen. Show one card per organisation grouped by domain,
   with a kind and relates-to. Keep files the organisation under its kind's
   folder and its facts in that space's `knowledge/`. Personal lines are split
   to the personal store. Reuse the existing cards, review and per-person
   decision code, keyed by organisation.
7. **Team roles.** Keep a role catalogue with a job, a default rhythm and a
   default team of agents, suggested from the business's products and services.
   Each card has a switch between on the team and you do this. Making the
   business creates a `Manager` per role that is on the team, covering the
   features across all of its projects, with `stop_at: [before any push]` for
   engineering. Nothing is created for "you do this" roles. Managers that
   already exist for another business are listed above the roles, each with
   "Use for this business too". Choosing one adds this business's features to
   that manager's portfolio instead of creating a second manager for the role.
   The Personal gate still holds: no business manager is offered to a Personal
   space.
8. **The space afterwards.** The tree shows Products holding their projects,
   Services, and the organisation folders. The space page has a Team tab
   saying what each role is on, and items waiting on the directors appear
   there and on Today.
9. **Clearing Develtech and Innotrack.** A screen lists exactly what goes and
   what is never touched: repositories on disk, Home, Life, mail, and what
   Learn kept. It needs an explicit confirm, and Demo is unticked by default.
   Tested only on a throwaway profile.

## Rules for tonight

- **Throwaway profile only**, via `DEVDECK_HOME`, with the mock provider. The
  user's real profile, mail and workspaces are not touched.
- **Nothing from real mail is sent to a model.**
- **No real GitHub calls with the user's credentials.** Put a fake repository
  list behind the same interface for tests and screenshots. Clone nothing into
  the user's folders; any clone goes to a temporary local repository.
- **Reading a public website is allowed.** innotrack.co.za may be fetched.
- **No mail is sent, nothing is pushed** except this branch, and nothing is
  merged.
- **Commit as you go on `feat/business-setup`**, and push the branch at the end.

## Out of scope

Payments. Pushing to or opening pull requests on the user's repositories. CI,
issues and releases through GitHub. Reporting lines between roles. Sending mail.

## Test report

`test-results/business-setup/REPORT.md`: per step, what passed, what was
skipped and why, and a screenshot of every screen in the design. Made-up data
only, on the throwaway profile, and the report says so at the top.
