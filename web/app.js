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

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML = '<div class="role"></div><div class="text"></div>';
    div.querySelector(".role").textContent = role;
    div.querySelector(".text").textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
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

  // Chat
  async function onSend() {
    const text = (promptEl.value || "").trim();
    if (!text) return;
    addMsg("user", text);
    promptEl.value = "";
    sendBtn.disabled = true;
    try {
      const out = await apiCall("/chat", { messages: [{ role: "user", content: text }] });
      addMsg("assistant", out.reply || "(no reply)");
    } catch (e) {
      addMsg("assistant", "Error: " + (e?.message || String(e)));
      log("Chat error: " + (e?.message || ""));
    } finally {
      sendBtn.disabled = false;
      promptEl.focus();
    }
  }

  // AWS Validate
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

  // Action form templates
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
    const op = operationEl.value;
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
      actionResultEl.textContent = "Success! " + JSON.stringify(out);
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
    addMsg("assistant", "Hi! I'm AUTO — your AI builder on AWS.\n\nJust type what you want to build or ask me anything about AWS.\n\nIf you want to run actions on your AWS account, click \"AWS Settings\" in the top right.");
  }

  function togglePanel() {
    sidePanel.classList.toggle("hidden");
    togglePanelBtn.textContent = sidePanel.classList.contains("hidden") ? "AWS Settings" : "Close";
  }

  function restoreSavedInputs() {
    awsAccessKeyEl.value = localStorage.getItem(STORAGE.awsAccessKey) || "";
    awsSecretKeyEl.value = localStorage.getItem(STORAGE.awsSecretKey) || "";
    awsSessionTokenEl.value = localStorage.getItem(STORAGE.awsSessionToken) || "";
    awsRegionEl.value = localStorage.getItem(STORAGE.awsRegion) || "us-east-1";
  }

  // Event listeners
  sendBtn.addEventListener("click", onSend);
  clearBtn.addEventListener("click", onClear);
  togglePanelBtn.addEventListener("click", togglePanel);
  validateAwsBtn.addEventListener("click", onValidateAws);
  executeAwsBtn.addEventListener("click", onExecuteAws);
  operationEl.addEventListener("change", renderActionForm);
  promptEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onSend();
    }
  });

  // Init
  restoreSavedInputs();
  renderActionForm();
  onClear();
})();
