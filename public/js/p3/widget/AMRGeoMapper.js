define([
  "dojo/_base/declare",
  "dijit/_WidgetBase",
  "dijit/_TemplatedMixin",
  "dojo/dom-construct",
  "leaflet/dist/leaflet-src",
], function (declare, WidgetBase, Templated, domConstruct, L) {
  window.L = window.L || L;

  var depsReady = false;
  var depsPromise = null;

  // Load a script while temporarily hiding define.amd so that UMD
  // libraries (like Chart.js) fall back to setting a window global
  // instead of registering with Dojo's AMD loader.
  function loadScriptAsGlobal(src) {
    return new Promise(function (resolve, reject) {
      var savedAmd = define.amd;
      define.amd = false;

      var script = document.createElement("script");
      script.src = src;
      script.onload = function () {
        define.amd = savedAmd;
        resolve();
      };
      script.onerror = function () {
        define.amd = savedAmd;
        reject(new Error("Failed to load: " + src));
      };
      document.head.appendChild(script);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Failed to load: " + src));
      };
      document.head.appendChild(script);
    });
  }

  function loadStylesheet(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadDeps() {
    if (depsReady) return Promise.resolve();
    if (depsPromise) return depsPromise;

    depsPromise = Promise.resolve()
      .then(function () {
        if (window.Chart) return;
        return loadScriptAsGlobal("https://cdn.jsdelivr.net/npm/chart.js");
      })
      .then(function () {
        if (L.markerClusterGroup) return;
        loadStylesheet("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css");
        loadStylesheet("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css");
        return loadScriptAsGlobal("https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js");
      })
      .then(function () {
        return loadScript("/js/p3/resources/amr-geo-mapper-bundle.js");
      })
      .then(function () {
        depsReady = true;
      });

    return depsPromise;
  }

  return declare([WidgetBase, Templated], {
    templateString: '<div style="height:500px;"></div>',
    baseClass: "AMRGeoMapper",

    apiUrl: "http://localhost:3001",
    pathogen: "Escherichia coli",

    startup: function () {
      if (this._started) return;
      this.inherited(arguments);

      var self = this;
      loadDeps()
        .then(function () {
          if (self.domNode.querySelector("amr-geo-mapper")) return;

          var el = document.createElement("amr-geo-mapper");
          el.style.display = "block";
          el.style.width = "100%";
          el.style.height = "100%";
          el.setAttribute("api-url", self.apiUrl);
          el.setAttribute("pathogen", self.pathogen);
          domConstruct.place(el, self.domNode);
        })
        .catch(function (err) {
          console.error("AMRGeoMapper: ", err);
        });
    },
  });
});
