import { readFile, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME || "rvitmonisha";
const readmePath = process.env.README_PATH || "README.md";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const excludedRepos = new Set(
  (process.env.EXCLUDED_PR_REPOS || "")
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean),
);

const startMarker = "<!-- OSS_PR_HIGHLIGHTS_START -->";
const endMarker = "<!-- OSS_PR_HIGHLIGHTS_END -->";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-readme-pr-updater",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function githubJson(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }

  return response.json();
}

function compactStars(count) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }

  return String(count);
}

function cleanTitle(title) {
  return title
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

async function fetchAuthoredPullRequests() {
  const query = encodeURIComponent(`type:pr author:${username}`);
  const searchUrl =
    `https://api.github.com/search/issues?q=${query}` +
    `&sort=updated&order=desc&per_page=100`;

  const search = await githubJson(searchUrl);
  const items = [];

  for (const item of search.items) {
    const repoFullName = item.repository_url.replace(
      "https://api.github.com/repos/",
      "",
    );

    if (excludedRepos.has(repoFullName.toLowerCase())) {
      continue;
    }

    const [repo, pull] = await Promise.all([
      githubJson(item.repository_url),
      githubJson(item.pull_request.url),
    ]);

    items.push({
      number: item.number,
      title: cleanTitle(item.title),
      url: item.html_url,
      repo: repoFullName,
      stars: repo.stargazers_count || 0,
      state: item.state,
      mergedAt: pull.merged_at,
      updatedAt: item.updated_at,
    });
  }

  return items;
}

function sortByStarsThenUpdated(a, b) {
  if (b.stars !== a.stars) {
    return b.stars - a.stars;
  }

  return new Date(b.updatedAt) - new Date(a.updatedAt);
}

function formatPullRequest(item) {
  return `- [${item.repo} #${item.number}](${item.url}) - ${item.title}. _(${compactStars(item.stars)} stars)_`;
}

function buildSection(items) {
  const merged = items
    .filter((item) => item.mergedAt)
    .sort(sortByStarsThenUpdated)
    .slice(0, 3);

  const open = items
    .filter((item) => item.state === "open")
    .sort(sortByStarsThenUpdated)
    .slice(0, 6);

  const mergedLines = merged.length
    ? merged.map(formatPullRequest).join("\n")
    : "- No merged PR highlights found yet.";

  const openLines = open.length
    ? open.map(formatPullRequest).join("\n")
    : "- No open PR highlights found right now.";

  return `${startMarker}
_Auto-updated daily by GitHub Actions. Sorted by target repository stars and excluding onboarding-only PRs._

**Merged PRs**

${mergedLines}

**Open / Under Review**

${openLines}
${endMarker}`;
}

async function main() {
  const readme = await readFile(readmePath, "utf8");

  if (!readme.includes(startMarker) || !readme.includes(endMarker)) {
    throw new Error(
      `README is missing ${startMarker} / ${endMarker} markers.`,
    );
  }

  const items = await fetchAuthoredPullRequests();
  const section = buildSection(items);

  const pattern = new RegExp(
    `${startMarker}[\\s\\S]*?${endMarker}`,
  );

  const nextReadme = readme.replace(pattern, section);

  if (nextReadme !== readme) {
    await writeFile(readmePath, nextReadme);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});