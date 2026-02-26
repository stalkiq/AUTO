(function () {
  const API = "https://pxiaathir6.execute-api.us-east-1.amazonaws.com";
  const WS_PREVIEW = "http://auto-workspaces-016442247702-us-east-1.s3-website-us-east-1.amazonaws.com/workspaces/";
  const STORE = (k) => localStorage.getItem(k) || "";
  const SAVE = (k, v) => localStorage.setItem(k, v || "");

  const $ = (id) => document.getElementById(id);
  const tabsEl = $("tabs");
  const contentEl = $("tabContent");
  const addTabBtn = $("addTab");
  const newTabMenu = $("newTabMenu");
  const sidePanel = $("sidePanel");
  const togglePanelBtn = $("togglePanel");
  const awsBadge = $("awsBadge");
  const runLogEl = $("runLog");

  let tabs = [];
  let activeId = null;
  let tabCounter = 0;

  function log(t) {
    const now = new Date().toLocaleTimeString();
    runLogEl.textContent += "[" + now + "] " + t + "\n";
    runLogEl.scrollTop = runLogEl.scrollHeight;
  }

  async function api(path, payload) {
    const res = await fetch(API + path, {
      method: payload !== undefined ? "POST" : "GET",
      headers: payload !== undefined ? { "Content-Type": "application/json" } : {},
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
    return data;
  }

  async function apiGet(path) {
    const res = await fetch(API + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
    return data;
  }

  // ==================== TAB MANAGEMENT ====================
  function createTab(type, title) {
    tabCounter++;
    const id = "tab_" + tabCounter + "_" + Date.now();
    const tab = {
      id, type,
      title: title || (type === "assistant" ? "Assistant " + tabCounter : "Repo " + tabCounter),
      messages: [],
      workspaceId: null,
      files: [],
      openFile: null,
      editorContent: "",
      dirty: false,
    };
    if (type === "assistant") {
      tab.messages = [{ role: "assistant", text: "Hi! I'm AUTO \u2014 your AI builder.\n\nChat, generate images, analyze repos, or push to GitHub." }];
    }
    tabs.push(tab);
    renderTabs();
    switchTab(id);
    return tab;
  }

  function removeTab(id) {
    tabs = tabs.filter((t) => t.id !== id);
    if (activeId === id) {
      activeId = tabs.length ? tabs[tabs.length - 1].id : null;
    }
    renderTabs();
    renderContent();
    if (!tabs.length) createTab("assistant");
  }

  function switchTab(id) {
    activeId = id;
    renderTabs();
    renderContent();
  }

  function getTab(id) { return tabs.find((t) => t.id === (id || activeId)); }

  function renderTabs() {
    tabsEl.innerHTML = "";
    tabs.forEach((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === activeId ? " active" : "");
      const icon = t.type === "assistant" ? "\uD83E\uDD16" : "\uD83D\uDCC1";
      el.innerHTML =
        '<span class="tab-icon">' + icon + '</span>' +
        '<span class="tab-label">' + t.title + '</span>' +
        '<button class="tab-close">\u00D7</button>';
      el.querySelector(".tab-close").onclick = (e) => { e.stopPropagation(); removeTab(t.id); };
      el.onclick = () => switchTab(t.id);
      tabsEl.appendChild(el);
    });
  }

  // ==================== RENDER CONTENT ====================
  function renderContent() {
    const tab = getTab();
    contentEl.innerHTML = "";
    if (!tab) { contentEl.innerHTML = '<div class="editor-empty">Click + to open a tab</div>'; return; }
    if (tab.type === "assistant") renderAssistant(tab);
    else renderRepo(tab);
  }

  // ==================== ASSISTANT TAB ====================
  function renderAssistant(tab) {
    const view = document.createElement("div");
    view.className = "assistant-view";

    const chat = document.createElement("div");
    chat.className = "chat";
    chat.id = "chat_" + tab.id;
    tab.messages.forEach((m) => appendMsg(chat, m.role, m.text, m.extra));
    view.appendChild(chat);

    const tools = document.createElement("div");
    tools.className = "tools-bar";
    const toolDefs = [
      { label: "GitHub Analyze", fn: () => onGitHub(tab) },
      { label: "GitHub Push", fn: () => onGitHubPush(tab) },
      { label: "Image", fn: () => onImageGen(tab) },
    ];
    toolDefs.forEach((td) => {
      const b = document.createElement("button");
      b.className = "tool-btn";
      b.textContent = td.label;
      b.onclick = td.fn;
      tools.appendChild(b);
    });
    const analyzeLabel = document.createElement("label");
    analyzeLabel.className = "tool-btn";
    analyzeLabel.textContent = "Analyze";
    const fileIn = document.createElement("input");
    fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.hidden = true;
    fileIn.onchange = (e) => { if (e.target.files[0]) onImageUpload(tab, e.target.files[0]); e.target.value = ""; };
    analyzeLabel.appendChild(fileIn);
    tools.appendChild(analyzeLabel);
    view.appendChild(tools);

    const composer = document.createElement("div");
    composer.className = "composer";
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.placeholder = "Ask AUTO anything... (Ctrl+Enter)";
    textarea.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSend(tab, textarea); } };
    composer.appendChild(textarea);
    const actions = document.createElement("div");
    actions.className = "composer-actions";
    const sendBtn = document.createElement("button");
    sendBtn.className = "btn";
    sendBtn.textContent = "Send";
    sendBtn.onclick = () => onSend(tab, textarea);
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn-sm secondary";
    clearBtn.textContent = "Clear";
    clearBtn.onclick = () => { tab.messages = [{ role: "assistant", text: "Chat cleared. Ask me anything!" }]; renderContent(); };
    actions.appendChild(sendBtn);
    actions.appendChild(clearBtn);
    composer.appendChild(actions);
    view.appendChild(composer);

    contentEl.appendChild(view);
    chat.scrollTop = chat.scrollHeight;
  }

  function appendMsg(container, role, text, extra) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    const r = document.createElement("div"); r.className = "role"; r.textContent = role;
    const t = document.createElement("div"); t.className = "text"; t.textContent = text;
    div.appendChild(r); div.appendChild(t);
    if (extra?.image) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + extra.image;
      img.className = "msg-image";
      div.appendChild(img);
    }
    if (role === "assistant" && text && text.length > 15) {
      const sb = document.createElement("button");
      sb.className = "speak-btn"; sb.textContent = "\uD83D\uDD0A"; sb.title = "Read aloud";
      sb.onclick = () => speakText(text, sb);
      div.appendChild(sb);
    }
    container.appendChild(div);
    return div;
  }

  function addMsgToTab(tab, role, text, extra) {
    tab.messages.push({ role, text, extra });
    const chat = document.getElementById("chat_" + tab.id);
    if (chat) {
      appendMsg(chat, role, text, extra);
      chat.scrollTop = chat.scrollHeight;
    }
  }

  function addLoader(tab, label) {
    const chat = document.getElementById("chat_" + tab.id);
    if (!chat) return { remove: () => {} };
    const div = document.createElement("div");
    div.className = "msg assistant loading";
    div.innerHTML = '<div class="role">assistant</div><div class="text">' + (label || "Thinking...") + '</div>';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  // ==================== REPO TAB ====================
  function renderRepo(tab) {
    const view = document.createElement("div");
    view.className = "repo-view";

    const sidebar = document.createElement("div");
    sidebar.className = "repo-sidebar";
    const header = document.createElement("div");
    header.className = "repo-header";
    header.innerHTML = '<div class="repo-title">' + tab.title + '</div>' +
      '<div class="repo-id">' + (tab.workspaceId || "Creating...") + '</div>';
    const ra = document.createElement("div");
    ra.className = "repo-actions";
    const newFileBtn = document.createElement("button");
    newFileBtn.className = "btn-sm"; newFileBtn.textContent = "+ File";
    newFileBtn.onclick = () => onNewFile(tab);
    const previewBtn = document.createElement("button");
    previewBtn.className = "btn-sm secondary"; previewBtn.textContent = "Preview";
    previewBtn.onclick = () => {
      if (tab.workspaceId) window.open(WS_PREVIEW + tab.workspaceId + "/", "_blank");
    };
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn-sm secondary"; refreshBtn.textContent = "\u21BB";
    refreshBtn.onclick = () => loadFiles(tab);
    ra.appendChild(newFileBtn); ra.appendChild(previewBtn); ra.appendChild(refreshBtn);
    header.appendChild(ra);
    sidebar.appendChild(header);

    const fileList = document.createElement("div");
    fileList.className = "file-list";
    fileList.id = "files_" + tab.id;
    tab.files.forEach((f) => {
      const item = document.createElement("div");
      item.className = "file-item" + (f === tab.openFile ? " active" : "");
      item.innerHTML = '<span class="fi-icon">\uD83D\uDCC4</span>' + f;
      item.onclick = () => openFile(tab, f);
      fileList.appendChild(item);
    });
    sidebar.appendChild(fileList);
    view.appendChild(sidebar);

    const main = document.createElement("div");
    main.className = "repo-main";
    if (tab.openFile) {
      const eh = document.createElement("div");
      eh.className = "editor-header";
      eh.innerHTML = '<span class="editor-path">' + tab.openFile + '</span>';
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn-sm";
      saveBtn.textContent = tab.dirty ? "Save *" : "Save";
      saveBtn.onclick = () => saveFile(tab);
      eh.appendChild(saveBtn);
      main.appendChild(eh);

      const editor = document.createElement("textarea");
      editor.className = "editor-area";
      editor.value = tab.editorContent || "";
      editor.spellcheck = false;
      editor.onkeydown = (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const s = editor.selectionStart;
          editor.value = editor.value.substring(0, s) + "  " + editor.value.substring(editor.selectionEnd);
          editor.selectionStart = editor.selectionEnd = s + 2;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); tab.editorContent = editor.value; saveFile(tab); }
      };
      editor.oninput = () => { tab.editorContent = editor.value; tab.dirty = true; };
      main.appendChild(editor);
    } else {
      main.innerHTML = '<div class="editor-empty">Select a file or click "+ File" to create one</div>';
    }
    view.appendChild(main);
    contentEl.appendChild(view);

    if (!tab.workspaceId) initWorkspace(tab);
  }

  async function initWorkspace(tab) {
    try {
      const out = await api("/workspace/create", {});
      tab.workspaceId = out.workspaceId;
      log("Workspace: " + tab.workspaceId);
      renderContent();
    } catch (e) { log("Workspace error: " + (e?.message || "")); }
  }

  async function loadFiles(tab) {
    if (!tab.workspaceId) return;
    try {
      const out = await apiGet("/workspace/list?workspaceId=" + tab.workspaceId);
      tab.files = out.files || [];
      renderContent();
    } catch (e) { log("File list error: " + (e?.message || "")); }
  }

  async function openFile(tab, filePath) {
    tab.openFile = filePath;
    tab.dirty = false;
    try {
      const out = await apiGet("/workspace/read?workspaceId=" + tab.workspaceId + "&filePath=" + encodeURIComponent(filePath));
      tab.editorContent = out.content || "";
    } catch (e) {
      tab.editorContent = "// Error loading file: " + (e?.message || "");
    }
    renderContent();
  }

  async function saveFile(tab) {
    if (!tab.openFile || !tab.workspaceId) return;
    try {
      const ct = tab.openFile.endsWith(".html") ? "text/html; charset=utf-8"
        : tab.openFile.endsWith(".css") ? "text/css; charset=utf-8"
        : tab.openFile.endsWith(".js") ? "application/javascript; charset=utf-8"
        : "text/plain; charset=utf-8";
      await api("/workspace/patch", {
        workspaceId: tab.workspaceId,
        filePath: tab.openFile,
        content: tab.editorContent,
      });
      tab.dirty = false;
      log("Saved: " + tab.openFile);
      renderContent();
    } catch (e) { log("Save error: " + (e?.message || "")); }
  }

  function onNewFile(tab) {
    const name = prompt("File name (e.g. index.html):");
    if (!name) return;
    tab.files.push(name.trim());
    tab.openFile = name.trim();
    tab.editorContent = "";
    tab.dirty = true;
    renderContent();
  }

  // ==================== ASSISTANT ACTIONS ====================
  async function onSend(tab, textarea) {
    const text = (textarea.value || "").trim();
    if (!text) return;
    addMsgToTab(tab, "user", text);
    textarea.value = "";
    const loader = addLoader(tab);
    try {
      const out = await api("/chat", { messages: [{ role: "user", content: text }] });
      loader.remove();
      addMsgToTab(tab, "assistant", out.reply || "(no reply)");
    } catch (e) {
      loader.remove();
      addMsgToTab(tab, "assistant", "Error: " + (e?.message || ""));
    }
  }

  let currentAudio = null;
  async function speakText(text, btn) {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const orig = btn.textContent; btn.textContent = "\u23F3"; btn.disabled = true;
    try {
      const out = await api("/chat/speak", { text });
      if (out.audio) {
        const a = new Audio("data:audio/mpeg;base64," + out.audio);
        currentAudio = a; a.play(); btn.textContent = "\u23F9";
        a.onended = () => { btn.textContent = orig; currentAudio = null; };
      }
    } catch (e) { log("Polly: " + (e?.message || "")); }
    finally { btn.disabled = false; if (btn.textContent === "\u23F3") btn.textContent = orig; }
  }

  async function onGitHub(tab) {
    const url = prompt("GitHub repo URL:");
    if (!url) return;
    addMsgToTab(tab, "user", "Analyze: " + url.trim());
    const loader = addLoader(tab, "Analyzing repo...");
    try {
      const out = await api("/github/analyze", { url: url.trim() });
      loader.remove();
      addMsgToTab(tab, "assistant", out.repo + " (" + out.language + ", " + out.fileCount + " files)\n\n" + out.analysis);
    } catch (e) { loader.remove(); addMsgToTab(tab, "assistant", "Error: " + (e?.message || "")); }
  }

  async function onGitHubPush(tab) {
    const token = ($("githubToken").value || STORE("auto:githubToken")).trim();
    if (!token) { addMsgToTab(tab, "assistant", "Add your GitHub token in Settings first."); return; }
    SAVE("auto:githubToken", token);
    const repo = prompt("Repo URL:"); if (!repo) return;
    const fp = prompt("File path:"); if (!fp) return;
    const content = prompt("Content:"); if (content === null) return;
    const msg = prompt("Commit message:", "Update via AUTO") || "Update via AUTO";
    addMsgToTab(tab, "user", "Push: " + fp);
    const loader = addLoader(tab, "Pushing...");
    try {
      const out = await api("/github/push", { token, repo, path: fp, content, message: msg });
      loader.remove();
      addMsgToTab(tab, "assistant", "Pushed!\n" + out.repo + "/" + out.path + " (" + out.branch + ")\n" + out.htmlUrl);
    } catch (e) { loader.remove(); addMsgToTab(tab, "assistant", "Push failed: " + (e?.message || "")); }
  }

  async function onImageGen(tab) {
    const desc = prompt("Describe the image:"); if (!desc) return;
    addMsgToTab(tab, "user", "Generate: " + desc.trim());
    const loader = addLoader(tab, "Generating...");
    try {
      const out = await api("/image/generate", { prompt: desc.trim() });
      loader.remove();
      if (out.image) addMsgToTab(tab, "assistant", "Generated image:", { image: out.image });
      else addMsgToTab(tab, "assistant", "Failed: " + (out.error || ""));
    } catch (e) { loader.remove(); addMsgToTab(tab, "assistant", "Error: " + (e?.message || "")); }
  }

  async function onImageUpload(tab, file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
      addMsgToTab(tab, "user", "Analyze uploaded image");
      const loader = addLoader(tab, "Analyzing...");
      try {
        const out = await api("/image/analyze", { image: b64 });
        loader.remove();
        addMsgToTab(tab, "assistant", out.analysis || "No analysis");
      } catch (e) { loader.remove(); addMsgToTab(tab, "assistant", "Error: " + (e?.message || "")); }
    };
    reader.readAsDataURL(file);
  }

  // ==================== SETTINGS PANEL ====================
  function initSettings() {
    $("awsAccessKey").value = STORE("auto:awsAccessKey");
    $("awsSecretKey").value = STORE("auto:awsSecretKey");
    $("awsSessionToken").value = STORE("auto:awsSessionToken");
    $("awsRegion").value = STORE("auto:awsRegion") || "us-east-1";
    $("githubToken").value = STORE("auto:githubToken");

    togglePanelBtn.onclick = () => {
      sidePanel.classList.toggle("hidden");
      togglePanelBtn.textContent = sidePanel.classList.contains("hidden") ? "Settings" : "Close";
    };

    $("validateAws").onclick = async () => {
      const btn = $("validateAws"); btn.disabled = true;
      const creds = {
        accessKeyId: $("awsAccessKey").value.trim(),
        secretAccessKey: $("awsSecretKey").value.trim(),
        sessionToken: $("awsSessionToken").value.trim(),
        region: $("awsRegion").value.trim() || "us-east-1",
      };
      ["awsAccessKey", "awsSecretKey", "awsSessionToken", "awsRegion"].forEach((k) => SAVE("auto:" + k, $(k).value));
      try {
        const out = await api("/aws/validate", { awsCredentials: creds });
        awsBadge.textContent = "AWS: " + (out?.identity?.account || "OK");
        awsBadge.className = "aws-badge connected";
        $("awsStatusMsg").textContent = out?.identity?.arn || "Connected";
        $("awsStatusMsg").className = "status-msg ok";
      } catch (e) {
        awsBadge.className = "aws-badge disconnected"; awsBadge.textContent = "AWS: Failed";
        $("awsStatusMsg").textContent = e?.message || "Failed";
        $("awsStatusMsg").className = "status-msg err";
      } finally { btn.disabled = false; }
    };

    const AF = {
      s3_put_object: [{ key: "bucket", label: "Bucket" }, { key: "key", label: "Key" }, { key: "content", label: "Content", type: "textarea" }],
      s3_delete_object: [{ key: "bucket", label: "Bucket" }, { key: "key", label: "Key" }],
      cloudfront_invalidate: [{ key: "distributionId", label: "Distribution ID" }, { key: "paths", label: "Paths (comma)" }],
      dynamodb_put_item: [{ key: "tableName", label: "Table" }, { key: "item", label: "Item JSON", type: "textarea" }],
      lambda_update_env: [{ key: "functionName", label: "Function" }, { key: "environment", label: "Env JSON", type: "textarea" }],
    };

    function renderAF() {
      const form = $("actionForm"); form.innerHTML = "";
      (AF[$("operation").value] || []).forEach((f) => {
        const l = document.createElement("label"); l.textContent = f.label; form.appendChild(l);
        const el = document.createElement(f.type === "textarea" ? "textarea" : "input");
        el.dataset.key = f.key; if (f.type === "textarea") el.rows = 2;
        form.appendChild(el);
      });
    }
    $("operation").onchange = renderAF;
    renderAF();

    $("executeAws").onclick = async () => {
      const btn = $("executeAws"); btn.disabled = true;
      const creds = {
        accessKeyId: $("awsAccessKey").value.trim(),
        secretAccessKey: $("awsSecretKey").value.trim(),
        sessionToken: $("awsSessionToken").value.trim(),
        region: $("awsRegion").value.trim() || "us-east-1",
      };
      const op = $("operation").value;
      const input = {};
      $("actionForm").querySelectorAll("[data-key]").forEach((el) => {
        const k = el.dataset.key; let v = (el.value || "").trim();
        if (k === "paths") input[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
        else if (k === "item" || k === "environment") { try { input[k] = JSON.parse(v); } catch { input[k] = v; } }
        else input[k] = v;
      });
      try {
        const out = await api("/aws/execute", { awsCredentials: creds, operation: op, input });
        $("actionResult").textContent = "OK"; $("actionResult").className = "status-msg ok";
        log(op + ": done");
      } catch (e) {
        $("actionResult").textContent = e?.message || "Failed"; $("actionResult").className = "status-msg err";
      } finally { btn.disabled = false; }
    };
  }

  // ==================== TAB MENU ====================
  addTabBtn.onclick = (e) => {
    const rect = addTabBtn.getBoundingClientRect();
    newTabMenu.style.top = rect.bottom + 4 + "px";
    newTabMenu.style.left = rect.left + "px";
    newTabMenu.classList.toggle("hidden");
  };

  newTabMenu.querySelectorAll(".menu-item").forEach((item) => {
    item.onclick = () => {
      const type = item.dataset.type;
      const name = type === "repo" ? prompt("Workspace name:", "My Project") : null;
      createTab(type, name || undefined);
      newTabMenu.classList.add("hidden");
    };
  });

  document.addEventListener("click", (e) => {
    if (!newTabMenu.contains(e.target) && e.target !== addTabBtn) newTabMenu.classList.add("hidden");
  });

  // ==================== INIT ====================
  initSettings();
  createTab("assistant", "Assistant");
})();
