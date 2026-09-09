import { mkdir, writeFile } from "node:fs/promises";

const SOURCE_URL = "https://6a5cd3a1187ccdd1d63f28de--soft-sprinkles-e38939.netlify.app/";

const response = await fetch(SOURCE_URL, { cache: "no-store" });
if (!response.ok) throw new Error(`Unable to fetch base site: HTTP ${response.status}`);
let html = await response.text();

function replaceOne(pattern, replacement, label) {
  const before = html;
  html = html.replace(pattern, replacement);
  if (html === before) throw new Error(`Build patch failed: ${label}`);
}

replaceOne(
  /<div id="setupModal" class="modal hidden">[\s\S]*?<div id="toast" class="toast"><\/div>/,
  `<div id="setupModal" class="modal hidden"><div class="modal-card"><h3>多人跨電腦連線</h3><p class="hint">目前已啟用 Netlify 雲端多人同步。主持人建立房間後，不同電腦與手機可使用同一個四位房號加入；玩家、關卡、計時與答題狀態會同步更新。</p><button id="closeSetupBtn" class="btn btn-primary" style="width:100%">了解</button></div></div>\n<div id="toast" class="toast"></div>`,
  "multiplayer setup modal"
);

replaceOne(
  /const FIREBASE_CONFIG=\{apiKey:"",authDomain:"",databaseURL:"",projectId:"",appId:""\};/,
  `const MULTIPLAYER_API="/api/game-room";`,
  "backend config"
);

replaceOne(
  /function connectionOnline\(\)\{return Boolean\(FIREBASE_CONFIG\.apiKey&&FIREBASE_CONFIG\.databaseURL\)\}/,
  `function connectionOnline(){return true}`,
  "connection status"
);

replaceOne(
  /  class FirebaseBackend\{[\s\S]*?\n  async function initBackend\(\)\{[^\n]*\}/,
  `  class NetlifyBackend{\n    async request(method,payload=null,code=null){\n      const url=code?\`${'${MULTIPLAYER_API}'}?code=${'${encodeURIComponent(code)}'}&_=${'${Date.now()}'}\`:MULTIPLAYER_API;\n      const opt={method,headers:{"cache-control":"no-store"}};\n      if(payload){opt.headers["content-type"]="application/json";opt.body=JSON.stringify(payload)}\n      const r=await fetch(url,opt);\n      const d=await r.json().catch(()=>({}));\n      if(!r.ok)throw new Error(d.message||d.error||\`HTTP ${'${r.status}'}\`);\n      return d\n    }\n    async createRoom(c,v){await this.request("POST",{action:"createRoom",code:c,room:v})}\n    subscribe(c,cb){let dead=false,last="";const poll=async()=>{if(dead)return;try{const d=await this.request("GET",null,c);const sig=JSON.stringify(d.room||null);if(sig!==last){last=sig;cb(d.room||null)}}catch(e){console.warn("同步讀取失敗",e)}finally{if(!dead)setTimeout(poll,900)}};poll();return()=>{dead=true}}\n    async setPath(c,p,v){const d=await this.request("POST",{action:"setPath",code:c,path:p,value:v});return d.room}\n    async update(c,u){const d=await this.request("POST",{action:"update",code:c,updates:u});return d.room}\n    async exists(c){const d=await this.request("GET",null,c);return Boolean(d.exists)}\n    async getRoom(c){const d=await this.request("GET",null,c);return d.room||null}\n    async claimJoinIndex(c,max){const d=await this.request("POST",{action:"claimJoinIndex",code:c,max});return Number(d.index)}\n    async pressRelay(c,t,o,size){const d=await this.request("POST",{action:"pressRelay",code:c,teamId:t,order:o,teamSize:size});return d.state}\n  }\n  async function initBackend(){try{const b=new NetlifyBackend();await b.request("GET",null,"0000");appState.backend=b;$("connectionStatus").textContent="多人即時連線";$("connectionStatus").classList.add("online")}catch(e){console.error(e);appState.backend=new LocalBackend();$("connectionStatus").textContent="本機備援模式";toast("多人連線暫時不可用，已切換本機模式")}}`,
  "Netlify backend"
);

await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", html, "utf8");
console.log("Built multiplayer index.html");
