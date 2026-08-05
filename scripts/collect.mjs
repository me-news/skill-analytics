import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(path.join(root, 'config/skills.json'), 'utf8'));
const collectedAt = new Date().toISOString();
const date = collectedAt.slice(0, 10);

async function getJson(url, headers = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'me-news-skill-analytics/0.1', ...headers },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function collectClawHub(skill) {
  const url = `https://clawhub.ai/api/v1/skills/${skill.slug}`;
  try {
    const payload = await getJson(url);
    const item = payload.skill;
    return {
      status: 'ok', url: `https://clawhub.ai/${config.clawhubOwner}/${skill.slug}`,
      version: payload.latestVersion?.version ?? item.tags?.latest ?? null,
      metrics: {
        downloads: item.stats?.downloads ?? null,
        installs: item.stats?.installs ?? null,
        stars: item.stats?.stars ?? null,
        versions: item.stats?.versions ?? null,
        comments: item.stats?.comments ?? null
      },
      updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null
    };
  } catch (error) {
    return { status: 'error', url, error: error.message, metrics: {} };
  }
}

async function collectSkillsSh(listing) {
  const { url } = listing;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'me-news-skill-analytics/0.1' },
      redirect: 'follow', signal: AbortSignal.timeout(20_000)
    });
    const body = await response.text();
    const unavailable = /isn.t available in this repository/i.test(body);
    const structuredInstalls = body.match(/"userInteractionCount"\s*:\s*(\d+)/i)?.[1];
    const visibleInstalls = body.match(/Installs(?:<\/span>)?<\/div><div[^>]*text-3xl[^>]*>([\d,]+)/i)?.[1];
    const weeklyValues = body.match(/aria-label="Weekly installs:\s*([^"]+)"/i)?.[1];
    const weeklyInstalls = weeklyValues
      ? weeklyValues.split(',').map((value) => Number.parseInt(value.trim(), 10))
      : null;
    const installs = Number.parseInt((structuredInstalls ?? visibleInstalls ?? '').replaceAll(',', ''), 10);
    return {
      status: response.ok && !unavailable && Number.isFinite(installs) ? 'ok' :
        response.ok && !unavailable ? 'public-page-only' : 'unavailable',
      url,
      httpStatus: response.status,
      metrics: {
        installs: Number.isFinite(installs) ? installs : null,
        weeklyInstalls: weeklyInstalls?.every(Number.isFinite) ? weeklyInstalls : null
      },
      note: unavailable
        ? 'Public page reports that the skill is unavailable.'
        : 'Metrics parsed from public HTML; use the authenticated API when available.'
    };
  } catch (error) {
    return { status: 'error', url, error: error.message, metrics: {} };
  }
}

async function collectGitHub() {
  const url = `https://api.github.com/repos/${config.repository}`;
  const headers = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' }
    : {};
  try {
    let repo;
    if (process.env.GITHUB_TOKEN) {
      repo = await getJson(url, headers);
    } else {
      try {
        const { stdout } = await execFileAsync('gh', ['api', `repos/${config.repository}`], { timeout: 20_000 });
        repo = JSON.parse(stdout);
      } catch {
        repo = await getJson(url, headers);
      }
    }
    return {
      status: 'ok', url: repo.html_url,
      metrics: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        watchers: repo.subscribers_count,
        openIssues: repo.open_issues_count
      },
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at
    };
  } catch (error) {
    return { status: 'error', url, error: error.message, metrics: {} };
  }
}

const github = await collectGitHub();
const clawhubSkills = await Promise.all(config.clawhubSkills.map(async (skill) => ({
  slug: skill.slug,
  priority: skill.priority,
  data: await collectClawHub(skill)
})));
const skillsShListings = await Promise.all(config.skillsShListings.map(async (listing) => ({
  id: listing.id,
  name: listing.name,
  data: await collectSkillsSh(listing)
})));

const snapshot = {
  schemaVersion: 2,
  collectedAt,
  date,
  timezone: config.timezone,
  repository: config.repository,
  sharedPlatforms: { github },
  clawhubSkills,
  skillsShListings
};

const dailyDir = path.join(root, 'data/daily');
await mkdir(dailyDir, { recursive: true });
await writeFile(path.join(dailyDir, `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(path.join(root, 'data/latest.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

const failures = [github, ...clawhubSkills.map((skill) => skill.data), ...skillsShListings.map((listing) => listing.data)]
  .filter((platform) => platform.status === 'error');
console.log(`Collected ${clawhubSkills.length} ClawHub skills and ${skillsShListings.length} skills.sh listings at ${collectedAt}; hard failures: ${failures.length}`);
if (failures.length) process.exitCode = 1;
