(() => {
  const ROOT_ID = "gh-commit-summary-root";

  class CommitSummarySidebar {
    constructor() {
      this.root = null;
      this.content = null;
      this.loading = null;
      this.lastKey = null;
    }

    mount(title = "Commit Summary") {
      if (document.getElementById(ROOT_ID)) {
        this.root = document.getElementById(ROOT_ID);
        this.content = this.root.querySelector(".ghcs-content");
        this.loading = this.root.querySelector(".ghcs-loading");
        const titleNode = this.root.querySelector("h2");
        if (titleNode) {
          titleNode.textContent = title;
        }
        return;
      }

      this.root = document.createElement("aside");
      this.root.id = ROOT_ID;
      this.root.classList.add("ghcs-panel");
      this.root.setAttribute("aria-hidden", "true");
      this.root.innerHTML = `
        <div class="ghcs-header">
          <h2>${title}</h2>
        </div>
        <div class="ghcs-loading" hidden>
          <div class="ghcs-spinner" aria-hidden="true"></div>
          <p>Analyzing commit...</p>
        </div>
        <div class="ghcs-content"></div>
      `;

      document.body.appendChild(this.root);
      this.content = this.root.querySelector(".ghcs-content");
      this.loading = this.root.querySelector(".ghcs-loading");
    }

    open() {
      if (!this.root) {
        this.mount();
      }
      this.root.classList.add("ghcs-open");
      this.root.setAttribute("aria-hidden", "false");
    }

    close() {
      if (!this.root) {
        return;
      }
      this.root.classList.remove("ghcs-open");
      this.root.setAttribute("aria-hidden", "true");
    }

    isOpen() {
      return Boolean(this.root && this.root.classList.contains("ghcs-open"));
    }

    setLoading(isLoading) {
      if (!this.root) {
        this.mount();
      }
      this.loading.hidden = !isLoading;
    }

    renderSummary(summary, metadata = {}) {
      if (!this.root) {
        this.mount();
      }

      const rows = [];
      if (typeof metadata.cached === "boolean") {
        rows.push(`<div><strong>Cached:</strong> ${metadata.cached ? "Yes" : "No"}</div>`);
      }
      if (typeof metadata.chunkCount === "number") {
        rows.push(`<div><strong>Chunks:</strong> ${metadata.chunkCount}</div>`);
      }

      this.content.innerHTML = `
        <div class="ghcs-meta">${rows.join("")}</div>
        <article class="ghcs-summary">${this.escapeAndFormat(summary)}</article>
      `;
    }

    renderError(message) {
      if (!this.root) {
        this.mount();
      }
      this.content.innerHTML = `<p class="ghcs-error">${this.escapeHtml(message)}</p>`;
    }

    escapeAndFormat(markdownText) {
      const safe = this.escapeHtml(markdownText);
      return safe
        .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
        .replace(/^#\s+(.+)$/gm, "<h2>$1</h2>")
        .replace(/^\d+\.\s+(.+)$/gm, "<p><strong>$1</strong></p>")
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br/>")
        .replace(/^/, "<p>")
        .replace(/$/, "</p>");
    }

    escapeHtml(text) {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };
      return String(text).replace(/[&<>"']/g, (m) => map[m]);
    }
  }

  window.GitCommitSummarySidebar = new CommitSummarySidebar();
})();
