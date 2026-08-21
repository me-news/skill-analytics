# ME News Skill Analytics

GitHub Actions-only MVP for collecting and reviewing the distribution metrics of ME News agent skills.

## Scope

- Six published skills across the `jamesmenews` and `me-news` ClawHub accounts
- ClawHub downloads, installs, stars, comments, and version metrics
- GitHub repository metrics
- skills.sh public install metrics for two specified listings
- askill.sh public download labels and stars for five listings
- agentskill.sh installs, recent installs, security scores, verification status, and source API links
- Tencent SkillHub downloads, installs, stars, versions, security scan results, claim status, and source links for five listings
- Daily JSON snapshots and a static dashboard

The skills.sh collector tracks only these listings:

- `https://www.skills.sh/site/skills.volces.com/menews`
- `https://www.skills.sh/jamesmenews/ai-news/ai-news`

These values are parsed from public HTML because the supported API requires a Vercel OIDC token. Public HTML may change, so collection status is stored with every snapshot.

askill.sh currently exposes abbreviated public download labels such as `1.2k`. The collector stores the displayed label instead of presenting it as an exact count.

## Run locally

```bash
npm run collect
npm run build
python3 -m http.server 8000 --directory docs
```

Use `GITHUB_TOKEN` when available to avoid the low anonymous GitHub API rate limit.

## Automation

`collect.yml` runs twice daily at 01:15 and 13:15 UTC (09:15 and 21:15 Asia/Hong_Kong), updates the current day's snapshot, and rebuilds the dashboard. GitHub scheduled workflows can be delayed during periods of high load.

`pages.yml` publishes `docs/` when the dashboard changes and can also be run manually. GitHub Pages must use **GitHub Actions** as its source.

## Data interpretation

Platform metrics use different definitions. Downloads and installs across platforms must not be summed and reported as unique users. Actual usage of `agent.me.news` APIs is outside this MVP and should later be imported as a separate metric family.
