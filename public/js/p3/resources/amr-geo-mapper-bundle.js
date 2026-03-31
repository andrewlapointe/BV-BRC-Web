/**
 * Stateless API client for AMR GeoMapper backend.
 */

/**
 * Fetch configuration for a given pathogen.
 * @param {string} baseUrl - API base URL (no trailing slash)
 * @param {string} pathogen - Pathogen name
 * @returns {Promise<Object>} Parsed config JSON
 */
async function fetchConfig(baseUrl, pathogen) {
  const url = `${baseUrl}/config?pathogen=${encodeURIComponent(pathogen)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching config: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error || `HTTP ${res.status}`;
    throw new Error(`Failed to fetch config: ${msg}`);
  }
  return res.json();
}

/**
 * Fetch aggregated data for a given pathogen and filters.
 * @param {string} baseUrl - API base URL (no trailing slash)
 * @param {string} pathogen - Pathogen name
 * @param {Object} filters - Filter parameters
 * @returns {Promise<Object>} Parsed data JSON
 */
async function fetchData(baseUrl, pathogen, filters = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathogen, filters }),
    });
  } catch (err) {
    throw new Error(`Network error fetching data: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error || `HTTP ${res.status}`;
    throw new Error(`Failed to fetch data: ${msg}`);
  }
  return res.json();
}

/**
 * Dynamically loads Leaflet and Chart.js at runtime.
 * Idempotent — safe to call multiple times.
 */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function loadStylesheet(href, target) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  target.appendChild(link);
}

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const CHARTJS_JS = "https://cdn.jsdelivr.net/npm/chart.js";
const MARKERCLUSTER_CSS =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
const MARKERCLUSTER_DEFAULT_CSS =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
const MARKERCLUSTER_JS =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js";

/**
 * Load Leaflet, Chart.js, and Leaflet.markercluster, injecting CSS into both
 * document.head and the provided shadowRoot (needed for rendering inside Shadow DOM).
 * @param {ShadowRoot} shadowRoot
 */
async function loadDependencies(shadowRoot) {
  if (!window.L) {
    loadStylesheet(LEAFLET_CSS, document.head);
    await loadScript(LEAFLET_JS);
  }

  // Always ensure Leaflet CSS is in the shadow root
  if (!shadowRoot.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    loadStylesheet(LEAFLET_CSS, shadowRoot);
  }

  // Load markercluster after Leaflet (it extends L)
  if (!L.MarkerClusterGroup) {
    loadStylesheet(MARKERCLUSTER_CSS, document.head);
    loadStylesheet(MARKERCLUSTER_DEFAULT_CSS, document.head);
    await loadScript(MARKERCLUSTER_JS);
  }

  // Ensure markercluster CSS is in the shadow root
  if (!shadowRoot.querySelector(`link[href="${MARKERCLUSTER_CSS}"]`)) {
    loadStylesheet(MARKERCLUSTER_CSS, shadowRoot);
  }
  if (!shadowRoot.querySelector(`link[href="${MARKERCLUSTER_DEFAULT_CSS}"]`)) {
    loadStylesheet(MARKERCLUSTER_DEFAULT_CSS, shadowRoot);
  }

  if (!window.Chart) {
    await loadScript(CHARTJS_JS);
  }
}

/**
 * Creates single-ring doughnut pie charts for map markers using Chart.js.
 * Accepts pre-aggregated API data directly.
 * @class PieChart
 */
class PieChart {
  /**
   * @param {Object} options
   * @param {number} options.size - Chart size in pixels
   * @param {ShadowRoot} options.shadowRoot - Shadow DOM root
   */
  constructor({ size, shadowRoot }) {
    this.size = size;
    this.shadowRoot = shadowRoot;
  }

  /**
   * Create a pie chart element from pre-aggregated data.
   * @param {Object} pieChartData - { category, values: { label: count, ... } }
   * @param {Object} colorMap - { label: hexColor, ... }
   * @returns {HTMLElement|null} Chart container or null if no data
   */
  create(pieChartData, colorMap, { showOther = true } = {}) {
    if (!pieChartData?.values) return null;

    const MAX_SLICES = 5;

    // Sort entries by count descending and keep top 5
    const entries = Object.entries(pieChartData.values)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) return null;

    let labels, counts;
    if (entries.length <= MAX_SLICES) {
      labels = entries.map(([l]) => l);
      counts = entries.map(([, c]) => c);
    } else {
      const top = entries.slice(0, MAX_SLICES);
      labels = top.map(([l]) => l);
      counts = top.map(([, c]) => c);
      if (showOther) {
        const otherCount = entries
          .slice(MAX_SLICES)
          .reduce((sum, [, c]) => sum + c, 0);
        labels.push("Other");
        counts.push(otherCount);
      }
    }

    const backgroundColor = labels.map(
      (label) => colorMap?.[label] ?? "#999999",
    );

    const container = document.createElement("div");
    container.style.position = "relative";
    container.style.width = `${this.size}px`;
    container.style.height = `${this.size}px`;
    container.style.overflow = "visible";

    const canvas = document.createElement("canvas");
    canvas.width = this.size;
    canvas.height = this.size;
    canvas.style.width = `${this.size}px`;
    canvas.style.height = `${this.size}px`;
    container.appendChild(canvas);

    const chart = new Chart(canvas.getContext("2d"), {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: counts,
            backgroundColor,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        events: [],
        cutout: 0,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });

    container._pieCharts = [chart];
    container._destroyPieCharts = () => chart?.destroy?.();

    return container;
  }
}

/**
 * Creates and manages pie chart markers on the Leaflet map.
 * Uses Leaflet.markercluster to group nearby markers into aggregated pie charts.
 */
class MapMarkerManager {
  /**
   * @param {L.Map} map - Leaflet map instance
   * @param {ShadowRoot} shadowRoot - Shadow DOM root
   */
  constructor(map, shadowRoot) {
    this._map = map;
    this._shadowRoot = shadowRoot;
    this._markers = [];
    this._clusterGroup = null;
  }

  /**
   * Render pie chart markers from API data.
   * @param {Array} markers - data.markers array from API
   * @param {Object} pieChartConfig - config.mapOptions.pieChart
   * @param {Function} [onMarkerClick] - Callback when a marker is clicked, receives location name
   */
  render(markers, pieChartConfig, onMarkerClick) {
    this.clearMarkers();

    if (!markers || markers.length === 0) return;

    const config = pieChartConfig ?? {};
    this._minSize = config.minSize ?? 40;
    this._maxSize = config.maxSize ?? 120;
    this._colors = config.colors ?? {};
    this._showOther = config.showOther !== false;

    // Reference count is the largest single location's sample count
    this._referenceCount = Math.max(
      1,
      ...markers.map((m) =>
        Object.values(m.pieChart?.values ?? {}).reduce((a, b) => a + b, 0),
      ),
    );

    this._clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 60,
      iconCreateFunction: (cluster) => this._createClusterIcon(cluster),
    });

    // Listen for cluster hover to show tooltip
    this._clusterGroup.on("clustermouseover", (e) => {
      const cluster = e.layer;
      if (!cluster.getTooltip()) {
        const children = cluster.getAllChildMarkers();
        const html = this._buildClusterTooltipHtml(children);
        cluster
          .bindTooltip(html, { className: "country-tooltip" })
          .openTooltip();
      }
    });

    for (const markerData of markers) {
      const total = Object.values(markerData.pieChart?.values ?? {}).reduce(
        (a, b) => a + b,
        0,
      );
      const size = this._computeSize(
        total,
        this._referenceCount,
        this._minSize,
        this._maxSize,
      );

      const pieChart = new PieChart({ size, shadowRoot: this._shadowRoot });
      const content = pieChart.create(markerData.pieChart, this._colors, {
        showOther: this._showOther,
      });
      if (!content) continue;

      const icon = L.divIcon({
        className: "pie-chart-marker",
        html: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([markerData.lat, markerData.lng], { icon });

      // Store data on marker for cluster aggregation
      marker._pieChartData = markerData.pieChart;
      marker._pieChartContent = content;
      marker._locationName = markerData.location;

      // Attach pie chart DOM when marker is added to the map
      marker.on("add", () => {
        const el = marker.getElement();
        if (el) {
          el.innerHTML = "";
          el.appendChild(content);
        }
      });

      // Tooltip with location name, breakdown, and total
      marker.bindTooltip(
        this._buildTooltipHtml(
          markerData.location,
          markerData.pieChart,
          this._colors,
          total,
          this._showOther,
        ),
        { className: "country-tooltip" },
      );

      // Click handler — show charts for this location
      marker.on("click", () => {
        if (onMarkerClick) {
          onMarkerClick(markerData.location);
        }
      });

      this._markers.push(marker);
      this._clusterGroup.addLayer(marker);
    }

    this._map.addLayer(this._clusterGroup);
  }

  /**
   * Create a cluster icon by aggregating pie chart data from all child markers.
   * @param {L.MarkerCluster} cluster
   * @returns {L.DivIcon}
   */
  _createClusterIcon(cluster) {
    const children = cluster.getAllChildMarkers();

    // Aggregate values across all children
    const aggregated = {};
    for (const child of children) {
      const values = child._pieChartData?.values ?? {};
      for (const [label, count] of Object.entries(values)) {
        aggregated[label] = (aggregated[label] ?? 0) + count;
      }
    }

    const total = Object.values(aggregated).reduce((a, b) => a + b, 0);
    const size = this._computeSize(
      total,
      this._referenceCount,
      this._minSize,
      this._maxSize,
    );

    const pieChart = new PieChart({ size, shadowRoot: this._shadowRoot });
    const content = pieChart.create({ values: aggregated }, this._colors, {
      showOther: this._showOther,
    });

    return L.divIcon({
      className: "pie-chart-cluster",
      html: content ?? "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  _buildClusterTooltipHtml(children) {
    // Aggregate values across all children
    const aggregated = {};
    let totalSamples = 0;
    const locationNames = [];
    for (const child of children) {
      locationNames.push(child._locationName);
      const values = child._pieChartData?.values ?? {};
      for (const [label, count] of Object.entries(values)) {
        aggregated[label] = (aggregated[label] ?? 0) + count;
        totalSamples += count;
      }
    }

    // Location list (cap at 8 to keep tooltip manageable)
    const MAX_LOCATIONS = 8;
    const sortedLocations = locationNames.sort();
    let locationHtml;
    if (sortedLocations.length <= MAX_LOCATIONS) {
      locationHtml = sortedLocations.map((n) => `<div>${n}</div>`).join("");
    } else {
      const shown = sortedLocations.slice(0, MAX_LOCATIONS);
      const remaining = sortedLocations.length - MAX_LOCATIONS;
      locationHtml =
        shown.map((n) => `<div>${n}</div>`).join("") +
        `<div class="italic">+${remaining} more</div>`;
    }

    // Aggregated breakdown
    const MAX_SLICES = 5;
    const entries = Object.entries(aggregated)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    let displayEntries;
    if (entries.length <= MAX_SLICES) {
      displayEntries = entries;
    } else {
      const top = entries.slice(0, MAX_SLICES);
      if (this._showOther) {
        const otherCount = entries
          .slice(MAX_SLICES)
          .reduce((sum, [, c]) => sum + c, 0);
        displayEntries = [...top, ["Other", otherCount]];
      } else {
        displayEntries = top;
      }
    }

    const rows = displayEntries
      .map(([label, count]) => {
        const color = this._colors[label] ?? "#999";
        return (
          `<div style="display:flex;align-items:center;gap:6px;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>` +
          `<span>${label}: ${count}</span>` +
          `</div>`
        );
      })
      .join("");

    return (
      `<div><strong>${children.length} locations</strong> (${totalSamples} samples)</div>` +
      `<div style="margin-top:4px;margin-bottom:6px;padding-left:2px;">${locationHtml}</div>` +
      `<div style="border-top:1px solid #ddd;padding-top:4px;">${rows}</div>`
    );
  }

  _buildTooltipHtml(location, pieChartData, colors, total, showOther = true) {
    const MAX_SLICES = 5;
    const entries = Object.entries(pieChartData?.values ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    let displayEntries;
    if (entries.length <= MAX_SLICES) {
      displayEntries = entries;
    } else {
      const top = entries.slice(0, MAX_SLICES);
      if (showOther) {
        const otherCount = entries
          .slice(MAX_SLICES)
          .reduce((sum, [, c]) => sum + c, 0);
        displayEntries = [...top, ["Other", otherCount]];
      } else {
        displayEntries = top;
      }
    }

    const rows = displayEntries
      .map(([label, count]) => {
        const color = colors[label] ?? "#999";
        return (
          `<div style="display:flex;align-items:center;gap:6px;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>` +
          `<span>${label}: ${count}</span>` +
          `</div>`
        );
      })
      .join("");

    return (
      `<div><strong>${location}</strong> (${total} samples)</div>` +
      `<div style="margin-top:4px;">${rows}</div>`
    );
  }

  _computeSize(count, referenceCount, minSize, maxSize) {
    if (count <= 0) return Math.round(minSize);

    const t = Math.min(1, Math.sqrt(count) / Math.sqrt(referenceCount));
    return Math.round(minSize + (maxSize - minSize) * t);
  }

  clearMarkers() {
    for (const marker of this._markers) {
      const content = marker._pieChartContent;
      if (content?._destroyPieCharts) {
        content._destroyPieCharts();
      }
    }
    if (this._clusterGroup) {
      this._map.removeLayer(this._clusterGroup);
      this._clusterGroup.clearLayers();
      this._clusterGroup = null;
    }
    this._markers = [];
  }

  destroy() {
    this.clearMarkers();
  }
}

/**
 * Manages choropleth country shading on the Leaflet map.
 * Accepts pre-aggregated values keyed by ISO 3166-1 alpha-2 codes from the API.
 */
class CountryShadingManager {
  /**
   * @param {L.Map} map - Leaflet map instance
   * @param {ShadowRoot} shadowRoot - Shadow DOM root
   */
  constructor(map, shadowRoot) {
    this._map = map;
    this._shadowRoot = shadowRoot;
    this._choroplethLayer = null;
    this._geoJson = null;
  }

  /**
   * Fetch GeoJSON and render the choropleth layer.
   * @param {Object} choroplethData - { "US": 72.5, "BR": 65.3, ... }
   * @param {Object} choroplethConfig - config.mapOptions.choropleth
   */
  async render(choroplethData, choroplethConfig) {
    if (!this._geoJson) {
      const url =
        "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load country GeoJSON");
      this._geoJson = await res.json();
    }

    this._removeLayer();

    const config = choroplethConfig ?? {};
    const noDataColor = config.noDataColor ?? "#f0f0f0";
    const fillOpacity = config.fillOpacity ?? 0.6;
    const borderColor = config.borderColor ?? "#cbcbcb";
    const borderWeight = config.borderWeight ?? 1;
    const gradient = config.colorGradient ?? ["#f7fbff", "#08306b"];

    const values = Object.values(choroplethData).filter((v) => v > 0);
    const minValue = values.length > 0 ? Math.min(...values) : 0;
    const maxValue = values.length > 0 ? Math.max(...values) : 1;

    this._choroplethLayer = L.geoJSON(this._geoJson, {
      style: (feature) => {
        const iso = feature.properties["ISO3166-1-Alpha-2"];
        if (iso === "-99") {
          return {
            fillColor: noDataColor,
            fillOpacity,
            color: borderColor,
            weight: borderWeight,
          };
        }
        const value = choroplethData[iso] ?? 0;
        return {
          fillColor:
            value > 0
              ? this._getColorForValue(value, minValue, maxValue, gradient)
              : noDataColor,
          fillOpacity,
          color: borderColor,
          weight: borderWeight,
        };
      },
      onEachFeature: () => {},
    });

    this._choroplethLayer.addTo(this._map);
    this._choroplethLayer.bringToBack();

    const showLegend = config.showLegend !== false;
    if (showLegend) {
      this._createLegend(minValue, maxValue, gradient, noDataColor);
    } else {
      const existing = this._shadowRoot.getElementById(
        "country-shading-legend",
      );
      if (existing) existing.remove();
    }
  }

  /**
   * Create or update the choropleth legend.
   */
  _createLegend(minValue, maxValue, gradient, noDataColor) {
    let legend = this._shadowRoot.getElementById("country-shading-legend");
    if (legend) legend.remove();

    const mapArea = this._shadowRoot.getElementById("map-area");
    if (!mapArea) return;

    legend = document.createElement("div");
    legend.id = "country-shading-legend";
    legend.style.display = "block";

    const gradientCSS = `linear-gradient(to right, ${gradient.join(", ")})`;
    const minLabel = minValue > 0 ? minValue.toFixed(1) : "0";
    const maxLabel = maxValue.toFixed(1);

    legend.innerHTML = `
      <div class="legend-title">Samples Per Million People</div>
      <div class="legend-gradient">
        <div class="legend-gradient-bar" style="background: ${gradientCSS};"></div>
        <div class="legend-labels">
          <span>${minLabel}</span>
          <span>${maxLabel}</span>
        </div>
      </div>
      <div class="legend-no-data">
        <div class="legend-no-data-swatch" style="background-color: ${noDataColor};"></div>
        <span class="legend-no-data-label">No data</span>
      </div>
    `;

    mapArea.appendChild(legend);
  }

  _getColorForValue(value, min, max, gradient) {
    if (gradient.length === 0) return "#cccccc";
    if (gradient.length === 1) return gradient[0];

    const logMin = Math.log10(Math.max(min, 1));
    const logMax = Math.log10(Math.max(max, 1));
    const logValue = Math.log10(Math.max(value, 1));

    let t = logMax === logMin ? 0.5 : (logValue - logMin) / (logMax - logMin);
    t = Math.max(0, Math.min(1, t));

    const gradientPos = t * (gradient.length - 1);
    const lowerIndex = Math.floor(gradientPos);
    const upperIndex = Math.min(lowerIndex + 1, gradient.length - 1);
    const localT = gradientPos - lowerIndex;

    return this._interpolateColor(
      gradient[lowerIndex],
      gradient[upperIndex],
      localT,
    );
  }

  _interpolateColor(color1, color2, t) {
    const c1 = this._hexToRgb(color1);
    const c2 = this._hexToRgb(color2);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  _removeLayer() {
    if (this._choroplethLayer && this._map.hasLayer(this._choroplethLayer)) {
      this._map.removeLayer(this._choroplethLayer);
      this._choroplethLayer = null;
    }
  }

  destroy() {
    this._removeLayer();
    const legend = this._shadowRoot.getElementById("country-shading-legend");
    if (legend) legend.remove();
    this._geoJson = null;
  }
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for HTML insertion
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes a string for use in HTML attributes.
 * Same as escapeHtml but exported separately for clarity.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for attribute values
 */
function escapeAttr(str) {
  return escapeHtml(str);
}

class HTMLhelper {
  constructor() {}

  static color = {
    textDefault: "#000",
    menuBG: "#f8f9fa",
    filterMenuSectionBG: "#fff",
    whiteBtnHover: "#f3f4f6",
    scrollThumbFill: "#adb5bd",
    headerBorder: "#929292",
  };

  static menuHeader(title, id, filterCount = 0) {
    let button;
    let filterCounter;
    const filterIconHeight = 20;
    const safeId = escapeAttr(id);
    if (id === "filter") {
      button = /*html*/ `
      <div id="sidebar-menu-control-group">
        <button id="show-filters-button" class="sidebar-btn" data-placement="right" data-tooltip="Filter menu">
          <div class="icon" id="filterToggle">
          ${HTMLhelper.icons("filter", filterIconHeight)}

          </div>
        </button>
      </div>

      `;
      filterCounter = /*html*/ `
          <div id="total-filter-count" class="filter-counter ${
            filterCount === 0 ? "hide" : ""
          }">
            ${filterCount}
          </div>
        `;
    } else {
      button = /*html*/ `
        <button id="chart-fullscreen-btn" class="chart-toolbar-btn" data-placement="bottom" data-tooltip="Maximize chart to view all data"></button>

        <button id="${safeId}-menu-chevron" class="p-0 chevron-button justify-content-center align-items-center">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f">
            <g transform="rotate(90, 480, -480)">
              <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/>
            </g>
          </svg>
        </button>
      `;
    }

    return /*html*/ `
          <div
            id="menu-header"
            class="d-flex flex-row justify-content-between align-items-center"
          >
            <div class="menu-title mb-0"><h2>${escapeHtml(title)}${filterCounter ? filterCounter : ""}</h2></div>
            <div class="d-flex align-items-center">



              <div id="charts-header-btns" class="">
                ${button}
              </div>
            </div>
          </div>
        `;
  }

  static filterRow(section, value, index, isChecked) {
    const safeSection = escapeAttr(section);
    const safeValue = escapeAttr(value);
    return /*html*/ `
      <div class="form-check d-flex flex-row justify-content-start w-100 text-break">
        <input class="form-check-input" filter-type="${safeSection}" value="${safeValue}"
        type="checkbox" id="${safeSection}-option-${index}" ${
          isChecked ? "checked" : ""
        } />
        <label class="form-check-label ${
          section === "species" ? "italic" : ""
        }" for="${safeSection}-option-${index}">${escapeHtml(value)}</label>
        <span class="filter-option-count" data-count="0">0</span>
      </div>
          `;
  }

  static icons(key, height = 24) {
    switch (key) {
      case "download":
        return /*html*/ `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height="${height}px"
          viewBox="0 -960 960 960"
          width="${height}px"
          fill="#1f1f1f"
        >
          <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
        </svg>`;

      case "settingsCog":
        return /*html*/ `
          <svg id="chart-settings-svg" style="max-height: 20px;" xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>
        `;

      case "filter":
        return /*html*/ `
          <svg width="${height}px" height="${height}px" viewBox="0 0 40 40">
            <line class="top" x1="0" y1="7" x2="40" y2="7" />
            <line class="middle" x1="8" y1="20" x2="32" y2="20" />
            <line class="bottom" x1="15" y1="33" x2="25  " y2="33" />
          </svg>
        `;
      case "nofilter":
        return /*html*/ `
<svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M791-55 55-791l57-57 736 736-57 57ZM633-440l-80-80h167v80h-87ZM433-640l-80-80h487v80H433Zm-33 400v-80h160v80H400ZM240-440v-80h166v80H240ZM120-640v-80h86v80h-86Z"/></svg>
        `;
      case "edit":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>
        `;
      case "share":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM200-440q17 0 28.5-11.5T240-480q0-17-11.5-28.5T200-520q-17 0-28.5 11.5T160-480q0 17 11.5 28.5T200-440Zm480-280q17 0 28.5-11.5T720-760q0-17-11.5-28.5T680-800q-17 0-28.5 11.5T640-760q0 17 11.5 28.5T680-720Zm0 520ZM200-480Zm480-280Z"/></svg>
        `;
      case "info":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
        `;
      case "maximize":
        return /*html*/ `
          <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z"/></svg>
          `;
      case "minimize":
        return /*html*/ `
          <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="#1f1f1f"><path d="M240-120v-120H120v-80h200v200h-80Zm400 0v-200h200v80H720v120h-80ZM120-640v-80h120v-120h80v200H120Zm520 0v-200h80v120h120v80H640Z"/></svg>
        `;
      case "stackedBar":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M160-160v-440h160v440H160Zm0-480v-160h160v160H160Zm240 480v-320h160v320H400Zm0-360v-160h160v160H400Zm240 360v-200h160v200H640Zm0-240v-160h160v160H640Z"/></svg>
        `;
      case "lineGraph":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="m140-100-60-60 300-300 160 160 284-320 56 56-340 384-160-160-240 240Zm0-240-60-60 300-300 160 160 284-320 56 56-340 384-160-160-240 240Z"/></svg>
        `;
      case "stackedArea":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M120-160v-520l160 120 200-280 200 160h160v520H120Zm200-120 160-220 280 218v-318H652L496-725 298-447l-98-73v144l120 96Z"/></svg>
        `;
      case "plus":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="currentColor"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>
        `;
      case "close":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 -960 960 960" width="${height}px" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
        `;

      case "github":
        return /*html*/ `
        <svg xmlns="http://www.w3.org/2000/svg" height="${height}px" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M237.9 461.4C237.9 463.4 235.6 465 232.7 465C229.4 465.3 227.1 463.7 227.1 461.4C227.1 459.4 229.4 457.8 232.3 457.8C235.3 457.5 237.9 459.1 237.9 461.4zM206.8 456.9C206.1 458.9 208.1 461.2 211.1 461.8C213.7 462.8 216.7 461.8 217.3 459.8C217.9 457.8 216 455.5 213 454.6C210.4 453.9 207.5 454.9 206.8 456.9zM251 455.2C248.1 455.9 246.1 457.8 246.4 460.1C246.7 462.1 249.3 463.4 252.3 462.7C255.2 462 257.2 460.1 256.9 458.1C256.6 456.2 253.9 454.9 251 455.2zM316.8 72C178.1 72 72 177.3 72 316C72 426.9 141.8 521.8 241.5 555.2C254.3 557.5 258.8 549.6 258.8 543.1C258.8 536.9 258.5 502.7 258.5 481.7C258.5 481.7 188.5 496.7 173.8 451.9C173.8 451.9 162.4 422.8 146 415.3C146 415.3 123.1 399.6 147.6 399.9C147.6 399.9 172.5 401.9 186.2 425.7C208.1 464.3 244.8 453.2 259.1 446.6C261.4 430.6 267.9 419.5 275.1 412.9C219.2 406.7 162.8 398.6 162.8 302.4C162.8 274.9 170.4 261.1 186.4 243.5C183.8 237 175.3 210.2 189 175.6C209.9 169.1 258 202.6 258 202.6C278 197 299.5 194.1 320.8 194.1C342.1 194.1 363.6 197 383.6 202.6C383.6 202.6 431.7 169 452.6 175.6C466.3 210.3 457.8 237 455.2 243.5C471.2 261.2 481 275 481 302.4C481 398.9 422.1 406.6 366.2 412.9C375.4 420.8 383.2 435.8 383.2 459.3C383.2 493 382.9 534.7 382.9 542.9C382.9 549.4 387.5 557.3 400.2 555C500.2 521.8 568 426.9 568 316C568 177.3 455.5 72 316.8 72zM169.2 416.9C167.9 417.9 168.2 420.2 169.9 422.1C171.5 423.7 173.8 424.4 175.1 423.1C176.4 422.1 176.1 419.8 174.4 417.9C172.8 416.3 170.5 415.6 169.2 416.9zM158.4 408.8C157.7 410.1 158.7 411.7 160.7 412.7C162.3 413.7 164.3 413.4 165 412C165.7 410.7 164.7 409.1 162.7 408.1C160.7 407.5 159.1 407.8 158.4 408.8zM190.8 444.4C189.2 445.7 189.8 448.7 192.1 450.6C194.4 452.9 197.3 453.2 198.6 451.6C199.9 450.3 199.3 447.3 197.3 445.4C195.1 443.1 192.1 442.8 190.8 444.4zM179.4 429.7C177.8 430.7 177.8 433.3 179.4 435.6C181 437.9 183.7 438.9 185 437.9C186.6 436.6 186.6 434 185 431.7C183.6 429.4 181 428.4 179.4 429.7z"/></svg>
        `;
      default:
        return "";
    }
  }

  static menuStructure(filterSections, totalFilterCount = 0) {
    let sections = "";
    filterSections.forEach((section) => {
      const safeName = escapeHtml(section.name);
      const safeNameAttr = escapeAttr(section.name);
      const safeColumn = escapeAttr(section.column ?? "");
      const safeIcon = section.icon ? escapeAttr(section.icon) : "";
      sections += /*html*/ `
        <div
            class="menu-section" id="${safeNameAttr.toLowerCase()}-section"
            data-filter-column="${safeColumn}"
        >
            <div class="menu-section-header d-flex justify-content-between mt-2 mb-3">
              <div class="menu-section-header-left">

                ${
                  section.icon
                    ? `<img width="24px" height="24px" src="${safeIcon}" />`
                    : ""
                }
                <h3>
                ${safeName}
                </h3>
              </div>
              <div class="d-flex flex-row justify-end align-center">
                <div class="section-filter-count filter-counter hide">0</div>
                <svg class="chevron chevron-button subsection-chevron" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/></svg>
              </div>

            </div>
            ${
              section.searchable
                ? `
              <input
              type="text"
              id="${safeNameAttr}SearchBox"
              placeholder="Search ${safeName}..."
              class="form-control mb-2 menu-section-search"
              />
              `
                : ""
            }

            <div class="w-100 ${
              section.scrollable ? "scroll-container" : ""
            } menu-sub-section">
                ${section.string}
            </div>
        </div>
    `;
    });
    return /*html*/ `
    <div id="sidebar-menu-group" class="d-flex flex-row h-100">
      <div id="filter-menu-container" class="menu-box shadow-normal h-100 z-2">
        ${HTMLhelper.menuHeader("Filters", "filter", totalFilterCount)}

        <div class="menu-content scroll-container invisible">
          ${sections}
        </div>
        <button class="invisible clear-btn filter-menu-btn justify-center align-center">
          <span>${HTMLhelper.icons("nofilter")}</span>Clear Filters
        </button>
      </div>
    </div>

    `;
  }

  static dateSelectionWidget(startDate = null, endDate = null) {
    const braceColor = "#4682B4";
    const svgCircle = (id) => {
      return /*html*/ `
      <svg id="${id}" height="14px" viewbox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <circle r="5" cx="5" cy="5" fill="${braceColor}"/>
      </svg>
    `;
    };
    const widget =
      /*html*/
      `
    <div id="date-widget">
      <div id="dw-bar" style="background-color: ${braceColor}"></div>
      <label id="dw-start-label" for="dw-start-date-input">Start Date</label>
      ${svgCircle("dw-start-circle")}
      <input ${
        !!startDate ? `value=${escapeAttr(startDate)}` : ""
      } type="text" id="dw-start-date-input" name="dw-start-date-input" class="date-text-input" filter-type="date-start" />
      <p id="dw-start-hint" class="form-hint">YYYY/MM/DD or YYYY</p>

      <label id="dw-end-label" for="dw-end-date-input">End Date</label>
      ${svgCircle("dw-end-circle")}
      <input ${
        !!endDate ? `value=${escapeAttr(endDate)}` : ""
      } type="text" id="dw-end-date-input" name="dw-end-date-input" class="date-text-input" filter-type="date-end"/>
      <p id="dw-end-hint" class="form-hint">YYYY/MM/DD or YYYY</p>

      <p
        id="dw-error"
        class="form-hint hide"
        style="color: #b00020; margin-top: 0.25rem;"
      ></p>
    </div>
    `;

    return widget;
  }
}

class FilterMenuManager {
  /**
   * @param {ShadowRoot} shadowRoot
   * @param {Array} filterConfigs - Filter definitions from API config
   * @param {Object} filters - Mutable filters state object (shared with host)
   * @param {Function} onFilterChange - Callback when filters change
   */
  constructor(shadowRoot, filterConfigs, filters, onFilterChange, apiUrl) {
    this._shadowRoot = shadowRoot;
    this._filterConfigs = filterConfigs ?? [];
    this._filters = filters;
    this._onFilterChange = onFilterChange;
    this._apiUrl = apiUrl ?? "";
    this._abortController = null;
  }

  render() {
    this._abortController?.abort();
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    const sections = this._buildSections();
    const activeCount = this._countActiveFilters();

    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    menuEl.innerHTML = HTMLhelper.menuStructure(sections, activeCount);

    this._hydrateSectionCounters();
    this._bindCheckboxes(signal);
    this._bindDateInputs(signal);
    this._bindSidebarToggle(signal);
    this._bindSectionChevrons(signal);
    this._bindSearch(signal);
    this._bindClearAll(signal);
  }

  _resolveIconUrl(iconPath) {
    if (!iconPath) return null;
    if (/^https?:\/\//.test(iconPath)) return iconPath;
    // Resolve relative paths against the API base URL
    const base = this._apiUrl.replace(/\/+$/, "");
    return `${base}${iconPath.startsWith("/") ? "" : "/"}${iconPath}`;
  }

  destroy() {
    this._abortController?.abort();
    this._abortController = null;
  }

  // --- Build sections for HTMLhelper.menuStructure ---

  _buildSections() {
    return this._filterConfigs.map((config) => {
      let htmlString = "";
      let searchable = false;
      let scrollable = true;

      if (config.type === "dropdown") {
        const selected = this._filters[config.name] ?? [];
        const options = config.options ?? [];
        searchable = options.length > 10;

        options.forEach((value, i) => {
          const checked = selected.includes(value);
          htmlString += HTMLhelper.filterRow(config.name, value, i, checked);
        });
      } else if (config.type === "date_range") {
        scrollable = false;
        const dateFilter = this._filters[config.name];
        const startDate = dateFilter?.start ?? "";
        const endDate = dateFilter?.end ?? "";
        htmlString = HTMLhelper.dateSelectionWidget(startDate, endDate);
      }

      return {
        name: config.label,
        column: config.name,
        string: htmlString,
        icon: config.svgIcon ? this._resolveIconUrl(config.svgIcon) : null,
        searchable,
        scrollable,
      };
    });
  }

  // --- Active filter counting ---

  _countActiveFilters() {
    let total = 0;
    for (const config of this._filterConfigs) {
      const val = this._filters[config.name];
      if (!val) continue;
      if (Array.isArray(val)) {
        total += val.length;
      } else if (typeof val === "object") {
        // date_range: count start and end separately
        if (val.start) total++;
        if (val.end) total++;
      }
    }
    return total;
  }

  _countSectionFilters(name) {
    const val = this._filters[name];
    if (!val) return 0;
    if (Array.isArray(val)) return val.length;
    if (typeof val === "object") {
      return (val.start ? 1 : 0) + (val.end ? 1 : 0);
    }
    return 0;
  }

  _hydrateSectionCounters() {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    const totalEl = menuEl.querySelector("#total-filter-count");
    const total = this._countActiveFilters();
    if (totalEl) {
      totalEl.textContent = total;
      totalEl.classList.toggle("hide", total === 0);
    }

    menuEl.querySelectorAll(".menu-section").forEach((section) => {
      const col = section.dataset.filterColumn;
      if (!col) return;
      const counter = section.querySelector(".section-filter-count");
      if (!counter) return;
      const count = this._countSectionFilters(col);
      counter.textContent = count;
      counter.classList.toggle("hide", count === 0);
    });
  }

  _updateCounters() {
    this._hydrateSectionCounters();
  }

  // --- Event binding ---

  _bindCheckboxes(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    menuEl.querySelectorAll(".form-check-input").forEach((checkbox) => {
      checkbox.addEventListener(
        "change",
        () => {
          const filterName = checkbox.getAttribute("filter-type");
          const value = checkbox.value;

          if (!this._filters[filterName]) {
            this._filters[filterName] = [];
          }

          if (checkbox.checked) {
            if (!this._filters[filterName].includes(value)) {
              this._filters[filterName].push(value);
            }
          } else {
            this._filters[filterName] = this._filters[filterName].filter(
              (v) => v !== value,
            );
            if (this._filters[filterName].length === 0) {
              delete this._filters[filterName];
            }
          }

          this._updateCounters();
          this._onFilterChange();
        },
        { signal },
      );
    });
  }

  _bindDateInputs(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    const startInput = menuEl.querySelector(
      'input.date-text-input[filter-type="date-start"]',
    );
    const endInput = menuEl.querySelector(
      'input.date-text-input[filter-type="date-end"]',
    );
    const errorEl = menuEl.querySelector("#dw-error");

    if (!startInput && !endInput) return;

    // Find the date_range config to get its name
    const dateConfig = this._filterConfigs.find((c) => c.type === "date_range");
    if (!dateConfig) return;

    const applyDateRange = () => {
      const rawStart = startInput?.value.trim() ?? "";
      const rawEnd = endInput?.value.trim() ?? "";

      // Clear error state
      [startInput, endInput].forEach((el) => {
        if (el) el.classList.remove("invalid-date");
      });
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.classList.add("hide");
      }

      const startValid = rawStart ? this._validateDate(rawStart) : null;
      const endValid = rawEnd ? this._validateDate(rawEnd) : null;

      let hasError = false;
      if (rawStart && !startValid) {
        startInput?.classList.add("invalid-date");
        hasError = true;
      }
      if (rawEnd && !endValid) {
        endInput?.classList.add("invalid-date");
        hasError = true;
      }

      if (hasError) {
        if (errorEl) {
          errorEl.textContent = "Enter dates as YYYY/MM/DD or YYYY.";
          errorEl.classList.remove("hide");
        }
        return;
      }

      // Validate start <= end when both provided
      if (startValid && endValid && startValid > endValid) {
        startInput?.classList.add("invalid-date");
        endInput?.classList.add("invalid-date");
        if (errorEl) {
          errorEl.textContent =
            "Start date must be before or equal to the end date.";
          errorEl.classList.remove("hide");
        }
        return;
      }

      // Update filters
      if (startValid || endValid) {
        this._filters[dateConfig.name] = {};
        if (startValid) this._filters[dateConfig.name].start = rawStart;
        if (endValid) this._filters[dateConfig.name].end = rawEnd;
      } else {
        delete this._filters[dateConfig.name];
      }

      this._updateCounters();
      this._onFilterChange();
    };

    [startInput, endInput].forEach((input) => {
      if (!input) return;
      input.addEventListener("change", applyDateRange, { signal });
    });
  }

  /**
   * Validate a date string. Accepts YYYY or YYYY/MM/DD.
   * @returns {Date|false}
   */
  _validateDate(raw) {
    const dateString = String(raw || "").trim();
    if (dateString.length < 4) return false;

    const yearOnly = /^(\d{4})$/;
    const ymd = /^(\d{4})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/;

    let match;
    if ((match = dateString.match(yearOnly))) {
      return new Date(+match[1], 0, 1);
    }

    if ((match = dateString.match(ymd))) {
      const year = +match[1];
      const month = +match[2];
      const day = +match[3];

      const daysInMonth = [
        31,
        year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ];

      if (day >= 1 && day <= daysInMonth[month - 1]) {
        return new Date(year, month - 1, day);
      }
    }

    return false;
  }

  _bindSidebarToggle(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    const sidebarContainer = menuEl.querySelector("div#sidebar-menu-group");
    const showFiltersBtn = menuEl.querySelector("#show-filters-button");
    if (!sidebarContainer || !showFiltersBtn) return;

    showFiltersBtn.addEventListener(
      "click",
      () => {
        sidebarContainer.classList.toggle("open");
        sidebarContainer
          .querySelector(".menu-content")
          ?.classList.toggle("invisible");
        sidebarContainer
          .querySelector(".clear-btn")
          ?.classList.toggle("invisible");

        const totalFilterCounter = menuEl.querySelector("#total-filter-count");
        if (totalFilterCounter) {
          const count = Number(totalFilterCounter.textContent || "0");
          if (sidebarContainer.classList.contains("open")) {
            totalFilterCounter.classList.add("hide");
          } else if (count !== 0) {
            totalFilterCounter.classList.remove("hide");
          }
        }

        // Animate the filter icon lines
        const topLine = showFiltersBtn.querySelector("line.top");
        const bottomLine = showFiltersBtn.querySelector("line.bottom");
        showFiltersBtn.classList.toggle("filter-active");

        if (topLine && bottomLine) {
          const y1Top = parseFloat(topLine.getAttribute("y1") || "0");
          const y1Bottom = parseFloat(bottomLine.getAttribute("y1") || "0");
          const translation = (y1Bottom - y1Top) / 2;

          if (showFiltersBtn.classList.contains("filter-active")) {
            requestAnimationFrame(() => {
              topLine.setAttribute(
                "transform",
                `rotate(45) translate(0, ${translation})`,
              );
              bottomLine.setAttribute(
                "transform",
                `rotate(-45) translate(0, -${translation})`,
              );
              bottomLine.setAttribute("x1", "0");
              bottomLine.setAttribute("x2", "40");
            });
          } else {
            requestAnimationFrame(() => {
              topLine.setAttribute("transform", "rotate(0) translate(0, 0)");
              bottomLine.setAttribute("transform", "rotate(0) translate(0, 0)");
              bottomLine.setAttribute("x1", "15");
              bottomLine.setAttribute("x2", "25");
            });
          }
        }
      },
      { signal },
    );
  }

  _bindSectionChevrons(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    const sectionHeaders = menuEl.querySelectorAll("div.menu-section-header");

    sectionHeaders.forEach((section) => {
      const chevron = section.querySelector(".chevron");
      if (!chevron) return;

      chevron.addEventListener(
        "click",
        () => {
          // Close other open sections
          sectionHeaders.forEach((other) => {
            if (
              section !== other &&
              other.parentElement.classList.contains("menu-opened")
            ) {
              other.parentElement.classList.toggle("menu-opened");
              other.classList.toggle("flip");
            }
          });
          section.parentElement.classList.toggle("menu-opened");
          section.classList.toggle("flip");
        },
        { signal },
      );
    });
  }

  _bindSearch(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    menuEl
      .querySelectorAll(".menu-section input.menu-section-search")
      .forEach((searchInput) => {
        searchInput.addEventListener(
          "input",
          function () {
            const filterContainer = this.parentNode;
            const searchTerm = this.value.toLowerCase();

            filterContainer.querySelectorAll(".form-check").forEach((box) => {
              const label = box.querySelector(".form-check-label");
              const labelText = label?.textContent.toLowerCase() ?? "";

              if (!labelText.includes(searchTerm)) {
                box.setAttribute("style", "display: none !important");
              } else {
                box.style.display = "";
              }
            });
          },
          { signal },
        );
      });
  }

  _bindClearAll(signal) {
    const menuEl = this._shadowRoot.getElementById("menu");
    if (!menuEl) return;

    const sidebarContainer = menuEl.querySelector("div#sidebar-menu-group");
    const clearBtn = sidebarContainer?.querySelector(".clear-btn");
    if (!clearBtn) return;

    clearBtn.addEventListener(
      "click",
      () => {
        // Clear all filter state
        for (const key of Object.keys(this._filters)) {
          delete this._filters[key];
        }

        // Uncheck all checkboxes
        sidebarContainer
          .querySelectorAll("input.form-check-input")
          .forEach((cb) => {
            cb.checked = false;
          });

        // Clear date inputs
        sidebarContainer
          .querySelectorAll(".date-text-input")
          .forEach((input) => {
            input.value = "";
          });

        // Clear date error
        const errorEl = sidebarContainer.querySelector("#dw-error");
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.classList.add("hide");
        }

        // Clear invalid-date styling
        sidebarContainer
          .querySelectorAll(".invalid-date")
          .forEach((el) => el.classList.remove("invalid-date"));

        this._updateCounters();
        this._onFilterChange();
      },
      { signal },
    );
  }
}

// BaseChart.js

// --- Shared Constants ---
const CHART_DEFAULTS = {
  BASE_COLORS: [
    "#3b82f6", // blue
    "#ef4444", // red
    "#10b981", // green
    "#f59e0b", // amber
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#84cc16", // lime
    "#f97316", // orange
    "#6366f1", // indigo
  ],
};

class BaseChart {
  constructor(container, config = {}) {
    this.container = container;
    this.config = config;
    this.chartInstance = null;
    this.resizeObserver = null;
  }

  /**
   * Main render entry point.
   * @param {object} chartData - Pre-aggregated chart data from the API
   */
  render(chartData) {
    this.destroy();

    if (typeof Chart !== "undefined") {
      Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    }

    const { data, options, layoutLogic } = this._prepareConfig(chartData);

    this._setupContainer(layoutLogic);

    const canvas = this._createCanvas();
    this.chartInstance = new Chart(canvas.getContext("2d"), {
      type: this._getType(),
      data: data,
      options: options,
      plugins: this._getPlugins(),
    });

    this._attachResizeObserver();
    this.container._chartRenderer = this;
  }

  destroy() {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.container.innerHTML = "";
  }

  // --- Helpers ---

  _createCanvas() {
    const canvas = document.createElement("canvas");
    canvas.role = "img";
    Object.assign(this.container.style, {
      position: "relative",
      minWidth: "0",
    });
    this.container.appendChild(canvas);
    return canvas;
  }

  _attachResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chartInstance && this.chartInstance.canvas.isConnected) {
        this.chartInstance.resize();
      }
    });
    this.resizeObserver.observe(this.container);
  }

  _getType() {
    throw new Error("Method '_getType()' must be implemented.");
  }
  _prepareConfig(chartData) {
    throw new Error("Method '_prepareConfig()' must be implemented.");
  }
  _getPlugins() {
    return [];
  }

  _setupContainer() {
    Object.assign(this.container.style, {
      flex: "1 1 auto",
      minHeight: "0",
      minWidth: "0",
      position: "relative",
      width: "100%",
      height: "100%",
    });
  }

  // --- Shared Utility Methods ---

  /**
   * Generate an array of colors for chart datasets
   * @param {number} count - Number of colors needed
   * @returns {Array<string>} Array of color hex codes
   */
  _generateColors(count) {
    const baseColors = CHART_DEFAULTS.BASE_COLORS;

    if (count <= baseColors.length) {
      return baseColors.slice(0, count);
    }

    const colors = [...baseColors];
    for (let i = baseColors.length; i < count; i++) {
      const hue = (i * 137.508) % 360; // Golden angle for distribution
      colors.push(`hsl(${hue}, 70%, 50%)`);
    }
    return colors;
  }

  /**
   * Convert hex color to rgba string
   * @param {string} hex - Hex color code (e.g., "#3b82f6")
   * @param {number} alpha - Alpha value (0-1)
   * @returns {string} RGBA color string
   */
  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Plugin to display message when chart has no data
   * @param {string} message - Message to display
   * @returns {object} Chart.js plugin
   */
  _getNoDataPlugin(message = "No matching data") {
    return {
      id: "noData",
      afterDraw(chart) {
        const hasData = chart.data.datasets.some(
          (ds) => ds.data && ds.data.length > 0 && ds.data.some((v) => v > 0),
        );
        if (hasData) return;
        const {
          ctx,
          chartArea: { width, height },
        } = chart;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(100,100,100,0.8)";
        ctx.fillText(message, width / 2, height / 2);
        ctx.restore();
      },
    };
  }
}

// StackedBarChart.js

// --- Layout Constants ---
const LAYOUT = {
  MIN_BAR_PX: 15,
  MAX_BAR_PX: 80,
  GAP_PX: 3,
  MIN_SIDE_PAD_PX: 8,
  BAR_PCT_SINGLE: 0.75,
};

/**
 * StackedBarChart - Accepts pre-aggregated bar chart data from the API.
 *
 * Expected chartData shape:
 * {
 *   title: "Resistance by Drug Class",
 *   type: "stacked",
 *   categories: ["Beta-lactam", ...],
 *   groups: ["Resistant", "Susceptible"],
 *   data: { "Beta-lactam": { "Resistant": 960, "Susceptible": 440 }, ... },
 *   colors: { "Resistant": "#e74c3c", "Susceptible": "#2ecc71" }
 * }
 */
class StackedBarChart extends BaseChart {
  constructor(container, config) {
    super(container, config);
    this.layoutState = {
      calculatedTickWidth: 0,
      calculatedGroupWidth: 0,
      calculatedSidePad: 0,
    };
  }

  _getType() {
    return "bar";
  }

  _prepareConfig(chartData) {
    const categories = chartData.categories || [];
    const groups = chartData.groups || [];
    const dataMap = chartData.data || {};
    const colorMap = chartData.colors || {};
    const title = chartData.title || "Bar Chart";

    // Build one dataset per group
    const fallbackColors = this._generateColors(groups.length);
    const datasets = groups.map((group, i) => {
      const color = colorMap[group] || fallbackColors[i];
      const values = categories.map((cat) => dataMap[cat]?.[group] ?? 0);
      return {
        label: group,
        data: values,
        backgroundColor: color,
        borderColor: "#fff",
        borderWidth: 1,
        minBarLength: 6,
      };
    });

    // Layout
    const layoutLogic = {
      labelsCount: categories.length,
      barsPerCategory: 1, // stacked, so 1 stack group
      barPercentage: LAYOUT.BAR_PCT_SINGLE,
    };

    // Options
    const options = {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      indexAxis: "x",
      scales: {
        y: {
          beginAtZero: true,
          stacked: true,
          grace: 5,
          min: 0,
          grid: { display: false },
        },
        x: {
          grid: { display: false },
          ticks: { display: false, padding: 10 },
          stacked: true,
        },
      },
      datasets: {
        bar: {
          barThickness: (ctx) =>
            this._clampBarThickness(ctx, 1, LAYOUT.BAR_PCT_SINGLE),
          barPercentage: LAYOUT.BAR_PCT_SINGLE,
          categoryPercentage: 1,
        },
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: title,
          color: "#000",
          position: "top",
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (items.length === 0) return "";
              return items[0].label;
            },
            label: (ctx) => {
              const label = ctx.dataset.label || "Value";
              const value = ctx.raw ?? 0;
              return `${label}: ${value.toLocaleString()}`;
            },
          },
        },
      },
    };

    return {
      data: { labels: categories, datasets },
      options,
      layoutLogic,
    };
  }

  // --- Layout Helpers ---

  _setupContainer(layoutLogic) {
    const { labelsCount, barsPerCategory, barPercentage } = layoutLogic;

    const { MIN_BAR_PX, MIN_SIDE_PAD_PX, GAP_PX } = LAYOUT;
    const minBarsBlock = (MIN_BAR_PX * barsPerCategory) / barPercentage;
    const minCategoryWidth = minBarsBlock + MIN_SIDE_PAD_PX * 2;
    const neededWidth = Math.ceil(labelsCount * (minCategoryWidth + GAP_PX));

    Object.assign(this.container.style, {
      flex: "1 1 auto",
      minHeight: "0",
      minWidth: "0",
      position: "relative",
      width: `max(100%, ${neededWidth}px)`,
      height: "100%",
    });
  }

  _clampBarThickness(chartCtx, barsPerCategory, barPercentage) {
    const chart = chartCtx.chart;
    const area = chart.chartArea;
    if (!area || (!area.width && !area.height)) return;

    const { MIN_BAR_PX, MAX_BAR_PX, MIN_SIDE_PAD_PX } = LAYOUT;

    const catSize = area.width;
    const catCount = Math.max(1, chart.data.labels?.length ?? 1);
    const categoryWidth = catSize / catCount;

    const sidePad = Math.max(MIN_SIDE_PAD_PX, Math.ceil(0.4 * MIN_BAR_PX));
    const availableForBars = Math.max(0, categoryWidth - sidePad * 2);

    const naturalBarPx = (availableForBars * barPercentage) / barsPerCategory;
    const barPx = Math.max(
      MIN_BAR_PX,
      Math.min(MAX_BAR_PX, Math.floor(naturalBarPx)),
    );

    this.layoutState.calculatedGroupWidth = barPx * barsPerCategory;
    this.layoutState.calculatedSidePad = sidePad;
    this.layoutState.calculatedTickWidth =
      this.layoutState.calculatedGroupWidth + sidePad * 2 + LAYOUT.GAP_PX;

    return barPx;
  }

  // --- Plugins ---

  _getPlugins() {
    return [
      this._getNoDataPlugin("No data available"),
      this._getBaselineCategoryLabelsPlugin(),
    ];
  }

  _getBaselineCategoryLabelsPlugin() {
    const self = this;

    return {
      id: "baselineCategoryLabels",
      afterDatasetsDraw(chart, _args, opts) {
        const {
          ctx,
          scales: { x, y },
          chartArea,
        } = chart;
        const labels = chart.data.labels || [];
        const y0 = y.getPixelForValue(0);

        const { calculatedGroupWidth, calculatedSidePad } = self.layoutState;
        const margin = Math.min(calculatedSidePad - 2, 6);

        const glowBlur = opts?.glow ?? 0;
        const glowColor = opts?.glowColor ?? "rgba(255,255,255,.5)";
        const haloWidth = opts?.halo ?? 0;
        const haloColor = opts?.haloColor ?? "rgba(255,255,255,.85)";

        ctx.save();
        ctx.beginPath();
        ctx.rect(
          chartArea.left,
          chartArea.top,
          chartArea.width,
          chartArea.height,
        );
        ctx.clip();

        const fontFamily =
          chart.options.font?.family ||
          chart.defaults?.font?.family ||
          "sans-serif";
        ctx.font = opts?.font || `500 14px ${fontFamily}`;
        ctx.fillStyle = opts?.color || "#000";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";

        labels.forEach((label, i) => {
          const xPos = x.getPixelForTick(i);
          const labelX = xPos - calculatedGroupWidth / 2 + 2;

          ctx.save();
          ctx.translate(labelX, y0);
          ctx.rotate(-Math.PI / 2);

          if (glowBlur > 0) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = glowBlur;
          }

          if (haloWidth > 0) {
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            ctx.strokeStyle = haloColor;
            ctx.lineWidth = haloWidth;
            ctx.strokeText(label, margin, 0);
          }

          if (glowBlur > 0) ctx.shadowBlur = 0;
          ctx.fillText(label, margin, 0);
          ctx.restore();
        });

        ctx.restore();
      },
    };
  }
}

// LineChart.js

/**
 * LineChart - Accepts pre-aggregated time-series data from the API.
 *
 * Expected chartData shape:
 * {
 *   title: "Resistance Over Time",
 *   series: {
 *     "Beta-lactam": [{ date: "2018-01-01", value: 520 }, ...],
 *     "Quinolone": [{ date: "2018-01-01", value: 280 }, ...],
 *   },
 *   colors: { "Beta-lactam": "#e74c3c", "Quinolone": "#3498db" }
 * }
 */
class LineChart extends BaseChart {
  constructor(container, config) {
    super(container, config);
  }

  _getType() {
    return "line";
  }

  _prepareConfig(chartData) {
    const seriesMap = chartData.series || {};
    const colorMap = chartData.colors || {};
    const title = chartData.title || "Line Chart";

    const seriesNames = Object.keys(seriesMap);

    // Extract labels (dates) from the first series
    const firstSeries = seriesMap[seriesNames[0]] || [];
    const labels = firstSeries.map((pt) => this._formatDate(pt.date));

    // Build one dataset per series
    const fallbackColors = this._generateColors(seriesNames.length);
    const datasets = seriesNames.map((name, i) => {
      const color = colorMap[name] || fallbackColors[i];
      const points = seriesMap[name] || [];
      return {
        label: name,
        data: points.map((pt) => pt.value),
        borderColor: color,
        backgroundColor: color + "20",
        fill: false,
        tension: 0.1,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
      };
    });

    const options = {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          type: "category",
          title: { display: true, text: "Date" },
          ticks: { maxRotation: 45, minRotation: 45 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Value" },
          ticks: { precision: 0 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          display: false,
          position: "bottom",
          labels: {
            font: { size: 12 },
            usePointStyle: true,
            padding: 15,
          },
        },
        title: {
          display: true,
          text: title,
          color: "#000",
          position: "top",
        },
        tooltip: {
          itemSort: (a, b) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0),
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || "Value";
              const value = ctx.parsed.y ?? 0;
              return `${label}: ${value.toLocaleString()}`;
            },
          },
        },
      },
    };

    return {
      data: { labels, datasets },
      options,
      layoutLogic: { title },
    };
  }

  /**
   * Format a date string for display on x-axis
   * @param {string} dateStr - ISO date string (e.g., "2018-01-01")
   * @returns {string} Formatted date label
   */
  _formatDate(dateStr) {
    if (!dateStr) return "";
    // Extract year from ISO date string
    const year = dateStr.substring(0, 4);
    return year;
  }

  _getPlugins() {
    return [this._getNoDataPlugin()];
  }
}

// StackedAreaChart.js

/**
 * StackedAreaChart - Accepts pre-aggregated time-series data from the API.
 * Same data shape as LineChart but renders as stacked filled areas.
 *
 * Expected chartData shape:
 * {
 *   title: "Cumulative Resistance by Drug Class",
 *   series: {
 *     "Beta-lactam": [{ date: "2018-01-01", value: 520 }, ...],
 *     "Quinolone": [{ date: "2018-01-01", value: 280 }, ...],
 *   },
 *   colors: { "Beta-lactam": "#e74c3c", "Quinolone": "#3498db" }
 * }
 */
class StackedAreaChart extends BaseChart {
  constructor(container, config) {
    super(container, config);
  }

  _getType() {
    return "line";
  }

  _prepareConfig(chartData) {
    const seriesMap = chartData.series || {};
    const colorMap = chartData.colors || {};
    const title = chartData.title || "Area Chart";

    const seriesNames = Object.keys(seriesMap);

    // Extract labels (dates) from the first series
    const firstSeries = seriesMap[seriesNames[0]] || [];
    const labels = firstSeries.map((pt) => this._formatDate(pt.date));

    // Build one dataset per series, filled and stacked
    const fallbackColors = this._generateColors(seriesNames.length);
    const datasets = seriesNames.map((name, i) => {
      const color = colorMap[name] || fallbackColors[i];
      const points = seriesMap[name] || [];
      return {
        label: name,
        data: points.map((pt) => pt.value),
        borderColor: color,
        backgroundColor: color + "80",
        fill: true,
        stack: "single",
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
      };
    });

    const options = {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          type: "category",
          title: { display: true, text: "Date" },
          ticks: { maxRotation: 45, minRotation: 45 },
          grid: { display: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: "Value" },
          ticks: { precision: 0 },
          grace: 5,
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          display: false,
          position: "bottom",
          labels: {
            font: { size: 12 },
            usePointStyle: true,
            padding: 15,
          },
        },
        title: {
          display: true,
          text: title,
          color: "#000",
          position: "top",
        },
        tooltip: {
          itemSort: (a, b) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0),
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || "Value";
              const value = ctx.parsed.y ?? 0;
              return `${label}: ${value.toLocaleString()}`;
            },
          },
        },
      },
    };

    return {
      data: { labels, datasets },
      options,
      layoutLogic: { title },
    };
  }

  /**
   * Format a date string for display on x-axis
   * @param {string} dateStr - ISO date string (e.g., "2018-01-01")
   * @returns {string} Formatted date label
   */
  _formatDate(dateStr) {
    if (!dateStr) return "";
    const year = dateStr.substring(0, 4);
    return year;
  }

  _getPlugins() {
    return [this._getNoDataPlugin()];
  }
}

class TooltipManager {
  constructor(host) {
    this.host = host;
    this._tooltipAbort = null;
    this._openTip = null;
  }

  setupTooltips({ hoverDelay = 1000, focusDelay = 0 } = {}) {
    const root = this.host.shadowRoot ?? this.host.shadow;
    const hasPopover = "showPopover" in HTMLElement.prototype;

    if (this._tooltipAbort) this._tooltipAbort.abort();
    this._tooltipAbort = new AbortController();

    if (this._openTip && hasPopover && this._openTip.isConnected) {
      try {
        this._openTip.hidePopover();
      } catch {
        // hidePopover throws if popover is not currently shown - this is expected
      }
    }
    this._openTip = null;

    root.querySelectorAll(".mgo-tooltip").forEach((el) => el.remove());

    // Fallback for old browsers
    let portal, portalText;
    const bodyPortalShow = (btn, text) => {
      if (!portal) {
        portal = document.createElement("div");
        portalText = document.createElement("div");
        Object.assign(portal.style, {
          position: "fixed",
          zIndex: "2147483647",
          pointerEvents: "none",
        });
        Object.assign(portalText.style, {
          background: "#111",
          color: "#fff",
          padding: "6px 8px",
          borderRadius: "8px",
          boxShadow: "0 8px 24px rgba(0,0,0,.25)",
          font: "12px/1.25 system-ui, sans-serif",
          margin: 0,
        });
        portal.appendChild(portalText);
        document.body.appendChild(portal);
      }
      portalText.textContent = text;
      const r = btn.getBoundingClientRect();
      const x = Math.min(
        Math.max(r.left + r.width / 2, 8),
        window.innerWidth - 8,
      );
      const y = Math.max(r.bottom + 4, 8);
      portal.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
      portal.style.display = "block";
      window.addEventListener("scroll", bodyPortalHide, {
        once: true,
        signal: this._tooltipAbort.signal,
      });
    };
    const bodyPortalHide = () => {
      if (portal) portal.style.display = "none";
    };

    root.querySelectorAll("[data-tooltip]").forEach((btn, i) => {
      const tip = document.createElement("div");
      tip.className = "mgo-tooltip";
      tip.setAttribute("popover", "manual");
      tip.textContent = btn.getAttribute("data-tooltip");
      const place = btn.getAttribute("data-placement");
      if (place) tip.dataset.placement = place;

      btn.style.anchorName = `--btn-anchor-${i}`;
      tip.style.positionAnchor = `--btn-anchor-${i}`;

      root.appendChild(tip);

      const connected = () =>
        btn.isConnected && tip.isConnected && root.isConnected;
      const show = () => {
        if (!connected()) return;

        if (this._openTip && this._openTip !== tip) {
          try {
            hasPopover ? this._openTip.hidePopover() : bodyPortalHide();
          } catch {
            // hidePopover throws if popover is not currently shown - this is expected
          }
        }

        if (hasPopover) {
          void tip.offsetWidth;
          tip.showPopover();
        } else {
          bodyPortalShow(btn, tip.textContent);
        }
        this._openTip = tip;
      };
      const hide = () => {
        if (this._openTip === tip) {
          if (hasPopover && tip.isConnected) {
            try {
              tip.hidePopover();
            } catch {
              // hidePopover throws if popover is not currently shown - this is expected
            }
          } else {
            bodyPortalHide();
          }
          this._openTip = null;
        }
      };

      let hoverTimer = null;

      const scheduleShow = (delay) => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(show, delay);
      };
      const cancelShow = () => {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      };

      btn.addEventListener("mouseenter", () => scheduleShow(hoverDelay), {
        signal: this._tooltipAbort.signal,
      });
      btn.addEventListener(
        "mouseleave",
        () => {
          cancelShow();
          setTimeout(() => hide(), 120);
        },
        { signal: this._tooltipAbort.signal },
      );

      btn.addEventListener("focusin", () => scheduleShow(focusDelay), {
        signal: this._tooltipAbort.signal,
      });
      btn.addEventListener(
        "focusout",
        () => {
          cancelShow();
          hide();
        },
        { signal: this._tooltipAbort.signal },
      );

      btn.addEventListener(
        "pointerdown",
        () => {
          cancelShow();
          hide();
        },
        { signal: this._tooltipAbort.signal },
      );
    });
  }

  destroy() {
    this._tooltipAbort?.abort();
    this._tooltipAbort = null;
    this._openTip = null;
  }
}

function debounce(func, duration) {
  let timeout;
  return function (...args) {
    const effect = () => {
      timeout = null;
      return func.apply(this, args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(effect, duration);
  };
}

var bootstrapStyles =
  '/*\r\n * Minimal Bootstrap 5.3.0 extract\r\n * Only includes the utility classes used by AMR GeoMapper.\r\n * Source: https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css\r\n */\r\n\r\n:host {\r\n  box-sizing: border-box;\r\n  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",\r\n    "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji",\r\n    "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";\r\n  line-height: 1.5;\r\n}\r\n\r\n*,\r\n*::before,\r\n*::after {\r\n  box-sizing: border-box;\r\n}\r\n\r\n/* Reboot — margin/font normalization from Bootstrap 5.3.0 */\r\nh1, h2, h3, h4, h5, h6 {\r\n  margin-top: 0;\r\n  margin-bottom: 0.5rem;\r\n  font-weight: 500;\r\n  line-height: 1.2;\r\n}\r\np {\r\n  margin-top: 0;\r\n  margin-bottom: 1rem;\r\n}\r\nlabel {\r\n  display: inline-block;\r\n}\r\n\r\n/* Display */\r\n.d-flex {\r\n  display: flex !important;\r\n}\r\n\r\n/* Flex direction */\r\n.flex-row {\r\n  flex-direction: row !important;\r\n}\r\n.flex-column {\r\n  flex-direction: column !important;\r\n}\r\n.flex-wrap {\r\n  flex-wrap: wrap !important;\r\n}\r\n\r\n/* Justify content */\r\n.justify-content-start {\r\n  justify-content: flex-start !important;\r\n}\r\n.justify-content-center {\r\n  justify-content: center !important;\r\n}\r\n.justify-content-between {\r\n  justify-content: space-between !important;\r\n}\r\n\r\n/* Align items */\r\n.align-items-center {\r\n  align-items: center !important;\r\n}\r\n\r\n/* Position */\r\n.position-relative {\r\n  position: relative !important;\r\n}\r\n\r\n/* Sizing */\r\n.w-100 {\r\n  width: 100% !important;\r\n}\r\n.h-100 {\r\n  height: 100% !important;\r\n}\r\n\r\n/* Margins */\r\n.mb-0 {\r\n  margin-bottom: 0 !important;\r\n}\r\n.mb-2 {\r\n  margin-bottom: 0.5rem !important;\r\n}\r\n.mb-3 {\r\n  margin-bottom: 1rem !important;\r\n}\r\n.me-2 {\r\n  margin-inline-end: 0.5rem !important;\r\n}\r\n.mt-2 {\r\n  margin-top: 0.5rem !important;\r\n}\r\n\r\n/* Padding */\r\n.p-0 {\r\n  padding: 0 !important;\r\n}\r\n\r\n/* Form check */\r\n.form-check {\r\n  display: block;\r\n  min-height: 1.5rem;\r\n  padding-left: 1.5em;\r\n  margin-bottom: 0.125rem;\r\n}\r\n.form-check-input {\r\n  --bs-form-check-bg: #fff;\r\n  flex-shrink: 0;\r\n  width: 1em;\r\n  height: 1em;\r\n  margin-top: 0.25em;\r\n  vertical-align: top;\r\n  appearance: auto;\r\n  background-color: var(--bs-form-check-bg);\r\n  background-image: var(--bs-form-check-bg-image);\r\n  background-repeat: no-repeat;\r\n  background-position: center;\r\n  background-size: contain;\r\n  border: 1px solid rgba(0, 0, 0, 0.25);\r\n  border-radius: 0.25em;\r\n}\r\n.form-check-input[type="checkbox"] {\r\n  border-radius: 0.25em;\r\n}\r\n.form-check-input[type="radio"] {\r\n  border-radius: 50%;\r\n}\r\n.form-check-input:checked {\r\n  background-color: #0d6efd;\r\n  border-color: #0d6efd;\r\n}\r\n.form-check-input:focus {\r\n  border-color: #86b7fe;\r\n  outline: 0;\r\n  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);\r\n}\r\n.form-check-label {\r\n  cursor: pointer;\r\n}\r\n\r\n/* Form control */\r\n.form-control {\r\n  display: block;\r\n  width: 100%;\r\n  padding: 0.375rem 0.75rem;\r\n  font-size: 1rem;\r\n  font-weight: 400;\r\n  line-height: 1.5;\r\n  color: #212529;\r\n  appearance: none;\r\n  background-color: #fff;\r\n  background-clip: padding-box;\r\n  border: 1px solid #dee2e6;\r\n  border-radius: 0.375rem;\r\n  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;\r\n}\r\n.form-control:focus {\r\n  color: #212529;\r\n  background-color: #fff;\r\n  border-color: #86b7fe;\r\n  outline: 0;\r\n  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);\r\n}\r\n.form-control::placeholder {\r\n  color: #6c757d;\r\n  opacity: 1;\r\n}\r\n\r\n/* Text */\r\n.text-break {\r\n  word-wrap: break-word !important;\r\n  word-break: break-word !important;\r\n}\r\n\r\n/* Visibility */\r\n.invisible {\r\n  visibility: hidden !important;\r\n}\r\n\r\n/* Shadow */\r\n.shadow {\r\n  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15) !important;\r\n}\r\n\r\n/* Z-index */\r\n.z-2 {\r\n  z-index: 2 !important;\r\n}\r\n.z-3 {\r\n  z-index: 3 !important;\r\n}\r\n\r\n/* Button */\r\n.btn {\r\n  --bs-btn-padding-x: 0.75rem;\r\n  --bs-btn-padding-y: 0.375rem;\r\n  --bs-btn-font-size: 1rem;\r\n  --bs-btn-font-weight: 400;\r\n  --bs-btn-line-height: 1.5;\r\n  --bs-btn-border-width: 1px;\r\n  --bs-btn-border-radius: 0.375rem;\r\n  display: inline-block;\r\n  padding: var(--bs-btn-padding-y) var(--bs-btn-padding-x);\r\n  font-family: var(--bs-btn-font-family);\r\n  font-size: var(--bs-btn-font-size);\r\n  font-weight: var(--bs-btn-font-weight);\r\n  line-height: var(--bs-btn-line-height);\r\n  color: var(--bs-btn-color);\r\n  text-align: center;\r\n  text-decoration: none;\r\n  vertical-align: middle;\r\n  cursor: pointer;\r\n  user-select: none;\r\n  border: var(--bs-btn-border-width) solid var(--bs-btn-border-color);\r\n  border-radius: var(--bs-btn-border-radius);\r\n  background-color: var(--bs-btn-bg);\r\n  transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out,\r\n    border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;\r\n}\r\n\r\n/* Border */\r\n.border {\r\n  border: 1px solid #dee2e6 !important;\r\n}\r\n';

var styles =
  '/* Main styles for mGO web component */\n\n:host {\n  /* Color variables (mirrors HTMLhelper.color object) */\n  --color-text-default: #000;\n  --color-menu-bg: #f8f9fa;\n  --color-filter-menu-section-bg: #fff;\n  --color-white-btn-hover: #f3f4f6;\n  --color-scroll-thumb-fill: #adb5bd;\n  --color-header-border: #929292;\n\n  --filter-menu-width: 290px;\n  --filter-menu-padding: 16px;\n  --filter-btn-size: 20px;\n\n  --search-shadow-px: 3px;\n  --search-shadow: 0 0 0 var(--search-shadow-px) rgba(80, 120, 255, 0.15);\n  --menu-shadow: 0 16px 48px rgba(0, 0, 0, 0.24);\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  height: 100% !important;\n  min-height: 400px;\n  overflow: hidden;\n}\n\n#map {\n  position: absolute;\n  inset: 0;\n  z-index: 0;\n}\n\n/* Leaflet container styles for Shadow DOM */\n#map .leaflet-container {\n  width: 100%;\n  height: 100%;\n  z-index: 0;\n}\n\n#map .leaflet-tile-pane {\n  z-index: 1;\n}\n\n#map .leaflet-overlay-pane {\n  z-index: 2;\n}\n\n#map .leaflet-marker-pane {\n  z-index: 3;\n}\n\n#map .leaflet-tooltip-pane {\n  z-index: 4;\n}\n\n#map .leaflet-popup-pane {\n  z-index: 5;\n}\n\n#map .leaflet-control {\n  z-index: 6;\n}\n\n/* Leaflet pie chart marker styles */\n.pie-chart-marker {\n  background: transparent !important;\n  border: none !important;\n}\n\n.leaflet-marker-icon.pie-chart-marker {\n  background: transparent;\n  border: none;\n}\n\n/* Cluster pie chart markers */\n.pie-chart-cluster {\n  background: transparent !important;\n  border: none !important;\n}\n\n/* Country shading tooltip */\n.country-tooltip {\n  background-color: rgba(255, 255, 255, 0.95);\n  border: 1px solid #999;\n  border-radius: 4px;\n  padding: 6px 10px;\n  font-size: 12px;\n  font-weight: 500;\n  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);\n}\n\n/* Country shading legend */\n#country-shading-legend {\n  position: absolute;\n  bottom: 20px;\n  /* 52px for the closed sidebar toggle (padding + icon + padding) + 20px gap to match bottom */\n  left: calc(var(--filter-menu-padding) * 2 + var(--filter-btn-size) + 20px);\n  z-index: 2;\n  background-color: rgba(255, 255, 255, 0.95);\n  border: 1px solid #ccc;\n  border-radius: 6px;\n  padding: 10px 12px;\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);\n  font-size: 11px;\n  min-width: 140px;\n  max-width: 180px;\n}\n\n#country-shading-legend.sidebar-closed {\n  left: calc(var(--filter-menu-padding) * 2 + var(--filter-btn-size) + 20px);\n}\n\n#country-shading-legend .legend-title {\n  font-weight: 600;\n  font-size: 12px;\n  margin-bottom: 8px;\n  color: #333;\n}\n\n#country-shading-legend .legend-gradient {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n#country-shading-legend .legend-gradient-bar {\n  height: 12px;\n  width: 100%;\n  border-radius: 2px;\n  border: 1px solid #ddd;\n}\n\n#country-shading-legend .legend-labels {\n  display: flex;\n  justify-content: space-between;\n  font-size: 10px;\n  color: #666;\n  margin-top: 2px;\n}\n\n#country-shading-legend .legend-no-data {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin-top: 8px;\n  padding-top: 8px;\n  border-top: 1px solid #eee;\n}\n\n#country-shading-legend .legend-no-data-swatch {\n  width: 16px;\n  height: 12px;\n  border-radius: 2px;\n  border: 1px solid #ddd;\n}\n\n#country-shading-legend .legend-no-data-label {\n  font-size: 10px;\n  color: #666;\n}\n#amr-geo-mapper-wrapper {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  flex: 1 1 0;\n  min-height: 0;\n}\nh1 {\n  font-size: 0.8rem;\n  margin-bottom: 0;\n}\n\nh2 {\n  font-size: 1.1rem;\n  font-weight: 450;\n  margin: 0;\n}\n\ninput[type="checkbox"] {\n  border: 1px solid #dee2e6;\n}\ninput[type="checkbox"]:focus {\n  box-shadow: none;\n  border-color: #dee2e6;\n}\ninput[type="checkbox"]:hover {\n  border-color: #96989b;\n}\n\ninput[type="search"]:focus {\n  outline: none;\n  border-color: #9bb4ff;\n  box-shadow: var(--search-shadow);\n}\n\n.map-wrap {\n  position: relative;\n  overflow: hidden;\n  box-sizing: border-box;\n}\n.italic {\n  font-style: italic;\n}\n\n/* Status overlay (loading spinner, error messages) */\n.status-overlay {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  z-index: 9999;\n  background: var(--color-menu-bg, #f8f9fa);\n}\n\n.status-error {\n  text-align: center;\n  max-width: 400px;\n  padding: 2rem;\n}\n\n.status-error-icon {\n  width: 48px;\n  height: 48px;\n  border-radius: 50%;\n  background: #dc3545;\n  color: #fff;\n  font-size: 24px;\n  font-weight: 700;\n  line-height: 48px;\n  text-align: center;\n  margin: 0 auto 1rem;\n}\n\n.status-error-message {\n  font-size: 14px;\n  color: #333;\n  line-height: 1.5;\n}\n\n.status-retry-btn {\n  display: inline-block;\n  margin-top: 1rem;\n  padding: 8px 20px;\n  border: 1px solid #333;\n  border-radius: 6px;\n  background: #fff;\n  color: #333;\n  font-size: 14px;\n  cursor: pointer;\n  transition: background-color 0.2s;\n}\n.status-retry-btn:hover {\n  background: var(--color-white-btn-hover, #f3f4f6);\n}\n\n/* Warning banner for non-fatal errors */\n.status-warning {\n  position: absolute;\n  top: 10px;\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 1000;\n  background: #fff3cd;\n  color: #856404;\n  border: 1px solid #ffc107;\n  border-radius: 6px;\n  padding: 8px 16px;\n  font-size: 13px;\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);\n  cursor: pointer;\n  animation: warning-fade-in 0.3s ease;\n}\n\n@keyframes warning-fade-in {\n  from {\n    opacity: 0;\n    transform: translateX(-50%) translateY(-8px);\n  }\n  to {\n    opacity: 1;\n    transform: translateX(-50%) translateY(0);\n  }\n}\n\n/* Map loading overlay (semi-transparent, over existing map) */\n.map-loading-overlay {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  z-index: 999;\n  background: rgba(255, 255, 255, 0.5);\n  pointer-events: none;\n}\n\n/* https://css-loaders.com */\n.loader {\n  width: 100px;\n  aspect-ratio: 1;\n  border-radius: 50%;\n  border: 16px solid lightblue;\n  border-right-color: orange;\n  animation: l2 1s infinite linear;\n}\n@keyframes l2 {\n  to {\n    transform: rotate(1turn);\n  }\n}\n\n#menu,\n#charts {\n  position: absolute;\n  transition:\n    top 0.3s ease,\n    height 0.3s ease;\n  overflow: hidden;\n  top: 0;\n}\n\n#menu {\n  height: 100%;\n}\n\n#menu.menu-container {\n  pointer-events: none;\n}\n\n#sidebar-menu-group {\n  position: relative;\n  /* Slide left so only the toggle button + equal padding is visible */\n  right: calc(\n    var(--filter-menu-width, 290px) - var(--filter-menu-padding, 16px) * 2 -\n      20px\n  );\n  transition: right 0.4s ease;\n  pointer-events: auto;\n}\n#sidebar-menu-group.open {\n  position: relative;\n  right: 0px;\n}\n\n#sidebar-menu-control-group {\n  position: relative;\n  display: flex;\n  flex-direction: row;\n  justify-content: space-between;\n  align-items: center;\n  column-gap: 0.4rem;\n  margin: 0;\n  padding: 0;\n}\n\n#charts {\n  --charts-expanded-height: 90%;\n  position: absolute;\n  z-index: 5;\n  right: 10px;\n  top: 10px;\n  height: var(--charts-expanded-height);\n  width: calc(var(--charts-expanded-height) * 0.8);\n  transition:\n    width 0.4s,\n    height 0.4s 0.4s;\n  max-width: 900px;\n  overflow: visible;\n}\n\n#charts.collapsed {\n  transition:\n    height 0.4s,\n    width 0.4s 0.4s;\n  height: calc(50px - 0.5rem) !important;\n  width: 180px !important;\n}\n\n#charts.maximized {\n  position: absolute; /* stay within the map area */\n  z-index: 100;\n  margin: 0;\n  max-width: none;\n  max-height: none;\n  overflow: hidden;\n}\n\n#charts.maximized .chartSection {\n  height: 100%;\n  overflow-x: auto;\n}\n\n.chartSection canvas {\n  width: 100%;\n  height: 100%;\n  display: block;\n  overflow-x: hidden !important;\n}\n\n#charts .menu-box {\n  display: grid;\n  grid-template-rows: auto 1fr;\n  position: relative;\n  margin-left: auto;\n  padding: 0.5rem 1rem 1rem 1rem;\n  width: 100%;\n  height: 100%;\n  max-width: none;\n}\n\n#charts-header-btns {\n  display: flex;\n  flex-direction: row;\n  gap: 0.3rem;\n  align-items: center;\n  justify-content: end;\n  width: min-content;\n}\n\nbutton#charts-menu-chevron {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n#charts #charts-menu-chevron svg {\n  margin: auto;\n  transition: transform 0.4s ease;\n  transform: scaleY(-1);\n}\n\n#charts.collapsed #charts-menu-chevron svg {\n  transform: scaleY(1);\n}\n\n#charts.collapsed .genome-counter {\n  display: none;\n}\n\n#charts,\n#charts * {\n  box-sizing: border-box;\n}\n\n#chartContent,\n#charts-body {\n  flex: 1 1 auto;\n  min-height: 0;\n}\n\n#chartContent {\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  height: 100%;\n}\n\n#charts-body {\n  width: 100%;\n  flex: 1 1 auto;\n  min-height: 0;\n}\n\n#charts-toolbar {\n  display: flex;\n  flex-direction: row;\n  justify-content: space-between;\n  align-items: center;\n  width: 100%;\n  flex-shrink: 0;\n  padding-top: 4px;\n}\n\n#charts.maximized #charts-body {\n  overflow-x: auto;\n}\n\n.chart-toolbar-btn {\n  background-color: inherit;\n  border: none;\n  padding: 4px 8px;\n  margin: 0;\n  cursor: pointer;\n  font-size: 18px;\n}\n.chart-toolbar-btn.active-chart-type {\n  background-color: rgba(0, 0, 0, 0.1);\n  font-weight: 600;\n}\n#chart-type-selector {\n  display: flex;\n  flex-direction: row;\n  gap: 4px;\n  padding: 4px 8px;\n  align-items: center;\n  justify-content: center;\n  flex: 1;\n}\n.chart-type-selector-group {\n  display: flex;\n  flex-direction: row;\n  gap: 0.25rem;\n}\n#chart-type-selector .chart-toolbar-btn {\n  padding: 2px 8px;\n  font-size: 12px;\n  border-radius: 4px;\n  cursor: pointer;\n  transition: background-color 0.2s;\n}\n#chart-type-selector .chart-toolbar-btn:hover:not(:disabled) {\n  background-color: rgba(0, 0, 0, 0.05);\n}\n#chart-type-selector .chart-toolbar-btn:disabled {\n  cursor: default;\n  opacity: 0.6;\n}\n#chart-type-selector .chart-toolbar-btn.single-option {\n  cursor: default;\n}\n\n#charts-body .chartSection {\n  padding: 0;\n  height: 100%;\n}\n\n#charts-body .chartSection > canvas {\n  display: block;\n  height: 100% !important;\n  width: 100% !important;\n}\n\n#charts-body .chartSection.active-chart {\n  display: block !important;\n}\n\n.menu-box .form-check {\n  margin-left: 0;\n  width: 100%;\n  align-items: start;\n  gap: 0.25rem;\n  min-width: 0;\n  box-sizing: border-box;\n  padding-right: 0;\n}\n\n.menu-box {\n  height: 100%;\n  padding-bottom: 0;\n  padding-top: 0;\n  background-color: var(--color-menu-bg);\n  max-width: 290px;\n  overflow: hidden;\n}\n\n.menu-section {\n  overflow: hidden;\n}\n\n.menu-section > div.form-check:first-of-type {\n  margin-top: 1rem;\n}\n\n.menu-box label {\n  font-weight: 400;\n  margin-left: 0.3rem;\n}\n\n.menu-box .form-check-label {\n  flex: 1;\n  min-width: 0;\n  word-break: break-word;\n  overflow-wrap: break-word;\n}\n\n.filter-option-count {\n  margin-left: auto;\n  flex-shrink: 0;\n  font-size: 0.8rem;\n  color: #6c757d;\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n  display: none;\n}\n\n.menu-box select {\n  border-radius: 0.5rem;\n}\n\n#menu-header {\n  width: 100%;\n}\n\n#filter-menu-container {\n  display: flex;\n  gap: 0.5rem;\n  flex-direction: column;\n  padding: var(--filter-menu-padding);\n  width: var(--filter-menu-width);\n}\n\n.shadow-normal {\n  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);\n}\n\n.menu-title {\n  font-size: 1.1rem;\n  font-weight: 400;\n  white-space: nowrap;\n  overflow: hidden;\n  max-width: 100%;\n}\n.menu-title h1 {\n  text-overflow: ellipsis;\n}\n\n.genome-counter {\n  color: #666;\n  margin-left: 0.4rem;\n  white-space: nowrap;\n}\n\n.menu-content {\n  height: 100%;\n  visibility: visible;\n  display: flex;\n  flex-direction: column;\n  row-gap: 0.4rem;\n  margin-bottom: 0.4rem;\n  transition: ease 0.3s width;\n}\n\n.menu-content.scroll-container {\n  max-height: 700px;\n  overflow-y: scroll;\n  margin-right: -1rem; /*Subtract width of padding for scroll gutter*/\n}\n\n.filter-menu-btn,\n.menu-section {\n  border: 1px solid #dee2e6;\n  background-color: var(--color-filter-menu-section-bg);\n  width: 100%;\n}\n.filter-menu-btn {\n  text-align: center;\n  border-radius: 0.375rem;\n}\n\n.filter-menu-btn:hover {\n  filter: brightness(0.75);\n}\n\n.menu-section {\n  display: flex;\n  flex-direction: column;\n  padding-left: 1rem;\n  padding-right: 1rem;\n  padding-bottom: 0rem;\n  height: 44px;\n  min-height: 44px;\n  overflow-x: hidden;\n  transition:\n    flex-grow 0.4s ease,\n    min-height 0.4s ease;\n  flex-grow: 0;\n}\n\n.menu-section.menu-opened {\n  flex-grow: 1;\n  min-height: 200px;\n}\n.menu-content.scroll-container .menu-section.menu-opened:not(#date-section) {\n  min-height: 400px;\n}\n\n.date-text-input.invalid-date {\n  border-color: #dc3545;\n  outline-color: #dc3545;\n}\n\n#date-widget {\n  display: grid;\n  max-width: 100%;\n  grid-template-columns: 12px auto;\n  grid-template-rows: auto 0.5fr 0.5fr auto auto 0.5fr 0.5fr auto;\n  column-gap: 0.4rem;\n}\n#date-widget label {\n  margin: 0;\n  width: 100%;\n  grid-column: 2/3;\n}\n#date-widget label#dw-start-label {\n  grid-row: 1/2;\n}\n#date-widget label#dw-end-label {\n  grid-row: 5/6;\n}\n\n#date-widget svg {\n  width: 100%;\n  grid-column: 1/2;\n  margin: auto;\n}\n#date-widget svg#dw-start-circle {\n  grid-row: 2/4;\n}\n#date-widget svg#dw-end-circle {\n  grid-row: 6/8;\n}\n\n#date-widget div#dw-bar {\n  grid-column: 1/2;\n  grid-row: 3/7;\n  width: 4px;\n  margin-left: auto;\n  margin-right: auto;\n}\n\n#date-widget input {\n  width: 100%;\n  grid-column: 2/3;\n}\n#date-widget input#dw-start-date-input {\n  grid-row: 2/4;\n}\n#date-widget input#dw-end-date-input {\n  grid-row: 6/8;\n}\n\n#date-widget p {\n  margin: 0;\n  font-size: 0.6rem;\n  width: 100%;\n  grid-column: 2/3;\n}\n#date-widget p#dw-start-hint {\n  grid-row: 4/5;\n}\n#date-widget p#dw-end-hint {\n  grid-row: 8/9;\n}\n\ninput.form-check-input {\n  min-width: 16px;\n  height: 16px;\n  flex-shrink: 0;\n}\n\n.clear-btn {\n  font-weight: 500;\n  font-size: 14px;\n  margin-top: auto;\n  padding: 0.5rem 1rem;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n\n.clear-btn span {\n  margin-right: 4px;\n}\n\n.menu-section-header .menu-section-header-left {\n  display: flex;\n  flex-direction: row;\n  gap: 0.3rem;\n  align-items: center;\n}\n.menu-section-header div h3 {\n  font-weight: 600;\n  font-size: 0.9rem;\n  padding: 0;\n  margin: 0;\n}\n\n.menu-section-search {\n  width: 100%;\n  padding: 6px 8px;\n  border: 1px solid #d8dde6;\n  border-radius: 6px;\n  font-size: inherit;\n  font-family: inherit;\n}\n\n.menu-section-search:focus {\n  outline: none;\n  border-color: #9bb4ff;\n  box-shadow: var(--search-shadow);\n}\n\n#app-surface {\n  overflow: hidden;\n}\n\nsection#map-area {\n  position: relative;\n  flex: 1 1 0;\n  min-height: 0;\n  overflow: hidden;\n}\n\n.scroll-container {\n  overflow: auto;\n}\n.scroll-container::-webkit-scrollbar-thumb {\n  min-height: 30px;\n  background-color: var(--color-scroll-thumb-fill);\n  border: 10px solid transparent;\n  border-radius: 0.9rem;\n  background-clip: padding-box;\n}\n\n.scroll-container::-webkit-scrollbar {\n  width: 24px;\n}\n\n.menu-sub-section {\n  flex: 1 1 0%;\n}\n\n.menu-content.scroll-container .menu-sub-section {\n  scrollbar-gutter: stable;\n}\n\n.chevron {\n  width: 1.2em;\n  transition: transform 0.4s ease;\n}\n\n.chevron-button {\n  background-color: rgba(0, 0, 0, 0);\n  border: none;\n  cursor: pointer;\n}\n\n.flip .chevron {\n  transform: scaleY(-1);\n}\n\n.sidebar-btn {\n  border: none;\n  background-color: inherit;\n  padding: 0;\n  display: flex;\n  align-items: center;\n}\n\ndiv#chartjs-tooltip {\n  z-index: 4;\n  background-color: var(--color-menu-bg);\n  box-shadow: 0 0 10px -3px rgba(0, 0, 0, 0.4);\n  padding: 0.7rem 1rem;\n  font-weight: 400;\n}\n\n.chart-js-tooltip-tr {\n  padding: 0;\n}\n\ndiv#chartjs-tooltip td {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n}\n\nspan.tooltip-bullet {\n  padding-right: 0.5rem;\n  font-size: 1.7rem;\n}\n\nsvg line {\n  stroke: black;\n  stroke-width: 3;\n  transition: all 0.4s ease;\n  transform-origin: center center;\n  transform-box: view-box;\n}\n\n.filter-active > .icon .middle {\n  opacity: 0;\n}\n\n.icon {\n  display: flex;\n  align-items: center;\n  margin: auto;\n}\n\n.filter-counter {\n  width: 20px;\n  height: 20px;\n  border-radius: 10px;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  color: white;\n  font-weight: 500;\n  text-align: center;\n  z-index: 5;\n}\n.filter-counter.hide {\n  display: none;\n}\n#total-filter-count {\n  background-color: black;\n\n  position: absolute;\n  top: 9px;\n  right: 5px;\n}\n\n.section-filter-count {\n  height: 1.3rem;\n  width: 1.3rem;\n}\n\n[data-tooltip] {\n  anchor-name: --btn-anchor;\n}\n.mgo-tooltip[popover] {\n  border: none;\n  padding: 6px 8px;\n  background: #fff;\n  color: #000;\n  border: 1px solid grey;\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);\n  font:\n    12px/1.25 system-ui,\n    sans-serif;\n  pointer-events: none;\n  margin: 0;\n}\n\n.mgo-tooltip {\n  position: absolute;\n  inset: auto;\n  left: anchor(center);\n  top: calc(anchor(bottom) + 4px);\n  transform: translateX(-50%);\n}\n\n.mgo-tooltip[data-placement="top"] {\n  left: anchor(center);\n  top: anchor(top);\n  transform: translate(-50%, calc(-100% - 8px));\n}\n.mgo-tooltip[data-placement="left"] {\n  left: calc(anchor(left) - 4px);\n  top: anchor(center);\n  transform: translate(-100%, -50%);\n}\n.mgo-tooltip[data-placement="right"] {\n  left: calc(anchor(right) + 4px);\n  top: anchor(center);\n  transform: translate(0, -50%);\n}\n\n/* Responsive layout */\n@media (max-width: 768px) {\n  #charts {\n    right: 0;\n    top: auto;\n    bottom: 0;\n    width: 100% !important;\n    height: 50% !important;\n    max-width: none;\n    border-radius: 12px 12px 0 0;\n  }\n  #charts.collapsed {\n    height: 44px !important;\n    width: 100% !important;\n  }\n  #country-shading-legend {\n    bottom: auto;\n    top: 10px;\n  }\n}\n\n@media (max-width: 480px) {\n  :host {\n    min-width: 320px;\n  }\n  #charts {\n    height: 60% !important;\n  }\n}\n';

class AMRGeoMapper extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._data = null;
    this._apiUrl = null;
    this._pathogen = null;
    this._map = null;
    this._markerManager = null;
    this._shadingManager = null;
    this._activeChartRenderer = null;
    this._activeLocation = null;
    this._activeChartType = "stackedBar";
    this._filters = {};
    this._filterManager = null;
    this._tooltipManager = new TooltipManager(this);

    this._githubLink = `https://github.com/JCVenterInstitute/AMR-GeoMapper`;
  }

  async connectedCallback() {
    this._apiUrl = this.getAttribute("api-url");
    this._pathogen = this.getAttribute("pathogen");

    if (!this._apiUrl) {
      this._showError("Missing required attribute: api-url", {
        retryable: false,
      });
      return;
    }
    if (!this._pathogen) {
      this._showError("Missing required attribute: pathogen", {
        retryable: false,
      });
      return;
    }

    this.shadowRoot.innerHTML =
      `<style>${bootstrapStyles}${styles}</style>` +
      `<div id="amr-geo-mapper-wrapper"><div id="status-container"></div></div>`;

    await this._initialize();
  }

  async _initialize() {
    this._showLoading();
    try {
      this._config = await fetchConfig(this._apiUrl, this._pathogen);

      this._filters = this._parseFiltersFromURL();

      this._data = await fetchData(this._apiUrl, this._pathogen, this._filters);

      await loadDependencies(this.shadowRoot);
      this._buildDOM();
      this._initMap();
      await this._renderChoropleth();
      this._renderMarkers();
      this._initFilters();
      this._initChartPanel();
      this._refreshTooltips();
      this._clearStatus();
    } catch (err) {
      console.error("amr-geo-mapper initialization failed:", err);
      this._showError(err.message);
    }
  }

  _buildDOM() {
    const wrapper = this.shadowRoot.getElementById("amr-geo-mapper-wrapper");
    if (!wrapper) return;

    if (!this.shadowRoot.getElementById("map-area")) {
      wrapper.innerHTML = `
        <div id="status-container"></div>
        <div id="app-surface" class="d-flex flex-column w-100 h-100 position-relative">
          <section id="map-area" class="position-relative">
            <div id="menu" class="menu-container center z-3"></div>
            <div id="charts" class="charts-container menu-container collapsed collapsible">
              <div class="menu-box shadow">
                <div id="menu-header" class="d-flex flex-row justify-content-between align-items-center">
                  <div class="d-flex align-items-baseline" style="min-width:0;">
                    <div class="menu-title mb-0"></div>
                    <span class="genome-counter"></span>
                  </div>
                  <div class="d-flex align-items-center">
                    <div id="charts-header-btns">
                      <button id="charts-menu-chevron" class="p-0 chevron-button justify-content-center align-items-center" aria-label="Toggle chart panel">
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f">
                          <g transform="rotate(90, 480, -480)">
                            <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/>
                          </g>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div id="chartContent">
                  <div id="charts-body"></div>
                  <div id="charts-toolbar">
                    <div id="chart-type-selector"></div>
                    <button id="chart-download-btn" class="chart-toolbar-btn" aria-label="Download chart as image" data-tooltip="Download chart as image" data-placement="top">
                      ${HTMLhelper.icons("download", 20)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div id="map" class="w-100"></div>
          </section>
        </div>
      `;
    }
  }

  _initMap() {
    const mapEl = this.shadowRoot.getElementById("map");
    if (!mapEl) return;

    const loc = this._config.mapOptions?.initialLocation ?? {
      lat: 20,
      lng: 0,
      zoom: 2,
    };
    const tile = this._config.mapOptions?.tileProvider ?? {};

    this._map = L.map(mapEl, {
      center: [loc.lat, loc.lng],
      zoom: loc.zoom ?? 2,
      zoomControl: true,
      attributionControl: true,
    });

    this._map.attributionControl.setPrefix(
      `<a href="${this._githubLink}" target="_blank">AMR GeoMapper</a> | Leaflet`,
    );

    L.tileLayer(
      tile.url ??
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution: tile.attribution ?? "",
        maxZoom: tile.maxZoom ?? 19,
      },
    ).addTo(this._map);

    // Clicking empty map area returns to global charts
    this._map.on("click", () => {
      if (this._activeLocation) {
        this._showChartsForLocation(null);
      }
    });
  }

  async _renderChoropleth() {
    if (!this._map || !this._data?.choropleth) return;

    this._shadingManager = new CountryShadingManager(
      this._map,
      this.shadowRoot,
    );
    await this._shadingManager.render(
      this._data.choropleth,
      this._config.mapOptions?.choropleth,
    );
  }

  _getSampleCount(locationKey) {
    const markers = this._data?.markers;
    if (!markers) return null;
    const relevant = locationKey
      ? markers.filter((m) => m.location === locationKey)
      : markers;
    return relevant.reduce((sum, m) => {
      const vals = Object.values(m.pieChart?.values ?? {});
      return sum + vals.reduce((a, b) => a + b, 0);
    }, 0);
  }

  _renderMarkers() {
    if (!this._map || !this._data?.markers) return;

    this._markerManager = new MapMarkerManager(this._map, this.shadowRoot);
    this._markerManager.render(
      this._data.markers,
      this._config.mapOptions?.pieChart,
      (locationName) => this._showChartsForLocation(locationName),
    );
  }

  // --- Filters ---

  _parseFiltersFromURL() {
    const params = new URLSearchParams(window.location.search);
    const filters = {};
    const filterConfigs = this._config?.filters ?? [];

    for (const config of filterConfigs) {
      if (config.type === "dropdown") {
        const val = params.get(config.name);
        if (val) {
          filters[config.name] = val.split(",").filter(Boolean);
        }
      } else if (config.type === "date_range") {
        const start = params.get(`${config.name}_start`);
        const end = params.get(`${config.name}_end`);
        if (start || end) {
          filters[config.name] = {};
          if (start) filters[config.name].start = start;
          if (end) filters[config.name].end = end;
        }
      }
    }

    return filters;
  }

  _syncFiltersToURL() {
    const params = new URLSearchParams();
    const filterConfigs = this._config?.filters ?? [];

    for (const config of filterConfigs) {
      const val = this._filters[config.name];
      if (!val) continue;

      if (config.type === "dropdown" && Array.isArray(val) && val.length) {
        params.set(config.name, val.join(","));
      } else if (config.type === "date_range" && typeof val === "object") {
        if (val.start) params.set(`${config.name}_start`, val.start);
        if (val.end) params.set(`${config.name}_end`, val.end);
      }
    }

    const qs = params.toString();
    const newUrl = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    history.replaceState(null, "", newUrl);
  }

  _initFilters() {
    const filterConfigs = this._config?.filters;
    if (!filterConfigs?.length) return;

    this._filterManager = new FilterMenuManager(
      this.shadowRoot,
      filterConfigs,
      this._filters,
      debounce(() => this._applyFilters(), 300),
      this._apiUrl,
    );
    this._filterManager.render();
  }

  async _applyFilters() {
    this._syncFiltersToURL();
    this._showMapLoading();
    try {
      this._data = await fetchData(this._apiUrl, this._pathogen, this._filters);
      this._markerManager?.clearMarkers();
      this._shadingManager?.destroy();
      this._activeChartRenderer?.destroy();
      this._activeChartRenderer = null;
      await this._renderChoropleth();
      this._renderMarkers();
      this._showChartsForLocation(this._activeLocation);
      this._clearMapLoading();
    } catch (err) {
      this._clearMapLoading();
      this._showWarning(err.message);
    }
  }

  // --- Chart Panel ---

  _initChartPanel() {
    const chartPanel = this.shadowRoot.getElementById("charts");
    if (!chartPanel) return;

    // Chevron toggle button
    const chevronBtn = chartPanel.querySelector("#charts-menu-chevron");
    if (chevronBtn) {
      chevronBtn.addEventListener("click", () => {
        if (chartPanel.classList.contains("collapsed")) {
          this._showChartsForLocation(this._activeLocation);
        } else {
          this._hideChartPanel();
        }
      });
    }

    // Download button
    const downloadBtn = chartPanel.querySelector("#chart-download-btn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const chart = this._activeChartRenderer?.chartInstance;
        if (chart) {
          this._downloadChartImage(chart);
        }
      });
    }

    // Show global charts by default
    this._showChartsForLocation(null);
  }

  _showChartsForLocation(locationKey) {
    const charts = this._data?.charts;
    if (!charts) return;

    this._activeLocation = locationKey;

    const scope =
      locationKey && charts.byLocation?.[locationKey]
        ? charts.byLocation[locationKey]
        : charts.global;
    if (!scope) return;

    const chartPanel = this.shadowRoot.getElementById("charts");
    if (!chartPanel) return;

    // Update title
    const titleEl = chartPanel.querySelector(".menu-title");
    if (titleEl) {
      titleEl.textContent = locationKey || "Global";
    }

    // Update sample count
    const counterEl = chartPanel.querySelector(".genome-counter");
    if (counterEl) {
      const count = this._getSampleCount(locationKey);
      counterEl.textContent =
        count != null ? `(${count.toLocaleString()} samples)` : "";
    }

    // Show the panel
    chartPanel.classList.remove("collapsed");
    chartPanel.style.display = "";

    // Build chart type buttons
    const availableTypes = [];
    if (scope.barCharts?.length)
      availableTypes.push({ type: "stackedBar", label: "Bar" });
    if (scope.lineCharts?.length)
      availableTypes.push({ type: "lineGraph", label: "Line" });
    if (scope.areaCharts?.length)
      availableTypes.push({ type: "stackedArea", label: "Area" });

    const selectorEl = chartPanel.querySelector("#chart-type-selector");
    if (selectorEl) {
      selectorEl.innerHTML = availableTypes
        .map(
          (t) =>
            `<button data-chart-type="${t.type}" class="chart-toolbar-btn${
              t.type === this._activeChartType ? " active-chart-type" : ""
            }" aria-label="${t.label}" data-tooltip="${t.label}" data-placement="top">${HTMLhelper.icons(t.type)}</button>`,
        )
        .join("");

      selectorEl.querySelectorAll("button[data-chart-type]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this._activeChartType = btn.dataset.chartType;
          this._renderActiveChart(scope);
          selectorEl
            .querySelectorAll("button")
            .forEach((b) => b.classList.remove("active-chart-type"));
          btn.classList.add("active-chart-type");
        });
      });
    }

    // If the current chart type isn't available for this scope, pick the first available
    if (
      !availableTypes.some((t) => t.type === this._activeChartType) &&
      availableTypes.length
    ) {
      this._activeChartType = availableTypes[0].type;
    }

    this._renderActiveChart(scope);
    this._refreshTooltips();
  }

  _renderActiveChart(scope) {
    let chartData;
    if (this._activeChartType === "stackedBar") {
      chartData = scope.barCharts?.[0];
    } else if (this._activeChartType === "lineGraph") {
      chartData = scope.lineCharts?.[0];
    } else if (this._activeChartType === "stackedArea") {
      chartData = scope.areaCharts?.[0];
    }

    const container = this.shadowRoot.getElementById("charts-body");
    if (!container) return;

    // Destroy existing chart
    if (this._activeChartRenderer) {
      this._activeChartRenderer.destroy();
      this._activeChartRenderer = null;
    }

    if (!chartData) {
      container.innerHTML =
        "<p style='padding:12px;color:#666;'>No chart data available.</p>";
      return;
    }

    const ChartClass =
      this._activeChartType === "lineGraph"
        ? LineChart
        : this._activeChartType === "stackedArea"
          ? StackedAreaChart
          : StackedBarChart;

    const renderer = new ChartClass(container);
    renderer.render(chartData);
    this._activeChartRenderer = renderer;
  }

  _hideChartPanel() {
    const chartPanel = this.shadowRoot.getElementById("charts");
    if (chartPanel) {
      chartPanel.classList.add("collapsed");
    }
    if (this._activeChartRenderer) {
      this._activeChartRenderer.destroy();
      this._activeChartRenderer = null;
    }
  }

  // --- Chart Export ---

  _downloadChartImage(
    chart,
    {
      format = "png",
      scale = 2,
      fileName = "chart",
      background = "#ffffff",
    } = {},
  ) {
    const legendPlugin = chart.options.plugins.legend;
    const originalDisplay = legendPlugin?.display ?? false;

    if (legendPlugin) {
      legendPlugin.display = true;
      chart.update("none");
    }

    const src = chart.canvas;
    const cssW = src.clientWidth;
    const cssH = src.clientHeight;

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cssW * scale));
    out.height = Math.max(1, Math.round(cssH * scale));

    const ctx = out.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);

    if (legendPlugin) {
      legendPlugin.display = originalDisplay;
      chart.update("none");
    }

    const mime =
      format === "jpeg"
        ? "image/jpeg"
        : format === "webp"
          ? "image/webp"
          : "image/png";

    out.toBlob(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      mime,
      0.92,
    );
  }

  // --- Status ---

  _showLoading() {
    const container = this.shadowRoot.getElementById("status-container");
    if (!container) return;
    container.innerHTML = `<div class="status-overlay"><div class="loader"></div></div>`;
  }

  _showMapLoading() {
    const mapArea = this.shadowRoot.getElementById("map-area");
    if (!mapArea) return;
    // Remove existing overlay if any
    this._clearMapLoading();
    const overlay = document.createElement("div");
    overlay.id = "map-loading-overlay";
    overlay.className = "map-loading-overlay";
    overlay.innerHTML = `<div class="loader" style="width:48px;border-width:8px;"></div>`;
    mapArea.appendChild(overlay);
  }

  _clearMapLoading() {
    const overlay = this.shadowRoot.getElementById("map-loading-overlay");
    if (overlay) overlay.remove();
  }

  _showError(message, { retryable = true } = {}) {
    const retryHtml = retryable
      ? `<button class="status-retry-btn">Retry</button>`
      : "";

    const errorHtml =
      `<div class="status-overlay">` +
      `<div class="status-error">` +
      `<div class="status-error-icon">!</div>` +
      `<div class="status-error-message">${message}</div>` +
      retryHtml +
      `</div></div>`;

    const container = this.shadowRoot.getElementById("status-container");
    if (container) {
      container.innerHTML = errorHtml;
    } else {
      this.shadowRoot.innerHTML =
        `<style>${bootstrapStyles}${styles}</style>` +
        `<div id="amr-geo-mapper-wrapper"><div id="status-container">` +
        errorHtml +
        `</div></div>`;
    }

    if (retryable) {
      const retryBtn = this.shadowRoot.querySelector(".status-retry-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => this._initialize());
      }
    }
  }

  _showWarning(message) {
    // Remove existing warning if any
    this.shadowRoot.querySelector(".status-warning")?.remove();

    const mapArea = this.shadowRoot.getElementById("map-area");
    if (!mapArea) return;

    const banner = document.createElement("div");
    banner.className = "status-warning";
    banner.textContent = message;
    mapArea.appendChild(banner);

    const dismiss = () => banner.remove();
    banner.addEventListener("click", dismiss);
    setTimeout(dismiss, 5000);
  }

  _refreshTooltips() {
    this._tooltipManager.setupTooltips();
  }

  _clearStatus() {
    const container = this.shadowRoot.getElementById("status-container");
    if (container) container.innerHTML = "";
  }

  disconnectedCallback() {
    if (this._tooltipManager) {
      this._tooltipManager.destroy();
      this._tooltipManager = null;
    }
    if (this._filterManager) {
      this._filterManager.destroy();
      this._filterManager = null;
    }
    if (this._activeChartRenderer) {
      this._activeChartRenderer.destroy();
      this._activeChartRenderer = null;
    }
    if (this._markerManager) {
      this._markerManager.destroy();
      this._markerManager = null;
    }
    if (this._shadingManager) {
      this._shadingManager.destroy();
      this._shadingManager = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }
}

customElements.define("amr-geo-mapper", AMRGeoMapper);
