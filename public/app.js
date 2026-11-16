/* 错题解剖台 · 前端逻辑（无依赖） */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const els = {
    article: $("#article"), wc: $("#wc"), qlist: $("#qlist"), result: $("#result"),
    msgs: $("#msgs"), ask: $("#ask"), dot: $("#dot"), runhint: $("#runhint"),
  };

  const state = { questions: [], analysis: "", chat: [], recordId: null, recordTitle: "", busy: false, images: [], reading: [], kind: "mcq" };
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
    const hasOld = els.article.value.trim().length > 0 || collect().some(function (q) { return q.stem; });
    if (hasOld) {
      const ok = await confirmBox("来了新的照片", "输入区里还有上一份的文章 / 题目。清空它们，只分析这批新照片？");
      if (ok) { resetWorkbench({ keepImages: true }); return; }
    }
    mixedCheck();
  }

  function resetWorkbench(opts) {
    opts = opts || {};
    els.article.value = "";
    updateWc();
    if (!opts.keepImages) {
      state.images = [];
      renderThumbs();
    }
    els.qlist.innerHTML = "";
    qSeq = 0;
    state.kind = "mcq";
    const ksel = $("#qkind"); if (ksel) ksel.value = "mcq";
    addQuestion();
    const ma = $("#myAns"); if (ma) ma.value = "";
    state.analysis = ""; state.chat = [];
    state.recordId = null; state.recordTitle = "";
    updateRecChip("");
    const res = $("#result");
    if (res) res.innerHTML = '<div class="empty">把文章和题目填好，点左边「开始解剖」。<br>报告会包含：文章骨架 → 逐题定位 → 你的错选出自哪一句 → 共性诊断 → 生词。</div>';
    if (els.msgs) els.msgs.innerHTML = "";
    setReading("");
    const banner = $("#mixedWarn"); if (banner) banner.hidden = true;
    Array.from(document.querySelectorAll(".overlay.show")).forEach(function (o) { o.classList.remove("show"); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function newSession() {
    const hasText = els.article.value.trim().length > 0;
    const hasQs = collect().some(function (q) { return q.stem; });
    if ((hasText || hasQs || state.images.length) &&
        !(await confirmBox("开始新的一篇", "会清空当前的文章、题目和照片；已经存进错题本的内容不受影响。"))) {
      return;
    }
    resetWorkbench();
    toast("已清空，可以传新的一份了");
  }

  function mixedCheck() {
    const banner = $("#mixedWarn");
    if (!banner) return;
    const hasText = els.article.value.trim().length > 0;
    const hasQs = collect().length > 0;
    if (!state.images.length || (!hasText && !hasQs)) { banner.hidden = true; return; }
    const src = state.recordTitle ? "记录「" + state.recordTitle + "」" : "文字输入";
    $("#mixedTitle").textContent =
      "已经有" + src + "的内容。照片会和这些文字、题目一起发出去，模型可能对不上号——" +
      "要做的是新的一篇，先清空。";
    banner.hidden = false;
  }

  function clearImages() {
    const had = state.images.length > 0;
    state.images = [];
    renderThumbs();
    return had;
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
    const idx = vocabIndex();
    const re = /([A-Za-z][A-Za-z'’\-]*)/g;
    let out = "", last = 0, m;
    const gap = function (str, off) {
      return str ? '<span class="g" data-i="' + off + '">' + esc(str) + "</span>" : "";
    };
    while ((m = re.exec(text)) !== null) {
      out += gap(text.slice(last, m.index), last);
      const hit = vocabLookup(idx, m[1]);
      const cls = "w" + (hit ? (isFocus(hit) ? " w-known w-focus" : " w-known") : "");
      out += '<span class="' + cls + '" data-i="' + m.index + '">' + esc(m[1]) + "</span>";
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

  function refreshWordMarks() {
    const idx = vocabIndex();
    Array.from(document.querySelectorAll("#reading .w")).forEach(function (el) {
      const hit = vocabLookup(idx, el.textContent);
      el.classList.toggle("w-known", !!hit);
      el.classList.toggle("w-focus", !!(hit && isFocus(hit)));
    });
  }

  function setReading(text, qs) {
    const clean = String(text || "").replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, "").trim();
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

  function placeDict() { /* 固定在右下角，避免盖住相邻的单词 */ }

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

  async function openDict(wordEl, sentence, src) {
    const word = wordEl.textContent;
    const el = dictShell(word);
    placeDict(wordEl);
    const key = word.toLowerCase() + "|" + sentence.slice(0, 48);
    const hit = cacheGet(key);
    if (hit) {
      hit.sentence = sentence;
      const known = vocabIndex()[String(word).toLowerCase()];
      if (!known) {
        vocabAdd({ word: hit.word || word, ipa: hit.ipa, pos: hit.pos, meaning: hit.meaning, nuance: hit.nuance, sentence: sentence, sentenceZh: hit.sentenceZh, src: src || "" });
      } else {
        vocabTouch(hit.word || word);
      }
      return renderDict(el, word, hit);
    }
    wordEl.classList.add("loading");
    try {
      const data = await api("/api/lookup", { word: word, sentence: sentence });
      if (data && data.error) throw new Error(data.error);
      data.sentence = sentence;
      cacheSet(key, data);
      vocabAdd({ word: data.word || word, ipa: data.ipa, pos: data.pos, meaning: data.meaning, nuance: data.nuance, sentence: sentence, sentenceZh: data.sentenceZh, src: src || "" });
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
    const key = String(item.word).toLowerCase();
    const i = list.findIndex(function (x) { return String(x.word).toLowerCase() === key; });
    const prev = i >= 0 ? list[i] : null;
    const rec = {
      word: item.word, ipa: item.ipa || "", pos: item.pos || "", meaning: item.meaning || "",
      nuance: item.nuance || "", sentence: item.sentence || "", sentenceZh: item.sentenceZh || "",
      src: item.src || (prev && prev.src) || "",
      hits: prev ? (prev.hits || 1) + 1 : 1,
      star: prev ? !!prev.star : false,
      box: prev ? (prev.box || 0) : 0,
      due: prev ? (prev.due || Date.now()) : Date.now(),
      last: prev ? (prev.last || 0) : 0,
      at: Date.now(),
    };
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    vocabSave(list);
    refreshWordMarks();
  }

  const DAY = 86400000;
  const INTERVAL = [1, 3, 7, 16, 35, 60]; // box 0..5 对应的下次复习间隔（天）

  function isFocus(it) { return !!(it && (it.star || (it.hits || 1) >= 2)); }
  function dueOf(it) { return it.due || it.at || 0; }
  function isDue(it, now) { return dueOf(it) <= (now || Date.now()); }
  function dueList() {
    const now = Date.now();
    return vocabAll().filter(function (x) { return x.word && isDue(x, now); })
      .sort(function (x, y) { return dueOf(x) - dueOf(y); });
  }

  function stemKey(w) {
    w = String(w || "").toLowerCase().trim();
    if (w.length > 4 && w.slice(-3) === "ies") return w.slice(0, -3) + "y";
    if (w.length > 5 && w.slice(-3) === "ing") return w.slice(0, -3);
    if (w.length > 4 && w.slice(-2) === "es") return w.slice(0, -2);
    if (w.length > 4 && w.slice(-2) === "ed") return w.slice(0, -2);
    if (w.length > 3 && w.slice(-1) === "s" && w.slice(-2) !== "ss") return w.slice(0, -1);
    return w;
  }

  function vocabIndex() {
    const map = {};
    vocabAll().forEach(function (x) {
      const w = String(x.word || "").toLowerCase();
      map[w] = x;
      map[stemKey(w)] = x;
    });
    return map;
  }

  function vocabLookup(map, token) {
    const t = String(token || "").toLowerCase();
    return map[t] || map[stemKey(t)] || null;
  }

  function vocabTouch(word) {
    const list = vocabAll();
    const i = list.findIndex(function (x) { return String(x.word).toLowerCase() === String(word).toLowerCase(); });
    if (i >= 0) { list[i].at = Date.now(); vocabSave(list); }
  }
  function vocabRemove(word) {
    vocabSave(vocabAll().filter(function (x) { return String(x.word).toLowerCase() !== String(word).toLowerCase(); }));
  }

  function parseResultCode(text) {
    const t = String(text || "").trim();
    const m = /^CET6Q1\|([^|]*)\|([^|]*)$/.exec(t);
    if (!m) return null;
    const sp = function (s) {
      return String(s || "").split(";").map(function (x) { return x.trim(); }).filter(Boolean);
    };
    return { wrong: sp(m[1]), right: sp(m[2]) };
  }

  function applyQuizResult(res) {
    const list = vocabAll();
    const now = Date.now();
    let n = 0;
    function idx(w) {
      return list.findIndex(function (x) { return String(x.word).toLowerCase() === String(w).toLowerCase(); });
    }
    res.wrong.forEach(function (w) {
      const i = idx(w);
      if (i < 0) return;
      list[i].hits = (list[i].hits || 1) + 1;
      list[i].box = 0;
      list[i].last = now;
      list[i].due = now + DAY * INTERVAL[0];
      n++;
    });
    res.right.forEach(function (w) {
      const i = idx(w);
      if (i < 0) return;
      list[i].box = Math.min(5, (list[i].box || 0) + 1);
      list[i].last = now;
      list[i].due = now + DAY * INTERVAL[list[i].box];
      n++;
    });
    vocabSave(list);
    return n;
  }

  function renderVocab() {
    const all = vocabAll();
    vocabSave(all);
    const dueN = all.filter(function (x) { return x.word && isDue(x); }).length;
    const dueEl = $("#vDue");
    if (dueEl) dueEl.textContent = dueN ? "今天该复习 " + dueN + " 个。" : "";
    const qd = $("#qdDue");
    if (qd) { qd.textContent = "今天该复习的（" + dueN + "）"; qd.disabled = dueN === 0; }
    const box = $("#vList");
    if (!all.length) {
      box.innerHTML = '<div class="vempty">生词本还是空的。去「⑤ 原文精读」里点几个词，查过的词会自动收进来。</div>';
      return;
    }
    const list = all.slice().sort(function (x, y) {
      const fx = isFocus(x) ? 0 : 1, fy = isFocus(y) ? 0 : 1;
      if (fx !== fy) return fx - fy;
      const hx = x.hits || 1, hy = y.hits || 1;
      if (hx !== hy) return hy - hx;
      return (y.at || 0) - (x.at || 0);
    });

    box.innerHTML = list.map(function (it) {
      const hits = it.hits || 1;
      const on = isFocus(it);
      return '<div class="vrow" data-word="' + esc(it.word) + '">' +
        '<input type="checkbox" checked>' +
        '<div class="vmain">' +
          '<div><span class="vword">' + esc(it.word) + "</span>" +
          (it.ipa ? '<span class="vipa">' + esc(it.ipa) + "</span>" : "") +
          (it.pos ? '<span class="vpos">' + esc(it.pos) + "</span>" : "") +
          (it.src ? '<span class="vsrc">选自' + esc(it.src) + "</span>" : "") +
          (hits > 1 ? '<span class="vhits">查过 ' + hits + " 次</span>" : "") +
          (isFocus(it) && !it.star ? '<span class="vfocus">重点</span>' : "") +
          (isDue(it) ? '<span class="vbadge">待复习</span>' : "") +
          "</div>" +
          (it.meaning ? '<div class="vmean">' + esc(it.meaning) + "</div>" : "") +
          (it.nuance ? '<div class="vnu">' + esc(it.nuance) + "</div>" : "") +
          (it.sentence ? '<div class="vex">' + esc(it.sentence) + "</div>" : "") +
          (it.sentenceZh ? '<div class="vzh">' + esc(it.sentenceZh) + "</div>" : "") +
          '<div class="vlinks"></div>' +
        "</div>" +
        '<button class="vstar' + (it.star ? " on" : "") + '" title="' + (it.star ? "取消标记" : "手动标记为重点") + '">' + (it.star ? "★" : "☆") + "</button>" +
        '<button class="vdel" title="删除">×</button></div>';
    }).join("");

    Array.from(box.querySelectorAll(".vrow")).forEach(function (row) {
      const word = row.dataset.word;
      row.querySelector(".vmain").addEventListener("click", function (e) {
        if (e.target.closest(".vlink")) return;
        openArticleFor(word, row);
      });
      row.querySelector(".vstar").addEventListener("click", function () {
        const arr = vocabAll();
        const i = arr.findIndex(function (x) { return String(x.word).toLowerCase() === String(word).toLowerCase(); });
        if (i < 0) return;
        arr[i].star = !arr[i].star;
        vocabSave(arr);
        renderVocab();
        refreshWordMarks();
      });
      row.querySelector(".vdel").addEventListener("click", function () {
        vocabRemove(word);
        renderVocab();
        refreshWordMarks();
      });
    });
  }

  async function openArticleFor(word, row) {
    const box = row.querySelector(".vlinks");
    if (!box) return;
    if (box.dataset.open === "1") {
      box.innerHTML = "";
      box.dataset.open = "";
      return;
    }
    box.dataset.open = "1";
    box.innerHTML = '<div class="vlink hint">查找中…</div>';
    let list = [];
    try {
      list = await api("/api/find?word=" + encodeURIComponent(word));
    } catch (e) {
      const msg = String((e && e.message) || e);
      box.innerHTML = msg.indexOf("404") >= 0
        ? '<div class="vlink err">本地服务还是旧版本，没有「跳转原文」这个接口。<br>关掉那个黑窗口，重新双击 <b>启动.bat</b> 再试。</div>'
        : '<div class="vlink err">查找失败：' + esc(msg) + "</div>";
      return;
    }
    if (!list || !list.length) {
      box.innerHTML = '<div class="vlink err">找不到这篇文章：可能已经被删除，或者这个词是示例数据。</div>';
      return;
    }
    if (list.length === 1) return gotoRecord(list[0].id, word);
    box.innerHTML = '<div class="vlink hint">这个词出现在 ' + list.length + ' 篇文章里，点一个跳过去：</div>' +
      list.map(function (r) {
        return '<button class="vlink" data-id="' + r.id + '">' + esc(r.title) + " · " +
          new Date(r.createdAt || Date.now()).toLocaleDateString("zh-CN") + "</button>";
      }).join("");
    Array.from(box.querySelectorAll("button.vlink")).forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); gotoRecord(b.dataset.id, word); });
    });
  }

  async function gotoRecord(id, word) {
    const item = vocabAll().filter(function (x) {
      return String(x.word).toLowerCase() === String(word).toLowerCase();
    })[0] || {};
    $("#ovVocab").classList.remove("show");
    try {
      await loadRecord(id);
    } catch (e) {
      return toast("打开失败：" + e.message);
    }
    setTimeout(function () { jumpToWord(word, item.src, item.sentence); }, 450);
  }

  function isQuestionBlock(el) {
    const p = el.closest(".readp");
    return !!(p && (p.classList.contains("readqh") || p.classList.contains("readqo")));
  }

  function jumpToWord(word, src, sentence) {
    const all = Array.from(document.querySelectorAll("#reading .w"));
    if (!all.length) return toast("文章里没找到这个词，可能已被改写");
    const key = stemKey(word);
    const same = function (x) {
      const t = String(x.textContent).toLowerCase();
      return t === key || stemKey(t) === key || t === String(word).toLowerCase();
    };

    // 1) 记录里那句原句如果还能找到，就定位到那一句所在段落
    if (sentence) {
      const needle = String(sentence).slice(0, 40);
      const para = Array.from(document.querySelectorAll("#reading .readp")).find(function (p) {
        const raw = state.reading[Number(p.dataset.i)] || "";
        return needle && raw.indexOf(needle) >= 0;
      });
      if (para) {
        const inPara = Array.from(para.querySelectorAll(".w")).find(same);
        if (inPara) return flashWord(inPara);
      }
    }

    // 2) 按“选自文章 / 选自题目”优先，再退回全量
    const wantQ = src === "题目";
    const pool = all.filter(function (x) { return wantQ ? isQuestionBlock(x) : !isQuestionBlock(x); });
    const hit = pool.find(same) || all.find(same);
    if (!hit) return toast("文章里没找到这个词，可能已被改写");
    flashWord(hit);
  }

  function flashWord(hit) {
    hit.scrollIntoView({ block: "center" });
    hit.classList.add("w-jump");
    setTimeout(function () { hit.classList.remove("w-jump"); }, 2600);
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
  function makeTitle(article, questions) {
    if (questions && questions.length && questions[0].stem) return questions[0].stem.slice(0, 30).trim();
    const t = String(article || "")
      .replace(/\*\*/g, " ").replace(/¶\s*\d+/g, " ").replace(/\bPassage\s*\d+\b/gi, " ")
      .replace(/[#>`]/g, " ").replace(/\s+/g, " ").trim();
    if (!t) {
      const d = new Date();
      const p = function (n) { return String(n).padStart(2, "0"); };
      return (d.getMonth() + 1) + "-" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + " 的报告";
    }
    return t.slice(0, 30);
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
        (it.pos ? '<span class="pos">' + esc(it.pos) + "</span>" : "") +
        (it.hits > 1 ? '<span class="hits">查过 ' + it.hits + " 次</span>" : "") + "</div>" +
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
      ".hits{color:#b3352b;font-size:9pt;border:1px solid #f0cfc9;border-radius:3px;padding:0 1.5mm;margin-left:2mm}" +
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

  /* ---------------- 练习册导出 ---------------- */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function markWord(sentence, word) {
    const pattern = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    let re;
    try { re = new RegExp("(^|[^A-Za-z])(" + pattern + ")([A-Za-z]*)", "i"); } catch (e) { return null; }
    const m = re.exec(sentence);
    if (!m) return null;
    const start = m.index + m[1].length;
    const len = m[2].length + m[3].length;
    return {
      before: sentence.slice(0, start),
      hit: sentence.substr(start, len),
      after: sentence.slice(start + len),
    };
  }

  function buildClozeItems(pool, aiMap) {
    return pool.map(function (it) {
      const ai = aiMap && aiMap[String(it.word).toLowerCase()];
      const sent = String(ai || it.sentence || "").trim();
      const b = sent ? markWord(sent, it.word) : null;
      const base = {
        word: it.word,
        ipa: it.ipa || "",
        pos: it.pos || "",
        meaning: it.meaning || "",
        nuance: it.nuance || "",
      };
      if (b) {
        return Object.assign({ kind: "cloze", before: b.before, hit: b.hit, after: b.after, sentenceZh: ai ? "" : (it.sentenceZh || "") }, base);
      }
      return Object.assign({ kind: "word", sentenceZh: it.sentenceZh || "" }, base);
    });
  }

  function quizPageHtml(data) {
    const css = [
      "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}",
      "body{margin:0;background:#f4f2ed;color:#22252a;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7}",
      ".wrap{max-width:720px;margin:0 auto;padding:22px 16px 60px}",
      "h1{font-size:22px;margin:8px 0 4px}",
      ".sub{color:#6b7280;font-size:13px;margin:0 0 18px}",
      ".card{background:#fff;border:1px solid #e6e2d9;border-radius:16px;padding:20px 18px;margin-bottom:14px}",
      ".qno{font-size:12px;color:#8b95a1;letter-spacing:.1em;margin-bottom:10px}",
      ".prompt{font-size:26px;font-family:Georgia,serif;font-weight:600;margin:4px 0 2px}",
      ".prompt.zh{font-size:19px;font-family:inherit}",
      ".sub2{color:#8b95a1;font-size:13px;font-family:Georgia,serif;margin-bottom:14px}",
      ".opts{display:flex;flex-direction:column;gap:10px;margin-top:6px}",
      ".opt{text-align:left;width:100%;padding:14px 16px;font-size:16px;line-height:1.5;border:1px solid #e6e2d9;background:#fff;border-radius:12px;cursor:pointer;font-family:inherit;color:#22252a;transition:.15s}",
      ".opt:active{transform:scale(.995)}",
      ".opt.ok{border-color:#1c7a4a;background:#eaf6ef;color:#14603a;font-weight:600}",
      ".opt.no{border-color:#b3352b;background:#fdecea;color:#8a2018}",
      ".opt.dim{opacity:.5}",
      ".fb{margin-top:14px;font-size:14.5px;display:none}",
      ".fb.show{display:block}",
      ".fb .line{padding:8px 12px;border-radius:10px;background:#f7f9fb;border:1px solid #e6ebf0;margin-top:6px}",
      ".fb .ex{font-family:Georgia,serif;font-style:italic;color:#5b6470;font-size:13.5px}",
      ".nav{margin-top:16px;display:flex;gap:10px}",
      ".btn{flex:1;padding:13px;border-radius:12px;border:1px solid #d8d2c6;background:#fff;font-size:15px;font-family:inherit;cursor:pointer}",
      ".btn.p{background:#1c4f82;border-color:#1c4f82;color:#fff}",
      ".score{font-size:44px;font-weight:700;color:#1c4f82;margin:6px 0}",
      ".wrong-item{border-top:1px dashed #e6e2d9;padding:10px 0;font-size:14px}",
      ".wrong-item b{font-family:Georgia,serif}",
      ".cloze{font-family:Georgia,serif;font-size:19px;line-height:1.9;margin:8px 0 4px}",
      ".cloze .hit{color:#1c4f82;border-bottom:2px solid #e0b64a;padding-bottom:1px}",
      ".back{margin-top:16px;padding-top:14px;border-top:1px dashed #e6e2d9;display:none}",
      ".back.show{display:block}",
      ".answord{font-family:Georgia,serif;font-size:21px;font-weight:700;color:#1c4f82}",
      ".dm{font-size:16px;margin-top:6px;font-weight:600}",
      ".dn{color:#6b7280;font-size:13.5px;margin-top:4px}",
      ".ds{color:#6b7280;font-size:13.5px;margin-top:8px}",
      ".passage{font-family:Georgia,'Times New Roman',serif;font-size:17.5px;line-height:1.85}",
      ".passage p{margin:0 0 12px}",
      ".hl{background:#fff1cc;border-bottom:2px solid #e0b64a;padding:0 2px;border-radius:3px;cursor:pointer}",
      ".tip{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;background:#22252a;color:#fff;padding:9px 16px;border-radius:22px;font-size:14px;opacity:0;transition:.2s;pointer-events:none;max-width:90%;text-align:center}",
      ".tip.show{opacity:1}",
      "h2{font-size:16px;margin:22px 0 10px}",
      ".q{margin-bottom:14px}",
      ".q .stem{font-size:15.5px;margin-bottom:8px}",
      ".why{margin-top:8px;font-size:13.5px;color:#4b5563;background:#f7f9fb;border-radius:10px;padding:8px 12px;display:none}",
      ".why.show{display:block}",
      "@media print{.nav,.tip{display:none}.card{break-inside:avoid}}",
    ].join("\n");

    const pageJs = [
      "(function(){",
      "var D = window.__DATA__;",
      "var app = document.getElementById('app');",
      "var i = 0, score = 0, wrong = [], rightW = [], wrongW = [];",
      "function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }",
      "function tips(txt){ var t=document.getElementById('tip'); t.textContent=txt; t.className='tip show'; clearTimeout(tips._t); tips._t=setTimeout(function(){t.className='tip';},2200); }",
      "function done(){",
      "  var code = 'CET6Q1|' + wrongW.join(';') + '|' + rightW.join(';');",
      "  var rows = wrong.map(function(w){ return '<div class=\"wrong-item\"><b>'+esc(w.prompt)+'</b> → '+esc(w.answer)+'</div>'; }).join('');",
      "  app.innerHTML = '<div class=\"card\"><div class=\"qno\">完成</div><div class=\"score\">'+score+' / '+D.items.length+'</div>'",
      "    + '<div class=\"sub\">记住了 '+score+' 个'+(wrong.length?' · 没记住 '+wrong.length+' 个':' · 全对')+'</div>'",
      "    + (rows ? '<h2>再记一遍</h2>'+rows : '')",
      "    + '<h2>结果码</h2><p class=\"sub\" style=\"margin:0 0 8px\">复制这段，回到「错题解剖台」的生词本，点「导入练习结果」</p>'",
      "    + '<textarea readonly id=\"rc\" style=\"width:100%;min-height:70px;font-family:ui-monospace,Consolas,monospace;font-size:12px;border:1px solid #e6e2d9;border-radius:10px;padding:10px;background:#fdfcf9\">'+code+'</textarea>'",
      "    + '<div class=\"nav\"><button class=\"btn p\" id=\"copyrc\">复制结果码</button><button class=\"btn\" id=\"again\">再来一轮</button></div></div>';",
      "  document.getElementById('copyrc').onclick = function(){ var el=document.getElementById('rc'); el.select(); el.setSelectionRange(0,9999); try{ document.execCommand('copy'); tips('结果码已复制'); }catch(e){ tips('复制失败，长按手动复制'); } };",
      "  document.getElementById('again').onclick = function(){ i=0; score=0; wrong=[]; rightW=[]; wrongW=[]; render(); };",
      "}",
      "function render(){",
      "  if (i >= D.items.length) return done();",
      "  var it = D.items[i];",
      "  var front = it.kind === 'cloze'",
      "    ? '<div class=\"cloze\">' + esc(it.before) + '<b class=\"hit\">' + esc(it.hit) + '</b>' + esc(it.after) + '</div>' + '<div class=\"sub2\">根据上下文，这个词在这里是什么意思？</div>'",
      "    : '<div class=\"prompt\">' + esc(it.word) + '</div><div class=\"sub2\">' + esc(it.ipa||'') + ' ' + esc(it.pos||'') + '</div>';",
      "  app.innerHTML = '<div class=\"card\"><div class=\"qno\">第 '+(i+1)+' / '+D.items.length+' 题</div>'",
      "    + front",
      "    + '<div class=\"nav\"><button class=\"btn p\" id=\"reveal\">' + (it.kind==='cloze' ? '看答案' : '看释义') + '</button></div>'",
      "    + '<div class=\"back\" id=\"back\"></div></div>';",
      "  document.getElementById('reveal').onclick = function(){ showBack(it); };",
      "}",
      "function showBack(it){",
      "  var back = document.getElementById('back');",
      "  back.innerHTML = '<div class=\"answord\">'+esc(it.word)+'</div>'",
      "    + '<div class=\"ipa\">'+esc(it.ipa||'')+(it.pos?' · '+esc(it.pos):'')+'</div>'",
      "    + '<div class=\"dm\">'+esc(it.meaning)+'</div>'",
      "    + (it.nuance?'<div class=\"dn\">'+esc(it.nuance)+'</div>':'')",
      "    + (it.sentenceZh?'<div class=\"ds\">'+esc(it.sentenceZh)+'</div>':'')",
      "    + '<div class=\"nav\"><button class=\"btn\" id=\"bad\">没记住</button><button class=\"btn p\" id=\"good\">记住了</button></div>';",
      "  back.className = 'back show';",
      "  document.getElementById('reveal').style.display = 'none';",
      "  document.getElementById('good').onclick = function(){ score++; rightW.push(it.word); i++; render(); };",
      "  document.getElementById('bad').onclick = function(){ wrongW.push(it.word); wrong.push({prompt: it.word, answer: it.meaning}); i++; render(); };",
      "}",
      "function renderPassage(){",
      "  var map = {};",
      "  D.words.forEach(function(w){ map[String(w.w).toLowerCase()] = w.m; });",
      "  var body = D.passage.split(/\\n\\n+/).map(function(p){",
      "    var html = esc(p).replace(/\\*\\*([^*]+)\\*\\*/g, function(_, word){",
      "      return '<span class=\"hl\" data-w=\"'+word+'\">'+word+'</span>';",
      "    });",
      "    return '<p>'+html+'</p>';",
      "  }).join('');",
      "  var qs = (D.questions||[]).map(function(q, qi){",
      "    var opts = ['A','B','C','D'].map(function(k){",
      "      return q.options[k] ? '<button class=\"opt\" data-q=\"'+qi+'\" data-k=\"'+k+'\">'+k+') '+esc(q.options[k])+'</button>' : '';",
      "    }).join('');",
      "    return '<div class=\"card q\" data-q=\"'+qi+'\"><div class=\"qno\">第 '+(qi+1)+' 题</div>'+",
      "      '<div class=\"stem\">'+esc(q.stem)+'</div><div class=\"opts\">'+opts+'</div>'+",
      "      '<div class=\"why\" id=\"why'+qi+'\">答案：'+(q.answer||'')+'　'+(q.why||'')+'</div></div>';",
      "  }).join('');",
      "  app.innerHTML = '<div class=\"card\"><div class=\"passage\">'+body+'</div>'",
      "    + '<div class=\"sub\" style=\"margin:14px 0 0\">黄色高亮的词点一下就能看意思</div></div>'+",
      "    '<h2>题目</h2>'+qs+",
      "    '<div class=\"nav\"><button class=\"btn p\" id=\"reveal\">显示全部答案</button></div>';",
      "  Array.prototype.forEach.call(app.querySelectorAll('.hl'), function(el){",
      "    el.onclick = function(){ var w = el.dataset.w.toLowerCase(); tips(w + ' —— ' + (map[w] || '（生词本里没有这条）')); };",
      "  });",
      "  Array.prototype.forEach.call(app.querySelectorAll('.opt'), function(btn){",
      "    btn.onclick = function(){",
      "      var qi = btn.dataset.q, k = btn.dataset.k;",
      "      var q = D.questions[qi];",
      "      var card = app.querySelector('.q[data-q=\"'+qi+'\"]');",
      "      Array.prototype.forEach.call(card.querySelectorAll('.opt'), function(b){",
      "        b.disabled = true;",
      "        if (b.dataset.k === q.answer) b.classList.add('ok');",
      "        else if (b.dataset.k === k) b.classList.add('no');",
      "        else b.classList.add('dim');",
      "      });",
      "      document.getElementById('why'+qi).classList.add('show');",
      "    };",
      "  });",
      "  document.getElementById('reveal').onclick = function(){",
      "    Array.prototype.forEach.call(app.querySelectorAll('.why'), function(w){ w.classList.add('show'); });",
      "  };",
      "}",
      "try { if (D.mode === 'passage') renderPassage(); else render(); } catch (e) { document.getElementById('app').innerHTML = '<pre style=\"white-space:pre-wrap;color:#b3352b;padding:10px\">' + (e && e.stack ? e.stack : e) + '</pre>'; }",
      "})();",
    ].join("\n");

    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">" +
      "<title>" + data.title + "</title><style>" + css + "</style></head><body>" +
      "<div class=\"wrap\"><header><h1>" + data.title + "</h1><p class=\"sub\">" + data.sub + "</p></header>" +
      "<div id=\"app\"></div></div><div class=\"tip\" id=\"tip\"></div>" +
      "<script>window.__DATA__ = " + json + ";</scr" + "ipt><script>" + pageJs + "</scr" + "ipt></body></html>";
  }

  /* ---------------- 整卷分割 ---------------- */
  let splitData = [];

  async function doSplit() {
    const images = state.images.map(function (im) { return { dataUrl: im.dataUrl }; });
    const article = els.article.value.trim();
    if (!images.length && !article) return toast("先传试卷照片（或粘贴文字）");
    if (!images.length) return toast("整卷分割要先传照片");
    const btn = $("#btnSplit");
    btn.disabled = true; btn.textContent = "分割中…";
    try {
      const r = await api("/api/split", { images: images, article: article });
      if (r && r.error) throw new Error(r.error);
      splitData = r.passages || [];
      renderSplit();
      $("#ovSplit").classList.add("show");
    } catch (e) {
      toast("分割失败：" + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = "整卷分割…";
    }
  }

  function renderSplit() {
    const box = $("#splitList");
    box.innerHTML = splitData.map(function (p, i) {
      const words = String(p.article || "").split(/\s+/).filter(Boolean).length;
      return '<label class="rrow" style="cursor:pointer">' +
        '<input type="checkbox" class="spchk" data-i="' + i + '" checked style="margin-top:4px">' +
        '<div class="rmain"><b>' + esc(p.title) + "</b>" +
        "<small>" + words + " 词 · " + (p.questions || []).length + " 题 · " + (p.type === "match" ? "段落匹配" : "仔细阅读") + "</small>" +
        '<div class="vzh" style="margin-top:4px">' + esc(String(p.article || "").slice(0, 90)) + "…</div></div></label>";
    }).join("");
  }

  async function saveSplit() {
    const picks = Array.from(document.querySelectorAll(".spchk")).filter(function (c) { return c.checked; })
      .map(function (c) { return splitData[Number(c.dataset.i)]; });
    if (!picks.length) return toast("至少选一篇");
    let ok = 0;
    for (const p of picks) {
      try {
        await api("/api/records", {
          title: p.title || "整卷分割",
          article: p.article || "",
          questions: (p.questions || []).map(function (q, i) {
            return {
              type: p.type || "mcq",
              no: q.no || i + 1,
              stem: q.stem || "",
              options: q.options || {},
              my: q.my || "",
              correct: q.answer || "",
            };
          }),
          analysis: "",
          chat: [],
        });
        ok++;
      } catch (e) { /* 单条失败继续 */ }
    }
    $("#ovSplit").classList.remove("show");
    toast("已存 " + ok + " 篇，去错题本里逐条打开解剖");
    openHistory();
  }

  /* ---------------- 练习册 ---------------- */
  function qErr(msg) {
    const el = $("#qErr");
    el.className = "cfgerr show";
    el.textContent = msg;
  }
  function dateStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function quizWords(scope) {
    const all = vocabAll();
    let list = all;
    if (scope === "focus") list = all.filter(isFocus);
    else if (scope === "due") list = dueList();
    return list.filter(function (x) { return x.word && x.meaning; });
  }
  function downloadQuiz(data) {
    const blob = new Blob([quizPageHtml(data)], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, "六级练习-" + stamp() + ".html");
    $("#ovQuiz").classList.remove("show");
    toast("已生成：发到 iPad 用浏览器打开就能做");
  }
  let lastQuiz = null;

  async function buildQuizData() {
    const mode = document.querySelector('input[name="qmode"]:checked').value;
    const scope = $("#qscope").value;
    const n = Number($("#qcount").value) || 15;
    const words = quizWords(scope);
    if (!words.length) {
      qErr(scope === "focus" ? "重点词还是空的：先查几个词，或者手动 ★ 标记。" : "生词本还是空的。");
      return null;
    }
    if (mode === "words") {
      if (words.length < 4) {
        qErr("至少要有 4 个生词才能出选择题（现在 " + words.length + " 个）。");
        return null;
      }
      const pick = shuffle(words).slice(0, n);
      const btn0 = $("#qGo"), pv0 = $("#qPreview");
      btn0.disabled = true; pv0.disabled = true;
      const old0 = btn0.textContent;
      btn0.textContent = "生成例句…"; pv0.textContent = "生成例句…";
      let aiMap = {};
      try {
        const r = await api("/api/cloze", { words: pick.map(function (w) { return { word: w.word, meaning: w.meaning }; }) });
        (r.items || []).forEach(function (x) { aiMap[String(x.word).toLowerCase()] = x.sentence; });
      } catch (e) {
        /* 没有 Key 或生成失败：退回生词本里已有的例句，甚至纯词义卡 */
      } finally {
        btn0.disabled = false; pv0.disabled = false;
        btn0.textContent = old0; pv0.textContent = "先预览";
      }
      const items = buildClozeItems(pick, aiMap);
      return { mode: "words", title: "六级生词猜义", sub: "共 " + items.length + " 题 · " + dateStr() + " · 先猜意思，再看答案", items: items };
    }
    if (words.length < 3) {
      qErr("至少要有 3 个生词。");
      return null;
    }
    const pick = shuffle(words).slice(0, 8);
    const btn = $("#qGo"), pv = $("#qPreview");
    btn.disabled = true; pv.disabled = true;
    const old = btn.textContent;
    btn.textContent = "生成中…"; pv.textContent = "生成中…";
    try {
      const r = await api("/api/quiz", { words: pick.map(function (w) { return { word: w.word, meaning: w.meaning }; }) });
      if (r && r.error) throw new Error(r.error);
      return {
        mode: "passage",
        title: r.title || "生词阅读练习",
        sub: "用你生词本里的 " + pick.length + " 个词生成 · " + dateStr(),
        passage: r.passage,
        words: pick.map(function (w) { return { w: w.word, m: w.meaning }; }),
        questions: r.questions || [],
      };
    } catch (e) {
      qErr("生成失败：" + (e && e.message ? e.message : e));
      return null;
    } finally {
      btn.disabled = false; pv.disabled = false;
      btn.textContent = old; pv.textContent = "先预览";
    }
  }

  async function runQuiz(action) {
    qErr("");
    const data = await buildQuizData();
    if (!data) return;
    const html = quizPageHtml(data);
    lastQuiz = { html: html, name: "六级练习-" + stamp() + ".html" };
    if (action === "download") return saveQuiz();
    $("#quizFrame").srcdoc = html;
    $("#ovQuiz").classList.remove("show");
    $("#ovPreview").classList.add("show");
  }

  function saveQuiz() {
    if (!lastQuiz) return toast("先生成一份练习");
    downloadBlob(new Blob([lastQuiz.html], { type: "text/html;charset=utf-8" }), lastQuiz.name);
    $("#ovPreview").classList.remove("show");
    $("#ovQuiz").classList.remove("show");
    toast("已下载：" + lastQuiz.name);
  }

  /* ---------------- questions ---------------- */
  let qSeq = 0;
  function addQuestion(q) {
    q = q || { stem: "", options: {}, my: "", correct: "" };
    qSeq++;
    const el = document.createElement("div");
    el.className = "q";
    el.dataset.id = "q" + qSeq;
    if (q && q.no) el.dataset.no = String(q.no);
    const isMatch = (q && q.type) === "match" || (!q && state.kind === "match");
    el.dataset.type = isMatch ? "match" : "mcq";
    if (isMatch) {
      el.innerHTML =
        '<div class="qhead"><div class="no">' + (q && q.no ? q.no : qSeq) + '</div>' +
        '<input type="text" class="stem" placeholder="题干 / Statement">' +
        '<button class="del" title="删除">×</button></div>' +
        '<div class="ansrow"><span>我选</span><input class="mypick" maxlength="2" placeholder="—">' +
        '<span>正确答案</span><input class="corpick" maxlength="2" placeholder="—">' +
        '<span class="hint" style="margin-left:auto">填段落字母，如 C</span></div>';
    } else {
      el.innerHTML =
        '<div class="qhead"><div class="no">' + (q && q.no ? q.no : qSeq) + '</div>' +
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
    }
    els.qlist.appendChild(el);
    el.querySelector(".stem").value = q.stem || "";
    if (isMatch) {
      el.querySelector(".mypick").value = q.my || "";
      el.querySelector(".corpick").value = q.correct || "";
    } else {
      ["A", "B", "C", "D"].forEach(function (k) {
        const inp = el.querySelector('input[data-k="' + k + '"]');
        if (inp) inp.value = (q.options && q.options[k]) || "";
      });
      el.querySelector(".my").value = q.my || "";
      el.querySelector(".correct").value = q.correct || "";
    }
    el.querySelector(".del").addEventListener("click", function () {
      el.remove(); renumber();
      if (!els.qlist.children.length) addQuestion();
    });
    return el;
  }
  function renumber() {
    Array.from(els.qlist.children).forEach(function (el, i) {
      el.querySelector(".no").textContent = el.dataset.no || String(i + 1);
    });
    qSeq = els.qlist.children.length;
  }
  function collect() {
    return Array.from(els.qlist.children).map(function (el, i) {
      const type = el.dataset.type === "match" ? "match" : "mcq";
      if (type === "match") {
        const mp = el.querySelector(".mypick");
        const cp = el.querySelector(".corpick");
        return {
          type: "match",
          no: el.dataset.no || (i + 1),
          stem: el.querySelector(".stem").value.trim(),
          options: {},
          my: (mp ? mp.value : "").trim().toUpperCase(),
          correct: (cp ? cp.value : "").trim().toUpperCase(),
        };
      }
      const o = {};
      ["A", "B", "C", "D"].forEach(function (k) {
        const inp = el.querySelector('input[data-k="' + k + '"]');
        o[k] = inp ? inp.value.trim() : "";
      });
      return {
        type: "mcq",
        no: el.dataset.no || (i + 1),
        stem: el.querySelector(".stem").value.trim(),
        options: o,
        my: el.querySelector(".my").value,
        correct: el.querySelector(".correct").value,
      };
    }).filter(function (q) { return q.stem || (q.options && q.options.A); });
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
    if (!res.ok) {
      const body = String((data && data.error) || txt || "").trim();
      if (res.status === 404 && /^not found$/i.test(body)) {
        throw new Error("本地服务是旧版本，还没有这个接口。关掉那个黑窗口，重新双击 启动.bat 再试。");
      }
      throw new Error(body || ("HTTP " + res.status));
    }
    return data;
  }

  async function saveRecord() {
    const article = els.article.value.trim() || extractReading(state.analysis) || "";
    const questions = collect();
    if (!article && !questions.length) return;
    const keepTitle = state.recordId && state.recordTitle;
    const payload = {
      id: state.recordId,
      title: keepTitle || makeTitle(article, questions),
      article: article,
      questions: questions,
      analysis: state.analysis,
      chat: state.chat,
      hasImages: state.images.length > 0,
    };
    try {
      const r = await api("/api/records", payload);
      if (r && r.id) state.recordId = r.id;
      updateRecChip(payload.title);
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
  function updateRecChip(title) {
    const chip = $("#recChip");
    if (!chip) return;
    if (!state.recordId) { chip.style.display = "none"; return; }
    $("#recChipText").innerHTML = "正在更新记录：<b>" + esc(title || "未命名") + "</b>";
    chip.style.display = "flex";
  }

  function setBusy(b, txt) {
    state.busy = b;
    $("#analyze").disabled = b;
    $("#send").disabled = b;
    $("#analyze").textContent = b ? "解剖中…" : "开始解剖";
    if (txt) els.runhint.textContent = txt;
  }

  function normalizeAnswers(text) {
    const src = String(text || "").trim();
    if (!src) return "";
    const pairs = [];
    const re = /(\d{1,3})\s*[-—:：.、]?\s*([A-Da-d])\b/g;
    let m;
    while ((m = re.exec(src)) !== null) pairs.push(m[1] + " → " + m[2].toUpperCase());
    return pairs.length ? pairs.join("，") : src;
  }

  async function analyze() {
    const article = els.article.value.trim();
    const questions = collect();
    const images = state.images.map(function (im) { return { dataUrl: im.dataUrl, name: im.name }; });
    if (!images.length && article.length < 40) return toast("先传一张页面照片，或把文章粘进来");
    if (!images.length && !questions.length) return toast("至少填一道题，或者直接传图片");
    state.analysis = ""; state.chat = [];
    els.msgs.innerHTML = "";
    $("#result").innerHTML = '<p class="hint">正在定位…</p>';
    setBusy(true, images.length ? "正在读图、定位，通常要 30–90 秒…" : "正在逐段比对，请稍候…");
    let acc = "";
    try {
      const kind = questions.some(function (q) { return q.type === "match"; }) ? "match" : "mcq";
      const r = await stream("/api/analyze", {
        kind: kind, article: article, questions: questions, images: images,
        myAnswers: normalizeAnswers($("#myAns") && $("#myAns").value),
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
        title: makeTitle(article, questions),
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
    clearImages();
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
  let recCache = [];

  async function openHistory() {
    $("#ovHistory").classList.add("show");
    const box = $("#recList");
    box.innerHTML = '<p class="hint">加载中…</p>';
    try {
      recCache = await api("/api/records");
      renderRecList();
    } catch (e) {
      box.innerHTML = '<p class="hint">读取失败：' + esc(e.message) + "</p>";
    }
  }

  function renderRecList() {
    const box = $("#recList");
    const tools = $("#recTools");
    if (!recCache.length) {
      box.innerHTML = '<div class="vempty">还没有记录。<br>跑完一次「开始解剖」会自动存一份；<br>' +
        '只生成了提示词（没配 Key）时不会存档，可以点左边「只存到错题本」手动存。</div>';
      if (tools) tools.style.display = "none";
      return;
    }
    if (tools) tools.style.display = "flex";
    const c = $("#rCount");
    if (c) c.textContent = "共 " + recCache.length + " 条";
    box.innerHTML = recCache.map(function (r) {
      const d = new Date(r.createdAt || Date.now());
      return '<div class="rrow" data-id="' + r.id + '">' +
        '<input type="checkbox" class="rchk">' +
        '<div class="rmain"><b>' + esc(r.title || "未命名") + "</b>" +
        "<small>" + d.toLocaleString("zh-CN") + " · " + (r.qcount || 0) + " 题 · " +
        ((r.analysis || "").length) + " 字报告</small></div>" +
        '<button class="rdel" title="删除这条">×</button></div>';
    }).join("");

    Array.from(box.querySelectorAll(".rrow")).forEach(function (row) {
      row.querySelector(".rmain").addEventListener("click", function () { loadRecord(row.dataset.id); });
      row.querySelector(".rdel").addEventListener("click", async function (e) {
        e.stopPropagation();
        const id = row.dataset.id;
        const name = row.querySelector(".rmain b").textContent;
        if (!(await confirmBox("删除这条记录", "《" + name + "》删除后无法恢复。"))) return;
        await deleteRecords([id]);
      });
    });
  }

  async function deleteRecords(ids) {
    for (const id of ids) {
      try { await api("/api/records?id=" + encodeURIComponent(id), null, "DELETE"); } catch (e) { toast("删除失败：" + e.message); return; }
      if (state.recordId === id) state.recordId = null;
    }
    recCache = recCache.filter(function (r) { return ids.indexOf(r.id) < 0; });
    renderRecList();
    toast("已删除 " + ids.length + " 条");
  }

  function recChecked() {
    return Array.from(document.querySelectorAll("#recList .rrow"))
      .filter(function (r) { return r.querySelector(".rchk").checked; })
      .map(function (r) { return r.dataset.id; });
  }

  async function exportBackup() {
    try {
      const r = await api("/api/backup");
      const payload = {
        kind: "cet6-anatomy-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        vocab: vocabAll(),
        records: (r && r.records) || [],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      downloadBlob(blob, "六级备份-" + stamp() + ".json");
      toast("已备份：" + payload.vocab.length + " 个词 · " + payload.records.length + " 条记录");
    } catch (e) {
      toast("备份失败：" + e.message);
    }
  }

  async function restoreBackup(file) {
    if (!file) return;
    let data = null;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      return toast("这个文件不是合法的 JSON");
    }
    if (!data || data.kind !== "cet6-anatomy-backup") return toast("不是本工具的备份文件");
    const inVocab = Array.isArray(data.vocab) ? data.vocab : [];
    const inRecords = Array.isArray(data.records) ? data.records : [];

    // 生词：按词合并，取更“熟”的那份数据
    const local = vocabAll();
    const map = {};
    local.forEach(function (x) { map[String(x.word).toLowerCase()] = x; });
    let newWords = 0;
    inVocab.forEach(function (x) {
      if (!x || !x.word) return;
      const k = String(x.word).toLowerCase();
      const cur = map[k];
      if (!cur) { map[k] = x; newWords++; return; }
      map[k] = {
        word: cur.word, ipa: cur.ipa || x.ipa, pos: cur.pos || x.pos,
        meaning: cur.meaning || x.meaning, nuance: cur.nuance || x.nuance,
        sentence: cur.sentence || x.sentence, sentenceZh: cur.sentenceZh || x.sentenceZh,
        src: cur.src || x.src,
        hits: Math.max(cur.hits || 1, x.hits || 1),
        star: !!(cur.star || x.star),
        box: Math.max(cur.box || 0, x.box || 0),
        due: Math.min(cur.due || Date.now(), x.due || Date.now()),
        last: Math.max(cur.last || 0, x.last || 0),
        at: Math.min(cur.at || Date.now(), x.at || Date.now()),
      };
    });
    const merged = Object.keys(map).map(function (k) { return map[k]; });
    vocabSave(merged);

    let added = 0;
    if (inRecords.length) {
      try {
        const r = await api("/api/backup/import", { records: inRecords });
        added = (r && r.added) || 0;
      } catch (e) {
        return toast("记录恢复失败：" + e.message + "（生词已合并）");
      }
    }
    renderVocab();
    refreshWordMarks();
    if ($("#ovHistory").classList.contains("show")) openHistory();
    toast("已恢复：新增 " + newWords + " 个词 · " + added + " 条记录");
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
      if (clearImages()) toast("已清空上一批照片：这条记录用转录的文字解剖，不会再读图");
      mixedCheck();
      const recKind = (rec.questions || []).some(function (q) { return q && q.type === "match"; }) ? "match" : "mcq";
      state.kind = recKind;
      const ksel = $("#qkind"); if (ksel) ksel.value = recKind;
      els.qlist.innerHTML = ""; qSeq = 0;
      (rec.questions || []).forEach(addQuestion);
      if (!els.qlist.children.length) addQuestion();
      state.recordId = rec.id;
      state.recordTitle = rec.title || "";
      updateRecChip(rec.title);
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
  $("#qkind").addEventListener("change", async function (e) {
    const kind = e.target.value;
    const old = collect();
    if (old.length && old.some(function (q) { return q.stem; })) {
      const ok = await confirmBox("切换题型", "会把现有 " + old.length + " 道题重建成「" + (kind === "match" ? "段落匹配" : "仔细阅读") + "」，选项内容会丢失。");
      if (!ok) { e.target.value = state.kind; return; }
    }
    state.kind = kind;
    els.qlist.innerHTML = ""; qSeq = 0;
    if (old.length) {
      old.forEach(function (q) {
        addQuestion({ type: kind, no: q.no, stem: q.stem, my: q.my, correct: q.correct, options: kind === "mcq" ? q.options : {} });
      });
    } else addQuestion();
  });
  $("#analyze").addEventListener("click", analyze);
  $("#mixedClear").addEventListener("click", function () {
    els.article.value = "";
    updateWc();
    els.qlist.innerHTML = ""; qSeq = 0; addQuestion();
    clearImages();
    state.recordId = null; state.recordTitle = "";
    updateRecChip("");
    $("#mixedWarn").hidden = true;
    toast("已清空文字与题目，这次按照片新建一条记录");
  });
  $("#mixedKeep").addEventListener("click", function () {
    $("#mixedWarn").hidden = true;
  });

  $("#recDetach").addEventListener("click", function () {
    state.recordId = null;
    state.recordTitle = "";
    updateRecChip("");
    toast("已断开：下次解剖会新建一条记录");
  });
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
  function on(sel, ev, fn) { const el = $(sel); if (el) el.addEventListener(ev, fn); }

  on("#rAll", "click", function () {
    Array.from(document.querySelectorAll("#recList .rchk")).forEach(function (c) { c.checked = true; });
  });
  on("#rNone", "click", function () {
    Array.from(document.querySelectorAll("#recList .rchk")).forEach(function (c) { c.checked = false; });
  });
  on("#rDelSel", "click", async function () {
    const ids = recChecked();
    if (!ids.length) return toast("先勾选要删除的记录");
    if (!(await confirmBox("删除选中的记录", "将删除 " + ids.length + " 条记录，无法恢复。"))) return;
    await deleteRecords(ids);
  });
  $("#btnNew").addEventListener("click", newSession);
  $("#nextOne").addEventListener("click", newSession);
  $("#btnSplit").addEventListener("click", doSplit);
  $("#splitClose").addEventListener("click", function () { $("#ovSplit").classList.remove("show"); });
  $("#splitSave").addEventListener("click", saveSplit);
  $("#btnBackup").addEventListener("click", exportBackup);
  $("#fileRestore").addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    restoreBackup(f);
  });
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
      const src = (p.classList.contains("readqh") || p.classList.contains("readqo")) ? "题目" : "文章";
      vocabTouch(w.textContent, sentence);
      return openDict(w, sentence, src);
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
    if (!dictEl) return;
    if (dictEl.contains(e.target)) {
      if (!(e.target.closest && e.target.closest("button"))) closeDict();
      return;
    }
    if (!(e.target.closest && e.target.closest(".w"))) closeDict();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDict(); });
  /* 固定卡片：滚动不再关闭，方便边滚边看 */

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
  $("#vQuiz").addEventListener("click", function () {
    $("#qErr").className = "cfgerr";
    const dueN = dueList().length;
    const qd = $("#qdDue");
    if (qd) { qd.textContent = "今天该复习的（" + dueN + "）"; qd.disabled = dueN === 0; }
    $("#ovQuiz").classList.add("show");
  });
  $("#vImport").addEventListener("click", function () {
    $("#resErr").className = "cfgerr";
    $("#resText").value = "";
    $("#ovResult").classList.add("show");
  });
  $("#resClose").addEventListener("click", function () { $("#ovResult").classList.remove("show"); });
  $("#resGo").addEventListener("click", function () {
    const res = parseResultCode($("#resText").value);
    const err = $("#resErr");
    if (!res) {
      err.className = "cfgerr show";
      err.textContent = "这段不是有效的结果码（应该以 CET6Q1| 开头，形如 CET6Q1|错词;错词|对词）。";
      return;
    }
    const n = applyQuizResult(res);
    $("#ovResult").classList.remove("show");
    renderVocab();
    refreshWordMarks();
    toast(n ? "已更新 " + n + " 个词" : "这段结果码里的词都不在生词本里");
  });
  $("#qClose").addEventListener("click", function () { $("#ovQuiz").classList.remove("show"); });
  $("#qGo").addEventListener("click", function () { runQuiz("download"); });
  $("#qPreview").addEventListener("click", function () { runQuiz("preview"); });
  $("#pvClose").addEventListener("click", function () { $("#ovPreview").classList.remove("show"); $("#quizFrame").srcdoc = ""; });
  $("#pvDownload").addEventListener("click", saveQuiz);
  Array.from(document.querySelectorAll('input[name="qmode"]')).forEach(function (r) {
    r.addEventListener("change", function () {
      const isWords = document.querySelector('input[name="qmode"]:checked').value === "words";
      $("#qcountField").style.display = isWords ? "" : "none";
    });
  });
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
  if (/[?&]quizdlg=1/.test(location.search)) $("#ovQuiz").classList.add("show");
  function seedDemoVocab() {
    vocabAdd({ word: "influencer", ipa: "/ˈɪnfluənsə/", pos: "n.", meaning: "网红；有影响力的人", nuance: "指靠社媒内容变现、拥有大量粉丝的人", sentence: "Influencers have large followings.", sentenceZh: "网红拥有大量粉丝。", src: "文章" });
    vocabAdd({ word: "sealed off", ipa: "", pos: "短语", meaning: "被封锁的；与外界隔绝的", nuance: "此处指名气与奢侈品曾是小圈子的特权", sentence: "influencers rose by making fame and luxury less 'sealed off'.", sentenceZh: "网红通过让名气与奢侈不再封闭而崛起。", src: "文章" });
    vocabAdd({ word: "vehement", ipa: "/ˈviːəmənt/", pos: "adj.", meaning: "激烈的；猛烈的", nuance: "修饰 critic，指批评得毫不留情", sentence: "A vehement one is Symeon Brown.", sentenceZh: "其中一位言辞激烈的批评者是西米恩·布朗。", src: "题目" });
    vocabAdd({ word: "vehement", ipa: "/ˈviːəmənt/", pos: "adj.", meaning: "激烈的；猛烈的", nuance: "修饰 critic，指批评得毫不留情", sentence: "A vehement critic attacked the industry.", sentenceZh: "一位言辞激烈的批评者抨击了这个行业。", src: "文章" });
    vocabAdd({ word: "underbelly", ipa: "/ˈʌndəbeli/", pos: "n.", meaning: "阴暗面；软肋", sentence: "the industry's underbelly, full of scammers", sentenceZh: "这个行业的阴暗面，充斥着骗子。", src: "文章" });
    vocabAdd({ word: "scrutiny", ipa: "/ˈskruːtəni/", pos: "n.", meaning: "审视；细看", sentence: "popular enough to draw scrutiny", sentenceZh: "火到足以引来审视。", src: "文章" });
  }

  if (/[?&]vocabdemo=(1|seed)/.test(location.search)) {
    if (!vocabAll().length) seedDemoVocab();
    renderVocab();
    if (!/[?&]vocabdemo=seed/.test(location.search)) $("#ovVocab").classList.add("show");
  }
  if (/[?&]resetdemo=1/.test(location.search)) setTimeout(function () { resetWorkbench(); }, 1500);
  if (/[?&]afterimg=1/.test(location.search)) setTimeout(async function () {
    if (/[?&]hist=1/.test(location.search)) { $("#ovHistory").classList.add("show"); }
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const blob = await (await fetch(png)).blob();
    const f = new File([blob], "new-page.png", { type: "image/png" });
    addImages([f]);
  }, 1400);
  if (/[?&]imgdemo=1/.test(location.search)) setTimeout(function () {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    state.images = [{ name: "demo1.jpg", dataUrl: png, w: 1, h: 1, kb: 1 }, { name: "demo2.jpg", dataUrl: png, w: 1, h: 1, kb: 1 }];
    renderThumbs();
  }, 300);
  if (/[?&]loaddemo=1/.test(location.search)) setTimeout(async function () {
    try {
      const list = await api("/api/records");
      if (list && list.length) await loadRecord(list[0].id);
    } catch (e) { toast("载入失败：" + e.message); }
  }, 700);
  if (/[?&]splitdemo=1/.test(location.search)) setTimeout(async function () {
    try {
      const r = await api("/api/split", { images: [], article: "demo" });
      splitData = r.passages || [];
      renderSplit();
      $("#ovSplit").classList.add("show");
    } catch (e) {
      document.body.insertAdjacentHTML("beforeend", "<pre style='padding:20px;color:#b3352b'>" + e.message + "</pre>");
    }
  }, 700);
  if (/[?&]resultdemo=1/.test(location.search)) setTimeout(function () {
    if (!vocabAll().length) seedDemoVocab();
    applyQuizResult({ wrong: ["vehement"], right: ["influencer", "scrutiny"] });
    renderVocab();
    $("#ovVocab").classList.add("show");
  }, 600);
  if (/[?&]quizdemo=/.test(location.search)) setTimeout(async function () {
    const mode = ((location.search.match(/quizdemo=(\w+)/) || [])[1]) || "words";
    if (!vocabAll().length) seedDemoVocab();
    const words = vocabAll().filter(function (w) { return w.word && w.meaning; });
    let data;
    if (mode === "preview") {
      const items = buildClozeItems(shuffle(words).slice(0, 15), null);
      $("#quizFrame").srcdoc = quizPageHtml({ mode: "words", title: "六级生词猜义", sub: "共 " + items.length + " 题 · demo", items: items });
      $("#ovPreview").classList.add("show");
      return;
    }
    if (mode === "passage") {
      try {
        const r = await api("/api/quiz", { words: words.slice(0, 8).map(function (w) { return { word: w.word, meaning: w.meaning }; }) });
        if (r.error) throw new Error(r.error);
        data = { mode: "passage", title: r.title || "生词阅读练习", sub: "用 " + Math.min(8, words.length) + " 个生词生成 · demo", passage: r.passage, words: words.map(function (w) { return { w: w.word, m: w.meaning }; }), questions: r.questions || [] };
      } catch (e) {
        document.body.innerHTML = "<pre style='padding:20px;color:#b3352b'>生成失败：" + e.message + "</pre>";
        return;
      }
    } else {
      const items = buildClozeItems(shuffle(words).slice(0, 15), null);
      data = { mode: "words", title: "六级生词猜义", sub: "共 " + items.length + " 题 · demo", items: items };
    }
    const html = quizPageHtml(data);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    location.href = url;
  }, 800);
  if (/[?&]expand=/.test(location.search)) setTimeout(function () {
    const n = Number((location.search.match(/[?&]expand=(\d+)/) || [])[1] || 1) - 1;
    const row = document.querySelectorAll("#vList .vrow")[n];
    if (row) row.querySelector(".vmain").click();
  }, 900);
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
