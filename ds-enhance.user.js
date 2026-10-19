// ==UserScript==
// @name         DS Enhance
// @namespace    https://github.com/calendar0917/DeepseekWeb-enhance
// @version      3.3.1
// @description  批量删除、Fork 对话、会话分类、搜索、导出、批量重命名、多提示词注入
// @author       ds-enhance
// @homepageURL  https://github.com/calendar0917/DeepseekWeb-enhance
// @icon         https://fe-static.deepseek.com/chat/favicon.svg
// @match        https://chat.deepseek.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://chat.deepseek.com/api/v0';
  const LS_CATS = 'dse_categories';
  const LS_PROMPT = 'dse_custom_prompt';     // legacy single-prompt key (migration)
  const LS_PROMPTS = 'dse_prompts';           // multi-prompt: [{id, name, content, enabled}]
  const CUSTOM_PROMPT_MARKER = '[自定义提示词]';

  // ═══════════════════════════════════════════════════════════════════
  //  Prompt Injection (runs at document-start, before page scripts)
  // ═══════════════════════════════════════════════════════════════════
  function getEnabledPrompts() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_PROMPTS) || '[]');
      if (Array.isArray(arr) && arr.length) {
        return arr.filter(p => p.enabled).map(p => p.content).filter(Boolean);
      }
    } catch { /* corrupt */ }
    // legacy fallback
    const single = (localStorage.getItem(LS_PROMPT) || '').trim();
    return single ? [single] : [];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  对话切换监控与指纹记忆机制（基于 session_id）
  // ═══════════════════════════════════════════════════════════════════
  let injectedSessions = {}; // { sessionId: signature }

  function getCurrentSessionId() {
    const m = location.pathname.match(/\/s\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  }

  function safeParsePath(url) {
    try {
      if (typeof url === 'string') {
        if (url.startsWith('http') || url.startsWith('//')) return new URL(url).pathname;
        if (url.startsWith('/')) return url.split('?')[0].split('#')[0];
        return new URL(url, location.origin).pathname;
      }
    } catch { /* ignore */ }
    return null;
  }

  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    const newUrl = args[2];
    if (newUrl) {
      const oldPath = location.pathname;
      const newPath = safeParsePath(newUrl);

      if (newPath && oldPath !== newPath) {
        // 切换了房间，但保留旧房间的注入记录
        // 如果是回到首页，不做特殊处理
      }
    }
    return originalPushState.apply(this, args);
  };

  window.addEventListener('popstate', () => {
    // 返回/前进时，不主动清除注入记录，让逻辑自动判断
  });

  // ═══════════════════════════════════════════════════════════════════
  //  注入与修改请求逻辑（修复版）
  // ═══════════════════════════════════════════════════════════════════

  function modifyRequest(bodyStr) {
    const enabled = getEnabledPrompts();
    const currentSignature = enabled.join('\n\n');

    // 如果没有启用的提示词，直接放行
    if (!currentSignature) {
      return bodyStr;
    }

    if (!bodyStr) return bodyStr;

    // 如果已经包含自定义标记，说明已经注入过，直接放行
    if (bodyStr.includes(CUSTOM_PROMPT_MARKER)) {
      return bodyStr;
    }

    const sessionId = getCurrentSessionId();

    // 如果在同一会话中已经注入过相同的提示词，不再重复注入
    if (sessionId && injectedSessions[sessionId] === currentSignature) {
      return bodyStr;
    }

    // 执行注入
    try {
      const parsed = JSON.parse(bodyStr);
      const tagged = `${CUSTOM_PROMPT_MARKER}\n${currentSignature}`;
      let injected = false;

      if (parsed.prompt && typeof parsed.prompt === 'string') {
        parsed.prompt = parsed.prompt + '\n\n' + tagged;
        injected = true;
      }
      if (parsed.messages?.length) {
        const lastIdx = parsed.messages.length - 1;
        if (parsed.messages[lastIdx] && typeof parsed.messages[lastIdx].content === 'string') {
          parsed.messages[lastIdx].content = parsed.messages[lastIdx].content + '\n\n' + tagged;
          injected = true;
        }
      }

      if (injected) {
        // 记录注入状态（绑定到会话）
        if (sessionId) {
          injectedSessions[sessionId] = currentSignature;
        }
        return JSON.stringify(parsed);
      }
    } catch { /* not JSON */ }
    return bodyStr;
  }

  // Hook XHR（修复版：防止内存泄漏）
  const XHRProto = XMLHttpRequest.prototype;
  const _origOpen = XHRProto.open;
  const _origSend = XHRProto.send;
  const _xhrMeta = new WeakMap();

  XHRProto.open = function (method, url, ...rest) {
    _xhrMeta.set(this, { url });
    return _origOpen.apply(this, [method, url, ...rest]);
  };

  XHRProto.send = function (body) {
    const meta = _xhrMeta.get(this);
    if (meta && meta.url.includes('completion') && body) {
      body = modifyRequest(body);
    }
    // 清理元数据，防止潜在的内存泄漏
    if (meta) {
      this.addEventListener('loadend', () => {
        _xhrMeta.delete(this);
      }, { once: true });
    }
    return _origSend.apply(this, [body]);
  };

  // Hook fetch（修复版：不修改原始参数对象）
  const _origFetch = window.fetch;

  window.fetch = async function (...args) {
    const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url;
    if (url && url.includes('completion') && args[1]?.body) {
      const modifiedBody = modifyRequest(args[1].body);
      if (modifiedBody !== args[1].body) {
        // 创建新对象，避免修改原始参数
        args[1] = { ...args[1], body: modifiedBody };
      }
    }
    return _origFetch.apply(this, args);
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Wait for DOM before initializing UI
  // ═══════════════════════════════════════════════════════════════════
  function waitForDOM() {
    return new Promise(resolve => {
      if (document.body) resolve();
      else {
        const observer = new MutationObserver(() => {
          if (document.body) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    });
  }

  waitForDOM().then(() => {

  // ═══════════════════════════════════════════════════════════════════
  //  API（添加重试机制）
  // ═══════════════════════════════════════════════════════════════════
  function getToken() {
    try {
      const raw = localStorage.getItem('userToken');
      if (!raw) return null;
      const p = JSON.parse(raw);
      return typeof p === 'object' ? p.value || p.token || p : p;
    } catch {
      return localStorage.getItem('userToken');
    }
  }

  async function api(path, method = 'GET', body) {
    const token = getToken();
    if (!token) throw new Error('未找到 userToken，请先登录 DeepSeek');
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-App-Version': '2025.04.25'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${path}`, opts);
    if (res.status === 401) throw new Error('登录已过期，请重新登录');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.msg || `API error ${json.code}`);
    return json.data;
  }

  // 带重试的 API 调用
  async function apiWithRetry(path, method, body, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        return await api(path, method, body);
      } catch (e) {
        if (i === retries) throw e;
        // 仅对网络错误进行重试，token 问题不重试
        if (e.message.includes('登录已过期') || e.message.includes('未找到 userToken')) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error('重试失败');
  }

  async function fetchSessionsPage(cursor) {
    const params = new URLSearchParams({ count: '50' });
    if (cursor && cursor.updated_at != null) {
      params.set('lte_cursor.pinned', String(cursor.pinned ? 1 : 0));
      params.set('lte_cursor.updated_at', String(cursor.updated_at));
    }
    return api(`/chat_session/fetch_page?${params.toString()}`);
  }

  function getSessionKey(session) {
    return session?.id || session?.chat_session_id || session?.chatSessionId || session?.session_id || '';
  }

  function getSessionUpdatedAt(session) {
    const candidates = [session?.updated_at, session?.updatedAt, session?.update_time, session?.updateTime];
    for (const value of candidates) {
      if (value == null || value === '') continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function normalizeSession(session) {
    const id = getSessionKey(session);
    const updatedAt = getSessionUpdatedAt(session);
    const normalized = { ...session };
    if (id && !normalized.id) normalized.id = id;
    if (updatedAt != null && normalized.updated_at == null) normalized.updated_at = updatedAt;
    return normalized;
  }

  function buildSessionCursor(session) {
    const updatedAt = getSessionUpdatedAt(session);
    if (updatedAt == null) return null;
    return { pinned: session?.pinned ? 1 : 0, updated_at: updatedAt };
  }

  function cursorKey(cursor) {
    return cursor ? `${cursor.pinned ? 1 : 0}:${cursor.updated_at}` : '__first__';
  }

  async function fetchAllSessions() {
    const sessions = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let cursor = null;

    for (let i = 0; i < 100; i++) {
      const currentCursorKey = cursorKey(cursor);
      if (seenCursors.has(currentCursorKey)) break;
      seenCursors.add(currentCursorKey);

      const data = await fetchSessionsPage(cursor);
      const biz = data?.biz_data;
      const list = Array.isArray(biz?.chat_sessions) ? biz.chat_sessions : [];
      let addedThisPage = 0;
      for (const raw of list) {
        const session = normalizeSession(raw);
        const id = getSessionKey(session);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        sessions.push(session);
        addedThisPage++;
      }

      if (!biz?.has_more || !list.length) break;
      if (!addedThisPage) break;
      const nextCursor = buildSessionCursor(list[list.length - 1]);
      if (!nextCursor) break;
      const nextCursorKey = cursorKey(nextCursor);
      if (nextCursorKey === currentCursorKey) break;
      cursor = nextCursor;
    }

    return sessions;
  }

  const apiDelete = (id) => apiWithRetry('/chat_session/delete', 'POST', { chat_session_id: id });
  const apiDeleteAll = () => apiWithRetry('/chat_session/delete_all', 'POST');
  const apiRename = (id, title) => apiWithRetry('/chat_session/update_title', 'POST', { chat_session_id: id, title });
  const apiHistory = (id) => api(`/chat/history_messages?chat_session_id=${id}`);
  const apiCreateShare = (sid, mids) => api('/share/create', 'POST', { chat_session_id: sid, message_ids: mids });
  const apiForkShare = (shareId) => api('/share/fork', 'POST', { share_id: shareId });

  // ═══════════════════════════════════════════════════════════════════
  //  Categories (localStorage) - 添加数据验证
  // ═══════════════════════════════════════════════════════════════════
  function validateCatData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.categories)) return false;
    if (!data.categories.every(c => c.id && typeof c.name === 'string' && typeof c.color === 'string')) return false;
    if (typeof data.sessionMap !== 'object') return false;
    // 检查 sessionMap 中的分类 ID 是否存在
    const catIds = new Set(data.categories.map(c => c.id));
    for (const [sid, cats] of Object.entries(data.sessionMap)) {
      if (!Array.isArray(cats)) return false;
      if (cats.some(id => !catIds.has(id))) return false; // 有无效分类引用
    }
    return true;
  }

  function loadCats() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_CATS));
      if (raw && validateCatData(raw)) return raw;
      // 数据不合法则重置
      if (raw) localStorage.removeItem(LS_CATS);
    } catch { /* corrupt */ }
    return { categories: [], sessionMap: {} };
  }
  function saveCats(data) { localStorage.setItem(LS_CATS, JSON.stringify(data)); }
  let catData = loadCats();

  function addCategory(name, color) {
    catData.categories.push({ id: 'cat_' + Date.now(), name, color });
    saveCats(catData);
  }
  function removeCategory(catId) {
    catData.categories = catData.categories.filter(c => c.id !== catId);
    for (const sid in catData.sessionMap) {
      catData.sessionMap[sid] = catData.sessionMap[sid].filter(c => c !== catId);
      if (!catData.sessionMap[sid].length) delete catData.sessionMap[sid];
    }
    saveCats(catData);
  }
  function toggleCatSession(sid, catId) {
    if (!catData.sessionMap[sid]) catData.sessionMap[sid] = [];
    const idx = catData.sessionMap[sid].indexOf(catId);
    if (idx >= 0) catData.sessionMap[sid].splice(idx, 1);
    else catData.sessionMap[sid].push(catId);
    if (!catData.sessionMap[sid].length) delete catData.sessionMap[sid];
    saveCats(catData);
  }
  function getSessionCats(sid) { return catData.sessionMap[sid] || []; }
  function filterByCat(sessions, catId) {
    if (!catId) return sessions;
    return sessions.filter(s => (catData.sessionMap[s.id] || []).includes(catId));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════════════
  function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function getSessionId() { return getCurrentSessionId(); }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toast(msg, type = 'info') {
    const colors = { info: '#2a2a3e', success: '#0d3320', error: '#3d0f0f' };
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2000001;background:${colors[type]};color:#eee;padding:12px 22px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.5);font-family:system-ui;transition:opacity .3s;`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CSS（保持不变）
  // ═══════════════════════════════════════════════════════════════════
  const style = document.createElement('style');
  style.textContent = `
    #dse-fab{position:fixed;z-index:999999;width:48px;height:48px;border-radius:50%;background:#2563eb;color:#fff;border:none;font-size:22px;cursor:grab;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(37,99,235,.4);user-select:none;-webkit-user-select:none;touch-action:none}
    #dse-fab:active{cursor:grabbing}
    #dse-fab:hover{transform:scale(1.1);box-shadow:0 4px 20px rgba(37,99,235,.6)}

    #dse-panel{position:fixed;z-index:999998;width:460px;max-height:75vh;background:#16161e;color:#eee;border:1px solid #333;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:system-ui;font-size:14px;display:none;flex-direction:column;overflow:hidden}
    #dse-panel.open{display:flex}
    #dse-panel .hd{padding:14px 18px;border-bottom:1px solid #2a2a3a;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    #dse-panel .hd h3{margin:0;font-size:15px;font-weight:600}
    #dse-panel .hd .cls{background:none;border:none;color:#888;font-size:20px;cursor:pointer;padding:0 4px}
    #dse-panel .hd .cls:hover{color:#fff}

    #dse-tabs{display:flex;border-bottom:1px solid #2a2a3a;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
    #dse-tabs::-webkit-scrollbar{display:none}
    #dse-tabs button{flex:0 0 auto;padding:9px 14px;background:none;border:none;color:#888;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;white-space:nowrap}
    #dse-tabs button.active{color:#7aa2f7;border-bottom-color:#7aa2f7}
    #dse-tabs button:hover{color:#ccc}

    .dse-bd{flex:1;overflow-y:auto;padding:12px 14px}
    .dse-section{display:none}.dse-section.active{display:block}

    .dse-actions{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
    .dse-actions button{padding:6px 12px;border-radius:8px;border:1px solid #444;background:#222;color:#eee;font-size:12px;cursor:pointer;transition:background .15s}
    .dse-actions button:hover{background:#333}
    .dse-actions button.pri{background:#2563eb;border-color:#2563eb;color:#fff}
    .dse-actions button.pri:hover{background:#3b82f6}
    .dse-actions button.dng{background:#7f1d1d;border-color:#991b1b}
    .dse-actions button.dng:hover{background:#991b1b}

    .dse-input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid #444;background:#1a1a28;color:#eee;font-size:13px;box-sizing:border-box;outline:none}
    .dse-input:focus{border-color:#7aa2f7}
    .dse-input::placeholder{color:#555}

    .dse-sel{padding:7px 10px;border:1px solid #444;border-radius:8px;background:#1a1a28;color:#eee;font-size:13px;outline:none}
    .dse-sel option{background:#1a1a28}

    /* session row */
    .dse-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;transition:background .1s}
    .dse-row:hover{background:#1e1e2e}
    .dse-row input[type=checkbox]{width:15px;height:15px;accent-color:#ef4444;cursor:pointer;flex-shrink:0}
    .dse-row .ttl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    .dse-row .dt{font-size:11px;color:#555;flex-shrink:0}
    .dse-row .btn-sm{background:none;border:none;color:#7aa2f7;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px 6px;border-radius:4px;opacity:0;transition:opacity .15s}
    .dse-row:hover .btn-sm{opacity:1}
    .dse-row .btn-sm:hover{background:#1a2a4a}

    /* category dots */
    .dse-cats{display:flex;gap:3px;flex-shrink:0}
    .dse-catdot{width:10px;height:10px;border-radius:50%;cursor:pointer;transition:transform .1s}
    .dse-catdot:hover{transform:scale(1.3)}

    /* cat filter bar */
    .dse-catfilter{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
    .dse-catfilter button{padding:4px 10px;border-radius:12px;border:1px solid #444;background:#222;color:#aaa;font-size:11px;cursor:pointer}
    .dse-catfilter button.active{border-color:#7aa2f7;color:#7aa2f7;background:#1a2a4a}

    /* category management */
    .dse-catmgmt{margin-bottom:12px;padding:10px;background:#1a1a28;border-radius:10px}
    .dse-catmgmt .row{display:flex;gap:6px;margin-bottom:6px;align-items:center}
    .dse-catmgmt .row input[type=color]{width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;background:none}
    .dse-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:11px;cursor:pointer;margin:2px}
    .dse-chip:hover{filter:brightness(1.2)}
    .dse-chip .x{font-size:13px;opacity:.6}.dse-chip .x:hover{opacity:1}

    /* progress */
    .dse-prog{font-size:13px;color:#aaa;padding:8px 0}
    .dse-prog .bar{height:4px;background:#333;border-radius:2px;margin-top:6px;overflow:hidden}
    .dse-prog .bar-i{height:100%;background:#2563eb;border-radius:2px;transition:width .2s}

    /* modal */
    .dse-modal-bg{position:fixed;inset:0;z-index:1000002;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center}
    .dse-modal-box{background:#1a1a28;color:#eee;border-radius:14px;padding:0;min-width:380px;max-width:520px;box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:system-ui;overflow:hidden}
    .dse-modal-box .mhd{padding:16px 20px;border-bottom:1px solid #2a2a3a;font-size:15px;font-weight:600}
    .dse-modal-box .mbd{padding:14px 20px;max-height:360px;overflow-y:auto}
    .dse-modal-box .mft{padding:12px 20px;border-top:1px solid #2a2a3a;display:flex;justify-content:flex-end;gap:8px}
    .dse-modal-box .mft button{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px}
    .dse-modal-box .mft .cancel{background:#333;color:#eee}.dse-modal-box .mft .cancel:hover{background:#444}
    .dse-modal-box .mft .confirm{background:#2563eb;color:#fff;font-weight:600}.dse-modal-box .mft .confirm:hover{background:#3b82f6}
    .dse-msg-row{padding:8px 12px;border-radius:6px;cursor:pointer;display:flex;align-items:flex-start;gap:8px;font-size:13px}
    .dse-msg-row:hover{background:#222238}.dse-msg-row.sel{background:#1a2e50}
    .dse-msg-row .num{color:#7aa2f7;font-weight:600;min-width:30px;font-size:12px}
    .dse-msg-row .preview{color:#aaa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* rename preview */
    .dse-rename-preview{margin:10px 0;font-size:12px}
    .dse-rename-preview .old{color:#888;text-decoration:line-through}
    .dse-rename-preview .arrow{color:#555;margin:0 6px}
    .dse-rename-preview .new{color:#7aa2f7}

    /* prompt cards */
    .dse-pcard{background:#1a1a28;border:1px solid #333;border-radius:10px;padding:10px 12px;margin-bottom:8px;transition:border-color .15s}
    .dse-pcard.disabled{opacity:.5}
    .dse-pcard-hd{display:flex;align-items:center;gap:8px}
    .dse-pcard-hd .pname{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dse-pcard-hd .pname[contenteditable]{outline:1px solid #7aa2f7;border-radius:4px;padding:0 4px}
    .dse-pcard-hd .btn-pc{background:none;border:none;color:#888;cursor:pointer;font-size:12px;padding:2px 6px;border-radius:4px}
    .dse-pcard-hd .btn-pc:hover{color:#eee;background:#333}
    .dse-pcard-hd .btn-pc.dng:hover{color:#f87171;background:#3b1111}
    .dse-pcard-toggle{position:relative;width:32px;height:18px;flex-shrink:0}
    .dse-pcard-toggle input{opacity:0;width:0;height:0;position:absolute}
    .dse-pcard-toggle .slider{position:absolute;inset:0;background:#444;border-radius:9px;cursor:pointer;transition:background .2s}
    .dse-pcard-toggle .slider::before{content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;background:#fff;border-radius:50%;transition:transform .2s}
    .dse-pcard-toggle input:checked+.slider{background:#2563eb}
    .dse-pcard-toggle input:checked+.slider::before{transform:translateX(14px)}
    .dse-pcard-body{display:none;margin-top:8px}
    .dse-pcard-body.open{display:block}
    .dse-pcard-body textarea{width:100%;padding:8px;border-radius:8px;border:1px solid #444;background:#16161e;color:#eee;font-size:12px;resize:vertical;min-height:60px;box-sizing:border-box;outline:none}
    .dse-pcard-body textarea:focus{border-color:#7aa2f7}
    .dse-pcard-body .pfoot{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}


    /* 独立挂载的弹窗（绝不在输入框内部以防被遮挡） */
    .dse-global-dropdown {
      position: fixed;
      background: #2c2c2e;
      border: rgba(255,255,255,.06);
      border-radius: 8px;
      padding: 4px;
      display: none;
      flex-direction: column;
      gap: 2px;
      min-width: 160px;
      max-width: 280px;
      box-shadow: 0 4px 20px rgba(0,0,0,.5);
      z-index: 2147483647;
      max-height: 300px;
      overflow-y: auto;
    }
    .dse-global-dropdown.open { display: flex; }
    .dse-dropdown-item {
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      color: #eee;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background 0.15s;
    }
    .dse-dropdown-item:hover { background: #2a2a3a; }
    .dse-dropdown-item.active { color: #7aa2f7; background: #1a2a4a; }
  `;
  document.head.appendChild(style);

  // ═══════════════════════════════════════════════════════════════════
  //  FAB (draggable)
  // ═══════════════════════════════════════════════════════════════════
  const fab = document.createElement('button');
  fab.id = 'dse-fab';
  fab.innerHTML = '&#9881;';
  fab.title = 'DeepSeek 增强 (可拖动)';
  document.body.appendChild(fab);

  let fabDragged = false, fabSX, fabSY, fabOX, fabOY;
  const DRAG_TH = 5;

  const panel = document.createElement('div');
  panel.id = 'dse-panel';

  function posPanel() {
    const r = fab.getBoundingClientRect();
    let l = r.left;
    const pw = 460;
    if (l + pw > window.innerWidth - 10) l = window.innerWidth - pw - 10;
    if (l < 10) l = 10;
    panel.style.left = l + 'px';
    panel.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    panel.style.top = 'auto';
  }

  fab.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    fabDragged = false; fabSX = e.clientX; fabSY = e.clientY;
    const r = fab.getBoundingClientRect();
    fabOX = e.clientX - r.left; fabOY = e.clientY - r.top;
    const mv = (e) => {
      if (!fabDragged && Math.abs(e.clientX - fabSX) + Math.abs(e.clientY - fabSY) < DRAG_TH) return;
      fabDragged = true;
      fab.style.left = Math.max(0, Math.min(innerWidth - 48, e.clientX - fabOX)) + 'px';
      fab.style.top = Math.max(0, Math.min(innerHeight - 48, e.clientY - fabOY)) + 'px';
      fab.style.bottom = 'auto';
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      if (!fabDragged) { panel.classList.toggle('open'); if (panel.classList.contains('open')) posPanel(); }
      else if (panel.classList.contains('open')) posPanel();
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
    e.preventDefault();
  });

  fab.style.left = '20px';
  fab.style.top = (innerHeight - 68) + 'px';

  // ═══════════════════════════════════════════════════════════════════
  //  Panel HTML
  // ═══════════════════════════════════════════════════════════════════
  panel.innerHTML = `
    <div class="hd"><h3>DeepSeek 增强</h3><button class="cls">&times;</button></div>
    <div id="dse-tabs">
      <button class="active" data-tab="batch">批量删除</button>
      <button data-tab="fork">Fork</button>
      <button data-tab="cats">分类</button>
      <button data-tab="search">搜索</button>
      <button data-tab="export">导出</button>
      <button data-tab="rename">重命名</button>
      <button data-tab="prompt">提示词</button>
    </div>
    <div class="dse-bd">

      <!-- batch delete -->
      <div id="sec-batch" class="dse-section active">
        <div class="dse-actions">
          <button id="batch-load">加载对话列表</button>
          <button id="batch-sel-all">全选</button>
          <button id="batch-desel">取消全选</button>
        </div>
        <div class="dse-actions">
          <button id="batch-del" class="dng">删除选中</button>
          <button id="batch-del-all" class="dng">清空全部</button>
        </div>
        <div id="batch-status" class="dse-prog" style="display:none"></div>
        <div id="batch-list"></div>
      </div>

      <!-- fork -->
      <div id="sec-fork" class="dse-section">
        <div style="margin-bottom:12px">
          <div style="color:#aaa;font-size:13px;margin-bottom:6px">当前对话</div>
          <div id="fork-info" style="font-size:13px;color:#888"></div>
          <div class="dse-actions" style="margin-top:8px">
            <button id="fork-entire">Fork 整个对话</button>
            <button id="fork-pick" class="pri">Fork (选择起点)</button>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #2a2a3a;margin:12px 0">
        <div style="color:#aaa;font-size:13px;margin-bottom:6px">从历史列表 Fork</div>
        <div class="dse-actions"><button id="fork-load">加载对话列表</button></div>
        <div id="fork-list"></div>
      </div>

      <!-- categories -->
      <div id="sec-cats" class="dse-section">
        <div class="dse-catmgmt">
          <div style="color:#aaa;font-size:12px;margin-bottom:8px">管理分类</div>
          <div class="row">
            <input type="text" id="cat-name" class="dse-input" placeholder="分类名称" style="flex:1">
            <input type="color" id="cat-color" value="#3b82f6" style="width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;background:none">
            <button id="cat-add" class="pri" style="padding:6px 14px">添加</button>
          </div>
          <div id="cat-chips"></div>
          <div class="dse-actions" style="margin-top:8px">
            <button id="cat-export-data">导出分类数据</button>
            <button id="cat-import-data">导入分类数据</button>
          </div>
        </div>
        <div class="dse-actions">
          <button id="cat-load">加载对话列表</button>
        </div>
        <div class="dse-catfilter" id="cat-filter-bar"></div>
        <div id="cat-list"></div>
      </div>

      <!-- search -->
      <div id="sec-search" class="dse-section">
        <div class="dse-actions" style="margin-bottom:8px">
          <button id="search-load">加载对话列表</button>
        </div>
        <input type="text" id="search-input" class="dse-input" placeholder="搜索对话标题..." style="margin-bottom:10px">
        <div id="search-count" style="font-size:12px;color:#666;margin-bottom:8px"></div>
        <div id="search-list"></div>
      </div>

      <!-- export -->
      <div id="sec-export" class="dse-section">
        <div class="dse-actions">
          <button id="exp-load">加载对话列表</button>
          <button id="exp-sel-all">全选</button>
          <button id="exp-desel">取消全选</button>
        </div>
        <div class="dse-actions">
          <select id="exp-format" class="dse-sel">
            <option value="json">JSON</option>
            <option value="md">Markdown</option>
          </select>
          <button id="exp-go" class="pri">导出选中</button>
        </div>
        <div id="exp-status" class="dse-prog" style="display:none"></div>
        <div id="exp-list"></div>
      </div>

      <!-- rename -->
      <div id="sec-rename" class="dse-section">
        <div class="dse-actions">
          <button id="rnm-load">加载对话列表</button>
          <button id="rnm-sel-all">全选</button>
          <button id="rnm-desel">取消全选</button>
        </div>
        <div style="margin-bottom:10px">
          <select id="rnm-mode" class="dse-sel" style="margin-bottom:6px">
            <option value="direct">直接重命名</option>
            <option value="prefix">添加前缀</option>
            <option value="suffix">添加后缀</option>
            <option value="replace">查找替换</option>
            <option value="serial">序号命名</option>
          </select>
          <div id="rnm-params"></div>
        </div>
        <div class="dse-actions">
          <button id="rnm-preview">预览</button>
          <button id="rnm-go" class="pri">执行重命名</button>
        </div>
        <div id="rnm-status" class="dse-prog" style="display:none"></div>
        <div id="rnm-preview-area"></div>
        <div id="rnm-list"></div>
      </div>

      <!-- prompt injection -->
      <div id="sec-prompt" class="dse-section">
        <div style="color:#aaa;font-size:13px;margin-bottom:8px">自定义系统提示词（每次对话自动注入，可保存多条）</div>
        <div style="display:flex;gap:6px;margin-bottom:10px">
          <input type="text" id="prompt-name" class="dse-input" placeholder="提示词名称（如：翻译助手）" style="flex:1">
          <button id="prompt-add" class="pri">添加</button>
        </div>
        <div id="prompt-list"></div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('.cls').onclick = () => panel.classList.remove('open');

  // ═══════════════════════════════════════════════════════════════════
  //  Shared state
  // ═══════════════════════════════════════════════════════════════════
  let allSessions = []; // cached, shared across tabs
  const selIds = new Set();
  let activeCatFilter = null;

  async function ensureSessions() {
    if (!allSessions.length) {
      allSessions = await fetchAllSessions();
    }
    return allSessions;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Tab switching
  // ═══════════════════════════════════════════════════════════════════
  panel.querySelectorAll('#dse-tabs button').forEach(btn => {
    btn.onclick = () => {
      panel.querySelectorAll('#dse-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      panel.querySelectorAll('.dse-section').forEach(s => s.classList.remove('active'));
      panel.querySelector(`#sec-${tab}`).classList.add('active');
      if (tab === 'fork') updateForkInfo();
      if (tab === 'cats') { renderCatChips(); renderCatFilterBar(); }
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Session list renderer (shared)
  // ═══════════════════════════════════════════════════════════════════
  function renderList(container, sessions, opts = {}) {
    const { showFork, showCats, onCheck, highlight } = opts;
    container.innerHTML = '';
    if (!sessions.length) { container.innerHTML = '<div style="color:#555;font-size:13px;padding:12px 0">暂无对话</div>'; return; }
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'dse-row';

      if (onCheck) {
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = selIds.has(s.id);
        cb.onchange = () => { if (cb.checked) selIds.add(s.id); else selIds.delete(s.id); };
        row.appendChild(cb);
      }

      if (showCats) {
        const catsDiv = document.createElement('span');
        catsDiv.className = 'dse-cats';
        const sc = getSessionCats(s.id);
        sc.forEach(cid => {
          const cat = catData.categories.find(c => c.id === cid);
          if (!cat) return;
          const dot = document.createElement('span');
          dot.className = 'dse-catdot';
          dot.style.background = cat.color;
          dot.title = cat.name;
          catsDiv.appendChild(dot);
        });
        row.appendChild(catsDiv);
      }

      const ttl = document.createElement('span');
      ttl.className = 'ttl';
      if (highlight) {
        const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        ttl.innerHTML = esc(s.title || '(无标题)').replace(re, '<mark style="background:#2a3a1a;color:#a0ffa0;border-radius:2px;padding:0 2px">$1</mark>');
      } else {
        ttl.textContent = s.title || '(无标题)';
      }

      const dt = document.createElement('span');
      dt.className = 'dt';
      dt.textContent = fmtDate(s.updated_at);

      row.appendChild(ttl);
      row.appendChild(dt);

      if (showFork) {
        const fb = document.createElement('button');
        fb.className = 'btn-sm'; fb.textContent = 'Fork';
        fb.onclick = (e) => { e.stopPropagation(); forkEntire(s.id); };
        row.appendChild(fb);
      }

      // category tag button
      if (showCats) {
        const tb = document.createElement('button');
        tb.className = 'btn-sm'; tb.textContent = '标签';
        tb.style.color = '#aaa';
        tb.onclick = (e) => { e.stopPropagation(); showCatPicker(s.id); };
        row.appendChild(tb);
      }

      container.appendChild(row);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Batch Delete
  // ═══════════════════════════════════════════════════════════════════
  const batchListEl = panel.querySelector('#batch-list');
  const batchStatusEl = panel.querySelector('#batch-status');
  function showBatchProg(t, p) { batchStatusEl.style.display = 'block'; batchStatusEl.innerHTML = `<div>${esc(t)}</div><div class="bar"><div class="bar-i" style="width:${p}%"></div></div>`; }
  function hideBatchProg() { batchStatusEl.style.display = 'none'; }

  panel.querySelector('#batch-load').onclick = async () => {
    try { batchListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>'; allSessions = await fetchAllSessions(); selIds.clear(); renderList(batchListEl, allSessions, { onCheck: true, showCats: true }); toast(`已加载 ${allSessions.length} 条对话`, 'success'); }
    catch (e) { toast(`加载失败: ${e.message}`, 'error'); batchListEl.innerHTML = ''; }
  };
  panel.querySelector('#batch-sel-all').onclick = () => { allSessions.forEach(s => selIds.add(s.id)); renderList(batchListEl, allSessions, { onCheck: true, showCats: true }); };
  panel.querySelector('#batch-desel').onclick = () => { selIds.clear(); renderList(batchListEl, allSessions, { onCheck: true, showCats: true }); };

  panel.querySelector('#batch-del').onclick = async () => {
    if (!selIds.size) { toast('请先选择', 'error'); return; }
    if (!confirm(`确定删除 ${selIds.size} 条对话？不可撤销。`)) return;
    const ids = [...selIds]; let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      showBatchProg(`删除中 ${i + 1}/${ids.length}`, ((i + 1) / ids.length) * 100);
      try { await apiDelete(ids[i]); ok++; } catch { fail++; }
    }
    hideBatchProg(); toast(`完成: 成功 ${ok}, 失败 ${fail}`, ok ? 'success' : 'error');
    allSessions = await fetchAllSessions(); selIds.clear();
    renderList(batchListEl, allSessions, { onCheck: true, showCats: true });
  };

  panel.querySelector('#batch-del-all').onclick = async () => {
    if (!confirm('⚠️ 删除【所有】对话？不可撤销！')) return;
    if (!confirm('再次确认！')) return;
    try { showBatchProg('清空中...', 50); await apiDeleteAll(); hideBatchProg(); toast('已清空', 'success'); allSessions = []; selIds.clear(); renderList(batchListEl, [], {}); }
    catch (e) { hideBatchProg(); toast(`失败: ${e.message}`, 'error'); }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Fork
  // ═══════════════════════════════════════════════════════════════════
  const forkListEl = panel.querySelector('#fork-list');

  function updateForkInfo() {
    const sid = getSessionId();
    panel.querySelector('#fork-info').innerHTML = sid
      ? `<code style="color:#7aa2f7;font-size:12px">${sid}</code>`
      : '<span style="color:#888">未打开对话，请先打开一个对话</span>';
  }

  async function forkEntire(sessionId) {
    if (!confirm('Fork 此对话？将创建一份完整副本。')) return;
    try {
      toast('获取消息中...', 'info');
      const hist = await apiHistory(sessionId);
      const msgs = hist?.biz_data?.chat_messages || [];
      if (!msgs.length) { toast('对话为空', 'error'); return; }
      const mids = msgs.map(m => m.message_id);
      toast('创建分享...', 'info');
      const sd = await apiCreateShare(sessionId, mids);
      const shareId = sd?.biz_data?.share_id;
      if (!shareId) throw new Error('创建分享失败');
      toast('Fork 中...', 'info');
      const fd = await apiForkShare(shareId);
      const newId = fd?.biz_data?.chat_session_id;
      if (!newId) throw new Error('Fork 失败');
      toast('Fork 成功！', 'success');
      setTimeout(() => { location.href = `/a/chat/s/${newId}`; }, 800);
    } catch (e) { toast(`Fork 失败: ${e.message}`, 'error'); }
  }

  function showForkPicker(sessionId, messages) {
    const userMsgs = messages.filter(m => m.role === 'USER' && m.status !== 'in_progress');
    if (!userMsgs.length) { toast('没有用户消息', 'error'); return; }
    let sel = userMsgs.length - 1;
    const bg = document.createElement('div'); bg.className = 'dse-modal-bg';
    bg.innerHTML = `<div class="dse-modal-box"><div class="mhd">选择 Fork 起点</div><div class="mbd"><div id="fp-mode" style="display:flex;gap:14px;margin-bottom:10px;font-size:12px;color:#888"><label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="fp-mode" value="before" checked style="accent-color:#2563eb"> 保留此节点之前(含此节点)</label><label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="fp-mode" value="after" style="accent-color:#2563eb"> 保留此节点之后(含此节点)</label></div><div id="fp-list"></div></div><div class="mft"><button class="cancel">取消</button><button class="confirm">确认 Fork</button></div></div>`;
    const listEl = bg.querySelector('#fp-list');
    userMsgs.forEach((m, i) => {
      const r = document.createElement('div'); r.className = `dse-msg-row ${i === sel ? 'sel' : ''}`;
      r.innerHTML = `<span class="num">#${i + 1}</span><span class="preview">${esc((m.fragments?.[0]?.content || '').substring(0, 120))}</span>`;
      r.onclick = () => { listEl.querySelectorAll('.dse-msg-row').forEach(e => e.classList.remove('sel')); r.classList.add('sel'); sel = i; };
      listEl.appendChild(r);
    });
    bg.querySelector('.cancel').onclick = () => bg.remove();
    bg.onclick = e => { if (e.target === bg) bg.remove(); };
    bg.querySelector('.confirm').onclick = async () => {
      const mode = bg.querySelector('input[name="fp-mode"]:checked')?.value || 'before';
      bg.remove();
      const sm = userMsgs[sel];
      let ids;
      if (mode === 'after') {
        const childMap = new Map();
        for (const m of messages) { if (m.parent_id) { if (!childMap.has(m.parent_id)) childMap.set(m.parent_id, []); childMap.get(m.parent_id).push(m); } }
        ids = [sm.message_id]; let cur = sm;
        while (cur) { const cs = childMap.get(cur.message_id); if (cs && cs.length) { const c = cs[cs.length - 1]; ids.push(c.message_id); cur = c; } else break; }
      } else {
        const mm = new Map(messages.map(m => [m.message_id, m]));
        ids = []; let cur = sm;
        while (cur) { ids.unshift(cur.message_id); cur = cur.parent_id ? mm.get(cur.parent_id) : null; }
        const idx = messages.findIndex(m => m.message_id === sm.message_id);
        if (idx >= 0 && idx + 1 < messages.length) { const n = messages[idx + 1]; if (n.role === 'ASSISTANT' && n.parent_id === sm.message_id) ids.push(n.message_id); }
      }
      try {
        toast('Fork 中...', 'info');
        const sd = await apiCreateShare(sessionId, ids);
        const shareId = sd?.biz_data?.share_id; if (!shareId) throw new Error('创建分享失败');
        const fd = await apiForkShare(shareId);
        const newId = fd?.biz_data?.chat_session_id; if (!newId) throw new Error('Fork 失败');
        toast('Fork 成功！', 'success'); setTimeout(() => { location.href = `/a/chat/s/${newId}`; }, 800);
      } catch (e) { toast(`失败: ${e.message}`, 'error'); }
    };
    document.body.appendChild(bg);
  }

  panel.querySelector('#fork-entire').onclick = () => { const s = getSessionId(); s ? forkEntire(s) : toast('请先打开一个对话', 'error'); };
  panel.querySelector('#fork-pick').onclick = async () => {
    const s = getSessionId();
    if (!s) { toast('请先打开一个对话', 'error'); return; }
    try { toast('加载消息...', 'info'); const h = await apiHistory(s); const m = h?.biz_data?.chat_messages || []; if (!m.length) { toast('对话为空', 'error'); return; } showForkPicker(s, m); }
    catch (e) { toast(`失败: ${e.message}`, 'error'); }
  };
  panel.querySelector('#fork-load').onclick = async () => {
    try { forkListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>'; allSessions = await fetchAllSessions(); renderList(forkListEl, allSessions, { showFork: true, showCats: true }); toast(`已加载 ${allSessions.length} 条`, 'success'); }
    catch (e) { toast(`失败: ${e.message}`, 'error'); forkListEl.innerHTML = ''; }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Categories（包含导入验证）
  // ═══════════════════════════════════════════════════════════════════
  const catListEl = panel.querySelector('#cat-list');
  const catChipsEl = panel.querySelector('#cat-chips');
  const catFilterBar = panel.querySelector('#cat-filter-bar');

  function renderCatChips() {
    catChipsEl.innerHTML = '';
    catData.categories.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'dse-chip';
      chip.style.background = c.color + '22';
      chip.style.color = c.color;
      chip.style.border = `1px solid ${c.color}44`;
      chip.innerHTML = `${esc(c.name)} <span class="x">&times;</span>`;
      chip.querySelector('.x').onclick = (e) => { e.stopPropagation(); if (confirm(`删除分类「${c.name}」？`)) { removeCategory(c.id); renderCatChips(); renderCatFilterBar(); } };
      catChipsEl.appendChild(chip);
    });
  }

  function renderCatFilterBar() {
    catFilterBar.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.textContent = '全部';
    if (!activeCatFilter) allBtn.classList.add('active');
    allBtn.onclick = () => { activeCatFilter = null; renderCatFilterBar(); renderCatListFiltered(); };
    catFilterBar.appendChild(allBtn);
    catData.categories.forEach(c => {
      const btn = document.createElement('button');
      btn.textContent = c.name;
      btn.style.borderColor = c.color;
      if (activeCatFilter === c.id) { btn.classList.add('active'); btn.style.background = c.color + '33'; }
      btn.onclick = () => { activeCatFilter = activeCatFilter === c.id ? null : c.id; renderCatFilterBar(); renderCatListFiltered(); };
      catFilterBar.appendChild(btn);
    });
  }

  function renderCatListFiltered() {
    const filtered = filterByCat(allSessions, activeCatFilter);
    renderList(catListEl, filtered, { showCats: true });
  }

  function showCatPicker(sid) {
    const bg = document.createElement('div'); bg.className = 'dse-modal-bg';
    const box = document.createElement('div'); box.className = 'dse-modal-box';
    box.innerHTML = `<div class="mhd">为对话分配标签</div><div class="mbd" id="cp-list"></div><div class="mft"><button class="cancel">完成</button></div>`;
    bg.appendChild(box); document.body.appendChild(bg);

    const cpList = box.querySelector('#cp-list');
    const sc = getSessionCats(sid);
    catData.categories.forEach(c => {
      const r = document.createElement('div'); r.className = 'dse-msg-row';
      const has = sc.includes(c.id);
      r.innerHTML = `<span style="width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0"></span><span style="flex:1">${esc(c.name)}</span><span style="color:${has ? '#7aa2f7' : '#555'}">${has ? '已选' : ''}</span>`;
      r.onclick = () => { toggleCatSession(sid, c.id); showCatPicker(sid); bg.remove(); };
      cpList.appendChild(r);
    });

    box.querySelector('.cancel').onclick = () => bg.remove();
    bg.onclick = e => { if (e.target === bg) bg.remove(); };
  }

  panel.querySelector('#cat-add').onclick = () => {
    const name = panel.querySelector('#cat-name').value.trim();
    const color = panel.querySelector('#cat-color').value;
    if (!name) { toast('请输入分类名称', 'error'); return; }
    if (catData.categories.some(c => c.name === name)) { toast('分类名称已存在', 'error'); return; }
    addCategory(name, color);
    panel.querySelector('#cat-name').value = '';
    renderCatChips(); renderCatFilterBar();
    toast(`已添加「${name}」`, 'success');
  };

  panel.querySelector('#cat-load').onclick = async () => {
    try { catListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>'; allSessions = await fetchAllSessions(); renderCatFilterBar(); renderCatListFiltered(); toast(`已加载 ${allSessions.length} 条`, 'success'); }
    catch (e) { toast(`失败: ${e.message}`, 'error'); }
  };

  // Import/Export category data（带验证）
  panel.querySelector('#cat-export-data').onclick = () => {
    const json = JSON.stringify(catData, null, 2);
    download('dse-categories.json', json, 'application/json');
    toast('分类数据已导出', 'success');
  };
  panel.querySelector('#cat-import-data').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!validateCatData(data)) {
          toast('导入失败：数据格式不正确或包含无效的分类引用', 'error');
          return;
        }
        catData = data; saveCats(catData);
        renderCatChips(); renderCatFilterBar();
        toast('分类数据已导入', 'success');
      } catch (e) { toast(`导入失败: ${e.message}`, 'error'); }
    };
    inp.click();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Search（添加防抖）
  // ═══════════════════════════════════════════════════════════════════
  const searchListEl = panel.querySelector('#search-list');
  const searchCountEl = panel.querySelector('#search-count');
  const searchInput = panel.querySelector('#search-input');

  panel.querySelector('#search-load').onclick = async () => {
    try { searchListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>'; allSessions = await fetchAllSessions(); doSearch(); toast(`已加载 ${allSessions.length} 条`, 'success'); }
    catch (e) { toast(`失败: ${e.message}`, 'error'); }
  };

  function doSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchCountEl.textContent = `共 ${allSessions.length} 条`; renderList(searchListEl, allSessions, { showCats: true }); return; }
    const matched = allSessions.filter(s => (s.title || '').toLowerCase().includes(q));
    searchCountEl.textContent = `找到 ${matched.length} 条`;
    renderList(searchListEl, matched, { showCats: true, highlight: searchInput.value.trim() });
  }

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(doSearch, 300);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Export
  // ═══════════════════════════════════════════════════════════════════
  const expListEl = panel.querySelector('#exp-list');
  const expStatusEl = panel.querySelector('#exp-status');
  function showExpProg(t, p) { expStatusEl.style.display = 'block'; expStatusEl.innerHTML = `<div>${esc(t)}</div><div class="bar"><div class="bar-i" style="width:${p}%"></div></div>`; }
  function hideExpProg() { expStatusEl.style.display = 'none'; }

  panel.querySelector('#exp-load').onclick = async () => {
    try { expListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>'; allSessions = await fetchAllSessions(); selIds.clear(); renderList(expListEl, allSessions, { onCheck: true, showCats: true }); toast(`已加载 ${allSessions.length} 条`, 'success'); }
    catch (e) { toast(`失败: ${e.message}`, 'error'); }
  };
  panel.querySelector('#exp-sel-all').onclick = () => { allSessions.forEach(s => selIds.add(s.id)); renderList(expListEl, allSessions, { onCheck: true, showCats: true }); };
  panel.querySelector('#exp-desel').onclick = () => { selIds.clear(); renderList(expListEl, allSessions, { onCheck: true, showCats: true }); };

  panel.querySelector('#exp-go').onclick = async () => {
    if (!selIds.size) { toast('请先选择', 'error'); return; }
    const fmt = panel.querySelector('#exp-format').value;
    const ids = [...selIds];
    const results = [];

    for (let i = 0; i < ids.length; i++) {
      showExpProg(`导出中 ${i + 1}/${ids.length}`, ((i + 1) / ids.length) * 100);
      const s = allSessions.find(x => x.id === ids[i]);
      try {
        const h = await apiHistory(ids[i]);
        const msgs = h?.biz_data?.chat_messages || [];
        results.push({ session: s, messages: msgs });
      } catch (e) {
        results.push({ session: s, messages: [], error: e.message });
      }
    }
    hideExpProg();

    const date = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      const json = JSON.stringify(results, null, 2);
      download(`dse-export-${date}.json`, json, 'application/json');
    } else {
      let md = '';
      results.forEach(r => {
        md += `# ${r.session?.title || '(无标题)'}\n\n`;
        md += `- 日期: ${fmtDate(r.session?.updated_at)}\n`;
        md += `- ID: ${r.session?.id}\n\n`;
        if (r.error) { md += `> 导出失败: ${r.error}\n\n`; return; }
        r.messages.forEach(m => {
          const role = m.role === 'USER' ? '**用户**' : '**助手**';
          md += `### ${role}\n\n${m.content || ''}\n\n---\n\n`;
        });
        md += '\n';
      });
      download(`dse-export-${date}.md`, md, 'text/markdown');
    }
    toast(`已导出 ${results.length} 个对话`, 'success');
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Rename
  // ═══════════════════════════════════════════════════════════════════
  const rnmListEl = panel.querySelector('#rnm-list');
  const rnmStatusEl = panel.querySelector('#rnm-status');
  const rnmPreviewEl = panel.querySelector('#rnm-preview-area');
  const rnmMode = panel.querySelector('#rnm-mode');
  const rnmParams = panel.querySelector('#rnm-params');
  function showRnmProg(t, p) { rnmStatusEl.style.display = 'block'; rnmStatusEl.innerHTML = `<div>${esc(t)}</div><div class="bar"><div class="bar-i" style="width:${p}%"></div></div>`; }
  function hideRnmProg() { rnmStatusEl.style.display = 'none'; }

  function renderRenameParams() {
    const mode = rnmMode.value;
    if (mode === 'direct') rnmParams.innerHTML = '<div style="margin-top:4px;font-size:12px;color:#888">选中对话后点击下方「加载选中」，每条会显示一个输入框可直接编辑标题</div>';
    else if (mode === 'prefix') rnmParams.innerHTML = '<input type="text" id="rnm-prefix" class="dse-input" placeholder="输入前缀..." style="margin-top:4px">';
    else if (mode === 'suffix') rnmParams.innerHTML = '<input type="text" id="rnm-suffix" class="dse-input" placeholder="输入后缀..." style="margin-top:4px">';
    else if (mode === 'replace') rnmParams.innerHTML = '<div style="display:flex;gap:6px;margin-top:4px"><input type="text" id="rnm-find" class="dse-input" placeholder="查找"><input type="text" id="rnm-repl" class="dse-input" placeholder="替换为"></div>';
    else if (mode === 'serial') rnmParams.innerHTML = '<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><input type="text" id="rnm-fmt" class="dse-input" placeholder="格式: {n} {title}" value="{n}. {title}" style="flex:1"><span style="font-size:11px;color:#666">可用: {n} {name}</span></div>';
  }
  rnmMode.onchange = () => { renderRenameParams(); rnmPreviewEl.innerHTML = ''; };
  renderRenameParams();

  function getNewTitle(s, idx, mode) {
    const t = s.title || '(无标题)';
    if (mode === 'prefix') { const p = rnmParams.querySelector('#rnm-prefix')?.value || ''; return p + t; }
    if (mode === 'suffix') { const p = rnmParams.querySelector('#rnm-suffix')?.value || ''; return t + p; }
    if (mode === 'replace') {
      const find = rnmParams.querySelector('#rnm-find')?.value || '';
      const repl = rnmParams.querySelector('#rnm-repl')?.value || '';
      if (!find) return t;
      return t.split(find).join(repl);
    }
    if (mode === 'serial') {
      const fmt = rnmParams.querySelector('#rnm-fmt')?.value || '{n}. {title}';
      const n = String(idx + 1).padStart(3, '0');
      return fmt.replace(/\{n\}/g, n).replace(/\{title\}/g, t).replace(/\{name\}/g, t);
    }
    return t;
  }

  function renderDirectRenameList(sessions) {
    rnmListEl.innerHTML = '';
    if (!sessions.length) { rnmListEl.innerHTML = '<div style="color:#555;font-size:13px;padding:12px 0">暂无对话</div>'; return; }
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'dse-row';
      row.style.cursor = 'default';
      const dt = document.createElement('span');
      dt.className = 'dt';
      dt.textContent = fmtDate(s.updated_at);
      dt.style.marginRight = '6px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'dse-input';
      inp.value = s.title || '';
      inp.style.flex = '1';
      inp.dataset.sid = s.id;
      row.appendChild(dt);
      row.appendChild(inp);
      rnmListEl.appendChild(row);
    });
  }

  panel.querySelector('#rnm-load').onclick = async () => {
    try {
      rnmListEl.innerHTML = '<div style="color:#888;padding:8px 0">加载中...</div>';
      allSessions = await fetchAllSessions();
      selIds.clear();
      if (rnmMode.value === 'direct') {
        renderDirectRenameList(allSessions);
      } else {
        renderList(rnmListEl, allSessions, { onCheck: true, showCats: true });
      }
      rnmPreviewEl.innerHTML = '';
      toast(`已加载 ${allSessions.length} 条`, 'success');
    }
    catch (e) { toast(`失败: ${e.message}`, 'error'); }
  };
  panel.querySelector('#rnm-sel-all').onclick = () => {
    if (rnmMode.value === 'direct') return;
    allSessions.forEach(s => selIds.add(s.id)); renderList(rnmListEl, allSessions, { onCheck: true, showCats: true });
  };
  panel.querySelector('#rnm-desel').onclick = () => {
    if (rnmMode.value === 'direct') return;
    selIds.clear(); renderList(rnmListEl, allSessions, { onCheck: true, showCats: true });
  };

  panel.querySelector('#rnm-preview').onclick = () => {
    if (rnmMode.value === 'direct') { toast('直接重命名模式无需预览，直接编辑输入框即可', 'info'); return; }
    if (!selIds.size) { toast('请先选择', 'error'); return; }
    const mode = rnmMode.value;
    const selected = allSessions.filter(s => selIds.has(s.id));
    let html = '';
    selected.forEach((s, i) => {
      const oldT = s.title || '(无标题)';
      const newT = getNewTitle(s, i, mode);
      html += `<div class="dse-rename-preview"><span class="old">${esc(oldT)}</span><span class="arrow">→</span><span class="new">${esc(newT)}</span></div>`;
    });
    rnmPreviewEl.innerHTML = html;
  };

  panel.querySelector('#rnm-go').onclick = async () => {
    const mode = rnmMode.value;

    // Direct rename mode: read from inline inputs
    if (mode === 'direct') {
      const inputs = rnmListEl.querySelectorAll('input[data-sid]');
      if (!inputs.length) { toast('请先点击「加载对话列表」', 'error'); return; }
      const renames = [];
      inputs.forEach(inp => {
        const sid = inp.dataset.sid;
        const newTitle = inp.value.trim();
        const old = allSessions.find(s => s.id === sid);
        if (old && newTitle && newTitle !== (old.title || '')) {
          renames.push({ id: sid, title: newTitle });
        }
      });
      if (!renames.length) { toast('没有需要修改的标题', 'info'); return; }
      if (!confirm(`确定重命名 ${renames.length} 条对话？`)) return;
      let ok = 0, fail = 0;
      for (let i = 0; i < renames.length; i++) {
        showRnmProg(`重命名中 ${i + 1}/${renames.length}`, ((i + 1) / renames.length) * 100);
        try { await apiRename(renames[i].id, renames[i].title); ok++; } catch { fail++; }
      }
      hideRnmProg();
      toast(`完成: 成功 ${ok}, 失败 ${fail}`, ok ? 'success' : 'error');
      allSessions = await fetchAllSessions();
      renderDirectRenameList(allSessions);
      return;
    }

    // Batch modes
    if (!selIds.size) { toast('请先选择', 'error'); return; }
    const selected = allSessions.filter(s => selIds.has(s.id));
    if (!confirm(`确定重命名 ${selected.length} 条对话？`)) return;

    let ok = 0, fail = 0;
    for (let i = 0; i < selected.length; i++) {
      showRnmProg(`重命名中 ${i + 1}/${selected.length}`, ((i + 1) / selected.length) * 100);
      const newT = getNewTitle(selected[i], i, mode);
      try { await apiRename(selected[i].id, newT); ok++; } catch { fail++; }
    }
    hideRnmProg();
    toast(`完成: 成功 ${ok}, 失败 ${fail}`, ok ? 'success' : 'error');
    allSessions = await fetchAllSessions(); selIds.clear();
    renderList(rnmListEl, allSessions, { onCheck: true, showCats: true });
    rnmPreviewEl.innerHTML = '';
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Keyboard shortcut & init
  // ═══════════════════════════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) posPanel();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Prompt Tab (multi-prompt)
  // ═══════════════════════════════════════════════════════════════════
  const promptListEl = panel.querySelector('#prompt-list');
  const promptNameInput = panel.querySelector('#prompt-name');

  function loadPrompts() {
    let arr;
    try { arr = JSON.parse(localStorage.getItem(LS_PROMPTS) || 'null'); } catch { arr = null; }
    if (!Array.isArray(arr)) {
      // migrate legacy single prompt
      const single = (localStorage.getItem(LS_PROMPT) || '').trim();
      arr = single ? [{ id: Date.now(), name: '默认提示词', content: single, enabled: true }] : [];
      localStorage.setItem(LS_PROMPTS, JSON.stringify(arr));
    }
    return arr;
  }

  function savePrompts(arr) {
    localStorage.setItem(LS_PROMPTS, JSON.stringify(arr));
  }

  function renderPromptCards() {
    const prompts = loadPrompts();
    if (!prompts.length) {
      promptListEl.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:20px 0">暂无提示词，输入名称后点击"添加"</div>';
      return;
    }
    promptListEl.innerHTML = prompts.map(p => `
      <div class="dse-pcard${p.enabled ? '' : ' disabled'}" data-id="${p.id}">
        <div class="dse-pcard-hd">
          <label class="dse-pcard-toggle"><input type="checkbox" class="p-toggle" ${p.enabled ? 'checked' : ''}><span class="slider"></span></label>
          <span class="pname">${esc(p.name)}</span>
          <button class="btn-pc p-edit" title="编辑">编辑</button>
          <button class="btn-pc p-rename" title="重命名">重命名</button>
          <button class="btn-pc dng p-del" title="删除">删除</button>
        </div>
        <div class="dse-pcard-body">
          <textarea class="p-content" rows="4">${esc(p.content)}</textarea>
          <div class="pfoot"><button class="pri p-save-content">保存内容</button></div>
        </div>
      </div>
    `).join('');

    // event delegation
    promptListEl.querySelectorAll('.dse-pcard').forEach(card => {
      const id = Number(card.dataset.id);

      card.querySelector('.p-toggle').onchange = (e) => {
        const pList = loadPrompts();
        const p = pList.find(x => x.id === id);
        if (p) { p.enabled = e.target.checked; savePrompts(pList); }
        card.classList.toggle('disabled', !e.target.checked);
        InlinePromptUI.update();
      };

      card.querySelector('.p-edit').onclick = () => {
        card.querySelector('.dse-pcard-body').classList.toggle('open');
      };

      card.querySelector('.p-rename').onclick = () => {
        const nameEl = card.querySelector('.pname');
        nameEl.contentEditable = 'true';
        nameEl.focus();
        const done = () => {
          nameEl.contentEditable = 'false';
          const newName = nameEl.textContent.trim() || '未命名';
          nameEl.textContent = newName;
          const pList = loadPrompts();
          const p = pList.find(x => x.id === id);
          if (p) { p.name = newName; savePrompts(pList); InlinePromptUI.update(); }
        };
        nameEl.onblur = done;
        nameEl.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } };
      };

      card.querySelector('.p-del').onclick = () => {
        if (!confirm('确定删除该提示词？')) return;
        savePrompts(loadPrompts().filter(x => x.id !== id));
        renderPromptCards();
        InlinePromptUI.update();
        toast('提示词已删除', 'info');
      };

      card.querySelector('.p-save-content').onclick = () => {
        const val = card.querySelector('.p-content').value.trim();
        const pList = loadPrompts();
        const p = pList.find(x => x.id === id);
        if (p) { p.content = val; savePrompts(pList); }
        toast('内容已保存', 'success');
        card.querySelector('.dse-pcard-body').classList.remove('open');
      };
    });
  }

  panel.querySelector('#prompt-add').onclick = () => {
    const name = promptNameInput.value.trim();
    if (!name) { toast('请输入提示词名称', 'info'); return; }
    const prompts = loadPrompts();
    prompts.push({ id: Date.now(), name, content: '', enabled: true });
    savePrompts(prompts);
    promptNameInput.value = '';
    renderPromptCards();
    toast('提示词已添加', 'success');
    // auto-expand the new card for editing
    const lastCard = promptListEl.lastElementChild;
    if (lastCard) {
      lastCard.querySelector('.dse-pcard-body').classList.add('open');
      lastCard.querySelector('.p-content').focus();
    }
  };

  renderPromptCards();

  // ═══════════════════════════════════════════════════════════════════
  //  内嵌原生风格自定义提示词切换按钮
  // ═══════════════════════════════════════════════════════════════════
  const InlinePromptUI = {
    btnId: 'dse-inline-btn',
    dropdownId: 'dse-global-dropdown',

    // 初始化全局无遮挡下拉菜单
    init() {
      if (!document.getElementById(this.dropdownId)) {
        const dp = document.createElement('div');
        dp.id = this.dropdownId;
        dp.className = 'dse-global-dropdown';
        document.body.appendChild(dp);

        document.addEventListener('click', (e) => {
          const btn = document.getElementById(this.btnId);
          if (dp.classList.contains('open') && !dp.contains(e.target) && (!btn || !btn.contains(e.target))) {
            dp.classList.remove('open');
          }
        });
      }
    },

    // 寻找原生按钮并动态挂载/矫正位置
    mount() {
      const buttons = Array.from(document.querySelectorAll('.ds-toggle-button, [class*="ds-toggle-button"]'))
        .filter(b => b.id !== this.btnId && typeof b.textContent === 'string');
      const anchorBtn = buttons.find(b =>
        b.textContent.includes('智能搜索') ||
        b.textContent.includes('深度思考') ||
        b.textContent.includes('联网搜索') ||
        b.textContent.includes('DeepThink')
      );
      if (!anchorBtn) return;

      const container = anchorBtn.parentElement;
      let btn = document.getElementById(this.btnId);

      if (!btn) {
        btn = document.createElement('div');
        btn.id = this.btnId;
        // 动态获取当前页面原生按钮的类名，并过滤掉可能存在的"已选中"状态类
        const sourceBtn = container.querySelector('.ds-toggle-button:not([id="dse-inline-btn"])') || anchorBtn;
        btn.className = sourceBtn ? sourceBtn.className.replace(/\b(ds-toggle-button--selected|active)\b/g, '').trim() : 'ds-toggle-button ds-toggle-button--m';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.innerHTML = `
          <div class="ds-icon ds-atom-button__icon" style="font-size: 14px; width: 14px; height: 14px; margin-right: 0px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
            </svg>
          </div>
          <span><span class="_6dbc175 dse-btn-text" style="color: inherit;">指令选择</span></span>
          <div class="ds-focus-ring"></div>
        `;

        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleDropdown(btn);
        };
      }

      // 动态位置矫正：保证我们的按钮永远在所有原生 Toggle 按钮的最后面
      const nativeToggles = Array.from(container.children).filter(c => c.classList.contains('ds-toggle-button') && c.id !== this.btnId);
      const lastNative = nativeToggles[nativeToggles.length - 1];

      if (lastNative && lastNative.nextSibling !== btn) {
        container.insertBefore(btn, lastNative.nextSibling);
      } else if (!lastNative && !container.contains(btn)) {
        container.appendChild(btn);
      }

      this.update();
    },

    // 仅用于更新按钮的文案与激活状态
    update() {
      const btn = document.getElementById(this.btnId);
      if (!btn) return;

      const textEl = btn.querySelector('.dse-btn-text');

      const prompts = loadPrompts();
      const enabled = prompts.filter(p => p.enabled);

      if (enabled.length === 0) {
        if (btn.classList.contains('ds-toggle-button--selected')) {
          btn.classList.remove('ds-toggle-button--selected');
        }
        if (textEl.textContent !== '指令选择') {
          textEl.textContent = '指令选择';
        }
      } else {
        if (!btn.classList.contains('ds-toggle-button--selected')) {
          btn.classList.add('ds-toggle-button--selected');
        }
        const newText = enabled.length === 1 ? enabled[0].name : `${enabled[0].name}等(${enabled.length})`;
        if (textEl.textContent !== newText) {
          textEl.textContent = newText;
        }
      }
    },

    // 展开/收起绝对定位的全局菜单
    toggleDropdown(btnEl) {
      const dp = document.getElementById(this.dropdownId);
      if (!dp) return;

      if (dp.classList.contains('open')) {
        dp.classList.remove('open');
        return;
      }

      this.renderDropdownContent(dp);
      const rect = btnEl.getBoundingClientRect();
      dp.style.left = `${rect.left}px`;
      dp.style.bottom = `${window.innerHeight - rect.top + 8}px`; // 动态定位在按钮正上方
      dp.classList.add('open');
    },

    // 渲染菜单内容
    renderDropdownContent(dp) {
      const prompts = loadPrompts();
      dp.innerHTML = '';
      if (!prompts.length) {
        dp.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:13px;text-align:center;">暂无提示词</div>';
      } else {
        prompts.forEach(p => {
          const item = document.createElement('div');
          item.className = `dse-dropdown-item ${p.enabled ? 'active' : ''}`;
          item.innerHTML = `
            <div style="width:14px;height:14px;border-radius:4px;border:1px solid ${p.enabled ? '#7aa2f7' : '#555'};background:${p.enabled ? '#7aa2f7' : 'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${p.enabled ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
            </div>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.content)}">${esc(p.name)}</span>
          `;
          item.onclick = (e) => {
            e.stopPropagation();
            p.enabled = !p.enabled;
            savePrompts(prompts);
            renderPromptCards();
            this.renderDropdownContent(dp); // 重新渲染下拉列表
            this.update(); // 更新输入框按钮文字与颜色状态
          };
          dp.appendChild(item);
        });
      }

      const div = document.createElement('div');
      div.style.cssText = 'height:1px;background:#333;margin:4px 0;';
      dp.appendChild(div);

      const setBtn = document.createElement('div');
      setBtn.className = 'dse-dropdown-item';
      setBtn.innerHTML = `<span style="text-align:center;width:100%;color:#aaa;">⚙️ 管理提示词</span>`;
      setBtn.onclick = (e) => {
        e.stopPropagation();
        dp.classList.remove('open');
        document.getElementById('dse-panel').classList.add('open');
        posPanel();
      };
      dp.appendChild(setBtn);
    }
  };

  // 初始化与监听器
  InlinePromptUI.init();
  InlinePromptUI.mount();
  setTimeout(() => InlinePromptUI.mount(), 1000);

  // 添加防抖的 MutationObserver，监控并自动矫正节点位置
  let mountTimer = null;
  const domObserver = new MutationObserver(() => {
    if (mountTimer) clearTimeout(mountTimer);
    mountTimer = setTimeout(() => {
      InlinePromptUI.mount();
    }, 50);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[DSE] DeepSeek Chat Enhance v3.3.1 loaded');

  }); // end waitForDOM
})();

/* ═══════════════════════════════════════════════════════════════════
   侧边栏「项目分类」折叠菜单（独立模块 / UI 升级版）
   - 原生 SVG 图标 + 分类管理面板入口
   - 分类右键菜单：加入当前对话 / 重命名 / 删除
   - 不依赖任何哈希 class，全部通过文本 + DOM 结构关系定位
   - 每秒轮询 localStorage.dse_categories，数据变化自动重绘
   - MutationObserver 防抖，React 冲洗后自动补挂
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const FLAG = '__DSE_SIDEBAR_CATS_INSTALLED__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const UI_ID = 'dse-sidebar-cats';
  const STYLE_ID = UI_ID + '-style';
  const MENU_ID = 'dse-cat-context-menu';
  const LS_CATS = 'dse_categories';
  const LS_EXPANDED = 'dse_sidebar_cats_expanded_v1';
  const LS_TITLE_CACHE = 'dse_sidebar_cats_title_cache_v1';

  const emptyState = () => ({ raw: null, categories: [], sessionMap: {}, unavailable: false });

  let state = emptyState();
  let container = null;
  let bodyEl = null;
  let totalEl = null;
  let expanded = loadExpanded();
  let titleCache = loadTitleCache();
  let titleSaveTimer = null;
  let mountTimer = null;
  let lastMountTry = 0;
  let lastTitleScan = 0;
  let pollTimer = null;
  let observer = null;
  let booted = false;
  let contextMenu = null;
  let contextCatId = null;
  let contextListenersBound = false;

  // ═══════════════════════════════════════════════════════════════════
  //  基础工具
  // ═══════════════════════════════════════════════════════════════════
  function norm(value) {
    return String(value == null ? '' : value)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanTitle(value) {
    let t = norm(value);
    if (!t) return '';
    t = t.replace(/^[·•]\s*/, '');
    if (t.length > 180) t = t.slice(0, 180);
    if (t === '开启新对话') return '';
    return t;
  }

  function safeColor(value) {
    const c = String(value == null ? '' : value).trim();
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
    if (/^rgba?\([\d\s.,%]+\)$/i.test(c)) return c;
    return '#6b7280';
  }

  function getCurrentSid() {
    const m = location.href.match(/\/s\/([A-Za-z0-9_-]{8,})/);
    return m ? m[1] : '';
  }

  function loadExpanded() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_EXPANDED) || '[]');
      if (Array.isArray(arr)) {
        return new Set(arr.filter(x => typeof x === 'string'));
      }
    } catch { /* ignore */ }
    return new Set();
  }

  function saveExpanded() {
    try {
      localStorage.setItem(LS_EXPANDED, JSON.stringify([...expanded]));
    } catch { /* ignore */ }
  }

  function loadTitleCache() {
    const out = Object.create(null);
    try {
      const obj = JSON.parse(localStorage.getItem(LS_TITLE_CACHE) || '{}');
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [sid, title] of Object.entries(obj)) {
          if (typeof title === 'string' && title) out[sid] = title;
        }
      }
    } catch { /* ignore */ }
    return out;
  }

  function scheduleTitleSave() {
    if (titleSaveTimer) return;
    titleSaveTimer = setTimeout(() => {
      titleSaveTimer = null;
      try {
        const keys = Object.keys(titleCache);
        if (keys.length > 900) {
          keys.slice(0, keys.length - 900).forEach(k => delete titleCache[k]);
        }
        localStorage.setItem(LS_TITLE_CACHE, JSON.stringify(titleCache));
      } catch { /* ignore */ }
    }, 600);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  读取 / 校验 localStorage 数据
  // ═══════════════════════════════════════════════════════════════════
  function readCats() {
    let raw = null;
    try {
      raw = localStorage.getItem(LS_CATS);
    } catch {
      return { ...emptyState(), unavailable: true };
    }

    if (!raw) return { ...emptyState(), raw: '' };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...emptyState(), raw };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...emptyState(), raw };
    }

    const categories = [];
    const catIds = new Set();
    if (Array.isArray(parsed.categories)) {
      for (const item of parsed.categories) {
        if (!item || typeof item !== 'object') continue;
        if (typeof item.id !== 'string' || !item.id) continue;
        if (typeof item.name !== 'string') continue;
        const id = item.id.trim();
        if (!id || catIds.has(id)) continue;
        catIds.add(id);
        categories.push({
          id,
          name: norm(item.name) || '未命名分类',
          color: safeColor(item.color)
        });
      }
    }

    const sessionMap = Object.create(null);
    if (parsed.sessionMap && typeof parsed.sessionMap === 'object' && !Array.isArray(parsed.sessionMap)) {
      for (const [sid, catList] of Object.entries(parsed.sessionMap)) {
        if (typeof sid !== 'string' || !sid || sid.length > 160) continue;
        if (!Array.isArray(catList)) continue;
        const valid = [...new Set(catList.filter(id => typeof id === 'string' && catIds.has(id)))];
        if (valid.length) sessionMap[sid] = valid;
      }
    }

    return { raw, categories, sessionMap, unavailable: false };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  通过文本定位（绝不依赖 class）
  // ═══════════════════════════════════════════════════════════════════
  function textParents(label) {
    const out = [];
    if (!document.body) return out;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || norm(node.nodeValue) !== label) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('#' + UI_ID) || parent.closest('script,style,noscript')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent) out.push(parent);
    }
    return out;
  }

  function isLeftRegion(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) return false;
    if (r.width > 560 || r.right <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    return r.left < Math.min(window.innerWidth * 0.45, 480);
  }

  function findNewChat() {
    const seen = new Set();
    const list = [];
    const label = '开启新对话';

    for (const parent of textParents(label)) {
      let el = parent.closest('button,[role="button"],a') || parent;
      const elText = norm(el.innerText || el.textContent);
      // 避免 closest 命中了过大的外层容器
      if (!elText.includes(label) || elText.length > 40) el = parent;
      if (el.tagName === 'A' && extractSid(el.getAttribute('href'))) continue;
      if (seen.has(el)) continue;
      if (!isLeftRegion(el)) continue;

      seen.add(el);
      const r = el.getBoundingClientRect();
      list.push({
        el,
        exact: norm(el.innerText || el.textContent) === label ? 1 : 0,
        top: r.top,
        width: r.width
      });
    }

    list.sort((a, b) => (b.exact - a.exact) || (a.top - b.top) || (a.width - b.width));
    return list.length ? list[0].el : null;
  }

  function findHistoryMarker(newChat) {
    const nr = newChat.getBoundingClientRect();
    const labels = ['今天', '昨天', '7 天内', '7天内', '更早'];

    for (const label of labels) {
      const list = [];
      for (const parent of textParents(label)) {
        if (parent.closest('a,button,[role="button"]')) continue;
        if (!isLeftRegion(parent)) continue;
        const r = parent.getBoundingClientRect();
        if (r.bottom <= nr.bottom - 2) continue;
        list.push({ el: parent, top: r.top, height: r.height });
      }
      list.sort((a, b) => (a.top - b.top) || (a.height - b.height));
      if (list.length) return list[0].el;
    }
    return null;
  }

  function commonAncestor(a, b) {
    const set = new Set();
    let node = a;
    while (node && node !== document.documentElement) {
      set.add(node);
      node = node.parentElement;
    }
    node = b;
    while (node && node !== document.documentElement) {
      if (set.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function childUnder(ancestor, el) {
    let node = el;
    while (node && node.parentElement !== ancestor) node = node.parentElement;
    return node && node.parentElement === ancestor ? node : null;
  }

  function isSidebarAncestor(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const r = el.getBoundingClientRect();
    const maxWidth = Math.min(620, window.innerWidth * 0.7);
    return r.width >= 120 && r.width <= maxWidth && r.height >= 80 &&
      r.left < window.innerWidth * 0.5;
  }

  function findMountSpot() {
    const newChat = findNewChat();
    if (!newChat) return null;

    const historyMarker = findHistoryMarker(newChat);
    if (historyMarker) {
      const common = commonAncestor(newChat, historyMarker);
      if (common && common !== document.body && isSidebarAncestor(common)) {
        const newChatBranch = childUnder(common, newChat);
        const historyBranch = childUnder(common, historyMarker);
        if (newChatBranch && historyBranch && newChatBranch !== historyBranch &&
            historyBranch.parentElement === common) {
          // 插在“新对话”和“今天/昨天”之间
          return { parent: common, before: historyBranch };
        }
      }
    }

    // 没有历史标题（例如历史为空）时的降级挂载：
    // 从“开启新对话”向上找到高度合理的块，插在它后面。
    let block = newChat;
    let parent = newChat.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const r = parent.getBoundingClientRect();
      if (r.width > 620 || r.height > 220) break;
      block = parent;
      parent = parent.parentElement;
    }

    const host = block.parentElement;
    if (!host || host === document.body || host === document.documentElement) return null;
    if (host.closest('button,a,[role="button"]')) return null;

    const hr = host.getBoundingClientRect();
    if (hr.width > Math.min(700, window.innerWidth * 0.8)) return null;
    if (hr.left > window.innerWidth * 0.55) return null;

    return { parent: host, before: block.nextSibling };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  标题解析：原脚本 allSessions -> DOM -> 缓存 -> ID 前 6 位
  // ═══════════════════════════════════════════════════════════════════
  function getSharedSessions() {
    // 如果本模块被粘在 waitForDOM 回调内部，这里能直接访问 allSessions
    try {
      if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        return allSessions;
      }
    } catch { /* ignore */ }

    try {
      if (Array.isArray(window.__DSE_ALL_SESSIONS__)) {
        return window.__DSE_ALL_SESSIONS__;
      }
    } catch { /* ignore */ }

    try {
      const api = window.__DSE_ENHANCE__;
      if (api) {
        if (Array.isArray(api.allSessions)) return api.allSessions;
        if (typeof api.getAllSessions === 'function') {
          const sessions = api.getAllSessions();
          if (Array.isArray(sessions)) return sessions;
        }
      }
    } catch { /* ignore */ }

    return [];
  }

  function sharedTitleMap() {
    const map = new Map();
    for (const session of getSharedSessions()) {
      if (!session || typeof session !== 'object') continue;
      const sid = session.id || session.chat_session_id || session.chatSessionId || session.session_id;
      const title = cleanTitle(session.title);
      if (typeof sid === 'string' && sid && title && !map.has(sid)) {
        map.set(sid, title);
      }
    }
    return map;
  }

  function bridgeTitle(sid) {
    try {
      const api = window.__DSE_ENHANCE__;
      if (api && typeof api.getSessionTitle === 'function') {
        const t = cleanTitle(api.getSessionTitle(sid));
        if (t) return t;
      }
      if (typeof window.__DSE_GET_SESSION_TITLE__ === 'function') {
        const t = cleanTitle(window.__DSE_GET_SESSION_TITLE__(sid));
        if (t) return t;
      }
    } catch { /* ignore */ }
    return '';
  }

  function extractSid(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      const m = url.pathname.match(/\/s\/([A-Za-z0-9_-]{8,})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function rememberTitle(sid, title) {
    const t = cleanTitle(title);
    if (!sid || !t || titleCache[sid] === t) return false;
    titleCache[sid] = t;
    scheduleTitleSave();
    return true;
  }

  function scanDomTitles() {
    lastTitleScan = Date.now();
    if (!document.body) return false;
    let changed = false;
    const fromAnchors = new Set();

    document.querySelectorAll('a[href*="/s/"]').forEach(a => {
      if (a.closest('#' + UI_ID)) return;
      const sid = extractSid(a.getAttribute('href'));
      if (!sid) return;
      const title = cleanTitle(a.innerText || a.textContent) || cleanTitle(a.getAttribute('title'));
      if (title) fromAnchors.add(sid);
      if (rememberTitle(sid, title)) changed = true;
    });

    for (const attr of ['data-session-id', 'data-chat-session-id']) {
      document.querySelectorAll('[' + attr + ']').forEach(el => {
        if (el.closest('#' + UI_ID)) return;
        const sid = norm(el.getAttribute(attr));
        if (!/^[A-Za-z0-9_-]{8,160}$/.test(sid)) return;
        if (fromAnchors.has(sid)) return;
        const title = cleanTitle(el.innerText || el.textContent) || cleanTitle(el.getAttribute('title'));
        if (rememberTitle(sid, title)) changed = true;
      });
    }

    return changed;
  }

  function currentPageTitle(sid) {
    if (!sid || getCurrentSid() !== sid) return '';
    let t = norm(document.title || '');
    t = t.replace(/^DeepSeek\s*[-–—|]\s*/i, '').replace(/\s*[-–—|]\s*DeepSeek.*$/i, '');
    if (!t || /^DeepSeek$/i.test(t) || t === '探索未至之境') return '';
    return cleanTitle(t);
  }

  function resolveTitle(sid, sharedMap) {
    const fromShared = sharedMap && sharedMap.get(sid);
    if (fromShared) return fromShared;
    if (titleCache[sid]) return titleCache[sid];
    const fromBridge = bridgeTitle(sid);
    if (fromBridge) return fromBridge;
    const fromPage = currentPageTitle(sid);
    if (fromPage) return fromPage;
    return sid.slice(0, 6);
  }

  function updateVisibleTitles() {
    if (!bodyEl || !bodyEl.isConnected) return;

    const beforeMap = sharedTitleMap();
    let missing = false;
    bodyEl.querySelectorAll('a[data-sid]').forEach(a => {
      const sid = a.dataset.sid;
      if (!beforeMap.has(sid) && !titleCache[sid]) missing = true;
    });

    if (missing && Date.now() - lastTitleScan > 2000) {
      scanDomTitles();
    }

    const sharedMap = sharedTitleMap();
    bodyEl.querySelectorAll('a[data-sid]').forEach(a => {
      const sid = a.dataset.sid;
      if (!sid) return;
      const title = resolveTitle(sid, sharedMap);
      const textEl = a.querySelector('.dse-sc-session-title');
      if (textEl && textEl.textContent !== title) textEl.textContent = title;
      if (a.getAttribute('title') !== title) a.setAttribute('title', title);
      if (textEl) textEl.classList.toggle('is-fallback', title === sid.slice(0, 6));
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════════════════
  const CSS = `
    #dse-sidebar-cats{
      --dse-sc-text:#c7c7ce;
      --dse-sc-muted:#7c7c85;
      --dse-sc-hover:rgba(255,255,255,.055);
      --dse-sc-line:rgba(255,255,255,.06);
      margin:6px 8px 8px;
      padding:7px 5px 5px;
      border:1px solid rgba(255,255,255,.055);
      border-radius:12px;
      background:rgba(255,255,255,.028);
      color:var(--dse-sc-text);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
      font-size:13px;
      line-height:1.45;
      text-align:left;
      box-sizing:border-box;
      width:auto;
      max-width:100%;
      flex:0 0 auto;
      overflow:hidden;
    }
    #dse-sidebar-cats *{box-sizing:border-box}
    #dse-sidebar-cats .dse-sc-head{
      display:flex;align-items:center;gap:6px;
      padding:2px 7px 6px;user-select:none;
    }
    #dse-sidebar-cats .dse-sc-head-main{
      display:flex;align-items:center;gap:6px;
      flex:1 1 auto;min-width:0;
    }
    #dse-sidebar-cats .dse-sc-icon{
      display:inline-flex;align-items:center;justify-content:center;
      flex:0 0 auto;color:#4d6bfe;
    }
    #dse-sidebar-cats .dse-sc-icon svg{display:block;width:14px;height:14px}
    #dse-sidebar-cats .dse-sc-title{
      font-size:12px;font-weight:600;color:#9898a2;
      letter-spacing:.02em;white-space:nowrap;
    }
    #dse-sidebar-cats .dse-sc-total{
      margin-left:auto;font-size:10.5px;color:#62626c;
      background:rgba(255,255,255,.045);padding:1px 6px;
      border-radius:8px;line-height:1.5;
    }
    #dse-sidebar-cats .dse-sc-settings{
      width:22px;height:22px;padding:0;border:0;border-radius:6px;
      display:inline-flex;align-items:center;justify-content:center;
      flex:0 0 auto;background:transparent;color:#6f6f78;
      cursor:pointer;outline:none;
      -webkit-appearance:none;appearance:none;
      transition:background .14s ease,color .14s ease;
    }
    #dse-sidebar-cats .dse-sc-settings svg{display:block;width:14px;height:14px}
    #dse-sidebar-cats .dse-sc-settings:hover{
      background:rgba(255,255,255,.08);color:#9db0ff;
    }
    #dse-sidebar-cats .dse-sc-settings:focus-visible{
      box-shadow:inset 0 0 0 1px rgba(77,107,254,.75);
    }
    #dse-sidebar-cats .dse-sc-body{
      max-height:42vh;
      max-height:min(42vh,420px);
      overflow-y:auto;overflow-x:hidden;
      overscroll-behavior:contain;
      scrollbar-width:thin;
      scrollbar-color:rgba(255,255,255,.16) transparent;
      padding:0 1px;
    }
    #dse-sidebar-cats .dse-sc-body::-webkit-scrollbar{width:5px}
    #dse-sidebar-cats .dse-sc-body::-webkit-scrollbar-thumb{
      background:rgba(255,255,255,.14);border-radius:3px;
    }
    #dse-sidebar-cats .dse-sc-body::-webkit-scrollbar-track{background:transparent}
    #dse-sidebar-cats .dse-sc-cat{margin:1px 0}
    #dse-sidebar-cats .dse-sc-cat-head{
      display:flex;align-items:center;gap:7px;
      min-height:30px;padding:5px 7px;border-radius:8px;
      cursor:pointer;user-select:none;outline:none;
      transition:background .14s ease,color .14s ease;
    }
    #dse-sidebar-cats .dse-sc-cat-head:hover{background:var(--dse-sc-hover)}
    #dse-sidebar-cats .dse-sc-cat-head:focus-visible{
      box-shadow:inset 0 0 0 1px rgba(122,162,247,.65);
    }
    #dse-sidebar-cats .dse-sc-dot{
      width:8px;height:8px;border-radius:50%;flex:0 0 auto;
      box-shadow:0 0 0 3px rgba(255,255,255,.025);
    }
    #dse-sidebar-cats .dse-sc-name{
      flex:1 1 auto;min-width:0;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap;
      font-size:12.5px;color:#bcbcc4;
    }
    #dse-sidebar-cats .dse-sc-count{
      flex:0 0 auto;font-size:10.5px;color:#666670;
      min-width:14px;text-align:right;
    }
    #dse-sidebar-cats .dse-sc-chevron{
      flex:0 0 auto;width:12px;text-align:center;color:#64646e;
      font-size:14px;line-height:1;transition:transform .16s ease;
    }
    #dse-sidebar-cats .dse-sc-cat.is-open > .dse-sc-cat-head .dse-sc-chevron{
      transform:rotate(90deg);
    }
    #dse-sidebar-cats .dse-sc-sessions{
      display:none;margin:1px 0 4px 11px;padding:1px 0 1px 8px;
      border-left:1px solid var(--dse-sc-line);
    }
    #dse-sidebar-cats .dse-sc-cat.is-open > .dse-sc-sessions{display:block}
    #dse-sidebar-cats .dse-sc-session{
      display:flex;align-items:center;gap:6px;
      padding:5px 7px;margin:1px 0;border-radius:7px;
      color:#9696a0;text-decoration:none;
      font-size:12.5px;line-height:1.4;
      transition:background .12s ease,color .12s ease;
    }
    #dse-sidebar-cats .dse-sc-session:hover{
      background:var(--dse-sc-hover);color:#e7e7ec;text-decoration:none;
    }
    #dse-sidebar-cats .dse-sc-session.is-active{
      background:rgba(122,162,247,.10);color:#adc5ff;
    }
    #dse-sidebar-cats .dse-sc-session-title{
      flex:1 1 auto;min-width:0;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap;
    }
    #dse-sidebar-cats .dse-sc-session-title.is-fallback{color:#74747e}
    #dse-sidebar-cats .dse-sc-empty{
      padding:4px 7px 6px;color:#5f5f68;
      font-size:11.5px;line-height:1.5;
    }

    /* 分类右键菜单：挂 body，fixed 定位，参考原生暗色右键菜单 */
    #dse-cat-context-menu{
      position:fixed;
      z-index:2147483647;
      display:none;
      min-width:212px;
      max-width:280px;
      padding:5px;
      background:#2c2c2e;
      color:#e6e6e8;
      border:1px solid rgba(255,255,255,.085);
      border-radius:10px;
      box-shadow:0 12px 32px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
      font-size:13px;
      line-height:1.4;
      text-align:left;
      user-select:none;
      box-sizing:border-box;
    }
    #dse-cat-context-menu.open{display:block}
    #dse-cat-context-menu *{box-sizing:border-box}
    #dse-cat-context-menu .dse-cat-menu-item{
      display:flex;align-items:center;gap:9px;
      width:100%;padding:7px 9px;border:0;border-radius:6px;
      background:transparent;color:#e6e6e8;
      font:inherit;text-align:left;white-space:nowrap;
      cursor:pointer;outline:none;
      -webkit-appearance:none;appearance:none;
      transition:background .1s ease,color .1s ease;
    }
    #dse-cat-context-menu .dse-cat-menu-item:hover{
      background:#3a3a3c;color:#fff;
    }
    #dse-cat-context-menu .dse-cat-menu-item:focus-visible{
      background:#3a3a3c;box-shadow:inset 0 0 0 1px rgba(77,107,254,.55);
    }
    #dse-cat-context-menu .dse-cat-menu-item svg{
      display:block;width:13px;height:13px;flex:0 0 auto;
      color:#94949a;
    }
    #dse-cat-context-menu .dse-cat-menu-sep{
      height:1px;margin:5px 4px;
      background:rgba(255,255,255,.08);
    }
    #dse-cat-context-menu .dse-cat-menu-danger{color:#ff7b7b}
    #dse-cat-context-menu .dse-cat-menu-danger svg{color:#ff7b7b}
    #dse-cat-context-menu .dse-cat-menu-danger:hover{
      background:rgba(255,80,80,.13);color:#ff9b9b;
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DOM 创建 / 挂载
  // ═══════════════════════════════════════════════════════════════════
  function createContainer() {
    const el = document.createElement('div');
    el.id = UI_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '项目分类');
    el.innerHTML =
      '<div class="dse-sc-head">' +
        '<div class="dse-sc-head-main">' +
          '<span class="dse-sc-icon" aria-hidden="true">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path>' +
            '</svg>' +
          '</span>' +
          '<span class="dse-sc-title">项目分类</span>' +
        '</div>' +
        '<span class="dse-sc-total"></span>' +
        '<button type="button" class="dse-sc-settings" title="管理分类" aria-label="管理分类">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
            '<path d="M12 5v14M5 12h14"></path>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="dse-sc-body"></div>';

    el.addEventListener('click', onContainerClick);
    el.addEventListener('keydown', onContainerKeydown);
    el.addEventListener('contextmenu', onContainerContextMenu);
    return el;
  }

  function onContainerClick(e) {
    if (!(e.target instanceof Element)) return;

    const settings = e.target.closest('.dse-sc-settings');
    if (settings && container && container.contains(settings)) {
      e.preventDefault();
      e.stopPropagation();
      openCategoryManager();
      return;
    }

    const head = e.target.closest('.dse-sc-cat-head');
    if (!head || !container || !container.contains(head)) return;
    const item = head.closest('.dse-sc-cat');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    toggleCategory(item.dataset.catId);
  }

  function onContainerContextMenu(e) {
    if (!(e.target instanceof Element)) return;
    const head = e.target.closest('.dse-sc-cat-head');
    if (!head || !container || !container.contains(head)) return;
    const item = head.closest('.dse-sc-cat');
    if (!item || !item.dataset.catId) return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, item.dataset.catId);
  }

  function onContainerKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!(e.target instanceof Element)) return;
    const head = e.target.closest('.dse-sc-cat-head');
    if (!head || e.target !== head || !container || !container.contains(head)) return;
    const item = head.closest('.dse-sc-cat');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    toggleCategory(item.dataset.catId);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  打开原脚本的分类管理面板
  // ═══════════════════════════════════════════════════════════════════
  function openCategoryManager() {
    const panel = document.getElementById('dse-panel');
    if (!panel) {
      console.warn('[DSE] 未找到 #dse-panel，无法打开分类管理');
      return;
    }

    panel.classList.add('open');

    // 复刻原脚本 posPanel 的定位，避免直接加 open 后出现在屏幕左上角
    const fab = document.getElementById('dse-fab');
    if (fab) {
      const r = fab.getBoundingClientRect();
      const pw = 460;
      let left = r.left;
      if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
      if (left < 10) left = 10;
      panel.style.left = left + 'px';
      panel.style.bottom = (window.innerHeight - r.top + 10) + 'px';
      panel.style.top = 'auto';
    }

    const tab = panel.querySelector('#dse-tabs button[data-tab="cats"]') ||
      document.querySelector('#dse-tabs button[data-tab="cats"]');
    if (tab) tab.click();

    // 可选桥接：如果原脚本暴露了 __DSE_RELOAD_CATS__，顺便刷新它的闭包缓存
    try {
      if (typeof window.__DSE_RELOAD_CATS__ === 'function') {
        window.__DSE_RELOAD_CATS__();
      }
    } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  分类右键菜单
  // ═══════════════════════════════════════════════════════════════════
  function ensureContextMenu() {
    if (contextMenu && contextMenu.isConnected) return contextMenu;

    const existed = document.getElementById(MENU_ID);
    if (existed) {
      contextMenu = existed;
      return existed;
    }
    if (!document.body) return null;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML =
      '<button type="button" class="dse-cat-menu-item" data-act="add" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
          '<path d="M12 5v14M5 12h14"></path>' +
        '</svg>' +
        '<span>将当前对话加入此分类</span>' +
      '</button>' +
      '<button type="button" class="dse-cat-menu-item" data-act="rename" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M12 20h9"></path>' +
          '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>' +
        '</svg>' +
        '<span>重命名分类</span>' +
      '</button>' +
      '<div class="dse-cat-menu-sep" role="separator"></div>' +
      '<button type="button" class="dse-cat-menu-item dse-cat-menu-danger" data-act="delete" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M3 6h18"></path>' +
          '<path d="M8 6V4h8v2"></path>' +
          '<path d="M19 6l-1 14H6L5 6"></path>' +
          '<path d="M10 11v6M14 11v6"></path>' +
        '</svg>' +
        '<span>删除分类</span>' +
      '</button>';

    menu.addEventListener('click', onContextMenuClick);
    menu.addEventListener('contextmenu', e => e.preventDefault());
    document.body.appendChild(menu);
    contextMenu = menu;
    return menu;
  }

  function initContextMenu() {
    if (!document.body) return;
    ensureContextMenu();
    if (contextListenersBound) return;
    contextListenersBound = true;

    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('contextmenu', onDocumentContextMenu, true);
    document.addEventListener('keydown', onDocumentKeydown);
    window.addEventListener('resize', hideContextMenu);
    window.addEventListener('scroll', hideContextMenu, true);
  }

  function openContextMenu(x, y, catId) {
    const menu = ensureContextMenu();
    if (!menu) return;

    contextCatId = catId;
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.left = '0px';
    menu.style.top = '0px';

    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    menu.style.left = Math.max(pad, left) + 'px';
    menu.style.top = Math.max(pad, top) + 'px';
    menu.style.visibility = '';
  }

  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.classList.remove('open');
      contextMenu.setAttribute('aria-hidden', 'true');
    }
    contextCatId = null;
  }

  function onDocumentClick(e) {
    if (!contextMenu || !contextMenu.classList.contains('open')) return;
    if (e.target instanceof Node && contextMenu.contains(e.target)) return;
    hideContextMenu();
  }

  function onDocumentContextMenu(e) {
    if (!contextMenu || !contextMenu.classList.contains('open')) return;
    if (e.target instanceof Node && contextMenu.contains(e.target)) return;
    hideContextMenu();
  }

  function onDocumentKeydown(e) {
    if (e.key === 'Escape') hideContextMenu();
  }

  function onContextMenuClick(e) {
    if (!(e.target instanceof Element)) return;
    const item = e.target.closest('.dse-cat-menu-item');
    if (!item || !contextMenu || !contextMenu.contains(item)) return;

    e.preventDefault();
    e.stopPropagation();

    const action = item.dataset.act;
    const catId = contextCatId;
    hideContextMenu();
    if (!catId) return;

    if (action === 'add') addCurrentSessionToCategory(catId);
    else if (action === 'rename') renameCategory(catId);
    else if (action === 'delete') deleteCategory(catId);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  分类数据写入（严格遵循 categories + sessionMap 结构）
  // ═══════════════════════════════════════════════════════════════════
  function readCatsForWrite() {
    try {
      const raw = localStorage.getItem(LS_CATS);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.categories)) {
        return null;
      }
      if (!data.sessionMap || typeof data.sessionMap !== 'object' || Array.isArray(data.sessionMap)) {
        data.sessionMap = {};
      }
      return data;
    } catch {
      return null;
    }
  }

  function writeCatsData(data) {
    try {
      const payload = {
        categories: Array.isArray(data.categories) ? data.categories : [],
        sessionMap: data.sessionMap && typeof data.sessionMap === 'object' && !Array.isArray(data.sessionMap)
          ? data.sessionMap
          : {}
      };
      localStorage.setItem(LS_CATS, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function refreshAfterWrite(openCatId) {
    if (openCatId) {
      expanded.add(openCatId);
      saveExpanded();
    }
    state = readCats();
    render();
  }

  function addCurrentSessionToCategory(catId) {
    const m = location.href.match(/\/s\/([A-Za-z0-9_-]{8,})/);
    const sid = m ? m[1] : '';
    if (!sid) {
      alert('当前不在对话页面，请先打开一个对话再添加。');
      return;
    }

    const data = readCatsForWrite();
    if (!data) {
      alert('读取分类数据失败，请刷新页面后重试。');
      return;
    }
    const cat = data.categories.find(c => c && c.id === catId);
    if (!cat) return;

    const list = Array.isArray(data.sessionMap[sid]) ? data.sessionMap[sid] : [];
    if (!list.includes(catId)) {
      list.push(catId);
      data.sessionMap[sid] = list;
      if (!writeCatsData(data)) {
        alert('保存分类失败，请检查浏览器存储权限。');
        return;
      }
    } else {
      data.sessionMap[sid] = list;
    }

    // 立即展开该分类并重绘，不等 1 秒轮询
    refreshAfterWrite(catId);
  }

  function renameCategory(catId) {
    const initial = readCatsForWrite();
    if (!initial) {
      alert('读取分类数据失败，请刷新页面后重试。');
      return;
    }
    const initialCat = initial.categories.find(c => c && c.id === catId);
    if (!initialCat) return;

    const input = prompt('重命名分类', initialCat.name);
    if (input === null) return;
    const name = input.trim();
    if (!name) {
      alert('分类名称不能为空。');
      return;
    }
    if (name === initialCat.name) return;

    // prompt 期间数据可能被别处修改，重新读取最新数据再写
    const data = readCatsForWrite();
    if (!data) {
      alert('读取分类数据失败，请刷新页面后重试。');
      return;
    }
    const cat = data.categories.find(c => c && c.id === catId);
    if (!cat) return;
    if (data.categories.some(c => c && c.id !== catId && c.name === name)) {
      alert('已存在同名分类。');
      return;
    }

    cat.name = name;
    if (!writeCatsData(data)) {
      alert('保存分类失败，请检查浏览器存储权限。');
      return;
    }
    refreshAfterWrite();
  }

  function deleteCategory(catId) {
    const initial = readCatsForWrite();
    if (!initial) {
      alert('读取分类数据失败，请刷新页面后重试。');
      return;
    }
    const initialCat = initial.categories.find(c => c && c.id === catId);
    if (!initialCat) return;

    if (!confirm('确定删除分类「' + initialCat.name + '」？\n只会删除分类，不会删除对话。')) return;

    const data = readCatsForWrite();
    if (!data) {
      alert('读取分类数据失败，请刷新页面后重试。');
      return;
    }
    if (!data.categories.some(c => c && c.id === catId)) return;

    data.categories = data.categories.filter(c => c && c.id !== catId);
    for (const sid of Object.keys(data.sessionMap)) {
      const list = data.sessionMap[sid];
      if (!Array.isArray(list)) {
        delete data.sessionMap[sid];
        continue;
      }
      const next = list.filter(id => id !== catId);
      if (next.length) data.sessionMap[sid] = next;
      else delete data.sessionMap[sid];
    }

    if (!writeCatsData(data)) {
      alert('保存分类失败，请检查浏览器存储权限。');
      return;
    }

    expanded.delete(catId);
    saveExpanded();
    refreshAfterWrite();
  }

  function ensureMounted() {
    if (!document.body) return false;

    const existing = document.getElementById(UI_ID);
    if (existing && existing.isConnected) {
      const existingBody = existing.querySelector('.dse-sc-body');
      if (existingBody) {
        container = existing;
        bodyEl = existingBody;
        totalEl = existing.querySelector('.dse-sc-total');
        return true;
      }
      // 自己的节点结构被破坏，移除后重建
      existing.remove();
    }

    const now = Date.now();
    if (now - lastMountTry < 400) return false;
    lastMountTry = now;

    injectStyle();
    const spot = findMountSpot();
    if (!spot) return false;

    const el = createContainer();
    try {
      spot.parent.insertBefore(el, spot.before || null);
    } catch {
      return false;
    }

    container = el;
    bodyEl = el.querySelector('.dse-sc-body');
    totalEl = el.querySelector('.dse-sc-total');
    return true;
  }

  function toggleCategory(catId) {
    if (!bodyEl || !catId) return;
    const item = Array.from(bodyEl.querySelectorAll('.dse-sc-cat'))
      .find(el => el.dataset.catId === catId);
    if (!item) return;

    const open = !item.classList.contains('is-open');
    item.classList.toggle('is-open', open);
    const head = item.querySelector('.dse-sc-cat-head');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) expanded.add(catId);
    else expanded.delete(catId);
    saveExpanded();

    if (open) {
      scanDomTitles();
      updateVisibleTitles();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  渲染
  // ═══════════════════════════════════════════════════════════════════
  function makeEmpty(text) {
    const el = document.createElement('div');
    el.className = 'dse-sc-empty';
    el.textContent = text;
    return el;
  }

  function sessionsOf(catId) {
    const out = [];
    for (const [sid, catList] of Object.entries(state.sessionMap)) {
      if (catList.includes(catId)) out.push(sid);
    }
    return out;
  }

  function syncActive() {
    if (!container || !container.isConnected) return;
    const sid = getCurrentSid();
    container.querySelectorAll('a.dse-sc-session').forEach(a => {
      const active = a.dataset.sid === sid;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function render() {
    if (!ensureMounted() || !bodyEl) return;

    const scrollTop = bodyEl.scrollTop;
    scanDomTitles();

    const validIds = new Set(state.categories.map(c => c.id));
    let expandedChanged = false;
    for (const id of [...expanded]) {
      if (!validIds.has(id)) {
        expanded.delete(id);
        expandedChanged = true;
      }
    }
    if (expandedChanged) saveExpanded();

    if (totalEl) totalEl.textContent = state.categories.length ? String(state.categories.length) : '';

    bodyEl.textContent = '';

    if (!state.categories.length) {
      bodyEl.appendChild(makeEmpty(state.unavailable ? '分类数据不可用' : '暂无分类'));
      bodyEl.scrollTop = 0;
      return;
    }

    const sharedMap = sharedTitleMap();
    const currentSid = getCurrentSid();
    const frag = document.createDocumentFragment();

    for (const cat of state.categories) {
      const sids = sessionsOf(cat.id);
      const isOpen = expanded.has(cat.id);

      const catEl = document.createElement('div');
      catEl.className = 'dse-sc-cat' + (isOpen ? ' is-open' : '');
      catEl.dataset.catId = cat.id;

      const head = document.createElement('div');
      head.className = 'dse-sc-cat-head';
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      head.title = '展开 / 收起「' + cat.name + '」';

      const dot = document.createElement('span');
      dot.className = 'dse-sc-dot';
      dot.style.background = cat.color;

      const name = document.createElement('span');
      name.className = 'dse-sc-name';
      name.textContent = cat.name;

      const count = document.createElement('span');
      count.className = 'dse-sc-count';
      count.textContent = String(sids.length);

      const chevron = document.createElement('span');
      chevron.className = 'dse-sc-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';

      head.append(dot, name, count, chevron);

      const sessionsEl = document.createElement('div');
      sessionsEl.className = 'dse-sc-sessions';

      if (!sids.length) {
        sessionsEl.appendChild(makeEmpty('暂无对话'));
      } else {
        for (const sid of sids) {
          const title = resolveTitle(sid, sharedMap);

          const link = document.createElement('a');
          link.className = 'dse-sc-session' + (sid === currentSid ? ' is-active' : '');
          link.dataset.sid = sid;
          link.href = '/a/chat/s/' + encodeURIComponent(sid);
          link.title = title;
          if (sid === currentSid) link.setAttribute('aria-current', 'page');

          const titleEl = document.createElement('span');
          titleEl.className = 'dse-sc-session-title' + (title === sid.slice(0, 6) ? ' is-fallback' : '');
          titleEl.textContent = title;

          link.appendChild(titleEl);
          sessionsEl.appendChild(link);
        }
      }

      catEl.append(head, sessionsEl);
      frag.appendChild(catEl);
    }

    bodyEl.appendChild(frag);
    bodyEl.scrollTop = scrollTop;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  轮询 / 观察
  // ═══════════════════════════════════════════════════════════════════
  function tick(force) {
    if (!document.body) return;
    if (document.hidden && !force) return;

    const hadContainer = !!document.getElementById(UI_ID);
    const mountedNow = ensureMounted();
    const next = readCats();
    const changed = next.raw !== state.raw || next.unavailable !== state.unavailable;
    state = next;

    if ((!hadContainer && mountedNow) || changed || force) {
      render();
    } else {
      // 定期补抓原生列表标题，处理原脚本重命名后的标题变化
      if (container && Date.now() - lastTitleScan > 3000) scanDomTitles();
      updateVisibleTitles();
    }

    syncActive();
  }

  function startObserver() {
    if (!document.body || observer) return;
    observer = new MutationObserver(() => {
      if (!document.body) return;
      if (document.getElementById(UI_ID)) return;
      if (mountTimer) return;
      mountTimer = setTimeout(() => {
        mountTimer = null;
        if (ensureMounted()) render();
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (booted || !document.body) return;
    booted = true;

    injectStyle();
    state = readCats();
    if (ensureMounted()) render();
    initContextMenu();

    startObserver();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => tick(false), 1000);

    // 侧边栏可能比 body 晚出现，补两次
    setTimeout(() => tick(true), 800);
    setTimeout(() => tick(true), 2400);
  }

  function onReady(fn) {
    if (document.body) {
      fn();
      return;
    }
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      fn();
    };
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        run();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) run();
    }, { once: true });
  }

  window.addEventListener('storage', (e) => {
    if (e.key === LS_CATS || e.key === null) tick(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick(true);
  });

  onReady(boot);
})();
