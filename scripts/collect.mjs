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

async function getResponse(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': 'me-news-skill-analytics/0.1', ...options.headers },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function collectClawHub(skill) {
  const owner = skill.clawhubOwner ?? config.clawhubOwner;
  const pageUrl = `https://clawhub.ai/${owner}/skills/${skill.slug}`;
  const url = `https://clawhub.ai/api/v1/skills/${skill.slug}?ownerHandle=${encodeURIComponent(owner)}`;
  try {
    const payload = await getJson(url);
    const item = payload.skill;
    return {
      status: 'ok', url: pageUrl,
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
    return { status: 'error', url: pageUrl, apiUrl: url, error: error.message, metrics: {} };
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

async function collectAskill(skill) {
  const url = `${config.askillBaseUrl}/@${skill.slug}`;
  try {
    const response = await getResponse(url, { redirect: 'follow' });
    const body = await response.text();
    const downloadsLabel = body.match(/>([\d.,]+[kKmM]?) downloads<\/span>/i)?.[1] ?? null;
    const starsLabel = body.match(/>([\d,]+)(?:<!-- -->)? stars<\/span>/i)?.[1] ?? null;
    return {
      status: downloadsLabel ? 'ok' : 'public-page-only',
      url,
      httpStatus: response.status,
      metrics: {
        downloadsLabel,
        stars: starsLabel == null ? null : Number.parseInt(starsLabel.replaceAll(',', ''), 10)
      },
      note: 'askill.sh exposes an abbreviated download label on its public page.'
    };
  } catch (error) {
    return { status: 'error', url, error: error.message, metrics: {} };
  }
}

async function collectAgentSkill(skill) {
  const pageUrl = `${config.agentSkillBaseUrl}/${skill.slug}`;
  const apiUrl = `https://agentskill.sh/api/skills/${encodeURIComponent(`me-news/${skill.slug}`)}`;
  try {
    const payload = await getJson(apiUrl);
    const item = payload.data;
    return {
      status: item?.isActive ? 'ok' : 'inactive',
      url: pageUrl,
      apiUrl,
      metrics: {
        installs: item?.installCount ?? null,
        installs24h: item?.recentInstalls24h ?? null,
        installs3d: item?.recentInstalls3d ?? null,
        installs7d: item?.recentInstalls7d ?? null,
        securityScore: item?.securityScore ?? null,
        qualityScore: item?.qualityReview?.score ?? item?.contentQualityScore ?? null,
        githubStars: item?.githubStars ?? null,
        ratingCount: item?.ratingCount ?? null
      },
      verified: item?.isVerified ?? false,
      lastCrawledAt: item?.lastCrawledAt ?? null
    };
  } catch (error) {
    return { status: 'error', url: pageUrl, apiUrl, error: error.message, metrics: {} };
  }
}

async function collectSkillHub(skill) {
  const namespace = skill.skillHubNamespace ?? config.skillHubNamespace;
  const pageUrl = `${config.skillHubBaseUrl}/${encodeURIComponent(namespace)}/${encodeURIComponent(skill.slug)}`;
  const apiUrl = `https://api.skillhub.cn/api/v1/skills/${encodeURIComponent(skill.slug)}?namespace=${encodeURIComponent(namespace)}`;
  try {
    const payload = await getJson(apiUrl);
    const item = payload.skill;
    return {
      status: item?.slug === skill.slug ? 'ok' : 'unavailable',
      url: pageUrl,
      apiUrl,
      version: payload.latestVersion?.version ?? item?.tags?.latest ?? null,
      source: item?.source ?? null,
      metrics: {
        downloads: item?.stats?.downloads ?? null,
        installs: item?.stats?.installs ?? null,
        stars: item?.stats?.stars ?? null,
        versions: item?.stats?.versions ?? null,
        comments: item?.stats?.comments ?? null
      },
      security: {
        keen: payload.securityReports?.keen?.status ?? null,
        sanbu: payload.securityReports?.sanbu?.status ?? null
      },
      claimState: item?.claim_state ?? null,
      claimable: item?.claimable ?? false,
      verified: item?.verified ?? false,
      contentZhAvailable: payload.contentZhAvailable ?? false,
      updatedAt: item?.updatedAt ? new Date(item.updatedAt).toISOString() : null,
      note: 'SkillHub metrics are stored separately and are not added to other platforms.'
    };
  } catch (error) {
    if (/HTTP 404\b/.test(error.message)) {
      return {
        status: 'pending-index',
        url: pageUrl,
        apiUrl,
        error: 'SkillHub has not indexed this skill yet.',
        metrics: {}
      };
    }
    return { status: 'error', url: pageUrl, apiUrl, error: error.message, metrics: {} };
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
const askillSkills = await Promise.all(config.clawhubSkills.map(async (skill) => ({
  slug: skill.slug,
  priority: skill.priority,
  data: await collectAskill(skill)
})));
const agentSkillListings = await Promise.all(config.clawhubSkills.map(async (skill) => ({
  slug: skill.slug,
  priority: skill.priority,
  data: await collectAgentSkill(skill)
})));
const skillHubListings = await Promise.all(config.clawhubSkills.map(async (skill) => ({
  slug: skill.slug,
  priority: skill.priority,
  data: await collectSkillHub(skill)
})));

const snapshot = {
  schemaVersion: 5,
  collectedAt,
  date,
  timezone: config.timezone,
  repository: config.repository,
  sharedPlatforms: { github },
  clawhubSkills,
  skillsShListings,
  askillSkills,
  agentSkillListings,
  skillHubListings
};

const dailyDir = path.join(root, 'data/daily');
await mkdir(dailyDir, { recursive: true });
await writeFile(path.join(dailyDir, `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(path.join(root, 'data/latest.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

const failures = [github, ...clawhubSkills.map((skill) => skill.data), ...skillsShListings.map((listing) => listing.data), ...askillSkills.map((skill) => skill.data), ...agentSkillListings.map((skill) => skill.data), ...skillHubListings.map((skill) => skill.data)]
  .filter((platform) => platform.status === 'error');
console.log(`Collected ${clawhubSkills.length} ClawHub, ${skillsShListings.length} skills.sh, ${askillSkills.length} askill.sh, ${agentSkillListings.length} agentskill.sh, and ${skillHubListings.length} SkillHub listings at ${collectedAt}; hard failures: ${failures.length}`);
if (failures.length) {
  console.warn(`Collection completed with ${failures.length} platform error(s); the snapshot was retained for observability.`);
}
