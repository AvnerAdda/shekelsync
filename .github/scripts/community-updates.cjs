const fs = require('node:fs');
const path = require('node:path');

const ASSETS_BRANCH = 'community-assets';
const SCREENS = ['home', 'plan', 'wealth'];

class GitHub {
  constructor(repository, token) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid GITHUB_REPOSITORY');
    if (!token) throw new Error('GH_TOKEN is required');
    this.repository = repository;
    this.token = token;
  }

  async request(method, endpoint, body) {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${endpoint}: ${response.status} ${data.message}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  rest(method, endpoint, body) {
    return this.request(method, `/repos/${this.repository}${endpoint}`, body);
  }

  async graphql(query, variables) {
    const result = await this.request('POST', '/graphql', { query, variables });
    if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '));
    return result.data;
  }
}

function communitySummary(body = '') {
  const parts = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf('<!--', cursor);
    if (start === -1) {
      parts.push(body.slice(cursor));
      break;
    }
    parts.push(body.slice(cursor, start));
    const end = body.indexOf('-->', start + 4);
    // An unterminated comment consumes the remaining input.
    if (end === -1) break;
    cursor = end + 3;
  }
  // Keep a separator so removing a comment cannot join surrounding characters
  // into another comment opener or HTML tag.
  const clean = parts.join('\n').trim();
  for (const heading of ['Community update', 'Summary']) {
    const match = clean.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'im'));
    const summary = match?.[1].trim();
    if (summary && summary !== 'Describe what changed and why.') return summary.slice(0, 2500);
  }
  return '';
}

async function upsertDiscussion(api, categorySlug, marker, title, body) {
  const [owner, name] = api.repository.split('/');
  const { repository } = await api.graphql(`
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id discussionCategories(first: 25) { nodes { id slug } }
      }
    }`, { owner, name });
  const category = repository.discussionCategories.nodes.find((item) => item.slug === categorySlug);
  if (!category) throw new Error(`Enable the '${categorySlug}' Discussion category before publishing.`);

  let after = null;
  let existing;
  do {
    const data = await api.graphql(`
      query($owner: String!, $name: String!, $category: ID!, $after: String) {
        repository(owner: $owner, name: $name) {
          discussions(first: 100, categoryId: $category, after: $after) {
            nodes { id body url }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { owner, name, category: category.id, after });
    const discussions = data.repository.discussions;
    existing = discussions.nodes.find((item) => item.body.includes(marker));
    after = discussions.pageInfo.hasNextPage ? discussions.pageInfo.endCursor : null;
  } while (!existing && after);

  const content = `${body.trim()}\n\n${marker}`;
  if (existing) {
    const result = await api.graphql(`
      mutation($input: UpdateDiscussionInput!) {
        updateDiscussion(input: $input) { discussion { url } }
      }`, { input: { discussionId: existing.id, title, body: content } });
    return result.updateDiscussion.discussion.url;
  }
  const result = await api.graphql(`
    mutation($input: CreateDiscussionInput!) {
      createDiscussion(input: $input) { discussion { url } }
    }`, { input: { repositoryId: repository.id, categoryId: category.id, title, body: content } });
  return result.createDiscussion.discussion.url;
}

async function optionalRest(api, endpoint) {
  try {
    return await api.rest('GET', endpoint);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function uploadScreenshots(api, pr, directory) {
  // Validate the complete set before creating branches or uploading anything.
  const files = SCREENS.map((name) => {
    const content = fs.readFileSync(path.join(directory, `${name}.png`));
    if (!content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new Error(`Invalid PNG screenshot: ${name}`);
    }
    if (content.length > 5 * 1024 * 1024) throw new Error(`Screenshot exceeds 5 MB: ${name}`);
    return { name, content: content.toString('base64') };
  });
  if (!await optionalRest(api, `/git/ref/heads/${ASSETS_BRANCH}`)) {
    // An orphan branch stores just public demo screenshots, without app sources.
    const tree = await api.rest('POST', '/git/trees', {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob',
        content: '# Community screenshots\n\nPublic demo images for ShekelSync Discussions. Managed by GitHub Actions.\n' }],
    });
    const commit = await api.rest('POST', '/git/commits', {
      message: 'Initialize community screenshots', tree: tree.sha, parents: [],
    });
    try {
      await api.rest('POST', '/git/refs', { ref: `refs/heads/${ASSETS_BRANCH}`, sha: commit.sha });
    } catch (error) {
      // Another merged PR can create the branch while this job is capturing.
      if (error.status !== 422 || !await optionalRest(api, `/git/ref/heads/${ASSETS_BRANCH}`)) throw error;
    }
  }
  const images = [];
  for (const file of files) {
    const imagePath = `screenshots/pr-${pr.number}/${pr.merge_commit_sha}/${file.name}.png`;
    const endpoint = `/contents/${imagePath}`;
    // Immutable paths preserve screenshots on reruns and keep old posts valid.
    if (!await optionalRest(api, `${endpoint}?ref=${ASSETS_BRANCH}`)) {
      // Concurrent PRs may advance the branch between Contents API writes.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await api.rest('PUT', endpoint, {
            message: `Add ${file.name} demo for PR #${pr.number}`,
            branch: ASSETS_BRANCH, content: file.content,
          });
          break;
        } catch (error) {
          if (![409, 422].includes(error.status) || attempt >= 2) throw error;
          if (await optionalRest(api, `${endpoint}?ref=${ASSETS_BRANCH}`)) break;
        }
      }
    }
    images.push(`### ${file.name[0].toUpperCase() + file.name.slice(1)}\n\n` +
      `![ShekelSync ${file.name} with demo data](https://raw.githubusercontent.com/${api.repository}/${ASSETS_BRANCH}/${imagePath})`);
  }
  return images.join('\n\n');
}

async function publishMerge(api, event, directory) {
  if (event.action !== 'closed' || !event.pull_request?.merged || event.pull_request.base?.ref !== 'main') {
    return null;
  }
  // Re-read merge metadata rather than treating the event's prose as executable input.
  const pr = await api.rest('GET', `/pulls/${event.pull_request.number}`);
  if (!pr.merged || pr.base.ref !== 'main' || pr.base.repo.full_name !== api.repository) return null;
  if (!/^[a-f0-9]{40}$/.test(pr.merge_commit_sha)) throw new Error('Missing merge commit SHA');
  if (pr.merge_commit_sha !== event.pull_request.merge_commit_sha) throw new Error('Screenshot commit does not match the merge');
  const screenshots = await uploadScreenshots(api, pr, directory);
  const summary = communitySummary(pr.body);
  const body = [
    `Just merged into \`main\`: [${pr.title}](${pr.html_url}) (#${pr.number}).`,
    summary,
    `Thanks to [${pr.user.login}](${pr.user.html_url}) for this contribution.`,
    `These screenshots show the app at [\`${pr.merge_commit_sha.slice(0, 7)}\`](https://github.com/${api.repository}/commit/${pr.merge_commit_sha}) with fictional demo data.`,
    screenshots,
    'This development update will be available in a future release. ' +
      `[Download published versions](https://github.com/${api.repository}/releases).`,
    'Try the latest development changes and share your feedback in this discussion.',
  ].filter(Boolean).join('\n\n');
  return upsertDiscussion(api, 'show-and-tell', `<!-- shekelsync:merge:${pr.number} -->`,
    `Development update: ${pr.title} (#${pr.number})`.slice(0, 250), body);
}

async function publishRelease(api, tag) {
  if (!tag) throw new Error('RELEASE_TAG is required');
  const release = await api.rest('GET', `/releases/tags/${encodeURIComponent(tag)}`);
  if (release.draft || !release.published_at) return null;
  const commit = await api.rest('GET', `/commits/${encodeURIComponent(tag)}`);
  const comparison = await api.rest('GET', `/compare/${commit.sha}...main`);
  if (!['ahead', 'identical'].includes(comparison.status)) {
    console.log(`Skipping ${tag}: the release commit is not contained in main.`);
    return null;
  }
  const body = [
    `ShekelSync **${tag}**${release.prerelease ? ' (prerelease)' : ''} is now available.`,
    `[Download ${tag}](${release.html_url}) for macOS, Windows, or Linux.`,
    '## What changed',
    release.body?.trim() || `See the [release details](${release.html_url}) for this version.`,
    '## Updating',
    'Download the installer for your platform from the release page. ' +
      'Unsigned macOS builds require manual updates and first-launch approval in Privacy & Security.',
    `[Installation help](https://github.com/${api.repository}/wiki/Getting-Started) · ` +
      `[Changelog](https://github.com/${api.repository}/blob/${encodeURIComponent(tag)}/CHANGELOG.md)`,
    'Share feedback in this discussion, or open an issue with steps to reproduce a problem.',
  ].join('\n\n');
  return upsertDiscussion(api, 'announcements', `<!-- shekelsync:release:${release.id} -->`,
    `ShekelSync ${tag} is now available`.slice(0, 250), body);
}

async function main() {
  const api = new GitHub(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
  const mode = process.argv[2];
  let url;
  if (mode === 'merge') {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    url = await publishMerge(api, event, process.env.COMMUNITY_SCREENSHOTS_DIR || 'community-screenshots');
  } else if (mode === 'release') {
    url = await publishRelease(api, process.env.RELEASE_TAG);
  } else {
    throw new Error('Usage: node .github/scripts/community-updates.cjs <merge|release>');
  }
  const message = url ? `Community discussion: ${url}` : 'No community update needed.';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { communitySummary, upsertDiscussion, uploadScreenshots, publishMerge, publishRelease };
