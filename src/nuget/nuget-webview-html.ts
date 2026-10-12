// HTML/JS for the NuGet Package Manager webview. All dynamic text is inserted with textContent.

export function renderNuGetHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NuGet Package Manager</title>
<style nonce="${nonce}">
  :root { --gap: 8px; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); height: 100vh; display: flex; flex-direction: column; }
  header { padding: 10px 14px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .title-row { display: flex; align-items: center; gap: var(--gap); flex-wrap: wrap; margin-bottom: 8px; }
  h1 { font-size: 1.15em; margin: 0; font-weight: 600; }
  .tabs { display: flex; gap: 18px; }
  .tab { background: none; border: none; color: var(--vscode-descriptionForeground); padding: 6px 0; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
  .tab[aria-selected="true"] { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 9px; padding: 0 6px; margin-left: 4px; font-size: .85em; }
  .toolbar { display: flex; gap: var(--gap); align-items: center; padding: 8px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--vscode-panel-border); }
  input[type=search], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 6px; font: inherit; }
  input[type=search] { flex: 1 1 260px; min-width: 160px; }
  button.action { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; font: inherit; }
  button.action:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: default; }
  main { flex: 1; display: grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, 1.1fr); min-height: 0; }
  #list { overflow-y: auto; border-right: 1px solid var(--vscode-panel-border); }
  .row { display: grid; grid-template-columns: 32px 1fr auto; gap: 10px; padding: 8px 14px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row[aria-selected="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .icon { width: 32px; height: 32px; object-fit: contain; }
  .name { font-weight: 600; }
  .meta, .desc { color: var(--vscode-descriptionForeground); font-size: .92em; }
  .desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; }
  .versions { text-align: right; white-space: nowrap; font-size: .92em; }
  .installed-v { color: var(--vscode-charts-green); }
  .update-v { color: var(--vscode-charts-blue); }
  #details { overflow-y: auto; padding: 14px 18px; }
  #details h2 { margin: 0 0 4px; font-size: 1.3em; display: flex; align-items: center; gap: 10px; }
  .field { display: flex; gap: var(--gap); align-items: center; margin: 10px 0; flex-wrap: wrap; }
  .field label { min-width: 90px; color: var(--vscode-descriptionForeground); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin-top: 16px; }
  dt { color: var(--vscode-descriptionForeground); }
  dd { margin: 0; word-break: break-word; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .empty { padding: 24px 14px; color: var(--vscode-descriptionForeground); }
  #status { padding: 4px 14px; min-height: 22px; font-size: .9em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
  #status.error { color: var(--vscode-errorForeground); }
  .verified { color: var(--vscode-charts-blue); font-size: .9em; }
  @media (max-width: 640px) { main { grid-template-columns: 1fr; } #list { border-right: none; max-height: 45vh; } }
</style>
</head>
<body>
<header>
  <div class="title-row">
    <h1>NuGet Package Manager</h1>
    <span class="meta">Project:</span>
    <select id="project" aria-label="Project"></select>
  </div>
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="browse" aria-selected="true">Browse</button>
    <button class="tab" role="tab" data-tab="installed" aria-selected="false">Installed<span id="installedCount" class="badge">0</span></button>
    <button class="tab" role="tab" data-tab="updates" aria-selected="false">Updates<span id="updateCount" class="badge">0</span></button>
  </div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search (e.g. Serilog, Dapper, Polly)" aria-label="Search packages">
  <label><input id="prerelease" type="checkbox"> Include prerelease</label>
  <label class="meta" for="source">Package source:</label>
  <select id="source" aria-label="Package source"><option value="">All</option></select>
  <button id="manageSources" class="action secondary" title="Add, remove, enable or disable package sources (nuget.config)">Package sources</button>
  <button id="refresh" class="action secondary" title="Refresh">Refresh</button>
  <button id="updateAll" class="action" hidden>Update all</button>
</div>
<main>
  <div id="list" role="listbox" aria-label="Packages"></div>
  <section id="details"><div class="empty">Select a package to see its details.</div></section>
</main>
<div id="status" role="status"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const state = { tab: 'browse', results: [], rows: [], selectedId: undefined, query: '' };
  const $ = id => document.getElementById(id);
  const el = (tag, props, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  };
  const DEFAULT_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="8" width="24" height="18" rx="2" fill="none" stroke="#888" stroke-width="2"/><path d="M4 13h24M12 8l2-4h4l2 4" fill="none" stroke="#888" stroke-width="2"/></svg>');
  const icon = url => {
    const img = el('img', { class: 'icon', alt: '', src: url || DEFAULT_ICON });
    img.addEventListener('error', () => { img.src = DEFAULT_ICON; }, { once: true });
    return img;
  };
  const downloads = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0);
  const setStatus = (text, error, authUrl) => {
    $('status').replaceChildren(text || '');
    $('status').className = error ? 'error' : '';
    if (authUrl) $('status').append(' ', el('a', { text: 'Enter credentials', onclick: () => vscode.postMessage({ type: 'credentials', url: authUrl }) }));
  };

  function currentItems() {
    if (state.tab === 'browse') return state.results.map(p => ({ id: p.id, summary: p, installed: p.installedVersion, latest: p.version }));
    const rows = state.tab === 'updates' ? state.rows.filter(r => r.updateAvailable) : state.rows;
    const q = state.query.toLowerCase();
    return rows.filter(r => !q || r.id.toLowerCase().includes(q))
      .map(r => ({ id: r.id, summary: r.summary, installed: r.version || 'central', latest: r.latest, update: r.updateAvailable }));
  }

  function renderList() {
    const list = $('list');
    list.replaceChildren();
    const items = currentItems();
    if (items.length === 0) {
      const msg = state.tab === 'browse' ? 'No packages found.' : state.tab === 'updates' ? 'All packages are up to date.' : 'No packages installed.';
      list.append(el('div', { class: 'empty', text: msg }));
      return;
    }
    for (const it of items) {
      const s = it.summary;
      const versions = el('div', { class: 'versions' });
      if (it.installed) versions.append(el('div', { class: 'installed-v', text: (state.tab === 'browse' ? '✓ ' : '') + it.installed }));
      if (it.latest && (state.tab === 'browse' ? !it.installed || it.installed !== it.latest : it.update)) {
        versions.append(el('div', { class: it.installed ? 'update-v' : '', text: (it.installed ? '↑ ' : '') + it.latest }));
      }
      const row = el('div', {
        class: 'row', role: 'option', tabindex: '0', 'data-id': it.id, 'aria-selected': String(it.id === state.selectedId),
        onclick: () => select(it.id),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.id); } },
      },
        icon(s && s.iconUrl),
        el('div', {},
          el('div', {}, el('span', { class: 'name', text: it.id }), s ? el('span', { class: 'meta', text: ' by ' + (s.authors || 'unknown') + ', ' + downloads(s.totalDownloads) + ' downloads' }) : null),
          s ? el('div', { class: 'desc', text: s.description }) : null),
        versions);
      list.append(row);
    }
  }

  function renderCounts() {
    $('installedCount').textContent = String(state.rows.length);
    const updates = state.rows.filter(r => r.updateAvailable).length;
    $('updateCount').textContent = String(updates);
    $('updateAll').hidden = !(state.tab === 'updates' && updates > 0);
  }

  function select(id) {
    state.selectedId = id;
    renderList();
    vscode.postMessage({ type: 'select', id });
  }

  function renderDetails(msg) {
    const p = msg.pkg;
    const d = $('details');
    d.replaceChildren();
    const versionSelect = el('select', { id: 'version', 'aria-label': 'Version' });
    for (const v of msg.versions) versionSelect.append(el('option', { value: v, text: v + (v === msg.installedVersion ? ' (installed)' : '') }));
    if (msg.versions.length) versionSelect.value = msg.versions[0];
    const installed = msg.installedVersion;
    const actionBtn = el('button', { class: 'action', id: 'primaryAction' });
    const refreshAction = () => {
      const v = versionSelect.value;
      actionBtn.textContent = !installed && !msg.central ? 'Install' : v === installed ? 'Installed' : 'Update';
      actionBtn.disabled = v === installed;
    };
    versionSelect.addEventListener('change', refreshAction);
    actionBtn.addEventListener('click', () => vscode.postMessage({ type: 'install', id: p.id, version: versionSelect.value }));
    refreshAction();
    const actions = el('div', { class: 'field' }, el('label', { text: 'Version' }), versionSelect, actionBtn);
    if (installed || msg.central) {
      actions.append(el('button', { class: 'action secondary', id: 'uninstall', text: 'Uninstall', onclick: () => vscode.postMessage({ type: 'uninstall', id: p.id }) }));
    }
    const link = (url, text) => url ? el('a', { text, title: url, onclick: () => vscode.postMessage({ type: 'openUrl', url }) }) : null;
    d.append(
      el('h2', {}, icon(p.iconUrl), el('span', { text: p.id }), p.verified ? el('span', { class: 'verified', text: '✔ verified owner' }) : null),
      el('div', { class: 'meta', text: installed ? 'Installed: ' + installed : msg.central ? 'Installed (version managed centrally in Directory.Packages.props)' : 'Not installed' }),
      actions,
      el('p', { text: p.description }),
      el('dl', {},
        el('dt', { text: 'Latest' }), el('dd', { text: p.version }),
        el('dt', { text: 'Authors' }), el('dd', { text: p.authors || '—' }),
        el('dt', { text: 'Downloads' }), el('dd', { text: downloads(p.totalDownloads) }),
        el('dt', { text: 'Tags' }), el('dd', { text: (p.tags || []).join(', ') || '—' }),
        el('dt', { text: 'Source' }), el('dd', { text: p.sourceName || '—' }),
        el('dt', { text: 'Links' }), el('dd', {}, (p.sourceUrl || '').toLowerCase().startsWith('https://api.nuget.org/') ? link('https://www.nuget.org/packages/' + encodeURIComponent(p.id), 'nuget.org') : null, p.projectUrl ? ' · ' : null, link(p.projectUrl, 'Project site'), p.licenseUrl ? ' · ' : null, link(p.licenseUrl, 'License'))));
  }

  function setTab(tab) {
    state.tab = tab;
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    $('search').placeholder = tab === 'browse' ? 'Search packages (e.g. Serilog, Dapper, Polly)' : 'Filter installed packages';
    renderCounts();
    renderList();
  }

  let searchTimer;
  $('search').addEventListener('input', e => {
    state.query = e.target.value;
    clearTimeout(searchTimer);
    if (state.tab === 'browse') searchTimer = setTimeout(() => vscode.postMessage({ type: 'search', query: state.query }), 350);
    else renderList();
  });
  $('prerelease').addEventListener('change', e => {
    vscode.postMessage({ type: 'setPrerelease', value: e.target.checked });
    if (state.tab === 'browse') vscode.postMessage({ type: 'search', query: state.query });
    if (state.selectedId) vscode.postMessage({ type: 'select', id: state.selectedId });
  });
  $('refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
    if (state.tab === 'browse') vscode.postMessage({ type: 'search', query: state.query });
  });
  $('source').addEventListener('change', e => vscode.postMessage({ type: 'setSource', url: e.target.value }));
  $('manageSources').addEventListener('click', () => vscode.postMessage({ type: 'manageSources' }));
  $('updateAll').addEventListener('click', () => vscode.postMessage({ type: 'updateAll' }));
  $('project').addEventListener('change', e => vscode.postMessage({ type: 'switchProject', key: e.target.value }));
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab));

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'project': {
        const sel = $('project');
        sel.replaceChildren(...msg.projects.map(p => el('option', { value: p.key, text: p.name })));
        sel.value = msg.project.key;
        $('prerelease').checked = msg.prerelease;
        break;
      }
      case 'installed': state.rows = msg.rows; renderCounts(); if (state.tab !== 'browse') renderList(); break;
      case 'results': if (msg.query === state.query) { state.results = msg.items; if (state.tab === 'browse') renderList(); } break;
      case 'details': if (msg.pkg.id.toLowerCase() === (state.selectedId || '').toLowerCase()) renderDetails(msg); break;
      case 'busy': setStatus(msg.text); for (const b of document.querySelectorAll('button.action')) b.disabled = !!msg.text || (b.id === 'primaryAction' && b.textContent === 'Installed'); break;
      case 'notice': setStatus(msg.text, msg.level === 'error', msg.authUrl); break;
      case 'sources': {
        const sel = $('source');
        sel.replaceChildren(el('option', { value: '', text: 'All' }), ...msg.sources.map(s => el('option', { value: s.url, text: s.name, title: s.url })));
        sel.value = msg.selected;
        break;
      }
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
