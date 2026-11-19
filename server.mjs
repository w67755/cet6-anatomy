import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT || 7788);
const BUILD = "2026-11-14-vocab";
const HOST = "127.0.0.1";
const F_SETTINGS = path.join(DATA, "settings.json");
const F_RECORDS = path.join(DATA, "records.json");
const F_VOCAB = path.join(DATA, "vocab.json");
const DEFAULT_SETTINGS = { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-flash", temperature: 0.2 };

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), "utf8");
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(F_SETTINGS, {}) });

const SYSTEM_PROMPT = [
  "你是一位专攻中国大学英语六级阅读的精讲老师，擅长“逐句定位 + 选项溯源”。",
  "",
  "【分析原则】",
  "1. 一切判断必须以原文为依据；原文没有的信息绝不补充、不臆测。定位不到就明确写“原文无直接依据”。",
  "2. 每个选项都要回原文找到它“出自哪一段、哪一句”（选项溯源），精确到句子，不能只说到段落。",
  "3. 讲清“同义替换链”：正确项 ↔ 定位句里的哪几个词一一对应。",
  "4. 错因命名只从这些里选：同段异句 / 相邻句干扰 / 答非所问 / 偷换主语 / 数字或对象错位 / 绝对化 / 程度过重 / 因果倒置 / 目的当结果 / 无中生有 / 与原文相反。",
  "5. 讲解用中文；原句保留英文，并给中文直译。",
  "6. 语气像一个严格但耐心的老师，直接指出“为什么会选错”，不要说空话。",
  "7. 题号一律用学生试卷上的原题号（21、22…）。学生给出的『题号 → 选项』要按题号去对应，不要自己重新编号、也不要按顺序猜；对不上号就直说，不要挪用到别的题上。",
  "",
  "【输出格式（Markdown）】",
  "## 一、文章骨架",
  "一个表格：段号 | 一句话大意（中文） | 与哪些题有关",
  "## 二、逐题解剖",
  "每道做错的题一个“### 第 X 题”小节，依次写：",
  "- **题干限定词**：题干里必须圈住的 2–3 个词，并说明它把答案锁在什么范围",
  "- **定位句**：用 > 引用原文英文原句（关键部分加粗），后面紧跟中文直译",
  "- **正解为什么对**：同义替换链（原文 A 词 ↔ 选项 B 词）",
  "- **我选的 X 错在哪**：先写清楚它出自哪一段哪一句，再给错因命名，最后说“你当时大概是被哪个词带走的”",
  "- **其余选项排除**：表格（选项 | 原文出处 | 判定 | 理由）",
  "- **一句话记住**：不超过 40 字的口诀",
  "## 三、共性诊断",
  "- 这几道错的题是不是同一种病？一句话点破",
  "- 3 条下次可直接执行的动作",
  "## 四、生词与短语",
  "表格：词/短语 | 释义 | 原文中的搭配",
  "",
  "如果某道题学生其实做对了，只在末尾用一行“第 X 题对了，跳过”带过。",
].join("\n");

const VISION_NOTE = [
  "",
  "【图片输入说明】",
  "学生会给你 1–6 张试卷照片（可能是文章页、题目页，甚至整页）。请先做三件事，再开始解剖：",
  "1. 逐段转录图片中的文章原文，段落用 ¶1 ¶2 编号；看不清的地方写 [不清]，绝不猜写。",
  "2. 转录题目：逐题照抄，格式必须严格如下（不要做成表格，一题一段）：",
  "**21.** 题干原文",
  "A) 选项原文",
  "B) 选项原文",
  "C) 选项原文",
  "D) 选项原文",
  "我选：B｜答案：D",
  "3. 识别图片上的作答痕迹（勾选、圈画、手写字母）。若学生另外给了文字版“我选的答案”，以文字版为准；两者不一致时照文字版，并提醒一句“图片上像是 X，这里按你写的 Y 处理”。",
  "3b. 如果图片内容和学生粘贴的文字明显不是同一篇（题材、题号都对不上），一律以图片为准，并在开头用一句话说明你忽略了文字版。",
  "然后先输出两个小节，再进入正式报告：",
  "## 〇、我读到的原文（请核对）",
  "逐段转录。",
  "## 〇、我读到的题目（请核对）",
  "按上面第 2 条的格式逐题列出；判断不了答案就写“待定”。",
  "之后照常输出“一、文章骨架”“二、逐题解剖”“三、共性诊断”“四、生词与短语”。",
].join("\n");

const LOOKUP_SYSTEM = [
  "你是英汉词典，服务对象是备考中国大学英语六级的学生。",
  "输入：一个英文单词或短语，以及它所在的句子。",
  "输出：严格一个 JSON 对象，不要任何解释、不要代码块围栏。",
  '{"word":"原形","ipa":"/音标/","pos":"词性","meaning":"该词在此句中的中文释义（15 字内）","nuance":"一句话说明它在此处的具体含义或搭配（30 字内）","sentenceZh":"整句中文翻译"}',
  "要求：",
  "1. meaning 只给贴合句意的那一个义项，不要罗列词典里的全部释义。",
  "2. 如果输入是短语、专有名词或人名，word 原样返回，pos 写“短语”或“专名”。",
  "3. 音标不确定就给空字符串，不要编。",
  "4. sentenceZh 要通顺，像人话，不要逐词硬译。",
].join("\n");

const SENTENCE_SYSTEM = [
  "你是英汉翻译老师，服务对象是备考中国大学英语六级的学生。",
  "输入：一个英文句子（可能来自阅读文章）。",
  "输出：严格一个 JSON 对象，不要解释、不要代码块围栏。",
  '{"sentenceZh":"通顺的中文翻译","note":"一句话点出这句话的难点（长难句结构、熟词僻义、指代），没有就给空字符串"}',
  "要求：翻译要像人话，不要逐词硬译；专业名词保留通用译法。",
].join("\n");

const QUIZ_SYSTEM = [
  "你是中国大学英语六级（CET-6）的命题人。",
  "学生会给你一组单词，你要写一篇英文短文，并围绕它出题。",
  "要求：",
  "1. 短文 300–380 词，体裁为说明文或议论文，话题自选但要连贯、有观点，难度贴近六级阅读。",
  "2. 必须自然地用上单词表里的每一个词（可变形），并在正文中用 **单词** 的形式加粗标出。",
  "3. 之后出 5 道单选题：2 道细节、1 道推断、1 道词义、1 道主旨；每题 4 个选项，只有一个正确。",
  "4. 题干用英文，解析用中文。",
  "5. 只输出 JSON，不要解释、不要代码块围栏：",
  '{"title":"短文标题","passage":"正文，含 **word** 标记","questions":[{"stem":"…","options":{"A":"…","B":"…","C":"…","D":"…"},"answer":"B","why":"…"}]}',
].join("\n");

const SPLIT_SYSTEM = [
  "你是六级试卷的排版分析员。输入是一整套试卷的照片（可能包含多篇阅读）。",
  "任务：把阅读文章按「篇」切开，逐篇转录。",
  "要求：",
  "1. 每篇包含：标题（没有就用 Passage N 或首句前六个词）、完整正文、紧随其后的题目。",
  "2. 判断每篇的题型：仔细阅读 type=\"mcq\"（题干 + A/B/C/D 四个选项）；长篇阅读·段落匹配 type=\"match\"（文章按 A) B) … 分段，题干没有选项，答案是段落字母）。",
  "2. 只做切分与转录，不要分析、不要翻译、不要总结。",
  "3. 图片看不清的地方写 [不清]，不要猜。",
  "4. 如果只有一篇，数组里就一项。",
  "5. 只输出 JSON，不要解释、不要代码块围栏：",
  '{"passages":[{"title":"…","type":"mcq|match","article":"正文，段落之间空一行","questions":[{"no":"21","stem":"…","options":{"A":"…","B":"…","C":"…","D":"…"},"my":"A-D 或空","answer":"A-D 或空"}]}]}',
  "6. 段落匹配的题目写成：{\"no\":\"36\",\"stem\":\"…\",\"answer\":\"D\",\"my\":\"\"}，不要填 options。",
].join("\n");

const MATCH_PROMPT = [
  "你是一位专攻中国大学英语六级阅读的精讲老师，擅长「长篇阅读 / 段落匹配」。",
  "",
  "【题型说明】",
  "文章被分成 A–O 若干段，题乾是 10 个陈述句（36–45 题）。每题对应一个段落字母；同一个段落可能被用两次，也可能有段落完全用不到。",
  "",
  "【分析原则】",
  "1. 先建立段落地图：逐段用一句话概括，标出该段的标志性关键词。",
  "2. 每题必须走完：题干关键词（尤其是同义替换点）→ 2 个候选段落 → 最终段落与理由 → 该段关键句（原文引用 + 中文直译）→ 干扰段为什么像但不是。",
  "3. 题号一律用原卷题号（36–45）；段落字母用大写。",
  "4. 不要编造原文没有的句子；定位不到就写“未找到明确对应段”。",
  "",
  "【输出格式（Markdown）】",
  "## 一、段落地图",
  "表格：段落 | 一句话概括（中文） | 关键词（英文）",
  "## 二、逐题定位",
  "每题一个 ###，依次写：",
  "- **题干关键词**：句子里最关键的 2–3 个词，以及它在原文里可能被替换成什么",
  "- **候选**：先列 2 个看起来都对的段落，各用一句话说明像在哪",
  "- **定位段落**：**X**",
  "- **关键句**：> 原文（加粗关键词）｜中文直译",
  "- **为什么不是另一段**：一句话点破区别",
  "- **一句话记住**：不超过 40 字",
  "## 三、共性诊断",
  "- 这几题暴露的固定毛病 + 3 条可执行的动作",
  "## 四、生词与短语",
  "表格：词/短语 | 释义 | 原文搭配",
].join("\n");

const CLOZE_SYSTEM = [
  "你是英语学习材料的编写者。学生会给你一组单词，你要为每个单词写一句用于「挖空练习」的例句。",
  "要求：",
  "1. 每句 12–20 词，难度贴近六级，句子本身要有上下文线索，能让人猜出该词的意思。",
  "2. 必须自然地包含该单词（可用其变形），不要用其他生僻词。",
  "3. 句子本身不要出现中文；但每条要额外给一句通顺的中文翻译。",
  "4. 只输出 JSON，不要解释、不要代码块围栏：",
  '{"items":[{"word":"promote","sentence":"Many brands pay influencers to promote their products to younger audiences.","sentenceZh":"许多品牌付费给网红，让他们向年轻受众推销自己的产品。"}]}',
].join("\n");

function questionBlock(qs) {
  return (qs || []).map((q, i) => {
    const no = q.no || i + 1;
    if (q.type === "match") {
      return "第" + no + "题（段落匹配）" + (q.stem || "") +
        "\n我的答案：段落" + (q.my || "未填") + "\n正确答案：段落" + (q.correct || "未知（请你自己判断）");
    }
    const opts = ["A", "B", "C", "D"].map((k) => k + ") " + ((q.options && q.options[k]) || "")).join("\n");
    return no + ". " + (q.stem || "") + "\n" + opts +
      "\n我的答案：" + (q.my || "未填") + "\n正确答案：" + (q.correct || "未知（请你自己判断并给出正确答案）");
  }).join("\n\n");
}

function buildPrompt(article, questions) {
  return SYSTEM_PROMPT + "\n\n======\n\n【阅读文章】\n" + article + "\n\n【题目与作答】\n" + questionBlock(questions) +
    "\n\n请严格按上面的格式，为每道“做错”的题（我的答案 ≠ 正确答案）做解剖；正确答案未知时，先判断正确项再讲。";
}

function sseHead(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": ok\n\n");
}
const send = (res, obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");

async function streamUpstream(res, messages, cfg) {
  sseHead(res);
  const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model || "deepseek-flash",
        messages,
        temperature: Number(cfg.temperature) || 0.2,
        stream: true,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      send(res, { error: "上游返回 " + r.status + "：" + t.slice(0, 400) });
      return res.end();
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const d = line.slice(5).trim();
          if (!d || d === "[DONE]") continue;
          try {
            const j = JSON.parse(d);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) send(res, { delta });
          } catch { /* 忽略无法解析的行 */ }
        }
      }
    }
    send(res, { done: true });
    res.end();
  } catch (e) {
    send(res, { error: "请求失败：" + String((e && e.message) || e) });
    res.end();
  }
}

function body(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 20 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

/* ---------------- docx 导出（零依赖：stored zip + 最小 OOXML） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipStore(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt32LE(0, 36);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

const xmlEsc = (t) => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wRun(text, o) {
  o = o || {};
  const face = o.face || "Calibri";
  const props = ['<w:rFonts w:ascii="' + face + '" w:hAnsi="' + face + '" w:eastAsia="Microsoft YaHei"/>'];
  if (o.bold) props.push("<w:b/>");
  if (o.italic) props.push("<w:i/>");
  if (o.color) props.push('<w:color w:val="' + o.color + '"/>');
  props.push('<w:sz w:val="' + (o.size || 22) + '"/><w:szCs w:val="' + (o.size || 22) + '"/>');
  return "<w:r><w:rPr>" + props.join("") + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r>";
}

function wPara(runs, o) {
  o = o || {};
  const ppr = '<w:pPr><w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 100 : o.after) + '"/></w:pPr>';
  return "<w:p>" + ppr + runs + "</w:p>";
}

function buildDocx(items, title) {
  const body = [];
  body.push(wPara(wRun(title || "六级生词本", { bold: true, size: 36, face: "Georgia" }), { after: 60 }));
  body.push(wPara(wRun("共 " + items.length + " 条 · " + new Date().toLocaleDateString("zh-CN"), { size: 18, color: "777777" }), { after: 200 }));
  items.forEach((it) => {
    let head = wRun(it.word || "", { bold: true, size: 28, face: "Georgia" });
    if (it.ipa) head += wRun("  " + it.ipa, { size: 18, color: "777777", face: "Georgia" });
    if (it.pos) head += wRun("  " + it.pos, { size: 18, color: "1C4F82" });
    if (it.hits && it.hits > 1) head += wRun("  查过 " + it.hits + " 次", { size: 16, color: "B3352B" });
    body.push(wPara(head, { before: 220, after: 40 }));
    if (it.meaning) body.push(wPara(wRun(it.meaning, { size: 24 }), { after: 30 }));
    if (it.nuance) body.push(wPara(wRun(it.nuance, { size: 18, color: "666666" }), { after: 30 }));
    if (it.sentence) body.push(wPara(wRun(it.sentence, { size: 18, italic: true, color: "444444", face: "Georgia" }), { after: 20 }));
    if (it.sentenceZh) body.push(wPara(wRun(it.sentenceZh, { size: 18, color: "666666" }), { after: 60 }));
  });

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    "</w:body></w:document>";

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  return zipStore([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
  ]);
}

function statics(req, res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(PUB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://" + HOST + ":" + PORT);

  if (u.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, build: BUILD, at: Date.now() }));
  }

  if (u.pathname === "/api/settings") {
    const cfg = getSettings();
    if (req.method === "POST") {
      const b = await body(req);
      const next = { ...cfg };
      if (typeof b.baseUrl === "string" && b.baseUrl.trim()) next.baseUrl = b.baseUrl.trim();
      if (typeof b.model === "string" && b.model.trim()) next.model = b.model.trim();
      if (b.temperature != null && !Number.isNaN(Number(b.temperature))) next.temperature = Number(b.temperature);
      if (typeof b.apiKey === "string" && b.apiKey.trim()) next.apiKey = b.apiKey.trim();
      writeJson(F_SETTINGS, next);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ baseUrl: next.baseUrl, model: next.model, temperature: next.temperature, hasKey: !!next.apiKey }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model, temperature: cfg.temperature, hasKey: !!cfg.apiKey }));
  }

  if (u.pathname === "/api/ping" && req.method === "POST") {
    const b = await body(req);
    const cfg = getSettings();
    const base = String(b.baseUrl || cfg.baseUrl || "").replace(/\/+$/, "");
    const key = String(b.apiKey || cfg.apiKey || "");
    const model = String(b.model || cfg.model || "deepseek-flash");
    const reply = (obj) => { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
    if (!key) return reply({ ok: false, error: "没有填写 API Key" });
    if (!/^https?:\/\//i.test(base)) return reply({ ok: false, error: "API 地址必须以 http(s):// 开头" });
    try {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      const t = await r.text();
      if (!r.ok) return reply({ ok: false, error: "HTTP " + r.status + " " + t.slice(0, 220) });
      return reply({ ok: true, model });
    } catch (e) {
      return reply({ ok: false, error: "网络错误：" + String((e && e.message) || e) });
    }
  }

  if (u.pathname === "/api/analyze" && req.method === "POST") {
    const b = await body(req);
    const article = String(b.article || "").trim();
    const myAnswers = String(b.myAnswers || "").trim();
    const questions = Array.isArray(b.questions) ? b.questions : [];
    const images = (Array.isArray(b.images) ? b.images : [])
      .filter((x) => x && typeof x.dataUrl === "string" && x.dataUrl.indexOf("data:image/") === 0)
      .slice(0, 6);
    const cfg = getSettings();

    if (!article && !images.length) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "没有收到文章，也没有收到图片" }));
    }
    if (images.length && !/flash/i.test(String(cfg.model))) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "当前模型（" + cfg.model + "）不支持读图。请到设置里把模型改成 deepseek-flash。" }));
    }

    const textParts = [];
    if (myAnswers) textParts.push("【学生自己写下的作答】" + myAnswers);
    if (article) textParts.push("【学生粘贴的文字（可作参照，可能不全）】\n" + article);
    if (questions.length) textParts.push("【学生填的题目卡片】\n" + questionBlock(questions));
    textParts.push(images.length
      ? "上面的图片就是这次要分析的试卷。请先转录、再按格式逐题解剖。"
      : "请严格按格式逐题解剖。");

    if (!cfg.apiKey) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const p = (images.length ? "（我会先上传 " + images.length + " 张试卷照片，请先读图再分析）\n\n" : "") +
        SYSTEM_PROMPT + "\n\n======\n\n" + textParts.join("\n\n");
      return res.end(JSON.stringify({ mode: "prompt", prompt: p }));
    }

    const userContent = images.length
      ? [{ type: "text", text: textParts.join("\n\n") }].concat(images.map((im) => ({
          type: "image_url",
          image_url: { url: im.dataUrl },
        })))
      : textParts.join("\n\n");

    const basePrompt = String(b.kind || "") === "match" ? MATCH_PROMPT : SYSTEM_PROMPT;
    const messages = [
      { role: "system", content: basePrompt + (images.length ? "\n" + VISION_NOTE : "") },
      { role: "user", content: userContent },
    ];
    return streamUpstream(res, messages, cfg);
  }

  if (u.pathname === "/api/split" && req.method === "POST") {
    const b = await body(req);
    const cfg = getSettings();
    const reply = (obj, code) => {
      res.writeHead(code || 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    const images = (Array.isArray(b.images) ? b.images : [])
      .filter((x) => x && typeof x.dataUrl === "string" && x.dataUrl.indexOf("data:image/") === 0)
      .slice(0, 6);
    const text = String(b.article || "").trim();
    if (!images.length && !text) return reply({ error: "没有收到试卷照片" }, 400);
    if (!cfg.apiKey) return reply({ error: "整卷分割需要 API Key（要先让模型读图）" }, 400);
    if (images.length && !/flash/i.test(String(cfg.model))) return reply({ error: "当前模型不支持读图，请改用 deepseek-flash" }, 400);

    const parts = [];
    if (text) parts.push("【学生粘贴的文字】\n" + text);
    parts.push("请把上面的内容按篇切分并转录，输出 JSON。");

    const userContent = images.length
      ? [{ type: "text", text: parts.join("\n\n") }].concat(images.map((im) => ({ type: "image_url", image_url: { url: im.dataUrl } })))
      : parts.join("\n\n");

    const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
    try {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model || "deepseek-flash",
          messages: [
            { role: "system", content: SPLIT_SYSTEM },
            { role: "user", content: userContent },
          ],
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 6000,
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        const t = await r.text();
        return reply({ error: "上游返回 " + r.status + "：" + t.slice(0, 220) }, 502);
      }
      const j = await r.json();
      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let data = null;
      try { data = JSON.parse(cleaned); } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { data = JSON.parse(m[0]); } catch {} }
      }
      if (!data) return reply({ error: "解析失败：" + cleaned.slice(0, 120) }, 502);
      const list = (Array.isArray(data.passages) ? data.passages : []).slice(0, 8).map((p) => ({
        title: String(p.title || "未命名").slice(0, 60),
        type: String(p.type || "").toLowerCase() === "match" ? "match" : "mcq",
        article: String(p.article || ""),
        questions: (Array.isArray(p.questions) ? p.questions : []).map((q) => ({
          no: String(q.no || ""),
          stem: String(q.stem || ""),
          options: q.options || {},
          my: String(q.my || ""),
          answer: String(q.answer || ""),
        })),
      })).filter((p) => p.article || p.questions.length);
      if (!list.length) return reply({ error: "没识别出任何文章" }, 502);
      return reply({ passages: list });
    } catch (e) {
      return reply({ error: "分割失败：" + String((e && e.message) || e) }, 502);
    }
  }

  if (u.pathname === "/api/cloze" && req.method === "POST") {
    const b = await body(req);
    const cfg = getSettings();
    const reply = (obj, code) => {
      res.writeHead(code || 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    const words = (Array.isArray(b.words) ? b.words : []).slice(0, 40)
      .map((w) => ({ word: String(w.word || "").trim(), meaning: String(w.meaning || "").trim() }))
      .filter((w) => w.word);
    if (!words.length) return reply({ error: "没有可用的生词" }, 400);
    if (!cfg.apiKey) return reply({ error: "生成例句需要 API Key" }, 400);

    const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
    const list = words.map((w) => "- " + w.word + (w.meaning ? "（" + w.meaning + "）" : "")).join("\n");
    try {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model || "deepseek-flash",
          messages: [
            { role: "system", content: CLOZE_SYSTEM },
            { role: "user", content: "单词表：\n" + list },
          ],
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.6,
          max_tokens: 3000,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) {
        const t = await r.text();
        return reply({ error: "上游返回 " + r.status + "：" + t.slice(0, 200) }, 502);
      }
      const j = await r.json();
      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let data = null;
      try { data = JSON.parse(cleaned); } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { data = JSON.parse(m[0]); } catch {} }
      }
      const items = (data && Array.isArray(data.items) ? data.items : [])
        .map((x) => ({
          word: String(x.word || ""),
          sentence: String(x.sentence || "").trim(),
          sentenceZh: String(x.sentenceZh || x.zh || "").trim(),
        }))
        .filter((x) => x.word && x.sentence);
      if (!items.length) return reply({ error: "例句解析失败" }, 502);
      return reply({ items });
    } catch (e) {
      return reply({ error: "生成失败：" + String((e && e.message) || e) }, 502);
    }
  }

  if (u.pathname === "/api/quiz" && req.method === "POST") {
    const b = await body(req);
    const cfg = getSettings();
    const reply = (obj, code) => {
      res.writeHead(code || 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    const words = (Array.isArray(b.words) ? b.words : [])
      .slice(0, 20)
      .map((w) => ({ word: String(w.word || "").trim(), meaning: String(w.meaning || "").trim() }))
      .filter((w) => w.word);
    if (!words.length) return reply({ error: "没有可用的生词" }, 400);
    if (!cfg.apiKey) return reply({ error: "生成新文章需要 API Key，可以先用「词卡自测」" }, 400);

    const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
    const list = words.map((w) => "- " + w.word + (w.meaning ? "（" + w.meaning + "）" : "")).join("\n");
    const payload = {
      model: cfg.model || "deepseek-flash",
      messages: [
        { role: "system", content: QUIZ_SYSTEM },
        { role: "user", content: "单词表：\n" + list + "\n\n请写短文并出 5 道题。" },
      ],
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature: 0.85,
      max_tokens: 2500,
      stream: false,
    };

    try {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) {
        const t = await r.text();
        return reply({ error: "上游返回 " + r.status + "：" + t.slice(0, 220) }, 502);
      }
      const j = await r.json();
      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let data = null;
      try { data = JSON.parse(cleaned); } catch { 
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { data = JSON.parse(m[0]); } catch {} }
      }
      if (!data || !data.passage) return reply({ error: "生成结果解析失败：" + cleaned.slice(0, 120) }, 502);
      const qs = (Array.isArray(data.questions) ? data.questions : []).slice(0, 8);
      return reply({ title: data.title || "生词阅读练习", passage: String(data.passage), questions: qs });
    } catch (e) {
      return reply({ error: "生成失败：" + String((e && e.message) || e) }, 502);
    }
  }

  if (u.pathname === "/api/lookup" && req.method === "POST") {
    const b = await body(req);
    const word = String(b.word || "").slice(0, 60).trim();
    const sentence = String(b.sentence || "").slice(0, 700).trim();
    const cfg = getSettings();
    const reply = (obj, code) => {
      res.writeHead(code || 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    if (!cfg.apiKey) return reply({ error: "还没有配置 API Key，查词要用它" }, 400);
    const sentenceMode = !word || String(b.mode || "") === "sentence";
    if (!sentenceMode && !word) return reply({ error: "没有收到单词" }, 400);
    if (sentenceMode && !sentence) return reply({ error: "没有收到句子" }, 400);

    const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
    const payload = {
      model: cfg.model || "deepseek-flash",
      messages: sentenceMode
        ? [{ role: "system", content: SENTENCE_SYSTEM }, { role: "user", content: "句子：" + sentence }]
        : [{ role: "system", content: LOOKUP_SYSTEM }, { role: "user", content: "单词：" + word + "\n句子：" + sentence }],
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 600,
      stream: false,
    };

    const call = (body) => fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    try {
      let r = await call(payload);
      if (!r.ok) {
        const t = await r.text();
        // 有些兼容端点不认 response_format / thinking，退一步重试
        const plain = { ...payload };
        delete plain.response_format;
        delete plain.thinking;
        r = await call(plain);
        if (!r.ok) {
          const t2 = await r.text();
          return reply({ error: "上游返回 " + r.status + "：" + (t2 || t).slice(0, 200) }, 502);
        }
      }
      const j = await r.json();
      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let data = null;
      try { data = JSON.parse(cleaned); } catch { 
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { data = JSON.parse(m[0]); } catch {} }
      }
      if (!data) return reply({ error: "解析失败：" + cleaned.slice(0, 120) }, 502);
      if (sentenceMode) return reply({ sentenceZh: data.sentenceZh || "", note: data.note || "" });
      return reply({
        word: data.word || word,
        ipa: data.ipa || "",
        pos: data.pos || "",
        meaning: data.meaning || "",
        nuance: data.nuance || "",
        sentenceZh: data.sentenceZh || "",
      });
    } catch (e) {
      return reply({ error: "查词失败：" + String((e && e.message) || e) }, 502);
    }
  }

  if (u.pathname === "/api/chat" && req.method === "POST") {
    const b = await body(req);
    const cfg = getSettings();
    if (!cfg.apiKey) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "还没有配置 API Key" })); }
    const ctx = [
      "【阅读文章】", String(b.article || ""),
      "", "【题目】", questionBlock(b.questions || []),
      "", "【你刚给出的解剖报告】", String(b.analysis || "").slice(0, 8000),
    ].join("\n");
    const hist = Array.isArray(b.messages) ? b.messages.slice(-8) : [];
    const messages = [
      { role: "system", content: SYSTEM_PROMPT + "\n\n你正在就下面这份材料回答学生的追问。回答要短、要具体，能引原句就引原句，不要重复整篇报告。\n\n" + ctx },
      ...hist.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "") })),
    ];
    return streamUpstream(res, messages, cfg);
  }

  if (u.pathname === "/api/export/docx" && req.method === "POST") {
    const b = await body(req);
    const items = Array.isArray(b.items) ? b.items.slice(0, 400) : [];
    if (!items.length) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "没有要导出的词" }));
    }
    const buf = buildDocx(items, String(b.title || "六级生词本"));
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="vocab.docx"',
      "Content-Length": buf.length,
    });
    return res.end(buf);
  }

  if (u.pathname === "/api/vocab") {
    const list = readJson(F_VOCAB, []);
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ items: Array.isArray(list) ? list : [] }));
    }
    if (req.method === "POST") {
      const b = await body(req);
      const items = Array.isArray(b.items) ? b.items.slice(0, 5000) : [];
      const deleted = Array.isArray(b.deleted) ? b.deleted.map((w) => String(w).toLowerCase()) : [];
      const map = {};
      (Array.isArray(list) ? list : []).forEach((x) => {
        if (x && x.word) map[String(x.word).toLowerCase()] = x;
      });
      items.forEach((x) => {
        if (!x || !x.word) return;
        const k = String(x.word).toLowerCase();
        const cur = map[k];
        if (!cur) { map[k] = x; return; }
        map[k] = {
          ...cur, ...x,
          hits: Math.max(cur.hits || 1, x.hits || 1),
          box: Math.max(cur.box || 0, x.box || 0),
          star: !!(cur.star || x.star),
          due: Math.min(cur.due || Date.now(), x.due || Date.now()),
          last: Math.max(cur.last || 0, x.last || 0),
          at: Math.min(cur.at || Date.now(), x.at || Date.now()),
        };
      });
      deleted.forEach((k) => { delete map[k]; });
      const merged = Object.keys(map).map((k) => map[k]);
      writeJson(F_VOCAB, merged);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, count: merged.length }));
    }
  }

  if (u.pathname === "/api/backup" && req.method === "GET") {
    const records = readJson(F_RECORDS, []);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ kind: "cet6-anatomy-backup", version: 1, exportedAt: Date.now(), records }));
  }

  if (u.pathname === "/api/backup/import" && req.method === "POST") {
    const b = await body(req);
    const incoming = Array.isArray(b.records) ? b.records : [];
    const list = readJson(F_RECORDS, []);
    const have = new Set(list.map((r) => r.id));
    let added = 0;
    for (const r of incoming) {
      if (!r || !r.id || have.has(r.id)) continue;
      list.unshift({
        id: r.id, title: r.title || "未命名", article: r.article || "", questions: r.questions || [],
        analysis: r.analysis || "", chat: r.chat || [], createdAt: r.createdAt || Date.now(), updatedAt: Date.now(),
      });
      have.add(r.id);
      added++;
    }
    writeJson(F_RECORDS, list.slice(0, 500));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ added, total: list.length }));
  }

  if (u.pathname === "/api/find" && req.method === "GET") {
    const w = String(u.searchParams.get("word") || "").trim().toLowerCase();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    if (!w) return res.end(JSON.stringify([]));
    const list = readJson(F_RECORDS, []);
    const hits = list.filter(function (r) {
      return String(r.article || "").toLowerCase().indexOf(w) >= 0 ||
             String(r.analysis || "").toLowerCase().indexOf(w) >= 0;
    }).map(function (r) {
      return { id: r.id, title: r.title || "未命名", createdAt: r.createdAt };
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return res.end(JSON.stringify(hits));
  }

  if (u.pathname === "/api/records") {
    const list = readJson(F_RECORDS, []);
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (u.searchParams.get("id")) {
        const rec = list.find((r) => r.id === u.searchParams.get("id"));
        return res.end(JSON.stringify({ record: rec || null }));
      }
      return res.end(JSON.stringify(list.map((r) => ({
        id: r.id, title: r.title, createdAt: r.createdAt,
        qcount: (r.questions || []).length, analysis: r.analysis || "",
      })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
    }
    if (req.method === "POST") {
      const b = await body(req);
      const id = b.id || ("r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const idx = list.findIndex((r) => r.id === id);
      const rec = {
        id, title: b.title || "未命名", article: b.article || "", questions: b.questions || [],
        analysis: b.analysis || "", chat: b.chat || [],
        createdAt: idx >= 0 ? list[idx].createdAt : Date.now(), updatedAt: Date.now(),
      };
      if (idx >= 0) list[idx] = rec; else list.unshift(rec);
      writeJson(F_RECORDS, list.slice(0, 200));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id }));
    }
    if (req.method === "DELETE") {
      const id = u.searchParams.get("id");
      writeJson(F_RECORDS, list.filter((r) => r.id !== id));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
  }

  if (req.method === "GET") return statics(req, res, u.pathname);
  res.writeHead(404); res.end("not found");
});

function openBrowser(url) {
  if (process.env.NO_OPEN === "1") return;
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 打不开就让用户手动点 */ }
}

function listenOn(p) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.removeListener("listening", onOk); reject(e); };
    const onOk = () => { server.removeListener("error", onErr); resolve(p); };
    server.once("error", onErr);
    server.once("listening", onOk);
    server.listen(p, HOST);
  });
}

async function probe(p) {
  try {
    const r = await fetch("http://" + HOST + ":" + p + "/api/health", { signal: AbortSignal.timeout(1200) });
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch { return null; }
}

function ready(p) {
  const url = "http://" + HOST + ":" + p;
  console.log("");
  console.log("  错题解剖台已启动 →  " + url);
  console.log("  这个黑窗口别关；关掉就等于退出程序。按 Ctrl+C 结束。");
  if (p !== PORT) console.log("  （" + PORT + " 被别的进程占着，所以自动换到 " + p + "）");
  console.log("");
  openBrowser(url);
}

(async () => {
  for (let i = 0; i < 6; i++) {
    const p = PORT + i;
    try {
      await listenOn(p);
      return ready(p);
    } catch (e) {
      if (!e || e.code !== "EADDRINUSE") {
        console.error(e);
        return process.exit(1);
      }
      const other = await probe(p);
      if (other && other.build === BUILD) {
        const url = "http://" + HOST + ":" + p;
        console.log("");
        console.log("  它已经在运行了 —— 不用重复启动。");
        console.log("  直接打开： " + url);
        console.log("");
        openBrowser(url);
        return process.exit(0);
      }
      if (other) {
        console.log("  端口 " + p + " 上有个旧版本在跑，自动换下一个端口…");
      } else {
        console.log("  端口 " + p + " 被别的程序占用，自动换下一个端口…");
      }
    }
  }
  console.log("");
  console.log("  7788–7793 都被占用了。用记事本把 启动.bat 里的 PORT 改成 7800 再试。");
  process.exit(1);
})();
