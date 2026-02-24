(function () {
  const chatEl = document.getElementById('chat');
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('send');
  const clearBtn = document.getElementById('clear');
  const apiBaseEl = document.getElementById('apiBase');
  const saveApiBtn = document.getElementById('saveApi');

  const STORAGE_KEY = 'auto:apiBase';

  function getApiBase() {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function setApiBase(v) {
    localStorage.setItem(STORAGE_KEY, String(v || '').trim());
  }

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;

    const r = document.createElement('div');
    r.className = 'role';
    r.textContent = role;

    const t = document.createElement('div');
    t.className = 'text';
    t.textContent = text;

    div.appendChild(r);
    div.appendChild(t);

    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function callChat(apiBase, messages) {
    const url = apiBase.replace(/\/$/, '') + '/chat';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Chat failed');
    return data;
  }

  async function onSend() {
    const text = (promptEl.value || '').trim();
    if (!text) return;

    const apiBase = getApiBase();
    addMsg('user', text);
    promptEl.value = '';

    if (!apiBase) {
      addMsg('assistant', 'No API base configured.\n\nSet an API base (e.g. https://xxxx.execute-api.us-east-1.amazonaws.com/prod) and try again.');
      return;
    }

    sendBtn.disabled = true;
    try {
      const messages = [{ role: 'user', content: text }];
      const out = await callChat(apiBase, messages);
      addMsg('assistant', out.reply || '(no reply)');
    } catch (e) {
      addMsg('assistant', 'Error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      sendBtn.disabled = false;
    }
  }

  function onClear() {
    chatEl.innerHTML = '';
    addMsg('assistant', 'AUTO ready. Configure API base, then ask Nova to build.');
  }

  apiBaseEl.value = getApiBase();
  saveApiBtn.addEventListener('click', () => {
    setApiBase(apiBaseEl.value);
    addMsg('assistant', 'Saved API base: ' + getApiBase());
  });

  sendBtn.addEventListener('click', onSend);
  clearBtn.addEventListener('click', onClear);

  promptEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  });

  onClear();
})();
