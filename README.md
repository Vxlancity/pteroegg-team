# VxTeamPanel

Self-hosted TeamPanel-style team management panel designed to run as a Node.js application inside Pterodactyl.

## Included

- Login and account registration
- Team dashboard
- Member management
- Tasks
- Meetings
- Applications
- Team settings / branding
- Responsive dark UI
- Local JSON persistence in `data/panel.json`
- Password hashing with Node.js `scrypt`
- Pterodactyl-ready startup on `SERVER_PORT`

This is an original self-hosted implementation inspired by the general concept of team-management panels. It is not the official TeamPanel service or its source code.

## Pterodactyl Egg

Import `egg-vx-team-panel.json` under **Admin → Nests → Import Egg**.

The Egg uses Node.js 22/24 images and starts the panel with:

```text
node server.js
```

### Private GitHub repository

The repository is private. During installation, enter a GitHub token directly into the Pterodactyl `GitHub Token` variable. Do not post the token in Discord, GitHub issues, or chat.

If the source repository is public, the token can be left empty.

### Important variables

- `TEAM_NAME` — initial team name
- `ADMIN_EMAIL` — initial owner email
- `ADMIN_PASSWORD` — initial owner password
- `SESSION_SECRET` — long random session secret
- `SOURCE_REPOSITORY` — Git source used by the installer
- `GITHUB_TOKEN` — only needed for a private source repository

Set a strong admin password and session secret before first start.

## Data

The first startup creates `data/panel.json`. Keep the `data` directory when updating the panel or back it up before reinstalling.

## Port

Pterodactyl's primary allocation is exposed through `SERVER_PORT`. No additional port is required by the application.
