/*!
 * Cosmo Dental "Ask us" chat widget - no dependencies.
 * Add to the site:  <script src="https://<worker-url>/widget.js" defer></script>
 * Language: data-lang="es" on the script tag forces Spanish. Otherwise it follows the page:
 * /es/ in the URL or <html lang="es">. It re-checks on every open and every question, so it
 * follows single-page-app language switches without a reload.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var API = new URL("/api/chat", script.src).href;
  var forced = script.getAttribute("data-lang");

  function currentLang() {
    if (forced) return forced === "es" ? "es" : "en";
    if (/^\/es(\/|$)/.test(location.pathname)) return "es";
    return (document.documentElement.lang || "").toLowerCase().indexOf("es") ===
      0
      ? "es"
      : "en";
  }

  var STRINGS = {
    en: {
      open: "Ask Cosmo Dental",
      title: "Ask Cosmo Dental",
      close: "Close chat",
      intro:
        "Hi! I'm an AI assistant. I answer questions about Cosmo Dental, like hours, services, dentists and insurance.",
      privacy:
        "Please don't share personal health information. For emergencies, call 911.",
      placeholder: "Type your question\u2026",
      send: "Send",
      thinking: "Looking that up\u2026",
      sources: "Sources",
      page: "p.",
      error: "Sorry, something went wrong. Please call (708) 345-6313.",
    },
    es: {
      open: "Preg\u00fantele a Cosmo Dental",
      title: "Preg\u00fantele a Cosmo Dental",
      close: "Cerrar chat",
      intro:
        "\u00a1Hola! Soy un asistente de IA. Respondo preguntas sobre Cosmo Dental, como horarios, servicios, dentistas y seguros.",
      privacy:
        "Por favor no comparta informaci\u00f3n personal de salud. En una emergencia, llame al 911.",
      placeholder: "Escriba su pregunta\u2026",
      send: "Enviar",
      thinking: "Buscando\u2026",
      sources: "Fuentes",
      page: "p\u00e1g.",
      error: "Lo sentimos, ocurri\u00f3 un error. Llame al (708) 345-6313.",
    },
  };

  var css =
    ".cdw-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:14px 20px;background:#0b5ed7;color:#fff;font:600 16px/1 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}" +
    ".cdw-btn:focus-visible,.cdw-panel button:focus-visible,.cdw-panel input:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}" +
    ".cdw-panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));display:flex;flex-direction:column;background:#fff;color:#1b2430;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:15px/1.45 system-ui,sans-serif;overflow:hidden}" +
    ".cdw-panel[hidden]{display:none}" +
    ".cdw-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#0b5ed7;color:#fff}" +
    ".cdw-head h2{margin:0;font-size:16px;color:#fff}" +
    ".cdw-head button{background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}" +
    ".cdw-log{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}" +
    ".cdw-msg{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}" +
    ".cdw-bot{background:#eef3f8;align-self:flex-start}" +
    ".cdw-user{background:#0b5ed7;color:#fff;align-self:flex-end}" +
    ".cdw-src{display:block;margin-top:6px;font-size:12.5px;color:#4a5563}" +
    ".cdw-note{font-size:12.5px;color:#4a5563;margin:0}" +
    ".cdw-form{display:flex;gap:8px;padding:10px;border-top:1px solid #dde3ea}" +
    ".cdw-form input{flex:1;min-width:0;padding:10px;border:1px solid #8a96a3;border-radius:8px;font:inherit;color:#1b2430}" +
    ".cdw-form button{border:0;border-radius:8px;padding:0 14px;background:#0b5ed7;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}" +
    ".cdw-form button:disabled{opacity:.6;cursor:default}" +
    "@media (max-width:480px){.cdw-btn{right:12px;bottom:12px;padding:12px 16px;font-size:15px}.cdw-panel{right:8px;left:8px;width:auto;bottom:72px;height:calc(100vh - 96px)}}";

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  var style = el("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = el("button", {
    class: "cdw-btn",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "cdw-panel",
  });
  var panel = el("div", {
    class: "cdw-panel",
    id: "cdw-panel",
    role: "dialog",
    "aria-labelledby": "cdw-title",
    hidden: "",
  });
  var head = el("div", { class: "cdw-head" });
  var title = el("h2", { id: "cdw-title" });
  var close = el("button", { type: "button" }, "\u00d7");
  head.appendChild(title);
  head.appendChild(close);
  var log = el("div", {
    class: "cdw-log",
    role: "log",
    "aria-live": "polite",
    tabindex: "0",
  });
  var form = el("form", { class: "cdw-form" });
  var input = el("input", {
    type: "text",
    maxlength: "500",
    autocomplete: "off",
  });
  var send = el("button", { type: "submit" });
  form.appendChild(input);
  form.appendChild(send);
  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(form);
  document.body.appendChild(panel);
  document.body.appendChild(btn);

  function add(cls, text) {
    var m = el("div", { class: "cdw-msg " + cls }, text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  var lang = null;
  var T = STRINGS.en;

  // Apply the page's current language to every label. When the language changes, add a fresh
  // greeting in the new language (earlier messages stay so the conversation isn't lost).
  function syncLang() {
    var next = currentLang();
    if (next === lang) return;
    lang = next;
    T = STRINGS[lang];
    btn.textContent = T.open;
    title.textContent = T.title;
    close.setAttribute("aria-label", T.close);
    input.setAttribute("placeholder", T.placeholder);
    input.setAttribute("aria-label", T.placeholder);
    send.textContent = T.send;
    add("cdw-bot", T.intro);
    log.appendChild(el("p", { class: "cdw-note" }, T.privacy));
  }
  syncLang();

  // Keep the floating button label in sync when the site switches language without a reload.
  window.addEventListener("popstate", syncLang);
  new MutationObserver(syncLang).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  ["pushState", "replaceState"].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(syncLang, 0);
      return r;
    };
  });

  function toggle(open) {
    if (open) syncLang();
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
    else btn.focus();
  }
  btn.addEventListener("click", function () {
    toggle(panel.hidden);
  });
  close.addEventListener("click", function () {
    toggle(false);
  });
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") toggle(false);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    syncLang();
    var t = T;
    add("cdw-user", q);
    input.value = "";
    send.disabled = true;
    var pending = add("cdw-bot", t.thinking);

    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q, lang: lang }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          pending.textContent = res.d.error || t.error;
          return;
        }
        pending.textContent = res.d.answer;
        if (res.d.sources && res.d.sources.length) {
          var s = res.d.sources
            .map(function (x) {
              return "[" + x.n + "] " + x.title + ", " + t.page + " " + x.page;
            })
            .join(" \u00b7 ");
          pending.appendChild(
            el("span", { class: "cdw-src" }, t.sources + ": " + s),
          );
        }
      })
      .catch(function () {
        pending.textContent = t.error;
      })
      .then(function () {
        send.disabled = false;
        input.focus();
        log.scrollTop = log.scrollHeight;
      });
  });
})();
