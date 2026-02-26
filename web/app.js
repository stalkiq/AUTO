(function () {
  const DEFAULT_API_BASE = "https://pxiaathir6.execute-api.us-east-1.amazonaws.com";

  const STORAGE = {
    apiBase: "auto:apiBase",
    awsRegion: "auto:awsRegion",
    awsAccessKey: "auto:awsAccessKey",
    awsSecretKey: "auto:awsSecretKey",
    awsSessionToken: "auto:awsSessionToken",
  };

  const $ = (id) => document.getElementById(id);

  const chatEl = $("chat");
  const promptEl = $("prompt");
  const sendBtn = $("send");
  const clearBtn = $("clear");
  const togglePanelBtn = $("togglePanel");
  const sidePanel = $("sidePanel");
  const awsBadge = $("awsBadge");
  const githubBtn = $("githubBtn");
  const githubPushBtn = $("githubPushBtn");
  const imageGenBtn = $("imageGenBtn");
  const imageUpload = $("imageUpload");
  const githubTokenEl = $("githubToken");

  const awsAccessKeyEl = $("awsAccessKey");
  const awsSecretKeyEl = $("awsSecretKey");
  const awsSessionTokenEl = $("awsSessionToken");
  const awsRegionEl = $("awsRegion");
  const validateAwsBtn = $("validateAws");
  const awsStatusMsgEl = $("awsStatusMsg");

  const executeAwsBtn = $("executeAws");
  const operationEl = $("operation");
  const actionFormEl = $("actionForm");
  const actionResultEl = $("actionResult");
  const runLogEl = $("runLog");

  function getApiBase() {
    return (localStorage.getItem(STORAGE.apiBase) || DEFAULT_API_BASE).trim();
  }

  // --- Message rendering ---
  function addMsg(role, text, extra) {
    const div = document.createElement("div");
    div.className = "msg " + role;

    const roleEl = document.createElement("div");
    roleEl.className = "role";
    roleEl.textContent = role;

    const textEl = document.createElement("div");
    textEl.className = "text";
    textEl.textContent = text;

    div.appendChild(roleEl);
    div.appendChild(textEl);

    if (extra?.image) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + extra.image;
      img.className = "msg-image";
      img.alt = "Generated image";
      div.appendChild(img);
    }

    if (role === "assistant" && text && text.length > 10) {
      const speakBtn = document.createElement("button");
      speakBtn.className = "speak-btn";
      speakBtn.textContent = "\u{1F50A}";
      speakBtn.title = "Read aloud (Polly)";
      speakBtn.onclick = () => speakText(text, speakBtn);
      div.appendChild(speakBtn);
    }

    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  function addLoading(label) {
    const div = document.createElement("div");
    div.className = "msg assistant loading";
    div.innerHTML = '<div class="role">assistant</div><div class="text">' + (label || "Thinking...") + '</div>';
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  function log(text) {
    const now = new Date().toLocaleTimeString();
    runLogEl.textContent += "[" + now + "] " + text + "\n";
    runLogEl.scrollTop = runLogEl.scrollHeight;
  }

  function getAwsCredentials() {
    return {
      accessKeyId: (awsAccessKeyEl.value || "").trim(),
      secretAccessKey: (awsSecretKeyEl.value || "").trim(),
      sessionToken: (awsSessionTokenEl.value || "").trim(),
      region: (awsRegionEl.value || "us-east-1").trim(),
    };
  }

  function storeAwsInputs() {
    localStorage.setItem(STORAGE.awsAccessKey, awsAccessKeyEl.value || "");
    localStorage.setItem(STORAGE.awsSecretKey, awsSecretKeyEl.value || "");
    localStorage.setItem(STORAGE.awsSessionToken, awsSessionTokenEl.value || "");
    localStorage.setItem(STORAGE.awsRegion, awsRegionEl.value || "us-east-1");
  }

  async function apiCall(path, payload) {
    const apiBase = getApiBase();
    const res = await fetch(apiBase.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
    return data;
  }

  // --- Polly TTS ---
  let currentAudio = null;
  async function speakText(text, btn) {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const orig = btn.textContent;
    btn.textContent = "\u23F3";
    btn.disabled = true;
    try {
      const out = await apiCall("/chat/speak", { text });
      if (out.audio) {
        const audio = new Audio("data:audio/mpeg;base64," + out.audio);
        currentAudio = audio;
        audio.play();
        btn.textContent = "\u23F9";
        audio.onended = () => { btn.textContent = orig; currentAudio = null; };
        audio.onerror = () => { btn.textContent = orig; currentAudio = null; };
      }
    } catch (e) {
      log("Polly error: " + (e?.message || ""));
    } finally {
      btn.disabled = false;
      if (btn.textContent === "\u23F3") btn.textContent = orig;
    }
  }

  // --- Chat ---
  async function onSend() {
    const text = (promptEl.value || "").trim();
    if (!text) return;
    addMsg("user", text);
    promptEl.value = "";
    sendBtn.disabled = true;
    const loader = addLoading();
    try {
      const out = await apiCall("/chat", { messages: [{ role: "user", content: text }] });
      loader.remove();
      addMsg("assistant", out.reply || "(no reply)");
    } catch (e) {
      loader.remove();
      addMsg("assistant", "Error: " + (e?.message || String(e)));
      log("Chat error: " + (e?.message || ""));
    } finally {
      sendBtn.disabled = false;
      promptEl.focus();
    }
  }

  // --- GitHub analyze ---
  async function onGitHub() {
    const url = prompt("Paste a GitHub repository URL:");
    if (!url || !url.trim()) return;
    addMsg("user", "Analyze this repo: " + url.trim());
    const loader = addLoading("Analyzing GitHub repository...");
    try {
      const out = await apiCall("/github/analyze", { url: url.trim() });
      loader.remove();
      const header = out.repo + " (" + out.language + ", " + out.stars + " stars, " + out.fileCount + " files)\n\n";
      addMsg("assistant", header + out.analysis);
      log("GitHub analyzed: " + out.repo);
    } catch (e) {
      loader.remove();
      addMsg("assistant", "GitHub error: " + (e?.message || String(e)));
      log("GitHub error: " + (e?.message || ""));
    }
  }

  // --- GitHub push ---
  async function onGitHubPush() {
    const token = (githubTokenEl.value || localStorage.getItem("auto:githubToken") || "").trim();
    if (!token) {
      addMsg("assistant", "You need a GitHub token to push files.\n\n1. Click \"Settings\" in the top right\n2. Paste your GitHub Personal Access Token\n3. Then click \"GitHub Push\" again\n\nGet a token at: https://github.com/settings/tokens");
      return;
    }
    localStorage.setItem("auto:githubToken", token);

    const repo = prompt("GitHub repo URL (e.g. https://github.com/you/repo):");
    if (!repo) return;
    const filePath = prompt("File path to create/update (e.g. src/index.js):");
    if (!filePath) return;
    const content = prompt("File content (or paste your code):");
    if (content === null) return;
    const message = prompt("Commit message:", "Update via AUTO") || "Update via AUTO";

    addMsg("user", "Push to " + repo + ": " + filePath);
    const loader = addLoading("Pushing to GitHub...");
    try {
      const out = await apiCall("/github/push", { token, repo, path: filePath, content, message });
      loader.remove();
      addMsg("assistant", "Pushed successfully!\n\nRepo: " + out.repo + "\nFile: " + out.path + "\nBranch: " + out.branch + "\nCommit: " + out.sha.slice(0, 7) + "\n\nView: " + out.htmlUrl);
      log("GitHub push: " + out.path + " -> " + out.repo);
    } catch (e) {
      loader.remove();
      addMsg("assistant", "Push failed: " + (e?.message || String(e)));
      log("GitHub push error: " + (e?.message || ""));
    }
  }

  // --- Image generation ---
  async function onImageGen() {
    const desc = prompt("Describe the image you want to generate:");
    if (!desc || !desc.trim()) return;
    addMsg("user", "Generate image: " + desc.trim());
    const loader = addLoading("Generating image with Nova Canvas...");
    try {
      const out = await apiCall("/image/generate", { prompt: desc.trim() });
      loader.remove();
      if (out.image) {
        addMsg("assistant", "Here's your generated image:", { image: out.image });
      } else {
        addMsg("assistant", "Image generation failed: " + (out.error || "unknown"));
      }
      log("Image generated");
    } catch (e) {
      loader.remove();
      addMsg("assistant", "Image error: " + (e?.message || String(e)));
      log("Image gen error: " + (e?.message || ""));
    }
  }

  // --- Image analysis ---
  async function onImageUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
      const preview = document.createElement("img");
      preview.src = reader.result;
      preview.className = "msg-image";

      const userDiv = addMsg("user", "Analyze this image:");
      userDiv.appendChild(preview);

      const loader = addLoading("Analyzing image with Nova...");
      try {
        const out = await apiCall("/image/analyze", { image: b64 });
        loader.remove();
        addMsg("assistant", out.analysis || "(no analysis)");
        log("Image analyzed");
      } catch (e) {
        loader.remove();
        addMsg("assistant", "Analysis error: " + (e?.message || String(e)));
        log("Image analysis error: " + (e?.message || ""));
      }
    };
    reader.readAsDataURL(file);
  }

  // --- AWS Validate ---
  async function onValidateAws() {
    validateAwsBtn.disabled = true;
    awsStatusMsgEl.textContent = "Connecting...";
    awsStatusMsgEl.className = "status-msg";
    try {
      storeAwsInputs();
      const creds = getAwsCredentials();
      if (!creds.accessKeyId || !creds.secretAccessKey) throw new Error("Enter Access Key ID and Secret Access Key");
      const out = await apiCall("/aws/validate", { awsCredentials: creds });
      awsBadge.textContent = "AWS: " + (out?.identity?.account || "Connected");
      awsBadge.className = "aws-badge connected";
      awsStatusMsgEl.textContent = "Connected as " + (out?.identity?.arn || "unknown");
      awsStatusMsgEl.className = "status-msg ok";
      log("AWS connected: " + (out?.identity?.arn || ""));
    } catch (e) {
      awsBadge.textContent = "AWS: Failed";
      awsBadge.className = "aws-badge disconnected";
      awsStatusMsgEl.textContent = "Failed: " + (e?.message || String(e));
      awsStatusMsgEl.className = "status-msg err";
      log("AWS validate failed: " + (e?.message || ""));
    } finally {
      validateAwsBtn.disabled = false;
    }
  }

  // --- AWS Execute ---
  const ACTION_FIELDS = {
    s3_put_object: [
      { key: "bucket", label: "Bucket name", placeholder: "my-bucket" },
      { key: "key", label: "File path (key)", placeholder: "folder/file.txt" },
      { key: "content", label: "File content", placeholder: "Hello world", type: "textarea" },
    ],
    s3_delete_object: [
      { key: "bucket", label: "Bucket name", placeholder: "my-bucket" },
      { key: "key", label: "File path (key)", placeholder: "folder/file.txt" },
    ],
    cloudfront_invalidate: [
      { key: "distributionId", label: "Distribution ID", placeholder: "E1EXAMPLE" },
      { key: "paths", label: "Paths (comma-separated)", placeholder: "/*" },
    ],
    dynamodb_put_item: [
      { key: "tableName", label: "Table name", placeholder: "my-table" },
      { key: "item", label: "Item (JSON)", placeholder: '{"pk":"id1","sk":"meta"}', type: "textarea" },
    ],
    lambda_update_env: [
      { key: "functionName", label: "Function name", placeholder: "my-lambda" },
      { key: "environment", label: "Env vars (JSON)", placeholder: '{"KEY":"value"}', type: "textarea" },
    ],
  };

  function renderActionForm() {
    const op = operationEl.value;
    const fields = ACTION_FIELDS[op] || [];
    actionFormEl.innerHTML = "";
    actionResultEl.textContent = "";
    fields.forEach((f) => {
      const lbl = document.createElement("label");
      lbl.textContent = f.label;
      actionFormEl.appendChild(lbl);
      const el = document.createElement(f.type === "textarea" ? "textarea" : "input");
      el.placeholder = f.placeholder || "";
      el.dataset.key = f.key;
      if (f.type === "textarea") el.rows = 3;
      actionFormEl.appendChild(el);
    });
  }

  function getActionInput() {
    const input = {};
    actionFormEl.querySelectorAll("[data-key]").forEach((el) => {
      const k = el.dataset.key;
      let v = (el.value || "").trim();
      if (k === "paths") {
        input[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (k === "item" || k === "environment") {
        try { input[k] = JSON.parse(v); } catch { input[k] = v; }
      } else {
        input[k] = v;
      }
    });
    return input;
  }

  async function onExecuteAws() {
    executeAwsBtn.disabled = true;
    actionResultEl.textContent = "Running...";
    actionResultEl.className = "status-msg";
    try {
      storeAwsInputs();
      const creds = getAwsCredentials();
      if (!creds.accessKeyId || !creds.secretAccessKey) throw new Error("Connect AWS credentials first");
      const operation = operationEl.value;
      const input = getActionInput();
      const out = await apiCall("/aws/execute", { awsCredentials: creds, operation, input });
      actionResultEl.textContent = "Success!";
      actionResultEl.className = "status-msg ok";
      log(operation + ": OK");
      addMsg("assistant", "Action completed: " + operation + "\n" + JSON.stringify(out, null, 2));
    } catch (e) {
      actionResultEl.textContent = "Failed: " + (e?.message || String(e));
      actionResultEl.className = "status-msg err";
      log("Execute failed: " + (e?.message || ""));
    } finally {
      executeAwsBtn.disabled = false;
    }
  }

  function onClear() {
    chatEl.innerHTML = "";
    addMsg("assistant",
      "Hi! I'm AUTO \u2014 your AI builder on AWS.\n\n" +
      "Chat \u2014 Ask me anything, I'll respond with Nova AI\n" +
      "\uD83D\uDD0A \u2014 Click the speaker icon on any response to hear it read aloud (Polly)\n" +
      "GitHub \u2014 Paste a repo URL and I'll analyze the codebase\n" +
      "Image \u2014 Describe an image and I'll generate it (Nova Canvas)\n" +
      "Analyze \u2014 Upload a photo and I'll describe what I see\n\n" +
      "For AWS write actions, click Settings in the top right."
    );
  }

  function togglePanel() {
    sidePanel.classList.toggle("hidden");
    togglePanelBtn.textContent = sidePanel.classList.contains("hidden") ? "Settings" : "Close";
  }

  function restoreSavedInputs() {
    awsAccessKeyEl.value = localStorage.getItem(STORAGE.awsAccessKey) || "";
    awsSecretKeyEl.value = localStorage.getItem(STORAGE.awsSecretKey) || "";
    awsSessionTokenEl.value = localStorage.getItem(STORAGE.awsSessionToken) || "";
    awsRegionEl.value = localStorage.getItem(STORAGE.awsRegion) || "us-east-1";
    githubTokenEl.value = localStorage.getItem("auto:githubToken") || "";
  }

  sendBtn.addEventListener("click", onSend);
  clearBtn.addEventListener("click", onClear);
  togglePanelBtn.addEventListener("click", togglePanel);
  validateAwsBtn.addEventListener("click", onValidateAws);
  executeAwsBtn.addEventListener("click", onExecuteAws);
  operationEl.addEventListener("change", renderActionForm);
  githubBtn.addEventListener("click", onGitHub);
  githubPushBtn.addEventListener("click", onGitHubPush);
  imageGenBtn.addEventListener("click", onImageGen);
  imageUpload.addEventListener("change", (e) => { if (e.target.files[0]) onImageUpload(e.target.files[0]); e.target.value = ""; });
  promptEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSend(); }
  });

  restoreSavedInputs();
  renderActionForm();
  onClear();
})();
