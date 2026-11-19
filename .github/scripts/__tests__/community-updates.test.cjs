const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { communitySummary, upsertDiscussion, uploadScreenshots, publishMerge, publishRelease } = require('../community-updates.cjs');

const repository = 'AvnerAdda/shekelsync';
const commitSha = 'a'.repeat(40);
const metadata = { repository: { id: 'repo-id', discussionCategories: { nodes: [
  { id: 'showcase-id', slug: 'show-and-tell' },
  { id: 'announcements-id', slug: 'announcements' },
] } } };
const discussionPage = (nodes = [], hasNextPage = false, endCursor = null) => ({
  repository: { discussions: { nodes, pageInfo: { hasNextPage, endCursor } } },
});
const notFound = () => { const error = new Error('Not found'); error.status = 404; throw error; };

test('extracts the user-facing update without template comments or validation checklists', () => {
  const body = '## Summary\nInternal explanation.\n\n## Community update\n<!-- guidance -->\nSee your next payday at a glance.\n\n## Validation\n- [x] Tests';
  assert.equal(communitySummary(body), 'See your next payday at a glance.');
  assert.equal(communitySummary('## Summary\nUseful change.\n## Community update\n<!-- optional -->'), 'Useful change.');
  assert.equal(communitySummary('## Summary\nDescribe what changed and why.'), '');
  assert.equal(communitySummary(), '');
});

test('does not post for unmerged, reopened, or non-main PRs', async () => {
  const api = { rest: () => assert.fail('No API calls expected') };
  for (const event of [
    { action: 'closed', pull_request: { merged: false, base: { ref: 'main' } } },
    { action: 'opened', pull_request: { merged: true, base: { ref: 'main' } } },
    { action: 'closed', pull_request: { merged: true, base: { ref: 'develop' } } },
  ]) assert.equal(await publishMerge(api, event, '/unused'), null);
});

test('rechecks merge status before publishing and rejects mismatched screenshot revisions', async () => {
  const event = { action: 'closed', pull_request: { number: 90, merged: true, base: { ref: 'main' }, merge_commit_sha: commitSha } };
  const api = { repository, rest: async () => ({ merged: false }) };
  assert.equal(await publishMerge(api, event, '/unused'), null);
  api.rest = async () => ({ merged: true, base: { ref: 'main', repo: { full_name: repository } }, merge_commit_sha: 'b'.repeat(40) });
  await assert.rejects(publishMerge(api, event, '/unused'), /Screenshot commit does not match/);
});

test('finds an existing post across pages and updates it on a rerun', async () => {
  const calls = [];
  const marker = '<!-- shekelsync:merge:90 -->';
  const api = { repository, graphql: async (query, variables) => {
    calls.push({ query, variables });
    if (calls.length === 1) return metadata;
    if (calls.length === 2) return discussionPage([{ id: 'other', body: 'Another update' }], true, 'page-2');
    if (calls.length === 3) {
      assert.equal(variables.after, 'page-2');
      return discussionPage([{ id: 'existing', body: `Old content\n${marker}` }]);
    }
    assert.match(query, /updateDiscussion/);
    assert.deepEqual(variables.input, { discussionId: 'existing', title: 'New title', body: `New content\n\n${marker}` });
    return { updateDiscussion: { discussion: { url: 'https://github.com/example/discussions/1' } } };
  } };
  assert.equal(await upsertDiscussion(api, 'show-and-tell', marker, 'New title', 'New content'), 'https://github.com/example/discussions/1');
  assert.equal(calls.length, 4);
});

test('creates new posts in the requested category and fails clearly for missing categories', async () => {
  let call = 0;
  const api = { repository, graphql: async (query, variables) => {
    call += 1;
    if (call === 1) return metadata;
    if (call === 2) return discussionPage();
    assert.match(query, /createDiscussion/);
    assert.equal(variables.input.categoryId, 'announcements-id');
    assert.equal(variables.input.repositoryId, 'repo-id');
    return { createDiscussion: { discussion: { url: 'created' } } };
  } };
  assert.equal(await upsertDiscussion(api, 'announcements', 'marker', 'Title', 'Body'), 'created');
  api.graphql = async () => metadata;
  await assert.rejects(upsertDiscussion(api, 'missing', 'marker', 'Title', 'Body'), /Enable the 'missing'/);
});

test('never announces draft or unpublished releases', async () => {
  for (const release of [{ draft: true }, { draft: false, published_at: null }]) {
    let calls = 0;
    const api = { rest: async () => { calls += 1; return release; } };
    assert.equal(await publishRelease(api, 'v1.0.0'), null);
    assert.equal(calls, 1);
  }
});

test('never announces a release whose commit is outside main', async () => {
  for (const status of ['behind', 'diverged']) {
    const api = { rest: async (_method, endpoint) => {
      if (endpoint.startsWith('/releases/')) return { draft: false, published_at: '2026-11-19' };
      if (endpoint.startsWith('/commits/')) return { sha: commitSha };
      assert.equal(endpoint, `/compare/${commitSha}...main`);
      return { status };
    } };
    assert.equal(await publishRelease(api, 'v1.0.0'), null);
  }
});

test('announces published releases on main with version-specific notes and an idempotency marker', async () => {
  for (const status of ['ahead', 'identical']) {
    const release = { id: 123, draft: false, published_at: '2026-11-19', body: 'Fixed the forecast.', html_url: 'https://github.com/example/releases/v1.0.0' };
    const api = { repository, rest: async (_method, endpoint) => {
      if (endpoint.startsWith('/releases/')) return release;
      if (endpoint.startsWith('/commits/')) return { sha: commitSha };
      return { status };
    }, graphql: async (query, variables) => {
      if (query.includes('discussionCategories')) return metadata;
      if (query.includes('discussions(first:')) return discussionPage();
      assert.equal(variables.input.categoryId, 'announcements-id');
      assert.match(variables.input.body, /Fixed the forecast/);
      assert.match(variables.input.body, /shekelsync:release:123/);
      assert.match(variables.input.body, /manual updates/);
      return { createDiscussion: { discussion: { url: 'announcement' } } };
    } };
    assert.equal(await publishRelease(api, 'v1.0.0'), 'announcement');
  }
});

function screenshotDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-screenshots-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['home', 'plan', 'wealth']) {
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  }
  return directory;
}

test('rejects missing or malformed screenshots before writing to GitHub', async (t) => {
  const directory = screenshotDirectory(t);
  const api = { rest: () => assert.fail('No writes before validation') };
  fs.unlinkSync(path.join(directory, 'wealth.png'));
  await assert.rejects(uploadScreenshots(api, {}, directory), /ENOENT/);
  fs.writeFileSync(path.join(directory, 'wealth.png'), 'not an image');
  await assert.rejects(uploadScreenshots(api, {}, directory), /Invalid PNG/);
});

test('initializes a dedicated assets branch and preserves immutable screenshots on reruns', async (t) => {
  const directory = screenshotDirectory(t);
  const files = new Set();
  let branchExists = false;
  let uploads = 0;
  const api = { repository, rest: async (method, endpoint, body) => {
    if (endpoint === '/git/ref/heads/community-assets') return branchExists ? {} : notFound();
    if (endpoint === '/git/trees') return { sha: 'tree' };
    if (endpoint === '/git/commits') { assert.deepEqual(body.parents, []); return { sha: 'initial' }; }
    if (endpoint === '/git/refs') { branchExists = true; return {}; }
    if (method === 'GET') return files.has(endpoint.split('?')[0]) ? {} : notFound();
    assert.equal(body.branch, 'community-assets');
    files.add(endpoint);
    uploads += 1;
    return {};
  } };
  const pr = { number: 90, merge_commit_sha: commitSha };
  const first = await uploadScreenshots(api, pr, directory);
  assert.match(first, /raw.githubusercontent.com\/AvnerAdda\/shekelsync\/community-assets\/screenshots\/pr-90/);
  assert.equal(uploads, 3);
  assert.equal(await uploadScreenshots(api, pr, directory), first);
  assert.equal(uploads, 3);
});

test('posts a merged PR summary with all three screenshots and a link to its exact commit', async (t) => {
  const directory = screenshotDirectory(t);
  const pr = {
    number: 90, title: 'Improve planning', body: '## Community update\nPlan the month ahead.',
    merged: true, merge_commit_sha: commitSha,
    base: { ref: 'main', repo: { full_name: repository } },
    html_url: `https://github.com/${repository}/pull/90`,
    user: { login: 'contributor', html_url: 'https://github.com/contributor' },
  };
  const api = { repository, rest: async (_method, endpoint) => {
    if (endpoint === '/pulls/90') return pr;
    return {}; // The branch and immutable images already exist.
  }, graphql: async (query, variables) => {
    if (query.includes('discussionCategories')) return metadata;
    if (query.includes('discussions(first:')) return discussionPage();
    const { input } = variables;
    assert.equal(input.categoryId, 'showcase-id');
    assert.match(input.body, /Plan the month ahead/);
    assert.match(input.body, new RegExp(`/commit/${commitSha}`));
    assert.equal((input.body.match(/!\[ShekelSync/g) || []).length, 3);
    assert.match(input.body, /fictional demo data/);
    assert.match(input.body, /shekelsync:merge:90/);
    return { createDiscussion: { discussion: { url: 'showcase' } } };
  } };
  assert.equal(await publishMerge(api, { action: 'closed', pull_request: pr }, directory), 'showcase');
});

test('retries a concurrent assets branch update without duplicating the image', async (t) => {
  const directory = screenshotDirectory(t);
  let puts = 0;
  const api = { repository, rest: async (method, endpoint) => {
    if (endpoint.startsWith('/git/ref/')) return {};
    if (method === 'GET') return notFound();
    puts += 1;
    if (puts === 1) { const error = new Error('Conflict'); error.status = 409; throw error; }
    return {};
  } };
  await uploadScreenshots(api, { number: 90, merge_commit_sha: commitSha }, directory);
  assert.equal(puts, 4);
});
