(() => {
  const MODAL_ROOT_ID = "ghrm-modal-root";

  class FunctionRiskModal {
    constructor() {
      this.root = null;
      this.overlay = null;
      this.panel = null;
      this.title = null;
      this.body = null;
      this.closeButton = null;

      this.handleOverlayClick = this.handleOverlayClick.bind(this);
      this.handleEscapeKey = this.handleEscapeKey.bind(this);
    }

    ensureMounted() {
      if (this.root) {
        return;
      }

      const root = document.createElement("div");
      root.id = MODAL_ROOT_ID;
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = `
        <div class="ghrm-overlay"></div>
        <section class="ghrm-panel" role="dialog" aria-modal="true" aria-label="Function Risk Score Dashboard">
          <header class="ghrm-header">
            <div>
              <h3 class="ghrm-title">Function Risk Score Dashboard</h3>
              <p class="ghrm-subtitle"></p>
            </div>
            <button class="ghrm-close" type="button" aria-label="Close risk dashboard">×</button>
          </header>
          <div class="ghrm-body"></div>
        </section>
      `;

      document.body.appendChild(root);

      this.root = root;
      this.overlay = root.querySelector(".ghrm-overlay");
      this.panel = root.querySelector(".ghrm-panel");
      this.title = root.querySelector(".ghrm-subtitle");
      this.body = root.querySelector(".ghrm-body");
      this.closeButton = root.querySelector(".ghrm-close");

      this.overlay.addEventListener("click", this.handleOverlayClick);
      this.closeButton.addEventListener("click", () => this.close());
      document.addEventListener("keydown", this.handleEscapeKey);
    }

    handleOverlayClick(event) {
      if (event.target === this.overlay) {
        this.close();
      }
    }

    handleEscapeKey(event) {
      if (event.key === "Escape" && this.isOpen()) {
        this.close();
      }
    }

    isOpen() {
      return Boolean(this.root && this.root.classList.contains("ghrm-open"));
    }

    open(functionId) {
      this.ensureMounted();
      this.root.classList.add("ghrm-open");
      this.root.setAttribute("aria-hidden", "false");
      this.title.textContent = functionId || "Unknown Function";
      document.body.classList.add("ghrm-no-scroll");
    }

    close() {
      if (!this.root) {
        return;
      }
      this.root.classList.remove("ghrm-open");
      this.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("ghrm-no-scroll");
    }

    renderLoading() {
      this.ensureMounted();
      this.body.innerHTML = `
        <div class="ghrm-loading">
          <div class="ghrm-spinner" aria-hidden="true"></div>
          <p>Computing function risk metrics...</p>
        </div>
      `;
    }

    renderError(message) {
      this.ensureMounted();
      this.body.innerHTML = `<p class="ghrm-error">${this.escapeHtml(message || "Risk score unavailable")}</p>`;
    }

    renderDashboard(payload) {
      this.ensureMounted();
      const score = Number(payload?.risk_score) || 0;

      this.body.innerHTML = `
        <div class="ghrm-gauge-wrap">
          <div id="ghrm-gauge"></div>
        </div>
        <p class="ghrm-note">
          The risk factor of a function is computed considering the change frequency, usage frequency by other functions and average amount of changes per commit
        </p>
      `;

      const gaugeMount = this.body.querySelector("#ghrm-gauge");
      if (window.GitRiskGauge && typeof window.GitRiskGauge.render === "function") {
        window.GitRiskGauge.render(gaugeMount, score);
      }
    }

    escapeHtml(text) {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };
      return String(text ?? "").replace(/[&<>"']/g, (m) => map[m]);
    }
  }

  window.GitFunctionRiskModal = new FunctionRiskModal();
})();
