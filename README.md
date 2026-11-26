<div align="center">

# 📡 Devlog

### A self-hosted GitHub activity feed for Discord

Follow commits, builds and releases from your public and private repositories
in one Discord channel.

[Feed preview](#-feed-preview) ·
[Quick start](#-quick-start) ·
[GitHub events](#-github-events) ·
[Oracle VM deployment](#-oracle-vm-deployment)

[![Node.js 22.13+](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![GitHub App](https://img.shields.io/badge/GitHub-App-181717?logo=github&logoColor=white)](https://docs.github.com/en/apps)
[![Discord embeds](https://img.shields.io/badge/Discord-Embeds-5865F2?logo=discord&logoColor=white)](https://discord.com/developers/docs/resources/message#embed-object)
[![SQLite persistence](https://img.shields.io/badge/SQLite-Persistence-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)

</div>

---

## ✨ What Devlog shows

- **🟣 Pushes and commits.** The branch, author, time, comparison link and a clickable title for each commit. Long pushes continue across several cards.
- **🟢 Builds and deployments.** Each workflow run gets one Discord card with linked jobs. The card updates as the run progresses, with green success, red failure and yellow progress states.
- **🔔 Repository activity.** Follow selected releases, pull requests, reviews, issues, discussions and checks.
- **🔒 Private repositories.** Install one GitHub App per account or organization. Choose **All repositories** to include private repositories and repositories created later.
- **🟢 Discord presence.** Devlog appears online with the activity **Watching GitHub commits**.

## 🎨 Feed preview

<table>
<tr>
<th align="left">🟣 Push</th>
<th align="left">🟢 Build</th>
</tr>
<tr>
<td valign="top">
<strong>Atlas</strong><br />
<strong>2 commits on main</strong><br />
• Validate settings on startup<br />
• Refresh the activity dashboard<br /><br />
<sub>by octocat · Today at 2:31 PM</sub>
</td>
<td valign="top">
<strong>Atlas</strong><br />
<strong>✅ Build and deploy</strong><br />
Finished successfully on <strong>main</strong> · Deploy UI<br /><br />
<sub>by octocat · Today at 2:33 PM</sub>
</td>
</tr>
</table>

Run `npm run preview` to generate example push, success and failure payloads with sample data.

## 🚀 Quick start

Requires **Node.js 22.13+**. The bot uses Node's built-in modules and SQLite.

```bash
git clone https://github.com/VIK-DD/devlog.git
cd devlog
cp .env.example .env
```

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and install it on your server with the `bot` scope. Grant **View Channel**, **Send Messages** and **Embed Links** in your destination channel. Enable **Developer Mode** to copy the channel ID.
2. Create a [GitHub App](https://github.com/settings/apps/new). Enable its webhook and set the URL to `https://YOUR-HOST/webhooks/github`. Generate a secret with `openssl rand -hex 32`, configure the repository permissions below and subscribe to the events you want.
3. Generate a private key for the GitHub App. Set the following values in `.env`.

   | Variable | Purpose |
   | --- | --- |
   | `GITHUB_WEBHOOK_SECRET` | The secret shared with the GitHub App webhook |
   | `GITHUB_APP_ID` | The numeric GitHub App ID |
   | `GITHUB_APP_PRIVATE_KEY_FILE` | PEM file used to fetch commits omitted from large pushes |
   | `DISCORD_BOT_TOKEN` | The token from the Discord application's **Bot** page |
   | `DISCORD_CHANNEL_ID` | The destination channel ID |
   | `GITHUB_LOGIN` | Optional login filter. Leave blank for activity from all actors. |

4. Start the bot with `npm start`. Put an HTTPS reverse proxy or tunnel in front of the listener and allow request bodies up to 25 MiB. Check `GET /healthz`.
5. Install the GitHub App under **Install App → All repositories**, then push to a repository. GitHub's **Advanced → Recent deliveries** should show HTTP 202 for the push.

By default, the service listens on `127.0.0.1:3000` and stores its queue at
`data/devlog.sqlite`. Set `HOST=0.0.0.0` when your container platform routes
traffic to the process. Use one instance and a persistent volume for SQLite.

## 🔔 GitHub events

| Repository permission · read-only | Events |
| --- | --- |
| Contents | Push, Release, Create, Delete, Workflow dispatch, Commit comment |
| Actions | Workflow job, Workflow run |
| Pull requests | Pull request, Pull request review, Review comment, Review thread |
| Issues | Issues |
| Issues or Pull requests | Issue comment |
| Deployments | Deployment, Deployment status |
| Discussions | Discussion, Discussion comment |
| Metadata | Repository, Fork, Star, Watch |
| Checks | Check run, Check suite |
| Commit statuses | Status |

Enable **Workflow run** for the overall result and **Workflow job** for job status
inside the same card. A rerun updates that card with the new attempt. Manual
workflow triggers and GitHub Actions check events use the workflow card.
**Create** and **Delete** may also surface through **Push** when
the same branch or tag changes. Other subscribed repository events use a basic
card with the event name and a GitHub link. [GitHub webhook event reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads)

## ☁️ Oracle VM deployment

| Component | Location |
| --- | --- |
| Bot | `devlog.service` on `127.0.0.1:8310` |
| HTTPS webhook | `https://devlog.novaguard.fun/webhooks/github` |
| Production configuration | `/etc/devlog` |
| Persistent queue | `/var/lib/devlog/devlog.sqlite` |
| Active release | `/opt/devlog/current` |

The VM checks `VIK-DD/devlog` on `main` about once a minute. A new commit is
fetched with a read-only deploy key, syntax-checked, then activated through
systemd. If the new process fails its health check, the updater restores the
previous release. It tries again when `main` advances to a different commit.

```bash
systemctl status devlog.service devlog-auto-update.timer
journalctl -u devlog-auto-update.service -n 30 --no-pager
sudo systemctl start devlog-auto-update.service
```

The updater deploys `src/` and `package.json`. The installed systemd units and
privileged updater are managed on the VM by the administrator. The repo includes
their source in [`deploy/`](deploy/), alongside the credential setup helper.

## 🛡️ Delivery and privacy

- Restrict the Discord channel to members who may see private repository names and commit subjects.
- Devlog validates GitHub signatures and queues accepted deliveries in SQLite before acknowledging them. It retries Discord failures and keeps progress for multi-card pushes.
- The feed starts after installation. GitHub can omit oversized events, and some large pushes include only part of the commit list. Devlog tries to retrieve the remainder and labels partial lists when it cannot. [GitHub push payload limits](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push)
- For webhooks GitHub sent while the endpoint was unavailable, use **Redeliver** in **Recent deliveries**. [GitHub webhook redelivery](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)
