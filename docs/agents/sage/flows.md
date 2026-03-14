# Sage Flows

## Setup Proxy

- Sage is the browser-facing path into Warden setup, install, and service-management APIs.
- Moon should not have to assemble the real managed-service set client-side.

## Discord OAuth And Bootstrap

- Sage owns Discord OAuth start and callback handling for Moon.
- First-admin bootstrap and ongoing Discord-linked sign-in both depend on this path.

## Users And Default Permissions

- Sage reads and writes the default permissions used for new Discord-linked accounts.
- Changes here usually need public/admin docs because admins manage this from Moon.
