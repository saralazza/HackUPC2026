(() => {
  const API_BASE_URL = "http://127.0.0.1:5000";
  const commitPathRegex = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]{7,40})(?:\/.*)?$/;
  const fileBlobRegex = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
  const NAV_EVENT = "ghcs:navigation";
  const TOGGLE_BUTTON_ID = "ghcs-toggle-button";

  let activeKey = null;

  function shouldShowToggle(pathname) {
    return commitPathRegex.test(pathname) || fileBlobRegex.test(pathname);
  }

  function isSidebarOpen() {
    const sidebar = window.GitCommitSummarySidebar;
    return Boolean(sidebar && sidebar.isOpen());
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

    const button = document.getElementById(TOGGLE_BUTTON_ID);
    if (button) {
      button.classList.toggle("ghcs-toggle-active", nextOpen);
      button.setAttribute("aria-pressed", String(nextOpen));
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
      setSidebarOpen(!isSidebarOpen());
    });

    document.body.appendChild(button);
  }

  function updateToggleVisibility() {
    const button = document.getElementById(TOGGLE_BUTTON_ID);
    if (!button) {
      return;
    }

    const shouldShow = shouldShowToggle(window.location.pathname);
    button.style.display = shouldShow ? "grid" : "none";
    if (!shouldShow && isSidebarOpen()) {
      setSidebarOpen(false);
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
