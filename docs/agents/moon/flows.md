# Moon Flows

## First-Run Setup

- Moon hydrates setup from Warden's persisted profile through Sage.
- The flow remains `Storage -> Library Setup -> Discord -> Install -> Finish`.
- Warden is responsible for deriving the actual managed-service selection from the saved profile.

## Login And Bootstrap

- Moon login is Discord-first.
- Setup completion and first-admin bootstrap are tied to the Discord OAuth flow and summary path.
- If the login or callback contract changes, update admin docs and Sage docs together.

## Settings And Users

- General ecosystem controls live under the task-based settings routes.
- User and default-permission management lives under `Settings -> Users`.
- Changes to settings route names or role-management UX should update the public docs because admins look there first.
