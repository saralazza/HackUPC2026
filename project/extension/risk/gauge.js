(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function polarToCartesian(cx, cy, r, angleDeg) {
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(radians),
      y: cy - r * Math.sin(radians)
    };
  }

  function arcPath(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    const sweepFlag = 1;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function valueToAngle(value) {
    // 0 => 180deg (left), 100 => 0deg (right)
    return 180 - (value / 100) * 180;
  }

  function createArc(svg, pathData, color, strokeWidth) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
  }

  function renderGauge(container, riskValue) {
    if (!container) {
      return;
    }

    const value = clamp(Number(riskValue) || 0, 0, 100);
    container.innerHTML = "";

    const width = 360;
    const height = 250;
    const centerX = width / 2;
    const centerY = 190;
    const radius = 132;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "ghrm-gauge-svg");

    const defs = document.createElementNS(SVG_NS, "defs");
    const gradient = document.createElementNS(SVG_NS, "linearGradient");
    gradient.setAttribute("id", "ghrm-risk-gradient");
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("y1", "0%");
    gradient.setAttribute("x2", "100%");
    gradient.setAttribute("y2", "0%");

    const stopGreen = document.createElementNS(SVG_NS, "stop");
    stopGreen.setAttribute("offset", "0%");
    stopGreen.setAttribute("stop-color", "#2bd38f");

    const stopYellow = document.createElementNS(SVG_NS, "stop");
    stopYellow.setAttribute("offset", "50%");
    stopYellow.setAttribute("stop-color", "#f4c94f");

    const stopRed = document.createElementNS(SVG_NS, "stop");
    stopRed.setAttribute("offset", "100%");
    stopRed.setAttribute("stop-color", "#f16363");

    gradient.appendChild(stopGreen);
    gradient.appendChild(stopYellow);
    gradient.appendChild(stopRed);
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const fullArc = arcPath(centerX, centerY, radius, 180, 0);
    createArc(svg, fullArc, "url(#ghrm-risk-gradient)", 24);

    const innerTrack = document.createElementNS(SVG_NS, "path");
    innerTrack.setAttribute("d", arcPath(centerX, centerY, radius - 22, 180, 0));
    innerTrack.setAttribute("fill", "none");
    innerTrack.setAttribute("stroke", "rgba(186, 206, 234, 0.22)");
    innerTrack.setAttribute("stroke-width", "3");
    svg.appendChild(innerTrack);

    const needleAngle = valueToAngle(value);
    const needleTip = polarToCartesian(centerX, centerY, radius - 28, needleAngle);
    const needle = document.createElementNS(SVG_NS, "line");
    needle.setAttribute("x1", String(centerX));
    needle.setAttribute("y1", String(centerY));
    needle.setAttribute("x2", needleTip.x.toFixed(2));
    needle.setAttribute("y2", needleTip.y.toFixed(2));
    needle.setAttribute("stroke", "#f8fafc");
    needle.setAttribute("stroke-width", "3");
    needle.setAttribute("stroke-linecap", "round");
    svg.appendChild(needle);

    const needleHub = document.createElementNS(SVG_NS, "circle");
    needleHub.setAttribute("cx", String(centerX));
    needleHub.setAttribute("cy", String(centerY));
    needleHub.setAttribute("r", "7");
    needleHub.setAttribute("fill", "#f8fafc");
    svg.appendChild(needleHub);

    const minText = document.createElementNS(SVG_NS, "text");
    minText.setAttribute("x", String(centerX - radius - 22));
    minText.setAttribute("y", String(centerY + 8));
    minText.setAttribute("class", "ghrm-gauge-bound");
    minText.textContent = "0";
    svg.appendChild(minText);

    const maxText = document.createElementNS(SVG_NS, "text");
    maxText.setAttribute("x", String(centerX + radius + 6));
    maxText.setAttribute("y", String(centerY + 8));
    maxText.setAttribute("class", "ghrm-gauge-bound");
    maxText.textContent = "100";
    svg.appendChild(maxText);

    const valueText = document.createElementNS(SVG_NS, "text");
    valueText.setAttribute("x", String(centerX));
    valueText.setAttribute("y", String(centerY - 38));
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("class", "ghrm-gauge-value");
    valueText.textContent = String(Math.round(value));
    svg.appendChild(valueText);

    const subtitleText = document.createElementNS(SVG_NS, "text");
    subtitleText.setAttribute("x", String(centerX));
    subtitleText.setAttribute("y", String(centerY - 14));
    subtitleText.setAttribute("text-anchor", "middle");
    subtitleText.setAttribute("class", "ghrm-gauge-caption");
    subtitleText.textContent = "Function Risk Score";
    svg.appendChild(subtitleText);

    container.appendChild(svg);
  }

  window.GitRiskGauge = {
    render: renderGauge
  };
})();
