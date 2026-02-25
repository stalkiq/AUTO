(function () {
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

  const apiBaseEl = $("apiBase");
  const saveApiBtn = $("saveApi");

  const awsAccessKeyEl = $("awsAccessKey");
  const awsSecretKeyEl = $("awsSecretKey");
  const awsSessionTokenEl = $("awsSessionToken");
  const awsRegionEl = $("awsRegion");
  const validateAwsBtn = $("validateAws");
  const executeAwsBtn = $("executeAws");
  const operationEl = $("operation");
  const operationInputEl = $("operationInput");
  const runLogEl = $("runLog");

  const awsStatusEl = $("awsStatus");
  const awsAccountEl = $("awsAccount");
  const awsRegionLabelEl = $("awsRegionLabel");
  const workspaceIdEl = $("workspaceId");
  const lastRunIdEl = $("lastRunId");

  let currentWorkspaceId = null;
  let cachedAwsIdentity = null;

  function getApiBase() {
    return (localStorage.getItem(STORAGE.apiBase) || "").trim();
  }

  function setApiBase(v) {
    localStorage.setItem(STORAGE.apiBase, String(v || "").trim());
  }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML = `<div class="role">${role}</div><div class="text"></div>`;
    div.querySelector(".text").textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function log(text) {
    const now = new Date().toLocaleTimeString();
    runLogEl.textContent += `[${now}] ${text}\n`;
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
    if (!apiBase) throw new Error("API base is not configured.");

    const res = await fetch(apiBase.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  async function ensureWorkspace() {
    if (currentWorkspaceId) return currentWorkspaceId;
    const out = await apiCall("/workspace/create", {});
    currentWorkspaceId = out.workspaceId;
    workspaceIdEl.textContent = currentWorkspaceId;
    log(`Workspace created: ${currentWorkspaceId}`);
    return currentWorkspaceId;
  }

  async function onSend() {
    const text = (promptEl.value || "").trim();
    if (!text) return;
    addMsg("user", text);
    promptEl.value = "";
    sendBtn.disabled = true;
    try {
      const out = await apiCall("/chat", { messages: [{ role: "user", content: text }] });
      addMsg("assistant", out.reply || "(no reply)");
      await ensureWorkspace();
    } catch (e) {
      addMsg("assistant", "Error: " + (e?.message || String(e)));
      log("Chat error: " + (e?.message || String(e)));
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function onValidateAws() {
    validateAwsBtn.disabled = true;
    try {
      storeAwsInputs();
      const creds = getAwsCredentials();
      const out = await apiCall("/aws/validate", { awsCredentials: creds });
      cachedAwsIdentity = out?.identity || null;
      awsStatusEl.textContent = "Connected";
      awsStatusEl.classList.add("ok");
      awsAccountEl.textContent = out?.identity?.account || "—";
      awsRegionLabelEl.textContent = out?.region || creds.region || "us-east-1";
      log(`AWS session valid: ${out?.identity?.arn || "unknown"}`);
      addMsg("assistant", `AWS connected.\nAccount: ${out?.identity?.account}\nARN: ${out?.identity?.arn}`);
    } catch (e) {
      awsStatusEl.textContent = "Failed";
      awsAccountEl.textContent = "—";
      awsRegionLabelEl.textContent = (awsRegionEl.value || "us-east-1").trim();
      log("AWS validate failed: " + (e?.message || String(e)));
      addMsg("assistant", "AWS validation failed: " + (e?.message || String(e)));
    } finally {
      validateAwsBtn.disabled = false;
    }
  }

  async function onExecuteAws() {
    executeAwsBtn.disabled = true;
    try {
      storeAwsInputs();
      const creds = getAwsCredentials();
      const operation = operationEl.value;
      let input = {};
      try {
        input = JSON.parse(operationInputEl.value || "{}");
      } catch {
        throw new Error("Operation input must be valid JSON.");
      }
      const out = await apiCall("/aws/execute", { awsCredentials: creds, operation, input });
      log(`EXECUTE ${operation}: ${JSON.stringify(out)}`);
      addMsg("assistant", `Write action executed:\n${operation}\n\nResult:\n${JSON.stringify(out, null, 2)}`);
      if (out?.runId) {
        lastRunIdEl.textContent = out.runId;
      }
    } catch (e) {
      log("Execute failed: " + (e?.message || String(e)));
      addMsg("assistant", "Write action failed: " + (e?.message || String(e)));
    } finally {
      executeAwsBtn.disabled = false;
    }
  }

  function onClear() {
    chatEl.innerHTML = "";
    runLogEl.textContent = "";
    addMsg(
      "assistant",
      "AUTO ready.\n1) Save API base\n2) Validate AWS credentials\n3) Run write actions from the control panel."
    );
  }

  function seedOperationInput() {
    const op = operationEl.value;
    const templates = {
      s3_put_object: {
        bucket: "my-bucket",
        key: "auto/output.txt",
        content: "hello from AUTO",
        contentType: "text/plain",
      },
      s3_delete_object: {
        bucket: "my-bucket",
        key: "auto/output.txt",
      },
      cloudfront_invalidate: {
        distributionId: "E123EXAMPLE",
        paths: ["/*"],
      },
      dynamodb_put_item: {
        tableName: "my-table",
        item: { pk: "demo#1", sk: "meta", updatedAt: new Date().toISOString() },
      },
      lambda_update_env: {
        functionName: "my-lambda-name",
        merge: true,
        environment: { FEATURE_FLAG: "true" },
      },
    };
    operationInputEl.value = JSON.stringify(templates[op] || {}, null, 2);
  }

  function restoreSavedInputs() {
    apiBaseEl.value = getApiBase();
    awsAccessKeyEl.value = localStorage.getItem(STORAGE.awsAccessKey) || "";
    awsSecretKeyEl.value = localStorage.getItem(STORAGE.awsSecretKey) || "";
    awsSessionTokenEl.value = localStorage.getItem(STORAGE.awsSessionToken) || "";
    awsRegionEl.value = localStorage.getItem(STORAGE.awsRegion) || "us-east-1";
    awsRegionLabelEl.textContent = awsRegionEl.value;
  }

  saveApiBtn.addEventListener("click", () => {
    setApiBase(apiBaseEl.value);
    addMsg("assistant", "Saved API base:\n" + getApiBase());
    log("API base updated.");
  });

  sendBtn.addEventListener("click", onSend);
  clearBtn.addEventListener("click", onClear);
  validateAwsBtn.addEventListener("click", onValidateAws);
  executeAwsBtn.addEventListener("click", onExecuteAws);
  operationEl.addEventListener("change", seedOperationInput);
  promptEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onSend();
    }
  });

  restoreSavedInputs();
  seedOperationInput();
  onClear();
})();
