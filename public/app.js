/* 错题解剖台 · 前端逻辑（无依赖） */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const els = {
    article: $("#article"), wc: $("#wc"), qlist: $("#qlist"), result: $("#result"),
    msgs: $("#msgs"), ask: $("#ask"), dot: $("#dot"), runhint: $("#runhint"),
  };

  const state = { questions: [], analysis: "", chat: [], recordId: null, busy: false, images: [], reading: [] };
  const cfg = { baseUrl: "", model: "", hasKey: false };

  /* ---------------- utils ---------------- */
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ---------------- tiny markdown ---------------- */
  function md(src) {
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const isBlockStart = (l) => /^\s*(#{1,4}\s|>|```|\||[-*]\s|\d+[.)]\s)/.test(l);
    let out = [], i = 0;
    while (i < lines.length) {
      let line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^```/.test(line.trim())) {
        let buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
        i++; out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
      }
      let h = line.match(/^\s*(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = Math.min(h[1].length, 4);
        out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"); i++; continue;
      }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(line)) {
        let buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>"); continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        const head = cells(line); i += 2;
        let body = [];
        while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) body.push(cells(lines[i++]));
        out.push("<table><thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") +
          "</tr></thead><tbody>" +
          body.map((r) => "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") +
          "</tbody></table>");
        continue;
      }
      if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        let items = [];
        while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
          i++;
        }
        const tag = ordered ? "ol" : "ul";
        out.push("<" + tag + ">" + items.map((t) => "<li>" + inline(t) + "</li>").join("") + "</" + tag + ">");
        continue;
      }
      let buf = [line]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) buf.push(lines[i++]);
      out.push("<p>" + inline(buf.join(" ")) + "</p>");
    }
    return out.join("\n");
  }

  window.__md = md; // dev hook（预览用）

  /* ---------------- images ---------------- */
  const MAX_IMGS = 6;

  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (file.type && file.type.indexOf("image/") !== 0) return reject(new Error("不是图片文件"));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let dataUrl = "";
        try { dataUrl = c.toDataURL("image/jpeg", 0.82); } catch (e) { return reject(new Error("图片转换失败")); }
        resolve({ name: (file.name || "photo-" + Date.now()) + ".jpg", dataUrl: dataUrl, w: w, h: h, kb: Math.round(dataUrl.length * 0.75 / 1024) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("图片格式读不出来")); };
      img.src = url;
    });
  }

  async function addImages(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    if (state.images.length + list.length > MAX_IMGS) return toast("最多 " + MAX_IMGS + " 张，够用了");
    for (let i = 0; i < list.length; i++) {
      try {
        const im = await readImage(list[i]);
        state.images.push(im);
      } catch (e) { toast("有一张没能读取：" + e.message); }
    }
    renderThumbs();
  }

  function renderThumbs() {
    const box = $("#thumbs");
    box.innerHTML = state.images.map(function (im, i) {
      return '<div class="thumb"><img src="' + im.dataUrl + '" alt=""><button data-i="' + i + '" title="移除">×</button></div>';
    }).join("") + (state.images.length
      ? '<div class="hint" style="align-self:center;margin-left:4px">' + state.images.length + ' 张 · 约 ' +
        state.images.reduce(function (a, b) { return a + (b.kb || 0); }, 0) + ' KB</div>'
      : "");
    Array.from(box.querySelectorAll("button")).forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        state.images.splice(Number(b.dataset.i), 1);
        renderThumbs();
      });
    });
  }

  /* ---------------- reading + dictionary ---------------- */
  function extractReading(mdText) {
    const m = /##[^\n]*我读到的原文[^\n]*\n([\s\S]*?)(?=\n##\s|$)/.exec(String(mdText || ""));
    return m ? m[1].trim() : "";
  }

  function parseQuestionsFromMd(mdText) {
    const m = /##[^\n]*我读到的题目[^\n]*\n([\s\S]*?)(?=\n##\s|$)/.exec(String(mdText || ""));
    if (!m) return [];
    const qs = [];
    let cur = null;
    m[1].split("\n").forEach(function (raw) {
      const line = raw.trim().replace(/^[-*]\s+/, "");
      if (!line || line.charAt(0) === "|") return;
      const qm = line.match(/^\*{0,2}(\d{1,3})[.、)]\*{0,2}\s*(.+)$/);
      if (qm && !/^[A-D][.)、]/.test(line)) {
        if (cur) qs.push(cur);
        cur = { no: qm[1], stem: qm[2].replace(/\*\*/g, ""), opts: {}, my: "", ans: "" };
        return;
      }
      const om = line.match(/^\**([A-D])[.)、]\**\s*(.+)$/);
      if (om && cur) { cur.opts[om[1]] = om[2].replace(/\*\*/g, ""); return; }
      if (cur) {
        const my = line.match(/我选[：:]\s*\**([A-D])/);
        if (my) cur.my = my[1];
        const an = line.match(/答案[：:]\s*\**([A-D]|待定)/);
        if (an) cur.ans = an[1];
      }
    });
    if (cur) qs.push(cur);
    return qs.filter(function (q) { return q.stem; });
  }

  function questionsFromCards() {
    return collect().map(function (q, i) {
      if (!q.stem && !q.options.A) return null;
      return { no: String(i + 1), stem: q.stem, opts: q.options, my: q.my, ans: q.correct };
    }).filter(Boolean);
  }

  function wordify(text) {
    const re = /([A-Za-z][A-Za-z'’\-]*)/g;
    let out = "", last = 0, m;
    const gap = function (str, off) {
      return str ? '<span class="g" data-i="' + off + '">' + esc(str) + "</span>" : "";
    };
    while ((m = re.exec(text)) !== null) {
      out += gap(text.slice(last, m.index), last);
      out += '<span class="w" data-i="' + m.index + '">' + esc(m[1]) + "</span>";
      last = m.index + m[1].length;
    }
    out += gap(text.slice(last), last);
    return out;
  }

  function sentenceAt(text, idx) {
    let start = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "." || ch === "?" || ch === "!") {
        if (text[i + 1] === " " || text[i + 1] === "\n") { start = i + 1; break; }
      }
      if (ch === "\n") { start = i + 1; break; }
    }
    let end = text.length;
    for (let i = idx; i < text.length; i++) {
      const ch = text[i];
      if ((ch === "." || ch === "?" || ch === "!") && (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\n")) {
        end = i + 1; break;
      }
    }
    return text.slice(start, end).trim();
  }

  function cardsToQs(list) {
    return (list || []).map(function (q, i) {
      if (!q || (!q.stem && !(q.options && q.options.A))) return null;
      return { no: String(q.no || i + 1), stem: q.stem || "", opts: q.options || {}, my: q.my || "", ans: q.correct || "" };
    }).filter(Boolean);
  }

  function setReading(text, qs) {
    const clean = String(text || "").replace(/```[sS]*?```/g, "").trim();
    const paras = clean.split(/\n{2,}/).map(function (t) {
      return t.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    }).filter(Boolean);

    const blocks = [];
    paras.forEach(function (t) { blocks.push({ t: t, cls: "readp" }); });
    if (qs && qs.length) {
      blocks.push({ label: "题目 / QUESTIONS", cls: "readh" });
      qs.forEach(function (q) {
        blocks.push({ t: q.no + ". " + q.stem, cls: "readp readqh" });
        ["A", "B", "C", "D"].forEach(function (k) {
          if (q.opts && q.opts[k]) blocks.push({ t: k + ") " + q.opts[k], cls: "readp readqo" });
        });
        if (q.my || q.ans) {
          blocks.push({ label: "我选 " + (q.my || "—") + "　｜　答案 " + (q.ans || "—"), cls: "readmeta" });
        }
      });
    }

    const card = $("#readCard");
    const jump = $("#toRead");
    if (!blocks.length) {
      card.style.display = "none";
      state.reading = [];
      if (jump) jump.style.display = "none";
      return;
    }
    state.reading = blocks.map(function (b) { return b.t || ""; });
    card.style.display = "";
    if (jump) jump.style.display = "";
    $("#reading").innerHTML = blocks.map(function (b, i) {
      if (b.cls === "readh" || b.cls === "readmeta") {
        return '<div class="' + b.cls + '">' + esc(b.label) + "</div>";
      }
      return '<p class="' + b.cls + '" data-i="' + i + '">' + wordify(b.t) + "</p>";
    }).join("");
  }

  let dictEl = null;
  function closeDict() {
    if (dictEl) { dictEl.remove(); dictEl = null; }
  }

  function placeDict(el) {
    const r = el.getBoundingClientRect();
    const w = 340;
    let left = Math.min(Math.max(10, r.left - 40), window.innerWidth - w - 14);
    let top = r.bottom + 8;
    if (top + 240 > window.innerHeight) top = Math.max(10, r.top - 248);
    dictEl.style.left = left + "px";
    dictEl.style.top = top + "px";
  }

  function dictShell(word) {
    closeDict();
    dictEl = document.createElement("div");
    dictEl.className = "dict";
    dictEl.innerHTML = '<button class="close" title="关闭">×</button>' +
      '<div class="dw">' + esc(word) + '<span class="ipa">…</span></div>' +
      '<div class="tip">查词中…</div>';
    document.body.appendChild(dictEl);
    dictEl.querySelector(".close").addEventListener("click", function (e) { e.stopPropagation(); closeDict(); });
    return dictEl;
  }

  function renderDict(el, word, data) {
    el.innerHTML = '<button class="close" title="关闭">×</button>' +
      '<div class="dw">' + esc(data.word || word) +
      (data.ipa ? '<span class="ipa">' + esc(data.ipa) + "</span>" : "") +
      (data.pos ? '<span class="pos">' + esc(data.pos) + "</span>" : "") + "</div>" +
      '<div class="dm">' + esc(data.meaning || "") + "</div>" +
      (data.nuance ? '<div class="dn">' + esc(data.nuance) + "</div>" : "") +
      (data.sentenceZh ? '<div class="ds"><span class="en">' + esc(data.sentence || "") + "</span>" + esc(data.sentenceZh) + "</div>" : "");
    el.querySelector(".close").addEventListener("click", function (e) { e.stopPropagation(); closeDict(); });
  }

  function dictShellSentence(sentence) {
    closeDict();
    dictEl = document.createElement("div");
    dictEl.className = "dict";
    dictEl.innerHTML = '<button class="close" title="关闭">×</button>' +
      '<div class="ds-en">' + esc(sentence) + "</div>" +
      '<div class="tip">翻译中…</div>';
    document.body.appendChild(dictEl);
    dictEl.querySelector(".close").addEventListener("click", function (e) { e.stopPropagation(); closeDict(); });
    return dictEl;
  }

  function renderSentence(el, sentence, data) {
    el.innerHTML = '<button class="close" title="关闭">×</button>' +
      '<div class="ds-en">' + esc(sentence) + "</div>" +
      '<div class="dm">' + esc(data.sentenceZh || "（没有拿到翻译）") + "</div>" +
      (data.note ? '<div class="dn">' + esc(data.note) + "</div>" : "");
    el.querySelector(".close").addEventListener("click", function (e) { e.stopPropagation(); closeDict(); });
  }

  async function openSentence(gEl, sentence) {
    const el = dictShellSentence(sentence);
    placeDict(gEl);
    const key = "S|" + sentence.slice(0, 90);
    const hit = cacheGet(key);
    if (hit) return renderSentence(el, sentence, hit);
    try {
      const data = await api("/api/lookup", { sentence: sentence, mode: "sentence" });
      if (data && data.error) throw new Error(data.error);
      cacheSet(key, data);
      renderSentence(el, sentence, data);
    } catch (e) {
      el.innerHTML = '<button class="close">×</button><div class="ds-en">' + esc(sentence) + "</div>" +
        '<div class="err">' + esc(e.message || "翻译失败") + "</div>" +
        '<div class="tip">没配 API Key 时不能翻译。</div>';
      el.querySelector(".close").addEventListener("click", function (ev) { ev.stopPropagation(); closeDict(); });
    }
  }

  function cacheGet(k) {
    try { const c = JSON.parse(localStorage.getItem("dictCache") || "{}"); return c[k] || null; } catch (e) { return null; }
  }
  function cacheSet(k, v) {
    try {
      const c = JSON.parse(localStorage.getItem("dictCache") || "{}");
      c[k] = v;
      const keys = Object.keys(c);
      if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(function (x) { delete c[x]; });
      localStorage.setItem("dictCache", JSON.stringify(c));
    } catch (e) { /* 缓存失败不影响使用 */ }
  }

  async function openDict(wordEl, sentence) {
    const word = wordEl.textContent;
    const el = dictShell(word);
    placeDict(wordEl);
    const key = word.toLowerCase() + "|" + sentence.slice(0, 48);
    const hit = cacheGet(key);
    if (hit) {
      hit.sentence = sentence;
      return renderDict(el, word, hit);
    }
    wordEl.classList.add("loading");
    try {
      const data = await api("/api/lookup", { word: word, sentence: sentence });
      if (data && data.error) throw new Error(data.error);
      data.sentence = sentence;
      cacheSet(key, data);
      vocabAdd({ word: data.word || word, ipa: data.ipa, pos: data.pos, meaning: data.meaning, nuance: data.nuance, sentence: sentence, sentenceZh: data.sentenceZh });
      renderDict(el, word, data);
    } catch (e) {
      el.innerHTML = '<button class="close">×</button><div class="dw">' + esc(word) + "</div>" +
        '<div class="err">' + esc(e.message || "查词失败") + "</div>" +
        '<div class="tip">可能是没配 API Key，或网络不通。</div>';
      el.querySelector(".close").addEventListener("click", function (ev) { ev.stopPropagation(); closeDict(); });
    } finally {
      wordEl.classList.remove("loading");
    }
  }

  window.__dict = { shell: dictShell, place: placeDict, render: renderDict }; // dev hook

  /* ---------------- 生词本 ---------------- */
  function vocabAll() {
    try { return JSON.parse(localStorage.getItem("vocab") || "[]"); } catch (e) { return []; }
  }
  function vocabSave(list) {
    try { localStorage.setItem("vocab", JSON.stringify(list)); } catch (e) {}
    const n = $("#vocabN");
    if (n) n.textContent = list.length;
  }
  function vocabAdd(item) {
    if (!item || !item.word) return;
    const list = vocabAll();
    const i = list.findIndex(function (x) { return String(x.word).toLowerCase() === String(item.word).toLowerCase(); });
    const rec = {
      word: item.word, ipa: item.ipa || "", pos: item.pos || "", meaning: item.meaning || "",
      nuance: item.nuance || "", sentence: item.sentence || "", sentenceZh: item.sentenceZh || "",
      at: Date.now(),
    };
    if (i >= 0) list[i] = Object.assign({}, list[i], rec);
    else list.unshift(rec);
    vocabSave(list);
  }
  function vocabTouch(word) {
    const list = vocabAll();
    const i = list.findIndex(function (x) { return String(x.word).toLowerCase() === String(word).toLowerCase(); });
    if (i >= 0) { list[i].at = Date.now(); vocabSave(list); }
  }
  function vocabRemove(word) {
    vocabSave(vocabAll().filter(function (x) { return String(x.word).toLowerCase() !== String(word).toLowerCase(); }));
  }

  function renderVocab() {
    const list = vocabAll();
    vocabSave(list);
    const box = $("#vList");
    if (!list.length) {
      box.innerHTML = '<div class="vempty">生词本还是空的。去「⑤ 原文精读」里点几个词，查过的词会自动收进来。</div>';
      return;
    }
    box.innerHTML = list.map(function (it, i) {
      return '<div class="vrow" data-i="' + i + '">' +
        '<input type="checkbox" checked>' +
        '<div class="vmain">' +
          '<div><span class="vword">' + esc(it.word) + "</span>" +
          (it.ipa ? '<span class="vipa">' + esc(it.ipa) + "</span>" : "") +
          (it.pos ? '<span class="vpos">' + esc(it.pos) + "</span>" : "") + "</div>" +
          (it.meaning ? '<div class="vmean">' + esc(it.meaning) + "</div>" : "") +
          (it.nuance ? '<div class="vnu">' + esc(it.nuance) + "</div>" : "") +
          (it.sentence ? '<div class="vex">' + esc(it.sentence) + "</div>" : "") +
        "</div>" +
        '<button class="vdel" title="删除">×</button></div>';
    }).join("");
    Array.from(box.querySelectorAll(".vdel")).forEach(function (b) {
      b.addEventListener("click", function () {
        const row = b.closest(".vrow");
        const it = list[Number(row.dataset.i)];
        vocabRemove(it.word);
        renderVocab();
      });
    });
  }

  function vocabSelected() {
    const list = vocabAll();
    const rows = Array.from(document.querySelectorAll("#vList .vrow"));
    return rows.filter(function (r) { return r.querySelector("input[type=checkbox]").checked; })
      .map(function (r) { return list[Number(r.dataset.i)]; }).filter(Boolean);
  }

  function confirmBox(title, text) {
    return new Promise(function (resolve) {
      $("#cfTitle").textContent = title;
      $("#cfText").textContent = text;
      $("#ovConfirm").classList.add("show");
      const done = function (v) {
        $("#ovConfirm").classList.remove("show");
        $("#cfYes").removeEventListener("click", yes);
        $("#cfNo").removeEventListener("click", no);
        resolve(v);
      };
      const yes = function () { done(true); };
      const no = function () { done(false); };
      $("#cfYes").addEventListener("click", yes);
      $("#cfNo").addEventListener("click", no);
    });
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function stamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  async function exportWord() {
    const items = vocabSelected();
    if (!items.length) return toast("先勾选要导出的词");
    toast("正在生成 Word…");
    try {
      const r = await fetch("/api/export/docx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items, title: "六级生词本" }),
      });
      if (!r.ok) throw new Error("导出失败 " + r.status);
      downloadBlob(await r.blob(), "六级生词本-" + stamp() + ".docx");
      toast("Word 已下载");
    } catch (e) { toast("导出失败：" + e.message); }
  }

  function exportPDF() {
    const items = vocabSelected();
    if (!items.length) return toast("先勾选要导出的词");
    const rows = items.map(function (it) {
      return '<div class="item"><div class="hd"><b>' + esc(it.word) + "</b>" +
        (it.ipa ? '<span class="ipa">' + esc(it.ipa) + "</span>" : "") +
        (it.pos ? '<span class="pos">' + esc(it.pos) + "</span>" : "") + "</div>" +
        (it.meaning ? '<div class="mn">' + esc(it.meaning) + "</div>" : "") +
        (it.nuance ? '<div class="nu">' + esc(it.nuance) + "</div>" : "") +
        (it.sentence ? '<div class="ex">' + esc(it.sentence) + "</div>" : "") +
        (it.sentenceZh ? '<div class="exz">' + esc(it.sentenceZh) + "</div>" : "") + "</div>";
    }).join("");
    const html = "<!doctype html><html><head><meta charset='utf-8'><title>六级生词本</title><style>" +
      "@page{size:A4;margin:16mm}" +
      "body{font-family:'Microsoft YaHei',sans-serif;color:#1d2125;font-size:12pt;line-height:1.6;margin:0}" +
      "h1{font-size:18pt;margin:0 0 2mm}.sub{color:#777;font-size:9pt;margin-bottom:7mm}" +
      ".item{margin:0 0 5mm;padding-bottom:4mm;border-bottom:1px solid #e6e2d9;page-break-inside:avoid}" +
      ".hd b{font-family:Georgia,serif;font-size:14pt}" +
      ".ipa{color:#888;font-family:Georgia,serif;margin-left:2mm;font-size:10pt}" +
      ".pos{color:#1c4f82;font-size:9pt;border:1px solid #cfdbe8;border-radius:3px;padding:0 2mm;margin-left:2mm}" +
      ".mn{font-size:12pt;margin-top:1mm}.nu{color:#777;font-size:10pt}" +
      ".ex{font-family:Georgia,serif;font-style:italic;color:#555;font-size:10pt;margin-top:1mm}" +
      ".exz{color:#666;font-size:10pt}" +
      "</style></head><body><h1>六级生词本</h1><div class='sub'>共 " + items.length + " 条 · " +
      new Date().toLocaleDateString("zh-CN") + "</div>" + rows + "</body></html>";

    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(ifr);
    const d = ifr.contentWindow.document;
    d.open(); d.write(html); d.close();
    setTimeout(function () {
      try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) { toast("打印失败：" + e.message); }
      setTimeout(function () { ifr.remove(); }, 60000);
    }, 500);
    toast("在弹出的打印窗口里，把「目标」选成「另存为 PDF」");
  }

  /* ---------------- questions ---------------- */
  let qSeq = 0;
  function addQuestion(q) {
    q = q || { stem: "", options: {}, my: "", correct: "" };
    qSeq++;
    const el = document.createElement("div");
    el.className = "q";
    el.dataset.id = "q" + qSeq;
    el.innerHTML =
      '<div class="qhead"><div class="no">' + qSeq + '</div>' +
      '<input type="text" class="stem" placeholder="题干 / Question stem">' +
      '<button class="del" title="删除">×</button></div>' +
      '<div class="opts">' +
      ["A", "B", "C", "D"].map(function (k) {
        return '<div class="opt"><i>' + k + '</i><input type="text" data-k="' + k + '" placeholder="选项 ' + k + '"></div>';
      }).join("") +
      '</div>' +
      '<div class="ansrow"><span>我选</span><select class="my"><option value="">—</option>' +
      ["A", "B", "C", "D"].map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join("") +
      '</select><span>正确答案</span><select class="correct"><option value="">未知</option>' +
      ["A", "B", "C", "D"].map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join("") +
      '</select><span class="hint" style="margin-left:auto">不知道答案就留空</span></div>';
    els.qlist.appendChild(el);
    el.querySelector(".stem").value = q.stem || "";
    ["A", "B", "C", "D"].forEach(function (k) {
      const inp = el.querySelector('input[data-k="' + k + '"]');
      if (inp) inp.value = (q.options && q.options[k]) || "";
    });
    el.querySelector(".my").value = q.my || "";
    el.querySelector(".correct").value = q.correct || "";
    el.querySelector(".del").addEventListener("click", function () {
      el.remove(); renumber();
      if (!els.qlist.children.length) addQuestion();
    });
    return el;
  }
  function renumber() {
    Array.from(els.qlist.children).forEach(function (el, i) {
      el.querySelector(".no").textContent = String(i + 1);
    });
    qSeq = els.qlist.children.length;
  }
  function collect() {
    return Array.from(els.qlist.children).map(function (el, i) {
      const o = {};
      ["A", "B", "C", "D"].forEach(function (k) {
        const inp = el.querySelector('input[data-k="' + k + '"]');
        o[k] = inp ? inp.value.trim() : "";
      });
      return {
        no: i + 1,
        stem: el.querySelector(".stem").value.trim(),
        options: o,
        my: el.querySelector(".my").value,
        correct: el.querySelector(".correct").value,
      };
    }).filter(function (q) { return q.stem || q.options.A; });
  }

  /* ---------------- records ---------------- */
  function netHelp() {
    if (location.protocol === "file:") {
      return "页面是直接双击打开的（file://），连不上本地服务。请双击文件夹里的「启动.bat」，再用 http://127.0.0.1:7788 打开。";
    }
    return "连不上本地服务 http://127.0.0.1:7788 —— 多半是那个黑色窗口被关了。重新双击「启动.bat」，然后刷新本页。";
  }

  async function api(path, body, method, allowRetry) {
    const opt = {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    };
    let res;
    try {
      res = await fetch(path, opt);
    } catch (e) {
      if (allowRetry !== false) {
        await new Promise(function (r) { setTimeout(r, 500); });
        return api(path, body, method, false);
      }
      throw new Error(netHelp());
    }
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (e) { data = { error: txt }; }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  async function saveRecord() {
    const article = els.article.value.trim() || extractReading(state.analysis) || "";
    const questions = collect();
    if (!article && !questions.length) return;
    const payload = {
      id: state.recordId,
      title: questions.length ? (questions[0].stem.slice(0, 28) || "未命名") : (article.slice(0, 24) || "未命名"),
      article: article,
      questions: questions,
      analysis: state.analysis,
      chat: state.chat,
      hasImages: state.images.length > 0,
    };
    try {
      const r = await api("/api/records", payload);
      if (r && r.id) state.recordId = r.id;
    } catch (e) { /* 保存失败不影响主流程 */ }
  }

  /* ---------------- SSE ---------------- */
  async function stream(url, payload, onDelta) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error(netHelp());
    }
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t.slice(0, 300) || ("HTTP " + res.status));
    }
    if (ct.indexOf("application/json") >= 0) return await res.json();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const lines = chunk.split("\n");
        for (let n = 0; n < lines.length; n++) {
          const ln = lines[n];
          if (ln.indexOf("data:") !== 0) continue;
          const d = ln.slice(5).trim();
          if (!d) continue;
          let j = null;
          try { j = JSON.parse(d); } catch (e) { continue; }
          if (j.error) throw new Error(j.error);
          if (typeof j.delta === "string" && j.delta) { full += j.delta; onDelta(full); }
        }
      }
    }
    return { text: full };
  }

  /* ---------------- analyze ---------------- */
  function setBusy(b, txt) {
    state.busy = b;
    $("#analyze").disabled = b;
    $("#send").disabled = b;
    $("#analyze").textContent = b ? "解剖中…" : "开始解剖";
    if (txt) els.runhint.textContent = txt;
  }

  async function analyze() {
    const article = els.article.value.trim();
    const questions = collect();
    const images = state.images.map(function (im) { return { dataUrl: im.dataUrl, name: im.name }; });
    if (!images.length && article.length < 40) return toast("先传一张页面照片，或把文章粘进来");
    if (!images.length && !questions.length) return toast("至少填一道题，或者直接传图片");
    state.analysis = ""; state.chat = []; state.recordId = null;
    els.msgs.innerHTML = "";
    $("#result").innerHTML = '<p class="hint">正在定位…</p>';
    setBusy(true, images.length ? "正在读图、定位，通常要 30–90 秒…" : "正在逐段比对，请稍候…");
    let acc = "";
    try {
      const r = await stream("/api/analyze", {
        article: article, questions: questions, images: images,
        myAnswers: ($("#myAns") && $("#myAns").value.trim()) || "",
      }, function (t) {
        acc = t;
        $("#result").innerHTML = md(acc);
      });
      if (r && r.mode === "prompt") {
        state.analysis = "";
        $("#result").innerHTML =
          '<p class="hint" style="color:#b3352b">还没有配置 API Key，下面是为你生成的完整提示词：复制它，粘贴到任意 AI（或本对话）即可拿到同样的解析。</p>' +
          '<div class="row"><button class="btn sm" id="copyPrompt">复制提示词</button></div>' +
          '<pre><code>' + esc(r.prompt) + "</code></pre>";
        const b = $("#copyPrompt");
        if (b) b.addEventListener("click", function () { copy(r.prompt); });
        setBusy(false, "填个 API Key 就能全自动。");
        return;
      }
      state.analysis = acc;
      const parsedQs = parseQuestionsFromMd(acc);
      setReading(extractReading(acc) || article, parsedQs.length ? parsedQs : questionsFromCards());
      await saveRecord();
      setBusy(false, "报告已存进错题本。可以直接在下面追问。");
    } catch (e) {
      $("#result").innerHTML = '<p style="color:#b3352b">出错了：' + esc(e.message) + "</p>" +
        '<p class="hint">检查设置里的 API 地址 / Key / 模型名。</p>';
      setBusy(false, "分析失败。");
    }
  }

  /* ---------------- chat ---------------- */
  function pushMsg(role, text) {
    const d = document.createElement("div");
    d.className = "msg " + role;
    d.innerHTML = role === "user" ? esc(text) : '<div class="md">' + md(text) + "</div>";
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return d;
  }

  async function send() {
    const text = els.ask.value.trim();
    if (!text || state.busy) return;
    if (!state.analysis) return toast("先做一次解剖，再基于它追问");
    els.ask.value = "";
    pushMsg("user", text);
    state.chat.push({ role: "user", content: text });
    const holder = pushMsg("bot", "");
    const body = holder.querySelector(".md");
    setBusy(true, "回答中…");
    let acc = "";
    try {
      await stream("/api/chat", {
        article: els.article.value.trim(),
        questions: collect(),
        analysis: state.analysis,
        messages: state.chat.slice(-8),
      }, function (t) {
        acc = t; body.innerHTML = md(acc);
        els.msgs.scrollTop = els.msgs.scrollHeight;
      });
      state.chat.push({ role: "assistant", content: acc });
      await saveRecord();
      setBusy(false, "继续问，或换一篇文章。");
    } catch (e) {
      body.innerHTML = '<span style="color:#b3352b">出错了：' + esc(e.message) + "</span>";
      setBusy(false, "追问失败。");
    }
  }

  /* ---------------- copy / export ---------------- */
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("已复制"); },
        function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("已复制"); } catch (e) { toast("复制失败，请手动选择"); }
    ta.remove();
  }

  /* ---------------- bulk parse ---------------- */
  function parseBulk(text) {
    const out = [];
    let cur = null;
    let src = String(text || "").replace(/\r/g, "");
    src = src.replace(/[ \t]+(?=[A-D][.)、]\s)/g, "\n");
    src.split("\n").forEach(function (raw) {
      const line = raw.trim();
      if (!line) return;
      const qm = line.match(/^(\d{1,3})[.、)]\s*(.+)$/);
      if (qm && !/^[A-D][.)、]/.test(line)) {
        if (cur) out.push(cur);
        cur = { stem: qm[2], options: {}, my: "", correct: "" };
        return;
      }
      const om = line.match(/^([A-D])[.)、]\s*(.*)$/);
      if (om && cur) { cur.options[om[1]] = om[2].trim(); return; }
      if (cur) {
        if (!cur.options.A) cur.stem += " " + line;
        else {
          const last = Object.keys(cur.options).pop();
          cur.options[last] = (cur.options[last] + " " + line).trim();
        }
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  async function saveToNotebook() {
    const article = els.article.value.trim() || extractReading(state.analysis) || "";
    const questions = collect();
    if (!article && !questions.length) return toast("先填文章、传照片或跑一次解剖，再存");
    try {
      const r = await api("/api/records", {
        id: state.recordId,
        title: questions.length ? (questions[0].stem.slice(0, 28) || "未命名") : (article.slice(0, 24) || "未命名"),
        article: article, questions: questions, analysis: state.analysis, chat: state.chat,
      });
      if (r && r.id) state.recordId = r.id;
      toast("已存进错题本");
    } catch (e) { toast("保存失败：" + e.message); }
  }

  /* ---------------- demo ---------------- */
  const DEMO_ARTICLE = "Influencers—the (usually female) people behind the most popular accounts on Instagram, TikTok and YouTube—have large followings, often in the hundreds of thousands or millions. According to Forbes, more than 50m people globally describe themselves as influencers; Goldman Sachs predicts the industry will double to nearly $500bn by 2027.\n\n" +
    "Though they shape digital culture, influencers are too often dismissed as fame-hungry pseudo-celebrities, who post about the minutiae of their lives and mindlessly promote branded products for eye-watering sums. But a new crop of books takes the influencer industry more seriously by exploring the way social media's most popular users are reshaping the global economy and changing what the average person views online.\n\n" +
    "Taylor Lorenz's new book, \"Extremely Online\", argues that influencers hold huge power: \"Tech founders may control the source code, but users shape the product.\" Charting the history of the influencer (once called \"e-celebs\" or \"ceWEBrities\") from the 1990s to today, Ms. Lorenz argues influencers rose by making fame and luxury less \"sealed off\".\n\n" +
    "Like reality-TV stars, early influencers created a new, niche sort of celebrity, popular enough to draw scrutiny but still unrecognisable to most. Ms. Lorenz makes the case that, despite its bad reputation, influencing has \"given more people the chance to benefit directly from their labour than at any other time in history\", regaling readers with stories about \"mommy bloggers\" turning the pain of parenthood into six-figure businesses and teens becoming multi-millionaires off short comedy skits.\n\n" +
    "Influencing has also spilled into politics, with the rise of social-media activism and influencers gaining followers by posting about social issues and news. (This sometimes leads to political candidates courting them in order to sway younger voters.) She also examines influencers' new role in traditional media, with TV and film studios harvesting stars and storylines from the content on these accounts.\n\n" +
    "Ms. Lorenz's take on influencing is optimistic. She is not alone. \"Bad Influence\" reflects on a decade of influencing, and also paints a honeyed picture of influencers' function in culture.\n\n" +
    "And there are plenty of reasons to be anxious: for every fan, there is a critic. A vehement one is Symeon Brown, who looks at the industry's underbelly, full of scammers, surgeries, racism and exploitation, in his entertaining \"Get Rich or Lie Trying\". He argues that this is influencers' real impact: making exploitation more accessible, widespread and far wilier than it was in its pre-internet days.\n\n" +
    "The argument that runs through these very different books is that influencers have changed the rhythm of our culture, as well as who in society holds power. How long influencers will stay top of their game, however, is not something any of the books try to answer.";

  const DEMO_QS = [
    { stem: "What can be inferred from Goldman Sachs's prediction?",
      options: { A: "The most popular accounts on social media are often owned by women.",
                 B: "Influencers usually have a good number of followers which can be as high as millions.",
                 C: "The number of world-recognized influencers is expected to reach 50 million this year.",
                 D: "The influencer industry has grown to about $250 billion by now." },
      my: "B", correct: "D" },
    { stem: "What can we conclude from the stories described in Taylor Lorenz's \u201cExtremely Online\u201d?",
      options: { A: "Influencers have a very long history.",
                 B: "Fame and luxury become more accessible to average person.",
                 C: "Early influencers become more recognizable than reality-TV stars.",
                 D: "Influencing makes more people get profits directly from their labour." },
      my: "A", correct: "D" },
    { stem: "What does it suggest when influencers put social news into their posts?",
      options: { A: "They promote the development of social-media activism.",
                 B: "They become influential in political sector.",
                 C: "They help political candidates to win support.",
                 D: "They play a new role in traditional media." },
      my: "D", correct: "B" },
  ];

  function loadDemo() {
    els.article.value = DEMO_ARTICLE;
    els.qlist.innerHTML = ""; qSeq = 0;
    DEMO_QS.forEach(addQuestion);
    updateWc();
    setReading(DEMO_ARTICLE, cardsToQs(DEMO_QS.map(function (q, i) { return { no: i + 21, stem: q.stem, options: q.options, my: q.my, correct: q.correct }; })));
    toast("已填入示例：2024 年 12 月六级 Passage 3 的 21–23 题");
  }

  /* ---------------- settings ---------------- */
  async function loadSettings() {
    try {
      const s = await api("/api/settings");
      cfg.baseUrl = s.baseUrl || ""; cfg.model = s.model || ""; cfg.hasKey = !!s.hasKey;
      els.dot.classList.toggle("on", cfg.hasKey);
      $("#cfgBase").value = s.baseUrl || "";
      $("#cfgKey").value = "";
      $("#cfgKey").placeholder = s.hasKey ? "已保存（留空则不修改）" : "sk-...";
      $("#cfgModel").value = s.model || "";
      $("#cfgTemp").value = s.temperature != null ? s.temperature : 0.2;
      if (!s.hasKey) els.runhint.textContent = "还没填 API Key：目前只能生成提示词。点右上「设置」填一下即可全自动。";
    } catch (e) { /* ignore */ }
  }

  function cfgMsg(text, ok) {
    const el = $("#cfgErr");
    if (!text) { el.className = "cfgerr"; el.textContent = ""; return; }
    el.className = "cfgerr show" + (ok ? " ok" : "");
    el.textContent = text;
  }

  async function saveSettings() {
    let base = $("#cfgBase").value.trim();
    let k = $("#cfgKey").value.trim();
    if (!base) base = "https://api.deepseek.com/v1";
    if (/platform\.deepseek\.com|deepseek\.com\/api|platform\.deepseek/i.test(base)) {
      return cfgMsg("「API 地址」里填的是官网网页地址，不是接口地址。这里固定填 https://api.deepseek.com/v1");
    }
    if (/^https?:\/\/[^/]+$/.test(base) && /deepseek/i.test(base) && base.indexOf("/v1") < 0) {
      return cfgMsg("地址少了一段，应该是 https://api.deepseek.com/v1");
    }
    if (k && !/^sk-/.test(k)) {
      return cfgMsg("Key 通常以 sk- 开头。你填的内容看起来不是 Key —— 去 platform.deepseek.com/api_keys 点「创建 API key」复制。");
    }
    cfgMsg("");
    const body = { baseUrl: base, model: $("#cfgModel").value.trim() || "deepseek-flash", temperature: parseFloat($("#cfgTemp").value) || 0.2 };
    if (k) body.apiKey = k;
    try {
      const s = await api("/api/settings", body);
      cfg.hasKey = !!s.hasKey; els.dot.classList.toggle("on", cfg.hasKey);
      $("#ovSettings").classList.remove("show");
      toast(cfg.hasKey ? "已保存，可以开始解剖了" : "已保存（还没有 Key）");
    } catch (e) { cfgMsg("保存失败：" + e.message); }
  }

  async function testConn() {
    const base = $("#cfgBase").value.trim() || "https://api.deepseek.com/v1";
    const k = $("#cfgKey").value.trim();
    if (!k && !cfg.hasKey) return cfgMsg("先填 Key，再点测试。");
    cfgMsg("测试中…", true);
    try {
      const r = await api("/api/ping", { baseUrl: base, apiKey: k, model: $("#cfgModel").value.trim() || "deepseek-flash" });
      if (r && r.ok) cfgMsg("连接成功，模型 " + r.model + " 可用 ✅", true);
      else cfgMsg("连接失败：" + ((r && r.error) || "未知错误"));
    } catch (e) { cfgMsg("连接失败：" + e.message); }
  }

  /* ---------------- history ---------------- */
  async function openHistory() {
    $("#ovHistory").classList.add("show");
    const box = $("#recList");
    box.innerHTML = '<p class="hint">加载中…</p>';
    try {
      const list = await api("/api/records");
      if (!list.length) {
        box.innerHTML = '<div class="vempty">还没有记录。<br>跑完一次「开始解剖」会自动存一份；<br>' +
          '只生成了提示词（没配 Key）时不会存档，可以点左边「只存到错题本」手动存。</div>';
        return;
      }
      box.innerHTML = list.map(function (r) {
        const d = new Date(r.createdAt || Date.now());
        return '<div class="rec" data-id="' + r.id + '"><b>' + esc(r.title || "未命名") + "</b>" +
          "<small>" + d.toLocaleString("zh-CN") + " · " + (r.qcount || 0) + " 题 · " + ((r.analysis || "").length) + " 字报告</small></div>";
      }).join("");
      Array.from(box.querySelectorAll(".rec")).forEach(function (el) {
        el.addEventListener("click", function () { return loadRecord(el.dataset.id); });
      });
    } catch (e) { box.innerHTML = '<p class="hint">读取失败：' + esc(e.message) + "</p>"; }
  }

  async function importMarkdown(file) {
    if (!file) return;
    let text = "";
    try { text = await file.text(); } catch (e) { return toast("读取失败：" + e.message); }
    if (!text.trim()) return toast("这个文件是空的");
    const head = (text.match(/^#s+(.+)$/m) || [])[1];
    const title = (head || file.name.replace(/.[^.]+$/, "")).slice(0, 40) || "导入的报告";
    try {
      await api("/api/records", { title: title, article: extractReading(text), questions: [], analysis: text, chat: [] });
      await openHistory();
      toast("已导入：" + title);
    } catch (e) { toast("导入失败：" + e.message); }
  }

  async function loadRecord(id) {
    try {
      const r = await api("/api/records?id=" + encodeURIComponent(id));
      if (!r || !r.record) return;
      const rec = r.record;
      els.article.value = rec.article || "";
      updateWc();
      els.qlist.innerHTML = ""; qSeq = 0;
      (rec.questions || []).forEach(addQuestion);
      if (!els.qlist.children.length) addQuestion();
      state.recordId = rec.id;
      state.analysis = rec.analysis || "";
      state.chat = rec.chat || [];
      $("#result").innerHTML = state.analysis ? md(state.analysis) : '<div class="empty">这份记录还没有报告。</div>';
      const recQs = parseQuestionsFromMd(state.analysis);
      setReading(extractReading(state.analysis) || rec.article || "",
        recQs.length ? recQs : cardsToQs(rec.questions));
      els.msgs.innerHTML = "";
      state.chat.forEach(function (m) { pushMsg(m.role === "user" ? "user" : "bot", m.content); });
      $("#ovHistory").classList.remove("show");
      toast("已载入：" + (rec.title || ""));
    } catch (e) { toast("载入失败：" + e.message); }
  }

  /* ---------------- misc ---------------- */
  function updateWc() {
    const t = els.article.value.trim();
    const w = t ? t.split(/\s+/).filter(Boolean).length : 0;
    els.wc.textContent = w + " 词 · " + t.length + " 字符";
  }

  /* ---------------- init ---------------- */
  els.article.addEventListener("input", updateWc);
  $("#file").addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = function () { els.article.value = String(rd.result || ""); updateWc(); toast("已载入 " + f.name); };
    rd.readAsText(f, "utf-8");
    e.target.value = "";
  });
  $("#clearArticle").addEventListener("click", function () { els.article.value = ""; updateWc(); });

  /* 图片：点击 / 拖拽 / Ctrl+V */
  const dropEl = $("#drop");
  dropEl.addEventListener("click", function () { $("#imgInput").click(); });
  $("#imgInput").addEventListener("change", function (e) {
    addImages(e.target.files);
    e.target.value = "";
  });
  ["dragenter", "dragover"].forEach(function (t) {
    dropEl.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); dropEl.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    dropEl.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); dropEl.classList.remove("over"); });
  });
  dropEl.addEventListener("drop", function (e) {
    const f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) addImages(f);
  });
  window.addEventListener("dragover", function (e) {
    const t = e.dataTransfer && e.dataTransfer.types;
    if (t && Array.prototype.indexOf.call(t, "Files") >= 0) e.preventDefault();
  });
  window.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault();
  });
  document.addEventListener("paste", function (e) {
    if (!e.clipboardData) return;
    const items = Array.from(e.clipboardData.items || []);
    const files = items.filter(function (it) { return it.kind === "file" && it.type.indexOf("image/") === 0; })
      .map(function (it) { return it.getAsFile(); }).filter(Boolean);
    if (files.length) { e.preventDefault(); addImages(files); toast("已粘贴 " + files.length + " 张图"); }
  });
  $("#addQ").addEventListener("click", function () { addQuestion(); });
  $("#analyze").addEventListener("click", analyze);
  $("#saveRec").addEventListener("click", saveToNotebook);
  $("#send").addEventListener("click", send);
  els.ask.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  $("#btnDemo").addEventListener("click", loadDemo);
  $("#btnSettings").addEventListener("click", function () { $("#ovSettings").classList.add("show"); });
  $("#cancelSettings").addEventListener("click", function () { $("#ovSettings").classList.remove("show"); });
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#btnHistory").addEventListener("click", openHistory);
  $("#closeHistory").addEventListener("click", function () { $("#ovHistory").classList.remove("show"); });
  $("#mdImport").addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    importMarkdown(f);
  });
  $("#bulkQ").addEventListener("click", function () { $("#ovBulk").classList.add("show"); });
  $("#cancelBulk").addEventListener("click", function () { $("#ovBulk").classList.remove("show"); });
  $("#doBulk").addEventListener("click", function () {
    const qs = parseBulk($("#bulkText").value);
    if (!qs.length) return toast("没解析出题目，检查一下格式");
    els.qlist.innerHTML = ""; qSeq = 0;
    qs.forEach(addQuestion);
    $("#ovBulk").classList.remove("show");
    toast("已添加 " + qs.length + " 题");
  });
  $("#reading").addEventListener("click", function (e) {
    const p = e.target.closest(".readp");
    if (!p) return;
    const raw = state.reading[Number(p.dataset.i)] || "";
    const w = e.target.closest(".w");
    if (w) {
      const sentence = sentenceAt(raw, Number(w.dataset.i));
      vocabTouch(w.textContent, sentence);
      return openDict(w, sentence);
    }
    const g = e.target.closest(".g");
    if (g) {
      const at = Number(g.dataset.i);
      const sentence = sentenceAt(raw, Math.max(0, at));
      if (sentence) openSentence(g, sentence);
      return;
    }
  });
  $("#reading").addEventListener("dblclick", function (e) {
    const p = e.target.closest(".readp");
    const w = e.target.closest(".w");
    if (!p || !w) return;
    e.preventDefault();
    const raw = state.reading[Number(p.dataset.i)] || "";
    openSentence(w, sentenceAt(raw, Number(w.dataset.i)));
  });
  document.addEventListener("click", function (e) {
    if (dictEl && !dictEl.contains(e.target) && !(e.target.closest && e.target.closest(".w"))) closeDict();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDict(); });
  window.addEventListener("scroll", function () { if (dictEl) closeDict(); }, true);

  $("#btnVocab").addEventListener("click", function () { renderVocab(); $("#ovVocab").classList.add("show"); });
  $("#closeVocab").addEventListener("click", function () { $("#ovVocab").classList.remove("show"); });
  $("#vAll").addEventListener("click", function () {
    Array.from(document.querySelectorAll("#vList input[type=checkbox]")).forEach(function (c) { c.checked = true; });
  });
  $("#vNone").addEventListener("click", function () {
    Array.from(document.querySelectorAll("#vList input[type=checkbox]")).forEach(function (c) { c.checked = false; });
  });
  $("#vDelSel").addEventListener("click", async function () {
    const sel = vocabSelected();
    if (!sel.length) return toast("先勾选要删除的词");
    if (!(await confirmBox("删除选中的词", "将删除 " + sel.length + " 个词，删掉就没了。"))) return;
    const names = sel.map(function (x) { return String(x.word).toLowerCase(); });
    vocabSave(vocabAll().filter(function (x) { return names.indexOf(String(x.word).toLowerCase()) < 0; }));
    renderVocab();
    toast("已删除 " + sel.length + " 个");
  });
  $("#vClear").addEventListener("click", async function () {
    if (!(await confirmBox("清空生词本", "会删掉全部 " + vocabAll().length + " 条记录，确定？"))) return;
    vocabSave([]);
    renderVocab();
  });
  $("#vPdf").addEventListener("click", exportPDF);
  $("#vWord").addEventListener("click", exportWord);

  $("#toRead").addEventListener("click", function () {
    const c = $("#readCard");
    if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#copyMd").addEventListener("click", function () {
    if (!state.analysis) return toast("还没有报告");
    copy(state.analysis);
  });
  $("#saveMd").addEventListener("click", function () {
    if (!state.analysis) return toast("还没有报告");
    const blob = new Blob([state.analysis], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "错题解剖报告.md";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  });
  Array.from(document.querySelectorAll(".overlay")).forEach(function (ov) {
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("show"); });
  });

  $("#testConn").addEventListener("click", testConn);
  $("#ovSettings").addEventListener("transitionend", function () {});

  function envCheck() {
    const b = $("#envWarn");
    if (location.protocol === "file:") {
      b.hidden = false;
      b.innerHTML = "⚠️ 你现在是直接双击 index.html 打开的（file://），这样连不上本地服务。请回到文件夹双击 <b>启动.bat</b>，浏览器会自动打开 http://127.0.0.1:7788";
      return;
    }
    fetch("/api/health", { cache: "no-store" }).then(function (r) {
      b.hidden = r.ok;
      if (!r.ok) b.innerHTML = "⚠️ 本地服务状态异常，请重新双击 <b>启动.bat</b> 后刷新本页。";
    }).catch(function () {
      b.hidden = false;
      b.innerHTML = "⚠️ 本地服务已断开（那个黑色窗口可能被关了）。重新双击 <b>启动.bat</b>，再刷新本页即可。";
    });
  }

  addQuestion();
  updateWc();
  vocabSave(vocabAll());
  loadSettings();
  envCheck();
  setInterval(envCheck, 20000);
  if (/[?&]cfg=1/.test(location.search)) $("#ovSettings").classList.add("show");
  if (/[?&]vocabdemo=1/.test(location.search)) {
    if (!vocabAll().length) {
      vocabAdd({ word: "influencer", ipa: "/ˈɪnfluənsə/", pos: "n.", meaning: "网红；有影响力的人", nuance: "指靠社媒内容变现、拥有大量粉丝的人", sentence: "Influencers have large followings.", sentenceZh: "网红拥有大量粉丝。" });
      vocabAdd({ word: "sealed off", ipa: "", pos: "短语", meaning: "被封锁的；与外界隔绝的", nuance: "此处指名气与奢侈品曾是小圈子的特权", sentence: "influencers rose by making fame and luxury less 'sealed off'.", sentenceZh: "网红通过让名气与奢侈不再封闭而崛起。" });
      vocabAdd({ word: "vehement", ipa: "/ˈviːəmənt/", pos: "adj.", meaning: "激烈的；猛烈的", nuance: "修饰 critic，指批评得毫不留情", sentence: "A vehement one is Symeon Brown.", sentenceZh: "其中一位言辞激烈的批评者是西米恩·布朗。" });
    }
    renderVocab();
    $("#ovVocab").classList.add("show");
  }
  if (/[?&]dictdemo=1/.test(location.search)) setTimeout(function () {
    const w = document.querySelector("#reading .w");
    if (!w || !window.__dict) return;
    const el = window.__dict.shell("Influencers");
    window.__dict.place(w);
    window.__dict.render(el, "Influencers", { word: "influencer", ipa: "/ˈɪnfluənsə/", pos: "n.",
      meaning: "网红；有影响力的人", nuance: "此处指在社交媒体上拥有大量粉丝、靠内容变现的人",
      sentence: "Influencers—the (usually female) people behind the most popular accounts…",
      sentenceZh: "网红——那些运营着 Instagram、TikTok 和 YouTube 上最热门账号的人（通常为女性）——拥有大量粉丝。" });
  }, 500);
  if (location.search.indexOf("demo") >= 0) loadDemo();
})();
