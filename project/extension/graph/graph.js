(() => {
  const GRAPH_SECTION_ID = "gh-repo-graph-section";
  const GRAPH_CANVAS_ID = "gh-repo-graph-canvas";
  const TOOLTIP_ID = "gh-repo-graph-tooltip";
  const API_BASE_URL = "http://127.0.0.1:5000";

  class RepositoryGraphFeature {
    constructor() {
      this.currentRepoKey = null;
      this.currentRepo = null;
      this.container = null;
      this.cy = null;
      this.tooltip = null;
      this.anchorRetryCount = 0;
      this.maxAnchorRetries = 12;
      this.searchHighlightTimer = null;
      this.suggestHideTimer = null;
    }

    getThemeMode() {
      const root = document.documentElement;
      const githubMode = (root.getAttribute("data-color-mode") || "").toLowerCase();
      if (githubMode === "dark" || githubMode === "light") {
        return githubMode;
      }

      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    getThemePalette(mode) {
      if (mode === "dark") {
        return {
          nodeFill: "#7aa2ff",
          nodeBorder: "#4f7cff",
          nodeText: "#ffffff",
          edge: "#8b949e",
          edgeArrow: "#8b949e",
          highlightViolet: "#a371f7",
          dimOpacity: 0.2
        };
      }

      return {
        nodeFill: "#218bff",
        nodeBorder: "#0969da",
        nodeText: "#ffffff",
        edge: "#8c959f",
        edgeArrow: "#57606a",
        highlightViolet: "#8250df",
        dimOpacity: 0.16
      };
    }

    parseRepositoryMain(pathname) {
      const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (!match) {
        return null;
      }
      return {
        repo: `${match[1]}/${match[2]}`,
        owner: match[1],
        name: match[2]
      };
    }

    async runForCurrentPage() {
      const context = this.parseRepositoryMain(window.location.pathname);
      if (!context) {
        return;
      }

      const repoKey = context.repo;
      const section = document.getElementById(GRAPH_SECTION_ID);
      const sectionMounted = Boolean(section);
      const sectionAttached = Boolean(section && section.isConnected);
      const canvasMounted = Boolean(section && section.querySelector(`#${GRAPH_CANVAS_ID}`));
      const sectionVisible = Boolean(
        section && !section.hidden && section.style.display !== "none"
      );
      if (
        this.currentRepoKey === repoKey &&
        sectionMounted &&
        sectionAttached &&
        canvasMounted &&
        sectionVisible
      ) {
        return;
      }

      if (this.currentRepoKey !== repoKey) {
        this.anchorRetryCount = 0;
      }
      this.currentRepoKey = repoKey;
      this.currentRepo = context.repo;

      const readmeAnchor = this.findReadmeAnchor();
      if (!readmeAnchor) {
        if (this.anchorRetryCount >= this.maxAnchorRetries) {
          return;
        }

        this.anchorRetryCount += 1;
        // README rendering on GitHub can be delayed; retry several times.
        window.setTimeout(() => {
          if (this.currentRepoKey === repoKey) {
            this.runForCurrentPage();
          }
        }, 900);
        return;
      }

      this.anchorRetryCount = 0;

      this.mountSection(readmeAnchor, context);
      this.renderStatus("Generating function dependency graph...");

      try {
        const payload = await this.fetchGraph(context.repo);
        if (this.currentRepoKey !== repoKey) {
          return;
        }

        this.renderGraph(payload);
      } catch (error) {
        if (this.currentRepoKey !== repoKey) {
          return;
        }
        const message = error instanceof Error ? error.message : "Graph could not be generated";
        this.renderStatus(`Graph could not be generated: ${message}`);
      }
    }

    findReadmeAnchor() {
      const readme = document.querySelector(
        "#readme, [data-testid='readme'], [data-testid='repository-readme-content'], [data-testid='readme-content']"
      );
      if (!readme) {
        return (
          document.querySelector("main .Layout-main") ||
          document.querySelector("main [data-testid='repo-content-pjax-container']") ||
          document.querySelector("main")
        );
      }
      return readme.closest("div.Box, section, article") || readme;
    }

    mountSection(anchorNode, context) {
      let section = document.getElementById(GRAPH_SECTION_ID);
      if (!section) {
        section = document.createElement("section");
        section.id = GRAPH_SECTION_ID;
        section.innerHTML = `
          <header class="ghrg-header">
            <div>
              <h3 class="ghrg-title">Function Dependency Graph</h3>
              <p class="ghrg-subtitle">Auto-generated from repository source files</p>
            </div>
            <div class="ghrg-search-wrap">
              <div class="ghrg-search-field">
                <input id="ghrg-search-input" type="text" placeholder="Search function..." />
                <div id="ghrg-search-suggest" class="ghrg-suggest-panel" role="listbox"></div>
              </div>
              <button id="ghrg-search-btn" type="button">Find</button>
              <span id="ghrg-search-feedback" aria-live="polite"></span>
            </div>
          </header>
          <div class="ghrg-body">
            <div id="${GRAPH_CANVAS_ID}"></div>
          </div>
        `;
      }

      section.hidden = false;
      section.style.display = "block";

      const readmeNode = document.querySelector(
        "#readme, [data-testid='readme'], [data-testid='repository-readme-content'], [data-testid='readme-content']"
      );
      const readmeBlock = readmeNode?.closest("div.Box, section, article") || null;
      const overviewContainer = document.querySelector(
        ".OverviewContent-module__Box__PF75K.tmp-pl-lg-3.mt-0"
      );
      const contentWrapper = document.querySelector("div.prc-PageLayout-ContentWrapper-gR9eG");

      if (overviewContainer) {
        overviewContainer.appendChild(section);
      } else if (contentWrapper) {
        // Always place the graph at the end of the main content flow.
        contentWrapper.appendChild(section);
      } else if (readmeBlock?.parentElement) {
        // Keep the graph in the same content flow as README, never in sidebar flow.
        readmeBlock.insertAdjacentElement("afterend", section);
      } else {
        const mainColumn = document.querySelector("main .Layout-main");
        const mainFlowContainer =
          mainColumn?.querySelector("[data-testid='repo-content-pjax-container']") ||
          mainColumn ||
          anchorNode.closest(".Layout-main") ||
          anchorNode;

        if (mainFlowContainer && mainFlowContainer !== section.parentElement) {
          mainFlowContainer.appendChild(section);
        }
      }

      this.container = section.querySelector(`#${GRAPH_CANVAS_ID}`);
      section.setAttribute("data-ghrg-theme", this.getThemeMode());
      this.updateSubtitle(context);
      this.bindSearchControls(section);
      this.destroyCy();
      this.destroyTooltip();
    }

    bindSearchControls(section) {
      const input = section.querySelector("#ghrg-search-input");
      const button = section.querySelector("#ghrg-search-btn");
      const suggestPanel = section.querySelector("#ghrg-search-suggest");

      if (!input || !button || !suggestPanel || input.dataset.bound === "true") {
        return;
      }

      input.removeAttribute("autofocus");

      const runSearch = () => {
        this.searchAndHighlight(input.value || "");
      };

      button.addEventListener("click", runSearch);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          runSearch();
        }
      });

      input.addEventListener("input", () => {
        this.updateSuggestPanel(input, suggestPanel);
      });

      input.addEventListener("focus", () => {
        this.updateSuggestPanel(input, suggestPanel);
      });

      input.addEventListener("blur", () => {
        if (this.suggestHideTimer) {
          window.clearTimeout(this.suggestHideTimer);
        }
        this.suggestHideTimer = window.setTimeout(() => {
          this.hideSuggestPanel(suggestPanel);
        }, 120);
      });

      input.dataset.bound = "true";
    }

    updateSuggestPanel(input, suggestPanel) {
      if (!this.cy) {
        this.hideSuggestPanel(suggestPanel);
        return;
      }

      const query = String(input.value || "").trim().toLowerCase();
      if (!query) {
        this.hideSuggestPanel(suggestPanel);
        return;
      }

      const items = this.collectSuggestions(query).slice(0, 6);
      if (!items.length) {
        this.hideSuggestPanel(suggestPanel);
        return;
      }

      this.renderSuggestItems(items, suggestPanel, input);
    }

    collectSuggestions(query) {
      const nodes = this.cy ? this.cy.nodes() : [];
      const results = [];
      const seen = new Set();

      nodes.forEach((node) => {
        const label = String(node.data("label") || "");
        const fullId = String(node.data("fullId") || "");
        if (!label && !fullId) {
          return;
        }
        const haystack = `${label} ${fullId}`.toLowerCase();
        if (!haystack.includes(query)) {
          return;
        }
        const key = fullId || label;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        results.push({
          label: label || fullId,
          fullId: fullId || label
        });
      });

      const startsWith = (item) =>
        item.label.toLowerCase().startsWith(query) || item.fullId.toLowerCase().startsWith(query);

      return results.sort((a, b) => {
        const aStart = startsWith(a) ? 0 : 1;
        const bStart = startsWith(b) ? 0 : 1;
        if (aStart !== bStart) {
          return aStart - bStart;
        }
        return a.label.localeCompare(b.label);
      });
    }

    renderSuggestItems(items, suggestPanel, input) {
      suggestPanel.innerHTML = "";
      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghrg-suggest-item";

        const primary = document.createElement("span");
        primary.className = "ghrg-suggest-primary";
        primary.textContent = item.label;

        const secondary = document.createElement("span");
        secondary.className = "ghrg-suggest-secondary";
        secondary.textContent = item.fullId;

        button.appendChild(primary);
        if (item.fullId && item.fullId !== item.label) {
          button.appendChild(secondary);
        }

        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });

        button.addEventListener("click", () => {
          input.value = item.fullId || item.label;
          this.hideSuggestPanel(suggestPanel);
          this.searchAndHighlight(input.value || "");
        });

        suggestPanel.appendChild(button);
      });

      suggestPanel.classList.add("is-visible");
    }

    hideSuggestPanel(suggestPanel) {
      suggestPanel.classList.remove("is-visible");
      suggestPanel.innerHTML = "";
    }

    searchAndHighlight(rawQuery) {
      if (!this.cy) {
        return;
      }

      const query = String(rawQuery).trim().toLowerCase();
      const feedback = document.getElementById("ghrg-search-feedback");
      this.cy.nodes().removeClass("search-hit");

      if (this.searchHighlightTimer) {
        window.clearTimeout(this.searchHighlightTimer);
        this.searchHighlightTimer = null;
      }

      if (!query) {
        if (feedback) {
          feedback.textContent = "";
        }
        return;
      }

      const nodes = this.cy.nodes();
      const exact = nodes.filter((node) => {
        const label = String(node.data("label") || "").toLowerCase();
        return label === query;
      });

      const partial = nodes.filter((node) => {
        const label = String(node.data("label") || "").toLowerCase();
        const fullId = String(node.data("fullId") || "").toLowerCase();
        return label.includes(query) || fullId.includes(query);
      });

      const target = (exact.length ? exact : partial)[0];
      if (!target) {
        if (feedback) {
          feedback.textContent = "No function found";
        }
        return;
      }

      target.addClass("search-hit");
      this.cy.animate({
        center: { eles: target },
        duration: 300
      });

      if (feedback) {
        feedback.textContent = `Found: ${target.data("label") || target.id()}`;
      }

      this.searchHighlightTimer = window.setTimeout(() => {
        target.removeClass("search-hit");
        if (feedback) {
          feedback.textContent = "";
        }
      }, 3000);
    }

    updateSubtitle(context) {
      const subtitle = document.querySelector(`#${GRAPH_SECTION_ID} .ghrg-subtitle`);
      if (!subtitle) {
        return;
      }
      subtitle.textContent = `Repository: ${context.owner}/${context.name}`;
    }

    renderStatus(message) {
      if (!this.container) {
        return;
      }
      this.container.innerHTML = `<div class="ghrg-status">${this.escapeHtml(message)}</div>`;
    }

    async fetchGraph(repo) {
      const url = `${API_BASE_URL}/graph?repo=${encodeURIComponent(repo)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        let errorMessage = `Backend request failed with status ${response.status}`;
        try {
          const payload = await response.json();
          if (payload.error) {
            errorMessage = payload.error;
          }
        } catch {
          // ignore JSON parse issues
        }
        throw new Error(errorMessage);
      }

      return response.json();
    }

    async fetchFunctionRisk(repo, functionId) {
      const url = `${API_BASE_URL}/function-risk?repo=${encodeURIComponent(repo)}&function_id=${encodeURIComponent(functionId)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        let errorMessage = `Risk request failed with status ${response.status}`;
        try {
          const payload = await response.json();
          if (payload.error) {
            errorMessage = payload.error;
          }
        } catch {
          // ignore JSON parse issues
        }
        throw new Error(errorMessage);
      }

      return response.json();
    }

    renderGraph(payload) {
      if (!this.container) {
        return;
      }
      if (!window.cytoscape) {
        this.renderStatus("Graph could not be generated: Cytoscape.js not loaded.");
        return;
      }

      const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
      const edges = Array.isArray(payload.edges) ? payload.edges : [];

      if (!nodes.length) {
        this.renderStatus("Graph could not be generated: no internal functions detected.");
        return;
      }

      const inDegreeMap = this.computeInDegree(nodes, edges);
      const outDegreeMap = this.computeOutDegree(nodes, edges);
      const mode = this.getThemeMode();
      const palette = this.getThemePalette(mode);
      const section = document.getElementById(GRAPH_SECTION_ID);
      if (section) {
        section.setAttribute("data-ghrg-theme", mode);
      }

      const elements = [
        ...nodes.map((node) => ({
          data: {
            id: node.id,
            label: this.nodeLabel(node.id),
            fullId: node.id,
            inDegree: inDegreeMap.get(node.id) || 0,
            outDegree: outDegreeMap.get(node.id) || 0,
            size: this.scaledNodeSize(inDegreeMap.get(node.id) || 0)
          }
        })),
        ...edges.map((edge, idx) => ({
          data: {
            id: `${edge.source}->${edge.target}-${idx}`,
            source: edge.source,
            target: edge.target
          }
        }))
      ];

      this.container.innerHTML = "";
      this.cy = window.cytoscape({
        container: this.container,
        elements,
        layout: {
          name: "cose",
          animate: false,
          fit: true,
          padding: 40,
          nodeRepulsion: 15000,
          idealEdgeLength: 180,
          edgeElasticity: 90,
          gravity: 0.8
        },
        style: [
          {
            selector: "node",
            style: {
              "background-color": palette.nodeFill,
              "label": "data(label)",
              "font-size": 10,
              "text-valign": "center",
              "text-halign": "center",
              "text-wrap": "wrap",
              "text-max-width": "90px",
              "width": "data(size)",
              "height": "data(size)",
              "color": palette.nodeText,
              "text-outline-color": "#000000",
              "text-outline-width": 1,
              "border-width": 1,
              "border-color": palette.nodeBorder
            }
          },
          {
            selector: "node[inDegree = 0][outDegree = 0]",
            style: {
              "background-color": "#d8dee4",
              "border-color": "#afb8c1"
            }
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "target-arrow-shape": "triangle",
              "target-arrow-color": palette.edgeArrow,
              "line-color": palette.edge,
              "width": 1.2,
              "arrow-scale": 0.8
            }
          },
          {
            selector: ".dim",
            style: {
              "opacity": palette.dimOpacity
            }
          },
          {
            selector: "node.highlight",
            style: {
              "opacity": 1,
              "background-color": palette.highlightViolet,
              "border-color": palette.highlightViolet
            }
          },
          {
            selector: "edge.highlight",
            style: {
              "opacity": 1,
              "line-color": palette.highlightViolet,
              "target-arrow-color": palette.highlightViolet,
              "width": 2.3
            }
          },
          {
            selector: "node.search-hit",
            style: {
              "background-color": "#2da44e",
              "border-color": "#1f883d"
            }
          }
        ]
      });

      this.installInteractions();
    }

    installInteractions() {
      if (!this.cy) {
        return;
      }

      this.cy.on("mouseover", "node", (event) => {
        const node = event.target;
        const incomingEdges = node.incomers("edge");
        const sourceNodes = incomingEdges.sources();

        this.cy.elements().addClass("dim").removeClass("highlight");
        node.removeClass("dim").addClass("highlight");
        incomingEdges.removeClass("dim").addClass("highlight");
        sourceNodes.removeClass("dim").addClass("highlight");

        const callers = sourceNodes.map((srcNode) => srcNode.data("fullId") || srcNode.id());
        this.showTooltip(node.data("fullId") || node.id(), callers);
      });

      this.cy.on("mousemove", "node", (event) => {
        if (!this.tooltip) {
          return;
        }
      });

      this.cy.on("mouseout", "node", () => {
        this.cy.elements().removeClass("dim").removeClass("highlight");
        this.destroyTooltip();
      });

      const handleNodeSelect = async (event) => {
        const node = event.target;
        const functionId = node.data("fullId") || node.id();
        if (!functionId || !this.currentRepo) {
          return;
        }

        const modal = window.GitFunctionRiskModal;
        if (!modal) {
          return;
        }

        modal.open(functionId);
        modal.renderLoading();

        try {
          const payload = await this.fetchFunctionRisk(this.currentRepo, functionId);
          modal.renderDashboard(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Risk metrics unavailable.";
          modal.renderError(message);
        }
      };

      this.cy.on("tap", "node", handleNodeSelect);
      this.cy.on("click", "node", handleNodeSelect);
    }

    computeInDegree(nodes, edges) {
      const counts = new Map(nodes.map((n) => [n.id, 0]));
      for (const edge of edges) {
        if (counts.has(edge.target)) {
          counts.set(edge.target, (counts.get(edge.target) || 0) + 1);
        }
      }
      return counts;
    }

    computeOutDegree(nodes, edges) {
      const counts = new Map(nodes.map((n) => [n.id, 0]));
      for (const edge of edges) {
        if (counts.has(edge.source)) {
          counts.set(edge.source, (counts.get(edge.source) || 0) + 1);
        }
      }
      return counts;
    }

    scaledNodeSize(inDegree) {
      const baseSize = 28;
      const scaleFactor = 6;
      const maxSize = 86;
      return Math.min(maxSize, baseSize + inDegree * scaleFactor);
    }

    nodeLabel(nodeId) {
      const functionPart = String(nodeId).split(":").slice(1).join(":") || nodeId;
      const parts = functionPart.split(".");
      return parts[parts.length - 1] || functionPart;
    }

    showTooltip(functionId, callers) {
      this.destroyTooltip();

      const tooltip = document.createElement("div");
      tooltip.id = TOOLTIP_ID;

      const callersHtml = callers.length
        ? `<ul class="ghrg-tooltip-list">${callers
            .map((caller) => `<li>${this.escapeHtml(caller)}</li>`)
            .join("")}</ul>`
        : "<div>No incoming calls</div>";

      tooltip.innerHTML = `
        <div class="ghrg-tooltip-title">Function: ${this.escapeHtml(functionId)}</div>
        <div>Called by:</div>
        ${callersHtml}
      `;

      const section = document.getElementById(GRAPH_SECTION_ID);
      const anchor = section?.querySelector(".ghrg-body") || section || document.body;
      anchor.appendChild(tooltip);
      this.tooltip = tooltip;
    }

    destroyTooltip() {
      const existing = document.getElementById(TOOLTIP_ID);
      if (existing) {
        existing.remove();
      }
      this.tooltip = null;
    }

    destroyCy() {
      if (this.cy) {
        this.cy.destroy();
      }
      this.cy = null;
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

  window.GitHubRepoGraph = new RepositoryGraphFeature();
})();
