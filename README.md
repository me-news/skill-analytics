# ME News Skill Analytics

GitHub Actions-only MVP for collecting and reviewing the distribution metrics of ME News agent skills.

## Scope

- Five skills from `me-news/agent-skills`
- ClawHub public API metrics
- GitHub repository metrics
- skills.sh public listing availability
- Daily JSON snapshots and a static dashboard

skills.sh install metrics are intentionally not scraped. Its supported API requires a Vercel OIDC token, so this MVP records public-page availability until an authenticated adapter is added.

## Run locally

```bash
npm run collect
npm run build
python3 -m http.server 8000 --directory docs
```

Use `GITHUB_TOKEN` when available to avoid the low anonymous GitHub API rate limit.

## Automation

`collect.yml` runs daily at 01:15 UTC (09:15 Asia/Hong_Kong), commits the daily snapshot, and rebuilds the dashboard. GitHub scheduled workflows can be delayed during periods of high load.

`pages.yml` can be run manually after GitHub Pages is enabled with **GitHub Actions** as its source. Automatic deployment should only be enabled after the first successful manual deployment.

## Data interpretation

Platform metrics use different definitions. Downloads and installs across platforms must not be summed and reported as unique users. Actual usage of `agent.me.news` APIs is outside this MVP and should later be imported as a separate metric family.
