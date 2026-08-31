// =====================================================================
// mhss-messages.js
// =====================================================================
// Shared "header bell" for the Admin ↔ User notification/messaging
// system. Self-contained: injects its own markup + scoped CSS so it can
// be dropped into dashboard.html's header today and onto any other
// authenticated page later without depending on that page's own
// dropdown/icon-btn implementation. It only relies on the small set of
// CSS custom properties already defined on :root in both dashboard.html
// and user-roles.html (--bg, --surface, --border, --gold, --text,
// --muted, --success, --danger, --warning).
//
// Usage (inside a page's own <script type="module">):
//
//   import { supabase } from './supabaseClient.js';
//   import { initMessageBell } from './mhss-messages.js';
//   const { refresh } = initMessageBell({ supabase, mountEl: document.querySelector('.header-right') });
//
// The bell polls every 60 seconds (matching the dashboard's existing
// 5-minute setInterval(loadDashboard, ...) pattern, just shorter) and
// exposes `refresh()` in case a host page wants to force an update
// (e.g. right after the admin sends a broadcast from notifications.html).
// =====================================================================

const POLL_MS = 60 * 1000;
const SUPER_ADMIN_EMAIL = 'mhssepr@gmail.com';

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mh-msg-wrap{position:relative;display:inline-flex;}
    .mh-msg-btn{
      width:40px;height:40px;flex-shrink:0;border-radius:10px;position:relative;
      display:flex;align-items:center;justify-content:center;
      background:transparent;border:1px solid transparent;color:var(--muted);
      cursor:pointer;transition:background .18s ease,color .18s ease;
    }
    .mh-msg-btn:hover{background:var(--border);color:var(--text);}
    .mh-msg-btn svg{width:19px;height:19px;}
    .mh-msg-dot{
      position:absolute;top:6px;right:6px;min-width:8px;height:8px;border-radius:50%;
      background:var(--danger);border:2px solid var(--surface);
    }
    .mh-msg-panel{
      position:absolute;top:calc(100% + 10px);right:0;
      width:min(360px,92vw);max-height:75vh;overflow:hidden;display:flex;flex-direction:column;
      background:var(--surface);border:1px solid var(--border);border-radius:14px;
      box-shadow:0 20px 50px -20px rgba(0,0,0,.4);z-index:200;
    }
    .mh-msg-panel.hidden{display:none;}
    .mh-msg-head{
      display:flex;align-items:center;gap:.5rem;padding:.75rem .85rem;
      border-bottom:1px solid var(--border);font-size:.78rem;font-weight:800;
      letter-spacing:.03em;text-transform:uppercase;color:var(--muted);
    }
    .mh-msg-back{background:none;border:none;color:var(--gold);cursor:pointer;font-size:.85rem;font-weight:800;padding:0;}
    .mh-msg-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);text-transform:none;letter-spacing:0;}
    .mh-msg-list{overflow-y:auto;flex:1;padding:.35rem;}
    .mh-msg-item{
      display:flex;flex-direction:column;gap:.15rem;padding:.6rem .65rem;border-radius:10px;
      cursor:pointer;text-align:left;width:100%;background:none;border:none;font:inherit;color:inherit;
    }
    .mh-msg-item:hover{background:var(--border);}
    .mh-msg-item-top{display:flex;align-items:center;gap:.4rem;}
    .mh-msg-item-subject{font-size:.82rem;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .mh-msg-item-time{font-size:.68rem;color:var(--muted);flex-shrink:0;}
    .mh-msg-item-snippet{font-size:.75rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .mh-msg-unread-dot{width:7px;height:7px;border-radius:50%;background:var(--gold);flex-shrink:0;}
    .mh-msg-tag{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--gold);}
    .mh-msg-empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.82rem;}
    .mh-msg-thread{overflow-y:auto;flex:1;padding:.75rem .85rem;display:flex;flex-direction:column;gap:.6rem;}
    .mh-msg-bubble{max-width:88%;padding:.55rem .7rem;border-radius:12px;font-size:.8rem;line-height:1.4;}
    .mh-msg-bubble-self{align-self:flex-end;background:var(--gold);color:#17120a;}
    .mh-msg-bubble-other{align-self:flex-start;background:var(--border);color:var(--text);}
    .mh-msg-bubble-meta{font-size:.62rem;opacity:.75;margin-top:.25rem;display:block;}
    .mh-msg-reply{display:flex;gap:.4rem;padding:.6rem;border-top:1px solid var(--border);}
    .mh-msg-reply textarea{
      flex:1;resize:none;min-height:38px;max-height:100px;border-radius:10px;border:1px solid var(--border);
      background:var(--bg);color:var(--text);padding:.5rem .6rem;font:inherit;font-size:.8rem;
    }
    .mh-msg-send{
      border:none;border-radius:10px;background:var(--gold);color:#17120a;font-weight:800;
      padding:0 .9rem;cursor:pointer;font-size:.78rem;flex-shrink:0;
    }
    .mh-msg-send:disabled{opacity:.5;cursor:not-allowed;}
    .mh-msg-status{font-size:.7rem;color:var(--muted);padding:0 .85rem .5rem;}
  `;
  document.head.appendChild(style);
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function relativeTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

async function callNotifFn(supabase, action, payload = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const url = `${supabase.supabaseUrl}/functions/v1/mhss-notifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function senderLabel(msg, thread, callerId, callerIsAdmin) {
  if (msg.sender_id === callerId) return 'You';
  if (callerIsAdmin) return (thread.recipient && thread.recipient.name) || 'User';
  return 'Administrator';
}

function threadDisplaySubject(thread) {
  if (thread.origin_broadcast_id) {
    return `Re: ${thread.origin_broadcast_subject || thread.subject || 'Broadcast'}`;
  }
  return thread.subject || (thread.is_broadcast ? 'Announcement' : 'Message');
}

function threadTagLabel(thread, callerIsAdmin) {
  if (!callerIsAdmin) return thread.is_broadcast ? 'Everyone' : null;
  if (thread.is_broadcast) return 'Everyone';
  return (thread.recipient && thread.recipient.name) || null;
}

/**
 * @param {{supabase: object, mountEl: HTMLElement, insertBefore?: HTMLElement}} opts
 */
export function initMessageBell({ supabase, mountEl, insertBefore = null }) {
  injectStyles();

  let threads = [];
  let callerId = null;
  let callerIsAdmin = false;
  let activeThreadId = null;
  let panelOpen = false;
  let pollTimer = null;

  const wrap = document.createElement('div');
  wrap.className = 'mh-msg-wrap';
  wrap.innerHTML = `
    <button type="button" class="mh-msg-btn" aria-haspopup="true" aria-expanded="false" aria-label="Messages">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H7l-3 3V5Z"/></svg>
      <span class="mh-msg-dot hidden"></span>
    </button>
    <div class="mh-msg-panel hidden" role="menu" aria-label="Messages">
      <div class="mh-msg-head">
        <button type="button" class="mh-msg-back hidden">&larr;</button>
        <span class="mh-msg-title">Messages</span>
      </div>
      <div class="mh-msg-body"></div>
    </div>
  `;

  if (insertBefore && insertBefore.parentNode === mountEl) {
    mountEl.insertBefore(wrap, insertBefore);
  } else {
    mountEl.appendChild(wrap);
  }

  const btn = wrap.querySelector('.mh-msg-btn');
  const dot = wrap.querySelector('.mh-msg-dot');
  const panel = wrap.querySelector('.mh-msg-panel');
  const backBtn = wrap.querySelector('.mh-msg-back');
  const titleEl = wrap.querySelector('.mh-msg-title');
  const bodyEl = wrap.querySelector('.mh-msg-body');

  function setOpen(open) {
    panelOpen = open;
    panel.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) renderActiveView();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!panelOpen);
  });
  document.addEventListener('click', (e) => {
    if (panelOpen && !wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) setOpen(false);
  });
  backBtn.addEventListener('click', () => {
    activeThreadId = null;
    renderActiveView();
  });

  function updateBadge() {
    const anyUnread = threads.some((t) => t.unread);
    dot.classList.toggle('hidden', !anyUnread);
  }

  function renderList() {
    backBtn.classList.add('hidden');
    titleEl.textContent = 'Messages';
    if (!threads.length) {
      bodyEl.innerHTML = '<div class="mh-msg-empty">No messages yet.</div>';
      return;
    }
    const sorted = [...threads].sort((a, b) => {
      const at = a.latest_message ? a.latest_message.created_at : a.created_at;
      const bt = b.latest_message ? b.latest_message.created_at : b.created_at;
      return new Date(bt) - new Date(at);
    });
    const list = document.createElement('div');
    list.className = 'mh-msg-list';
    sorted.forEach((t) => {
      const tag = threadTagLabel(t, callerIsAdmin);
      const snippet = t.latest_message ? t.latest_message.body : '';
      const time = t.latest_message ? t.latest_message.created_at : t.created_at;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'mh-msg-item';
      item.innerHTML = `
        <div class="mh-msg-item-top">
          ${t.unread ? '<span class="mh-msg-unread-dot"></span>' : ''}
          <span class="mh-msg-item-subject">${esc(threadDisplaySubject(t))}</span>
          <span class="mh-msg-item-time">${relativeTime(time)}</span>
        </div>
        ${tag ? `<span class="mh-msg-tag">${esc(tag)}</span>` : ''}
        <span class="mh-msg-item-snippet">${esc(snippet)}</span>
      `;
      item.addEventListener('click', () => openThread(t.id));
      list.appendChild(item);
    });
    bodyEl.innerHTML = '';
    bodyEl.appendChild(list);
  }

  function renderThread(thread) {
    backBtn.classList.remove('hidden');
    titleEl.textContent = threadDisplaySubject(thread);

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.flex = '1';
    container.style.minHeight = '0';

    const msgsEl = document.createElement('div');
    msgsEl.className = 'mh-msg-thread';
    if (!thread.messages || !thread.messages.length) {
      msgsEl.innerHTML = '<div class="mh-msg-empty">No messages in this thread.</div>';
    } else {
      thread.messages.forEach((m) => {
        const mine = m.sender_id === callerId;
        const bubble = document.createElement('div');
        bubble.className = `mh-msg-bubble ${mine ? 'mh-msg-bubble-self' : 'mh-msg-bubble-other'}`;
        bubble.innerHTML = `${esc(m.body)}<span class="mh-msg-bubble-meta">${esc(senderLabel(m, thread, callerId, callerIsAdmin))} &middot; ${relativeTime(m.created_at)}</span>`;
        msgsEl.appendChild(bubble);
      });
    }

    const replyRow = document.createElement('div');
    replyRow.className = 'mh-msg-reply';
    replyRow.innerHTML = `
      <textarea placeholder="Write a reply..." aria-label="Reply"></textarea>
      <button type="button" class="mh-msg-send">Send</button>
    `;
    const textarea = replyRow.querySelector('textarea');
    const sendBtn = replyRow.querySelector('.mh-msg-send');
    const statusEl = document.createElement('div');
    statusEl.className = 'mh-msg-status hidden';

    async function sendReply() {
      const text = textarea.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      statusEl.classList.add('hidden');
      try {
        const result = await callNotifFn(supabase, 'reply', { thread_id: thread.id, body: text });
        textarea.value = '';
        if (result.spun_off_from) {
          statusEl.textContent = 'Sent privately to the admin.';
          statusEl.classList.remove('hidden');
        }
        await refresh();
        const nextId = result.thread ? result.thread.id : thread.id;
        activeThreadId = nextId;
        renderActiveView();
      } catch (err) {
        statusEl.textContent = err.message || 'Could not send reply.';
        statusEl.classList.remove('hidden');
      } finally {
        sendBtn.disabled = false;
      }
    }
    sendBtn.addEventListener('click', sendReply);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    container.appendChild(msgsEl);
    container.appendChild(statusEl);
    container.appendChild(replyRow);
    bodyEl.innerHTML = '';
    bodyEl.appendChild(container);

    if (thread.unread) {
      callNotifFn(supabase, 'mark_read', { thread_id: thread.id }).then(() => {
        thread.unread = false;
        updateBadge();
      }).catch(() => {});
    }
    requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }

  function renderActiveView() {
    if (activeThreadId) {
      const thread = threads.find((t) => t.id === activeThreadId);
      if (thread) { renderThread(thread); return; }
      activeThreadId = null;
    }
    renderList();
  }

  function openThread(id) {
    activeThreadId = id;
    renderActiveView();
  }

  async function refresh() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        callerId = userData.user.id;
        callerIsAdmin = (userData.user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
      }
      const result = await callNotifFn(supabase, 'list_threads');
      threads = result.threads || [];
      updateBadge();
      if (panelOpen) renderActiveView();
    } catch (err) {
      console.error('[mhss-messages] refresh failed:', err.message || err);
    }
  }

  refresh();
  pollTimer = setInterval(refresh, POLL_MS);

  return {
    refresh,
    destroy() { clearInterval(pollTimer); wrap.remove(); },
  };
}