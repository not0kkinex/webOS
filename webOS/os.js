import { AuthAPI } from './auth.js';

const $$ = (sel, el = document) => el.querySelector(sel);
const $$$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const OS_VERSION = '0.3.0';
const STORAGE_SOFT_QUOTA = 512 * 1024;

const state = {
  zTop: 10,
  windows: new Map(),
  processes: new Map(),
  nextPid: 1,
  currentUser: null,
};

const RegistryStorageKey = 'os:registry:installed';

const AppRegistry = (() => {
  const builtins = [
    {
      id: 'clock',
      name: 'Clock',
      icon: 'https://cdn.jsdelivr.net/gh/tabler/tabler-icons/icons/clock.svg',
      description: 'Simple digital clock.',
      entryUrl: './apps/clock/index.html',
      permissions: [],
      _builtin: true,
    },
    {
      id: 'notes',
      name: 'Notes',
      icon: 'https://cdn.jsdelivr.net/gh/tabler/tabler-icons/icons/note.svg',
      description: 'Minimal notes using OS storage.',
      entryUrl: './apps/notes/index.html',
      permissions: ['storage'],
      _builtin: true,
    },
    {
      id: 'appstore',
      name: 'App Store',
      icon: 'https://cdn.jsdelivr.net/gh/tabler/tabler-icons/icons/shopping-bag.svg',
      description: 'Install and remove apps.',
      entryUrl: './apps/appstore/index.html',
      permissions: ['registry', 'storage'],
      _builtin: true,
    },
  ];

  let installed = loadInstalled();
  let byId = rebuildIndex();

  function loadInstalled() {
    try { return JSON.parse(localStorage.getItem(RegistryStorageKey) || '[]'); }
    catch { return []; }
  }
  function persistInstalled() {
    localStorage.setItem(RegistryStorageKey, JSON.stringify(installed));
  }
  function rebuildIndex() {
    const all = [...builtins, ...installed];
    return new Map(all.map(a => [a.id, a]));
  }

  function _validate(man) {
    const req = ['id','name','icon','entryUrl','permissions'];
    for (const k of req) if (!man || typeof man[k] === 'undefined' || man[k] === null || man[k] === '') {
      throw { code:'EVALID', message:`Manifest missing "${k}"` };
    }
    if (!Array.isArray(man.permissions)) throw { code:'EVALID', message:'"permissions" must be an array' };
    if (/^\s*$/.test(man.id)) throw { code:'EVALID', message:'Invalid id' };
  }

  function list() { return [...builtins, ...installed]; }
  function get(id) { return byId.get(id); }
  function isBuiltin(id) { return builtins.some(a => a.id === id); }

  function install(manifest) {
    _validate(manifest);
    if (isBuiltin(manifest.id)) throw { code:'EBUILTIN', message:'Cannot override builtin app id' };
    const idx = installed.findIndex(a => a.id === manifest.id);
    if (idx >= 0) installed[idx] = manifest; else installed.push(manifest);
    persistInstalled();
    byId = rebuildIndex();
    window.dispatchEvent(new CustomEvent('registry-changed'));
    return true;
  }

  function uninstall(appId) {
    if (isBuiltin(appId)) throw { code:'EBUILTIN', message:'Cannot uninstall builtin app' };
    const before = installed.length;
    installed = installed.filter(a => a.id !== appId);
    if (installed.length === before) throw { code:'ENOAPP', message:'App not installed' };
    persistInstalled();
    byId = rebuildIndex();
    for (const [pid, p] of state.processes.entries()) if (p.appId === appId) {
      WindowManager.close({ dataset: { winId: p.winId } });
    }
    window.dispatchEvent(new CustomEvent('registry-changed'));
    return true;
  }

  return { list, get, install, uninstall, isBuiltin };
})();

const Desktop = (() => {
  const menubar = $$('#menubar');
  const desktop = $$('#desktop');
  const icons = $$('#desktop-icons');
  const dock = $$('#dock');
  const launcher = $$('#launcher');
  const launcherSearch = $$('#launcher-search');
  const launcherGrid = $$('#launcher-grid');
  const clockEl = $$('#clock');
  const userNameEl = $$('#user-name');
  const userAvatarEl = $$('#user-avatar');
  const userToggle = $$('#user-toggle');
  const userMenu = $$('#user-menu');

  async function boot() {
    const session = await AuthAPI.checkSession();
    if (!session) {
      window.location.href = './auth.html';
      return;
    }

    const user = await AuthAPI.getCurrentUser();
    if (!user) {
      window.location.href = './auth.html';
      return;
    }

    state.currentUser = user;
    userNameEl.textContent = user.username || 'User';
    userAvatarEl.textContent = (user.username || 'U')[0].toUpperCase();

    renderAll();
    bindGlobalShortcuts();
    bindUserMenu();
    tickClock();
    setInterval(tickClock, 1000);

    $$('#boot-splash').hidden = true;
    menubar.hidden = false;
    desktop.hidden = false;
    window.addEventListener('registry-changed', renderAll);

    AuthAPI.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        window.location.href = './auth.html';
      }
    });
  }

  function bindUserMenu() {
    userToggle.onclick = (e) => {
      e.stopPropagation();
      userMenu.classList.toggle('hidden');
    };

    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target) && e.target !== userToggle) {
        userMenu.classList.add('hidden');
      }
    });

    $$('#menu-logout').onclick = async () => {
      await AuthAPI.signOut();
    };

    $$('#menu-profile').onclick = () => {
      userMenu.classList.add('hidden');
      alert('Profile settings coming soon!');
    };
  }

  function renderAll() {
    renderDesktopIcons();
    renderDock();
    renderLauncher();
  }

  function renderDesktopIcons() {
    icons.innerHTML = '';
    for (const app of AppRegistry.list()) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.title = app.name;
      li.innerHTML = `<img alt="" src="${app.icon}"/><div class="name">${app.name}</div>`;
      li.onclick = () => ProcessManager.launch(app.id);
      li.onkeydown = (e) => { if (e.key === 'Enter') ProcessManager.launch(app.id); };
      icons.appendChild(li);
    }
  }

  function renderDock() {
    const launcherItem = $$('#launcher-dock-item');
    launcherItem.onclick = () => toggleLauncher();

    for (const app of AppRegistry.list().slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'dock-item';
      item.title = app.name;
      item.innerHTML = `<img alt="" src="${app.icon}">`;
      item.onclick = () => ProcessManager.launch(app.id);
      dock.appendChild(item);
    }
  }

  function renderLauncher() {
    launcherGrid.innerHTML = '';
    for (const app of AppRegistry.list()) {
      const card = document.createElement('div');
      card.className = 'app-card';
      card.innerHTML = `
        <img alt="" src="${app.icon}">
        <div>
          <div class="name">${app.name}</div>
          <div class="desc">${app.description || ''}</div>
        </div>`;
      card.onclick = () => { launcher.close(); ProcessManager.launch(app.id); };
      launcherGrid.appendChild(card);
    }
    launcher.addEventListener('close', () => launcherSearch.value = '');
    launcherSearch.addEventListener('input', () => filterLauncher(launcherSearch.value));
    $$('#desktop-content').addEventListener('dblclick', (e) => {
      if ((e.target === $$('#desktop-content')) && !launcher.open) toggleLauncher();
    });
  }

  function filterLauncher(q) {
    const needle = q.toLowerCase();
    for (const card of $$$('.app-card', launcherGrid)) {
      const text = card.textContent.toLowerCase();
      card.classList.toggle('hidden', !text.includes(needle));
    }
  }

  function toggleLauncher() {
    if (launcher.open) launcher.close();
    else { launcher.showModal(); setTimeout(() => launcherSearch.focus(), 30); }
  }

  function bindGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'Space') { e.preventDefault(); toggleLauncher(); }
      if (mod && e.key.toLowerCase() === 'w') {
        const top = WindowManager.topWindow();
        if (top) WindowManager.close(top);
      }
    });
  }

  function tickClock() {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }

  function addDockItem(winId, app) {
    const existing = $$(`[data-win-id="${winId}"]`, dock);
    if (existing) {
      existing.classList.add('active');
      return existing;
    }

    const item = document.createElement('div');
    item.className = 'dock-item';
    item.dataset.winId = winId;
    item.innerHTML = `<img alt="" src="${app.icon}">`;
    item.onclick = () => WindowManager.focus(winId, {toggleMinimize:true});
    dock.appendChild(item);
    return item;
  }

  function removeDockItem(item) { item.remove(); }

  function setDockItemActive(item, active) {
    $$$('.dock-item[data-win-id]').forEach(i => i.classList.remove('active'));
    if (active) item.classList.add('active');
  }

  return { boot, addDockItem, removeDockItem, setDockItemActive };
})();

const WindowManager = (() => {
  const root = $$('#desktop-content');

  function create(app, url) {
    const winId = crypto.randomUUID();
    const el = document.createElement('div');
    el.className = 'window';
    el.style.zIndex = ++state.zTop;
    el.style.left = 100 + Math.random() * 200 + 'px';
    el.style.top = 80 + Math.random() * 100 + 'px';
    el.style.width = '800px';
    el.style.height = '550px';
    el.dataset.winId = winId;

    el.innerHTML = `
      <div class="titlebar">
        <div class="controls">
          <button data-close title="Close"></button>
          <button data-min title="Minimize"></button>
          <button data-max title="Maximize"></button>
        </div>
        <div class="title"><img alt="" src="${app.icon}"><span>${app.name}</span></div>
        <div></div>
      </div>
      <div class="content">
        <iframe sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" src="${url}"></iframe>
      </div>
      <div class="resize-handle" aria-hidden="true"></div>
    `;
    root.appendChild(el);

    const dockItem = Desktop.addDockItem(winId, app);
    const iframe = $$('iframe', el);

    const win = { el, app, iframe, dockItem, maximized:false, lastRect:null };
    state.windows.set(winId, win);

    bindWindowEvents(winId, win);
    focus(winId);
    return winId;
  }

  function bindWindowEvents(winId, win) {
    const { el, dockItem } = win;
    const title = $$('.titlebar', el);
    const min = $$('[data-min]', el);
    const max = $$('[data-max]', el);
    const close = $$('[data-close]', el);
    const handle = $$('.resize-handle', el);

    let drag = null;
    title.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target !== title) return;
      drag = { x:e.clientX - el.offsetLeft, y:e.clientY - el.offsetTop };
      focus(winId);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const nx = Math.max(0, Math.min(e.clientX - drag.x, root.clientWidth - el.offsetWidth));
      const ny = Math.max(0, Math.min(e.clientY - drag.y, root.clientHeight - el.offsetHeight));
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
    });
    window.addEventListener('mouseup', () => drag = null);

    let rs = null;
    handle.addEventListener('mousedown', (e) => {
      rs = { x:e.clientX, y:e.clientY, w:el.offsetWidth, h:el.offsetHeight };
      focus(winId);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!rs) return;
      const w = Math.max(320, rs.w + (e.clientX - rs.x));
      const h = Math.max(200, rs.h + (e.clientY - rs.y));
      el.style.width = w + 'px'; el.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => rs = null);

    min.onclick = () => minimize(winId);
    max.onclick = () => toggleMaximize(winId);
    close.onclick = () => closeWindow(winId);

    dockItem.oncontextmenu = (e) => { e.preventDefault(); closeWindow(winId); };
  }

  function focus(winId, opts = {}) {
    const win = state.windows.get(winId);
    if (!win) return;
    win.el.style.zIndex = ++state.zTop;
    Desktop.setDockItemActive(win.dockItem, true);
    if (opts.toggleMinimize) {
      const hidden = win.el.classList.toggle('hidden');
      if (!hidden) Desktop.setDockItemActive(win.dockItem, true);
    }
  }

  function topWindow() {
    let best = null; let bestZ = -1;
    state.windows.forEach(w => {
      const z = parseInt(w.el.style.zIndex || 0, 10);
      if (!w.el.classList.contains('hidden') && z > bestZ) { best = w; bestZ = z; }
    });
    return best ? best.el.dataset.winId : null;
  }

  function minimize(winId) {
    const win = state.windows.get(winId);
    if (!win) return;
    win.el.classList.add('hidden');
    Desktop.setDockItemActive(win.dockItem, false);
  }

  function toggleMaximize(winId) {
    const win = state.windows.get(winId);
    if (!win) return;
    if (!win.maximized) {
      win.lastRect = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
      win.el.style.left = '0px'; win.el.style.top = '0px';
      win.el.style.width = '100%'; win.el.style.height = '100%';
    } else {
      Object.assign(win.el.style, win.lastRect);
    }
    win.maximized = !win.maximized;
  }

  function closeWindow(winId) {
    const win = state.windows.get(winId);
    if (!win) return;
    win.el.remove();
    Desktop.removeDockItem(win.dockItem);
    state.windows.delete(winId);
    for (const [pid, p] of state.processes.entries()) if (p.winId === winId) state.processes.delete(pid);
  }

  function close(el) { closeWindow(el.dataset.winId); }

  return { create, focus, close, minimize, toggleMaximize, topWindow };
})();

const RPC = (() => {
  const pending = new Map();
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'OS_RPC') return;
    if (msg.role === 'app->os') return;
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    }
  });
  function call(iframe, method, params) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      iframe.contentWindow.postMessage({ type:'OS_RPC', id, method, params, role:'os->app' }, '*');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject({code:'ETIMEDOUT', message:'No response from app'}); }
      }, 5000);
    });
  }
  return { call };
})();

const OSApi = (() => {
  function checkPermission(app, perm) {
    const ok = app.permissions.includes(perm);
    if (!ok) throw { code: 'EPERM', message: `App "${app.id}" lacks permission "${perm}"` };
  }
  function storageSizeFor(appId) {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`os:${appId}:`)) total += (localStorage.getItem(k) ?? '').length;
    }
    return total;
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'OS_RPC' || msg.role !== 'app->os') return;
    const win = [...state.windows.values()].find(w => w.iframe.contentWindow === event.source);
    if (!win) return;
    const { app } = win;
    const reply = (payload) => event.source.postMessage({ type:'OS_RPC', id:msg.id, ...payload, role:'os->app' }, event.origin || '*');

    try {
      const { method, params } = msg;

      if (method === 'shell.alert') {
        alert(String(params?.message ?? ''));
        reply({ result: true }); return;
      }
      if (method === 'shell.openUrl') {
        window.open(String(params?.url ?? ''), '_blank', 'noopener,noreferrer');
        reply({ result: true }); return;
      }

      if (method.startsWith('storage.')) {
        checkPermission(app, 'storage');
        if (method === 'storage.set') {
          const { key, value } = params || {};
          const k = `os:${app.id}:${key}`;
          const projectedSize = storageSizeFor(app.id) - (localStorage.getItem(k)?.length ?? 0) + JSON.stringify(value).length;
          if (projectedSize > STORAGE_SOFT_QUOTA) throw { code: 'EQUOTA', message: 'Soft quota exceeded' };
          localStorage.setItem(k, JSON.stringify(value));
          reply({ result: true }); return;
        }
        if (method === 'storage.get') {
          const { key, fallback = null } = params || {};
          const raw = localStorage.getItem(`os:${app.id}:${key}`);
          reply({ result: raw ? JSON.parse(raw) : fallback }); return;
        }
        if (method === 'storage.list') {
          const prefix = `os:${app.id}:`;
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
          }
          reply({ result: keys.sort() }); return;
        }
        if (method === 'storage.remove') {
          const { key } = params || {};
          localStorage.removeItem(`os:${app.id}:${key}`);
          reply({ result: true }); return;
        }
        if (method === 'storage.quota') {
          reply({ result: { used: storageSizeFor(app.id), softLimit: STORAGE_SOFT_QUOTA } }); return;
        }
      }

      if (method.startsWith('registry.')) {
        checkPermission(app, 'registry');
        if (method === 'registry.list') {
          reply({ result: AppRegistry.list().map(a => ({ ...a, _builtin: undefined })) }); return;
        }
        if (method === 'registry.install') {
          const { manifest } = params || {};
          const ok = AppRegistry.install(manifest);
          reply({ result: ok }); return;
        }
        if (method === 'registry.uninstall') {
          const { appId } = params || {};
          const ok = AppRegistry.uninstall(appId);
          reply({ result: ok }); return;
        }
      }

      throw { code:'ENOMETHOD', message:`Unknown method ${method}` };
    } catch (error) {
      reply({ error });
    }
  });

  return {};
})();

const ProcessManager = (() => {
  function launch(appId) {
    const app = AppRegistry.get(appId);
    if (!app) return alert('App not found: ' + appId);
    const winId = WindowManager.create(app, app.entryUrl);
    const pid = state.nextPid++;
    state.processes.set(pid, { appId, winId });
    return pid;
  }
  return { launch };
})();

window.addEventListener('DOMContentLoaded', () => {
  console.info('WebDesk OS v' + OS_VERSION);
  Desktop.boot();
});
