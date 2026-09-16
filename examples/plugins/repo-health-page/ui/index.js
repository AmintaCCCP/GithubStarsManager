const pluginId = 'com.example.repo-health-page';
const pageId = 'dashboard';
let token = null;
let nextRequestId = 0;
let latestSearchId = 0;
const pending = new Map();

function request(method, args) {
  if (!token) return Promise.reject(new Error('Host bridge is not ready'));
  const requestId = String(++nextRequestId);
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    window.parent.postMessage({
      type: 'plugin-page:request', pluginId, pageId, requestId, token, method, args,
    }, '*');
  });
}

function renderRepositories(repositories) {
  const list = document.getElementById('results');
  list.replaceChildren();
  for (const repository of repositories) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = repository.full_name;
    const summary = document.createElement('small');
    const lastPush = repository.pushed_at ? repository.pushed_at.slice(0, 10) : 'unknown';
    summary.textContent = `★ ${repository.stargazers_count} · Last push: ${lastPush}`;
    item.append(title, summary);
    list.append(item);
  }
}

async function search() {
  const status = document.getElementById('status');
  const searchId = ++latestSearchId;
  try {
    status.textContent = 'Searching…';
    const repositories = await request('repositories.search', {
      query: document.getElementById('query').value.trim(), limit: 30,
    });
    if (searchId !== latestSearchId) return;
    renderRepositories(repositories);
    status.textContent = `${repositories.length} repositories found in the local Host snapshot.`;
  } catch (error) {
    if (searchId !== latestSearchId) return;
    status.textContent = error instanceof Error ? error.message : 'Search failed';
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data ||
    event.data.pluginId !== pluginId || event.data.pageId !== pageId) return;
  if (event.data.type === 'plugin-page:init' && typeof event.data.token === 'string') {
    token = event.data.token;
    void search();
    return;
  }
  if (event.data.type !== 'plugin-page:response' || event.data.token !== token) return;
  const handler = pending.get(event.data.requestId);
  if (!handler) return;
  pending.delete(event.data.requestId);
  if (event.data.success) handler.resolve(event.data.value);
  else handler.reject(new Error(event.data.error?.message || 'Host request failed'));
});

document.getElementById('search').addEventListener('click', () => void search());
