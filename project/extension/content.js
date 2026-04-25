(() => {
  const API_BASE_URL = "http://127.0.0.1:5000";
  const commitPathRegex = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]{7,40})(?:\/.*)?$/;

  let activeKey = null;

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

  async function runSummaryFlow() {
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
    sidebar.mount();
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

  function installNavigationHooks() {
    const pushState = history.pushState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      window.dispatchEvent(new Event("ghcs:navigation"));
      return result;
    };

    const replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      window.dispatchEvent(new Event("ghcs:navigation"));
      return result;
    };

    window.addEventListener("popstate", () => window.dispatchEvent(new Event("ghcs:navigation")));
    window.addEventListener("ghcs:navigation", runSummaryFlow);

    // GitHub's dynamic page transitions can skip history events, so observe URL changes.
    let lastHref = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        window.dispatchEvent(new Event("ghcs:navigation"));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  installNavigationHooks();
  runSummaryFlow();
})();
