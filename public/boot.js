/* Moj Evolako — sets theme and language before the first paint (external file: the CSP allows no inline scripts). */
(function () {
  var root = document.documentElement;
  var theme = "light";
  var lang = "sr";
  try {
    var t = localStorage.getItem("evo.theme");
    if (t === "light" || t === "dark" || t === "system") theme = t;
    var l = localStorage.getItem("evo.lang");
    if (l === "sr" || l === "sr-Cyrl" || l === "en" || l === "ru") lang = l;
  } catch (e) { /* storage blocked: defaults */ }
  // A language as a link writes it (any case): sr, en, ru, and sr-Cyrl / cy / cyr for Serbian Cyrillic — evolako.rs
  // sends ?lang=sr-Cyrl when it is open in Cyrillic. Anything else is not a language ("").
  function parse(value) {
    var v = (value || "").toLowerCase();
    if (v === "sr-cyrl" || v === "cy" || v === "cyr") return "sr-Cyrl";
    if (v === "sr-latn") return "sr";
    return v === "sr" || v === "en" || v === "ru" ? v : "";
  }
  // ?lang= on any route: applied, remembered, and taken out of the address, so a later switch in the app
  // is not undone by a reload (the other parameters and the hash stay as they are). The links of the Evolako pismo
  // e-mails carry the language as ?l= (/pismo?t=…&l=en, /odjava?e=…&t=…&l=en): on those two pages it counts the
  // same; ?lang= wins when both are there.
  var params = new URLSearchParams(location.search);
  var names = /^\/(pismo|odjava)\/?$/.test(location.pathname) ? ["lang", "l"] : ["lang"];
  var applied = false;
  for (var i = 0; i < names.length; i++) {
    var requested = parse(params.get(names[i]));
    if (!requested) continue;
    if (!applied) {
      lang = requested;
      applied = true;
      try { localStorage.setItem("evo.lang", lang); } catch (e) { /* ignore */ }
    }
    params.delete(names[i]);
  }
  if (applied) {
    var search = params.toString();
    try {
      history.replaceState(history.state, "", location.pathname + (search ? "?" + search : "") + location.hash);
    } catch (e) { /* the address keeps ?lang=, which is harmless */ }
  }
  var dark = theme === "dark" || (theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("lang", lang === "sr" ? "sr-Latn" : lang);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0B1220" : "#F1F4F9");
})();
