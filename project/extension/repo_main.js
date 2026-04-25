(() => {
  function installRepoNavigationHooks() {
    const emit = () => window.dispatchEvent(new Event("ghrg:navigation"));

    const pushState = history.pushState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      emit();
      return result;
    };

    const replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      emit();
      return result;
    };

    window.addEventListener("popstate", emit);
    window.addEventListener("ghrg:navigation", () => {
      if (window.GitHubRepoGraph) {
        window.GitHubRepoGraph.runForCurrentPage();
      }
    });

    let lastHref = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        emit();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  installRepoNavigationHooks();
  if (window.GitHubRepoGraph) {
    window.GitHubRepoGraph.runForCurrentPage();
  }
})();
