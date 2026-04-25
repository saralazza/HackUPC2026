(() => {
  const API_BASE_URL = "http://127.0.0.1:5000";
  const commitPathRegex = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]{7,40})(?:\/.*)?$/;
  const fileBlobRegex = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
  const repoRootRegex = /^\/([^/]+)\/([^/]+)\/?$/;
  const NAV_EVENT = "ghcs:navigation";
  const TOGGLE_BUTTON_ID = "ghcs-toggle-button";
  const GUIDE_ROOT_ID = "ghcs-guide-root";

  let activeKey = null;

  function getPageType(pathname) {
    if (commitPathRegex.test(pathname)) {
      return "commit";
    }
    if (fileBlobRegex.test(pathname)) {
      return "blob";
    }
    if (repoRootRegex.test(pathname)) {
      return "repo";
    }
    return "none";
  }

  function shouldShowToggle(pathname) {
    return getPageType(pathname) !== "none";
  }

  function isSidebarOpen() {
    const sidebar = window.GitCommitSummarySidebar;
    return Boolean(sidebar && sidebar.isOpen());
  }

  function isGuideOpen() {
    const guide = document.getElementById(GUIDE_ROOT_ID);
    return Boolean(guide && guide.classList.contains("ghcs-guide-open"));
  }

  function setButtonActive(active) {
    const button = document.getElementById(TOGGLE_BUTTON_ID);
    if (!button) {
      return;
    }
    button.classList.toggle("ghcs-toggle-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  function setSidebarOpen(nextOpen) {
    const sidebar = window.GitCommitSummarySidebar;
    if (!sidebar) {
      return;
    }

    sidebar.mount();
    if (nextOpen) {
      sidebar.open();
      triggerFlows();
      scheduleNavigationRetries();
    } else {
      sidebar.close();
      activeKey = null;
    }

    setButtonActive(nextOpen || isGuideOpen());
  }

  function ensureGuideModal() {
    if (document.getElementById(GUIDE_ROOT_ID)) {
      return;
    }

    const root = document.createElement("div");
    root.id = GUIDE_ROOT_ID;
    root.innerHTML = `
      <div class="ghcs-guide-overlay"></div>
      <section class="ghcs-guide-panel" role="dialog" aria-modal="true" aria-label="Extension Guide">
        <header class="ghcs-guide-header">
          <div>
            <h3 class="ghcs-guide-title">Extension Guide</h3>
            <p class="ghcs-guide-subtitle">Quick overview of what you can do here.</p>
          </div>
          <button class="ghcs-guide-close" type="button" aria-label="Close guide">×</button>
        </header>
        <div class="ghcs-guide-body">
          <div class="ghcs-guide-section">
            <h4>Available features</h4>
            <ul>
              <li>Commit summarization sidebar on commit pages.</li>
              <li>File modification history summaries on file pages.</li>
              <li>Repository function dependency graph on repo home.</li>
              <li>Risk dashboard for functions when selecting a node.</li>
            </ul>
          </div>
          <div class="ghcs-guide-section" id="ghcs-token-section"></div>
        </div>
      </section>
    `;

    document.body.appendChild(root);

    const overlay = root.querySelector(".ghcs-guide-overlay");
    const closeButton = root.querySelector(".ghcs-guide-close");

    overlay?.addEventListener("click", () => closeGuide());
    closeButton?.addEventListener("click", () => closeGuide());

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isGuideOpen()) {
        closeGuide();
      }
    });
  }

  function openGuide() {
    ensureGuideModal();
    const root = document.getElementById(GUIDE_ROOT_ID);
    if (!root) {
      return;
    }
    root.classList.add("ghcs-guide-open");
    setButtonActive(true);
    updateGuideTokenSection();
  }

  function closeGuide() {
    const root = document.getElementById(GUIDE_ROOT_ID);
    if (!root) {
      return;
    }
    root.classList.remove("ghcs-guide-open");
    setButtonActive(isSidebarOpen());
  }

  async function fetchTokenStatus() {
    const response = await fetch(`${API_BASE_URL}/settings/token`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      throw new Error("Unable to check token status.");
    }
    return response.json();
  }

  async function saveToken(token) {
    const response = await fetch(`${API_BASE_URL}/settings/token`, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if (!response.ok) {
      let message = "Unable to save token.";
      try {
        const payload = await response.json();
        if (payload.error) {
          message = payload.error;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return response.json();
  }

  async function updateGuideTokenSection() {
    const section = document.getElementById("ghcs-token-section");
    if (!section) {
      return;
    }

    section.innerHTML = "<p class=\"ghcs-guide-muted\">Checking GitHub token status...</p>";

    let configured = false;
    try {
      const status = await fetchTokenStatus();
      if (status && typeof status.stored === "boolean") {
        configured = status.stored;
      } else {
        configured = Boolean(status && status.configured);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to check token status.";
      section.innerHTML = `<p class=\"ghcs-guide-error\">${message}</p>`;
      return;
    }

    if (configured) {
      section.innerHTML = `
        <h4>GitHub token</h4>
        <p class="ghcs-guide-muted">Token is configured. <3</p>
      `;
      return;
    }

    section.innerHTML = `
      <h4>GitHub token required</h4>
      <p class="ghcs-guide-muted">Add a personal access token to unlock private repositories and API features.</p>
      <div class="ghcs-token-form">
        <input id="ghcs-token-input" type="password" />
        <button id="ghcs-token-save" type="button">Save token</button>
      </div>
      <p id="ghcs-token-feedback" class="ghcs-guide-muted"></p>
    `;

    const input = document.getElementById("ghcs-token-input");
    const button = document.getElementById("ghcs-token-save");
    const feedback = document.getElementById("ghcs-token-feedback");

    if (button && input) {
      button.addEventListener("click", async () => {
        const value = String(input.value || "").trim();
        if (!value) {
          if (feedback) {
            feedback.textContent = "Please enter a token.";
          }
          return;
        }
        if (feedback) {
          feedback.textContent = "Saving token...";
        }
        try {
          await saveToken(value);
          if (feedback) {
            feedback.textContent = "Token saved successfully.";
          }
          updateGuideTokenSection();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to save token.";
          if (feedback) {
            feedback.textContent = message;
          }
        }
      });
    }
  }

  function ensureToggleButton() {
    if (document.getElementById(TOGGLE_BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = TOGGLE_BUTTON_ID;
    button.type = "button";
    button.setAttribute("aria-label", "Toggle insights sidebar");
    button.setAttribute("aria-pressed", "false");

    const icon = document.createElement("img");
    icon.className = "ghcs-toggle-icon";
    if (window.chrome && window.chrome.runtime && window.chrome.runtime.getURL) {
      icon.src = window.chrome.runtime.getURL("icon.png");
    }
    icon.alt = "";
    button.appendChild(icon);

    button.addEventListener("click", () => {
      const pageType = getPageType(window.location.pathname);
      if (pageType === "repo") {
        if (isGuideOpen()) {
          closeGuide();
        } else {
          openGuide();
        }
        return;
      }

      setSidebarOpen(!isSidebarOpen());
    });

    document.body.appendChild(button);
  }

  function updateToggleVisibility() {
    const button = document.getElementById(TOGGLE_BUTTON_ID);
    if (!button) {
      return;
    }

    const pageType = getPageType(window.location.pathname);
    const shouldShow = pageType !== "none";
    button.style.display = shouldShow ? "grid" : "none";

    if (!shouldShow) {
      if (isSidebarOpen()) {
        setSidebarOpen(false);
      }
      if (isGuideOpen()) {
        closeGuide();
      }
      return;
    }

    if (pageType === "repo" && isSidebarOpen()) {
      setSidebarOpen(false);
    }
    if (pageType !== "repo" && isGuideOpen()) {
      closeGuide();
    }
  }

  function parseCommitContext(urlPathname) {
    const match = urlPathname.match(commitPathRegex);
    if (!match) {
      return null;
    }

    return {
      repo: `${match[1]}/${match[2]}`,
      sha: match[3]
    };
  }

  async function fetchSummary(repo, sha) {
    const endpoint = `${API_BASE_URL}/summarize?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      let serverMessage = `Backend request failed with status ${response.status}`;
      try {
        const payload = await response.json();
        if (payload.error) {
          serverMessage = payload.error;
        }
      } catch {
        // Keep generic message when response is non-JSON.
      }
      throw new Error(serverMessage);
    }

    return response.json();
  }

  async function fetchFileHistory(repo, path) {
    const endpoint = `${API_BASE_URL}/file-history?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      let serverMessage = `Backend request failed with status ${response.status}`;
      try {
        const payload = await response.json();
        if (payload.error) {
          serverMessage = payload.error;
        }
      } catch {
        // Keep generic message when response is non-JSON.
      }
      throw new Error(serverMessage);
    }

    return response.json();
  }

  async function runSummaryFlow() {
    if (!isSidebarOpen()) {
      return;
    }
    const ctx = parseCommitContext(window.location.pathname);
    if (!ctx) {
      return;
    }

    const key = `${ctx.repo}:${ctx.sha}`;
    if (key === activeKey) {
      return;
    }
    activeKey = key;

    const sidebar = window.GitCommitSummarySidebar;
    sidebar.mount("Commit Summary");
    sidebar.setLoading(true);
    sidebar.renderSummary("Preparing summary request...", {});

    try {
      const payload = await fetchSummary(ctx.repo, ctx.sha);
      if (activeKey !== key) {
        return;
      }
      sidebar.renderSummary(payload.summary, {
        cached: payload.cached,
        chunkCount: payload.chunk_count
      });
    } catch (error) {
      if (activeKey !== key) {
        return;
      }
      const msg = error instanceof Error ? error.message : "Unexpected extension error.";
      sidebar.renderError(msg);
    } finally {
      if (activeKey === key) {
        sidebar.setLoading(false);
      }
    }
  }

  async function runFileHistoryFlow() {
    if (!isSidebarOpen()) {
      return;
    }
    const match = window.location.pathname.match(fileBlobRegex);
    if (!match) {
      return;
    }

    const repo = `${match[1]}/${match[2]}`;
    const path = match[4];
    const key = `file-history:${repo}:${path}`;
    if (key === activeKey) {
      return;
    }
    activeKey = key;

    const sidebar = window.GitCommitSummarySidebar;
    sidebar.mount("File Modification History");
    sidebar.setLoading(true);
    sidebar.renderSummary("Preparing file history request...", {});

    try {
      const payload = await fetchFileHistory(repo, path);
      if (activeKey !== key) {
        return;
      }
      sidebar.renderSummary(payload.summary, {
        chunkCount: payload.commit_count
      });
    } catch (error) {
      if (activeKey !== key) {
        return;
      }
      const msg = error instanceof Error ? error.message : "Unexpected extension error.";
      sidebar.renderError(msg);
    } finally {
      if (activeKey === key) {
        sidebar.setLoading(false);
      }
    }
  }

  function triggerFlows() {
    if (!isSidebarOpen()) {
      return;
    }
    runSummaryFlow();
    runFileHistoryFlow();
  }

  function scheduleNavigationRetries() {
    // GitHub SPA transitions can update URL/content in multiple phases.
    window.setTimeout(() => window.dispatchEvent(new Event(NAV_EVENT)), 250);
    window.setTimeout(() => window.dispatchEvent(new Event(NAV_EVENT)), 900);
  }

  function installNavigationHooks() {
    const pushState = history.pushState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      window.dispatchEvent(new Event(NAV_EVENT));
      scheduleNavigationRetries();
      return result;
    };

    const replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      window.dispatchEvent(new Event(NAV_EVENT));
      scheduleNavigationRetries();
      return result;
    };

    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event(NAV_EVENT));
      scheduleNavigationRetries();
    });

    // Extra safety: clicking a file link may navigate before all observers settle.
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const link = target.closest("a[href]");
        if (!link) {
          return;
        }
        const href = link.getAttribute("href") || "";
        if (href.includes("/blob/") || href.includes("/commit/")) {
          scheduleNavigationRetries();
        }
      },
      true
    );

    window.addEventListener(NAV_EVENT, () => {
      updateToggleVisibility();
      if (isSidebarOpen()) {
        triggerFlows();
      }
    });

    // GitHub's dynamic page transitions can skip history events, so observe URL changes.
    let lastHref = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        window.dispatchEvent(new Event(NAV_EVENT));
        scheduleNavigationRetries();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  ensureToggleButton();
  updateToggleVisibility();
  installNavigationHooks();
})();
