import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transform } from "sucrase";
export class WidgetError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "WidgetError";
    }
}
export const MAX_WIDGET_CODE = 300_000;
const MAX_TITLE = 200;
const MAX_WIDGETS_PER_ANSWER = 3;
export const WIDGET_FRAME_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "sandbox allow-scripts"
].join("; ");
export function validateWidgetSpec(value) {
    if (!value || typeof value !== "object")
        throw new WidgetError("WIDGET_INVALID");
    const raw = value;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE) : "";
    const kind = raw.kind === "html" || raw.kind === "jsx" ? raw.kind : null;
    const code = typeof raw.code === "string" ? raw.code : "";
    if (!kind)
        throw new WidgetError("WIDGET_KIND_INVALID");
    if (!code.trim())
        throw new WidgetError("WIDGET_CODE_REQUIRED");
    if (code.length > MAX_WIDGET_CODE)
        throw new WidgetError("WIDGET_CODE_TOO_LARGE");
    const source = typeof raw.source === "string" && raw.source.length <= 300 ? raw.source : undefined;
    return { title: title || "Widget", kind, code, ...(source ? { source } : {}) };
}
// Kod widgetu z pliku: .html/.htm, .jsx/.tsx albo pierwszy blok ```jsx / ```html w .md.
export function widgetFromFile(file, text) {
    const extension = path.extname(file).toLowerCase();
    if (extension === ".html" || extension === ".htm")
        return { kind: "html", code: text };
    if (extension === ".jsx" || extension === ".tsx")
        return { kind: "jsx", code: text };
    if (extension === ".md") {
        const blocks = [...text.matchAll(/```(jsx|tsx|javascript|js|html)\s*\n([\s\S]*?)```/g)];
        const jsx = blocks.find((block) => block[1] !== "html" && /export\s+default|<[A-Za-z]/.test(block[2]));
        const html = blocks.find((block) => block[1] === "html" && /<(html|body|div|script|style)\b/i.test(block[2]));
        const chosen = jsx ?? html;
        if (chosen)
            return { kind: chosen[1] === "html" ? "html" : "jsx", code: chosen[2] };
    }
    throw new WidgetError("WIDGET_FILE_HAS_NO_WIDGET");
}
// Szablon widgetu z korpusu zasilany danymi: model podaje tylko `data` (JSON), a aplikacja
// wstawia je w miejsce literału oznaczonego w szablonie `/* lex:dane */` i dokłada pasek
// eksportu/importu (MOD-WIDGET-IO). Model nie przepisuje już kodu szablonu.
export const MAX_WIDGET_DATA = 200_000;
// The mark directly followed by an object or array literal (a mention in prose does not count).
const DATA_SLOT = /\/\*\s*lex:dane\s*\*\/\s*(?=[{[])/u;
// Koniec literału {…} albo […] od `start`: nawiasy zbalansowane, pomija napisy i komentarze.
function literalEnd(code, start) {
    let depth = 0;
    for (let i = start; i < code.length; i += 1) {
        const ch = code[i];
        if (ch === '"' || ch === "'" || ch === "`") {
            for (i += 1; i < code.length && code[i] !== ch; i += 1)
                if (code[i] === "\\")
                    i += 1;
            continue;
        }
        if (ch === "/" && code[i + 1] === "/") {
            while (i < code.length && code[i] !== "\n")
                i += 1;
            continue;
        }
        if (ch === "/" && code[i + 1] === "*") {
            const close = code.indexOf("*/", i + 2);
            if (close < 0)
                return -1;
            i = close + 1;
            continue;
        }
        if (ch === "{" || ch === "[")
            depth += 1;
        else if (ch === "}" || ch === "]") {
            depth -= 1;
            if (depth === 0)
                return i + 1;
        }
    }
    return -1;
}
function scriptJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function ioBar(skill) {
    return `<div id="lex-io" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;font:12px system-ui,sans-serif;background:#f7f7f7">
<span style="font-weight:600;color:#555">Dane widgetu:</span>
<button type="button" data-io="json">Eksport JSON</button><button type="button" data-io="md">Eksport MD</button><button type="button" data-io="csv">Eksport CSV</button>
<label style="cursor:pointer;border:1px solid #bbb;border-radius:3px;padding:1px 6px;background:#fff">Wczytaj JSON<input type="file" accept=".json,application/json" style="display:none"></label>
<span id="lex-io-status" style="color:#555"></span></div>
<script>(function(){
var SKILL=${JSON.stringify(skill)};
function data(){return window.__lexData||window.__lexDefault||{};}
function status(t){var s=document.getElementById("lex-io-status");if(s)s.textContent=t;}
function dl(text,ext,mime){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:mime}));
a.download=SKILL+"_"+new Date().toISOString().slice(0,10)+"."+ext;document.body.appendChild(a);a.click();a.remove();status("Zapisano ."+ext);}
function cell(v){return v===null||v===undefined?"":typeof v==="object"?JSON.stringify(v):String(v);}
function rows(a){return Array.isArray(a)&&a.length&&a.every(function(x){return x&&typeof x==="object"&&!Array.isArray(x);});}
function keys(a){var k=[];a.forEach(function(o){Object.keys(o).forEach(function(x){if(k.indexOf(x)<0)k.push(x);});});return k;}
function md(v,name,depth){var h=new Array(Math.min(depth,6)+1).join("#");
 if(rows(v)){var k=keys(v);return (name?h+" "+name+"\\n\\n":"")+"| "+k.join(" | ")+" |\\n|"+k.map(function(){return " --- |";}).join("")+"\\n"+
  v.map(function(o){return "| "+k.map(function(x){return cell(o[x]).replace(/\\|/g,"\\\\|").replace(/\\n/g," ");}).join(" | ")+" |";}).join("\\n")+"\\n\\n";}
 if(Array.isArray(v))return (name?h+" "+name+"\\n\\n":"")+v.map(function(x){return "- "+cell(x);}).join("\\n")+"\\n\\n";
 if(v&&typeof v==="object")return (name?h+" "+name+"\\n\\n":"")+Object.keys(v).map(function(x){var y=v[x];
  return y&&typeof y==="object"?md(y,x,depth+1):"- **"+x+":** "+cell(y)+"\\n";}).join("")+"\\n";
 return (name?"- **"+name+":** ":"")+cell(v)+"\\n";}
function csv(v){var out=[];function q(x){x=cell(x);return /[",\\n;]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;}
 function table(name,a){var k=keys(a);if(name)out.push("# "+name);out.push(k.map(q).join(","));a.forEach(function(o){out.push(k.map(function(x){return q(o[x]);}).join(","));});out.push("");}
 if(rows(v))table("",v);else if(v&&typeof v==="object")Object.keys(v).forEach(function(x){if(rows(v[x]))table(x,v[x]);});
 return out.join("\\n");}
document.getElementById("lex-io").addEventListener("click",function(e){var k=e.target&&e.target.getAttribute&&e.target.getAttribute("data-io");if(!k)return;
 var d=data();if(k==="json")dl(JSON.stringify({_meta:{skill:SKILL,exported_at:new Date().toISOString()},state:d},null,2),"json","application/json");
 else if(k==="md")dl(md(d,"",1),"md","text/markdown");
 else{var c=csv(d);if(c)dl(c,"csv","text/csv");else status("Brak tabel do eksportu CSV");}});
document.querySelector("#lex-io input[type=file]").addEventListener("change",function(e){var f=e.target.files&&e.target.files[0];if(!f)return;
 var r=new FileReader();r.onload=function(){try{var p=JSON.parse(String(r.result));var s=p&&p.state!==undefined?p.state:p;
  window.name="lexdata:"+JSON.stringify(s);location.reload();}catch(err){status("Błąd importu: "+err.message);}};r.readAsText(f);});
})();</script>`;
}
/** Szablon z korpusu z danymi modelu: literał `/* lex:dane *\/` zastąpiony danymi, pasek IO aplikacji. */
export function withWidgetData(spec, data, skill) {
    const serialized = JSON.stringify(data ?? null);
    if (serialized === undefined || serialized.length > MAX_WIDGET_DATA)
        throw new WidgetError("WIDGET_DATA_TOO_LARGE");
    const mark = DATA_SLOT.exec(spec.code);
    if (!mark)
        throw new WidgetError("WIDGET_TEMPLATE_HAS_NO_DATA_SLOT");
    const start = mark.index + mark[0].length;
    const end = literalEnd(spec.code, start);
    if (end < 0)
        throw new WidgetError("WIDGET_TEMPLATE_DATA_SLOT_INVALID");
    const boot = `<script>window.__lexDefault=${scriptJson(data)};try{if(window.name.indexOf("lexdata:")===0)window.__lexData=JSON.parse(window.name.slice(8));}catch(e){}</script>`;
    const code = `${spec.code.slice(0, start)}(window.__lexData||window.__lexDefault)${spec.code.slice(end)}`;
    if (spec.kind !== "html")
        return code;
    // A template with its own MOD-WIDGET-IO functions keeps its bar (it exports the full state).
    const bar = /function\s+ioExportJSON\b/u.test(code) ? boot : boot + ioBar(skill);
    return /<body[^>]*>/iu.test(code) ? code.replace(/<body[^>]*>/iu, (tag) => tag + bar) : bar + code;
}
const require = createRequire(import.meta.url);
let preactBundle = null;
function preactScripts() {
    // Pliki UMD nie są w "exports" pakietu: katalog pakietu z głównego wejścia (dist/).
    const root = path.dirname(path.dirname(require.resolve("preact")));
    preactBundle ??= ["dist/preact.umd.js", "hooks/dist/hooks.umd.js", "compat/dist/compat.umd.js"]
        .map((entry) => readFileSync(path.join(root, entry), "utf8"))
        .join("\n;\n");
    return preactBundle;
}
function inlineScript(code) {
    return `<script>${code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--")}</script>`;
}
// Most do aplikacji: sendPrompt oraz zapis plików (Blob/data URL z <a download>).
function bridgeScript(widgetId) {
    return `(function(){
var ID=${JSON.stringify(widgetId)};
function post(m){m.lexWidget=ID;parent.postMessage(m,"*");}
window.sendPrompt=function(t){post({type:"prompt",text:String(t).slice(0,20000)});};
var blobs={};var create=URL.createObjectURL;
URL.createObjectURL=function(b){var u=create.call(URL,b);blobs[u]=b;return u;};
function save(a){
  var href=a.getAttribute("href")||"";var name=a.getAttribute("download")||"widget.txt";
  var blob=blobs[href];
  if(!blob&&href.indexOf("data:")===0){
    var comma=href.indexOf(",");var meta=href.slice(5,comma);var body=href.slice(comma+1);
    var bin=meta.indexOf(";base64")>=0?atob(body):unescape(encodeURIComponent(decodeURIComponent(body)));
    var bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    blob=new Blob([bytes],{type:meta.split(";")[0]});
  }
  if(!blob)return false;
  var r=new FileReader();r.onload=function(){post({type:"save",filename:name,base64:String(r.result).replace(/^data:[^,]*,/,"")});};
  r.readAsDataURL(blob);return true;
}
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[download]");if(a&&save(a))e.preventDefault();},true);
var click=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute("download")&&save(this))return;return click.call(this);};
function size(){post({type:"size",height:Math.ceil(document.documentElement.scrollHeight)});}
window.addEventListener("load",size);new ResizeObserver(size).observe(document.documentElement);
window.addEventListener("error",function(e){post({type:"error",message:String(e.message||e)});});
})();`;
}
const JSX_RUNTIME = `(function(){
var h=preact.h,Fragment=preact.Fragment,React=preactCompat,ReactDOM=preactCompat;
var useState=preactHooks.useState,useEffect=preactHooks.useEffect,useRef=preactHooks.useRef,useMemo=preactHooks.useMemo,
useCallback=preactHooks.useCallback,useReducer=preactHooks.useReducer,useContext=preactHooks.useContext,useLayoutEffect=preactHooks.useLayoutEffect;
var module={exports:{}},exports=module.exports;
function require(n){
  if(n==="react"||n==="react-dom"||n==="react-dom/client"||n==="preact/compat"||n==="react/jsx-runtime")return preactCompat;
  if(n==="preact")return preact;if(n==="preact/hooks")return preactHooks;
  throw new Error("Widget: biblioteka "+n+" nie jest dostępna w Lex Machina");
}
__WIDGET_CODE__
var C=module.exports.default||exports.default||(typeof App!=="undefined"?App:null);
if(!C)throw new Error("Widget nie eksportuje komponentu (export default).");
preact.render(h(C,null),document.getElementById("root"));
})();`;
// Dokument ramki: HTML widgetu z mostem albo komponent JSX skompilowany do Preact.
export function compileWidget(spec, widgetId) {
    const bridge = inlineScript(bridgeScript(widgetId));
    const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${bridge}`;
    if (spec.kind === "html") {
        if (/<head[^>]*>/i.test(spec.code))
            return spec.code.replace(/<head[^>]*>/i, (tag) => tag + head);
        if (/<html[^>]*>/i.test(spec.code))
            return spec.code.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
        return `<!doctype html><html lang="pl"><head>${head}</head><body>${spec.code}</body></html>`;
    }
    let compiled;
    try {
        compiled = transform(spec.code, {
            transforms: ["jsx", "typescript", "imports"],
            jsxPragma: "h",
            jsxFragmentPragma: "Fragment",
            production: true
        }).code;
    }
    catch (error) {
        throw new WidgetError(`WIDGET_COMPILE_FAILED:${error instanceof Error ? error.message.slice(0, 200) : "?"}`);
    }
    return `<!doctype html><html lang="pl"><head>${head}<style>body{margin:0;font-family:system-ui,sans-serif}</style></head>` +
        `<body><div id="root"></div>${inlineScript(preactScripts())}${inlineScript(JSX_RUNTIME.replace("__WIDGET_CODE__", () => compiled))}</body></html>`;
}
// Skompilowane ramki w pamięci runtime: identyfikator losowy (128 bitów), 2 h ważności.
export class WidgetFrameStore {
    now;
    frames = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    register(ownerId, value) {
        const spec = validateWidgetSpec(value);
        const widgetId = randomBytes(16).toString("hex");
        const html = compileWidget(spec, widgetId);
        this.prune();
        this.frames.set(widgetId, { html, ownerId, expiresAt: this.now() + 2 * 60 * 60 * 1000 });
        return widgetId;
    }
    frame(widgetId) {
        if (!/^[0-9a-f]{32}$/.test(widgetId))
            return null;
        const stored = this.frames.get(widgetId);
        if (!stored || stored.expiresAt < this.now())
            return null;
        return stored.html;
    }
    prune() {
        const now = this.now();
        for (const [id, stored] of this.frames)
            if (stored.expiresAt < now)
                this.frames.delete(id);
        while (this.frames.size >= 200)
            this.frames.delete(this.frames.keys().next().value);
    }
}
const SHOW_WIDGET = "show_widget";
const SHOW_WIDGET_SCHEMA = {
    type: "function",
    function: {
        name: SHOW_WIDGET,
        description: "Show an interactive widget to the user in the chat (host implementation of show_widget). " +
            "Give either `path` of a widget file in the skill corpus (e.g. audyt-systemu-v4/widgets/WIDGET-MENU.md, " +
            "chronologia-sprawy-v1/assets/widget-timeline.html) or your own `code` with `kind` html or jsx (React component with export default). " +
            "The widget runs offline in an isolated frame: no network, no external scripts or styles; window.sendPrompt(text) sends text as the user's next message.",
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: {
                title: { type: "string", description: "Short widget title shown in the chat" },
                path: { type: "string", description: "Widget file in the skill corpus" },
                kind: { type: "string", enum: ["html", "jsx"] },
                code: { type: "string", description: "Widget code when not using a corpus file" },
                data: {
                    type: "object",
                    description: "Case data for a corpus template with a /* lex:dane */ slot (same shape as the template's sample literal). " +
                        "The application inserts it and adds the export/import bar; do not send code for such a template."
                }
            }
        }
    }
};
export class WidgetToolRuntime {
    registry;
    shown = [];
    constructor(registry) {
        this.registry = registry;
    }
    schemas() {
        return [SHOW_WIDGET_SCHEMA];
    }
    handles(name) {
        return name === SHOW_WIDGET;
    }
    systemPromptAppendix() {
        return [
            "# WIDGETS (show_widget)",
            "This host supports show_widget through the show_widget tool. When a skill instructs you to render a widget, call it with the widget file path from the corpus, or with your own HTML/JSX code.",
            "The widget appears in the chat under your answer; do not paste its code into the answer. Widgets run offline (no network, no CDN): use inline styles, no external libraries other than React hooks.",
            "A corpus template whose sample data literal is marked /* lex:dane */ takes only `path` and `data`: the application inserts the data and adds the export/import bar (MOD-WIDGET-IO) itself. Never rewrite such a template as `code`.",
            "Never put information into a widget that is not in the case material or verified sources; legal-source rules apply to widget content as to the answer."
        ].join("\n");
    }
    widgets() {
        return this.shown.map((widget) => ({ ...widget }));
    }
    async runTools(calls) {
        return calls.map((call) => {
            try {
                const spec = this.resolve(call.input);
                // Kompilacja na próbę: błąd składni JSX wraca do modelu, nie do użytkownika.
                compileWidget(spec, "0".repeat(32));
                if (this.shown.length >= MAX_WIDGETS_PER_ANSWER)
                    throw new WidgetError("WIDGET_LIMIT_REACHED");
                this.shown.push(spec);
                return {
                    tool_use_id: call.id,
                    content: JSON.stringify({
                        status: "SHOWN",
                        title: spec.title,
                        ...(spec.source ? { source: spec.source } : {}),
                        note: "The widget is displayed to the user under your answer. Continue with a short answer; do not repeat the widget code."
                    })
                };
            }
            catch (error) {
                return {
                    tool_use_id: call.id,
                    content: JSON.stringify({
                        status: "BLOCKED",
                        error: error instanceof WidgetError ? error.code : "WIDGET_FAILED"
                    })
                };
            }
        });
    }
    resolve(input) {
        const title = typeof input.title === "string" ? input.title : "";
        if (typeof input.path === "string" && input.path.trim()) {
            const relative = input.path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
            const skill = relative.split("/", 1)[0] ?? "";
            let file = null;
            try {
                file = this.registry.resolveResource(skill, relative);
            }
            catch {
                file = null;
            }
            if (!file || !statSync(file).isFile())
                throw new WidgetError("WIDGET_FILE_NOT_FOUND");
            if (statSync(file).size > MAX_WIDGET_CODE)
                throw new WidgetError("WIDGET_CODE_TOO_LARGE");
            const widget = widgetFromFile(file, readFileSync(file, "utf8"));
            const code = input.data !== undefined ? withWidgetData(widget, input.data, skill) : widget.code;
            return validateWidgetSpec({ title, kind: widget.kind, code, source: relative });
        }
        return validateWidgetSpec({ title, kind: input.kind, code: input.code });
    }
}
