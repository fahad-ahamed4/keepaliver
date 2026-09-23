const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store"
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepAlive Manager</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#f4f7fb;color:#172033}
.wrap{max-width:1000px;margin:auto;padding:28px 18px}
.hero{background:#111827;color:#fff;border-radius:20px;padding:26px;margin-bottom:18px}
h1{margin:0 0 8px;font-size:30px}.muted{color:#667085}.hero .muted{color:#cbd5e1}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:14px 0;box-shadow:0 5px 20px #1018280a}
form{display:flex;gap:10px}input{flex:1;min-width:0;padding:13px 14px;border:1px solid #d0d5dd;border-radius:10px;font-size:15px}
button{border:0;border-radius:10px;padding:12px 15px;background:#111827;color:#fff;cursor:pointer}
button.secondary{background:#eef2f6;color:#172033}.danger{background:#b42318}
.site{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}
.url{font-weight:700;word-break:break-all}.online{color:#067647}.offline{color:#b42318}
.meta{font-size:13px;color:#667085;margin-top:7px;line-height:1.6}.actions{display:flex;gap:7px;flex-wrap:wrap}
.empty{text-align:center;padding:30px;color:#667085}
@media(max-width:650px){form{flex-direction:column}.site{grid-template-columns:1fr}.actions button{flex:1}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>⚡ KeepAlive Manager</h1>
    <div class="muted">Cloudflare Worker URL monitor and periodic wake-up requester.</div>
  </div>

  <div class="card">
    <form id="addForm">
      <input id="url" type="url" placeholder="https://your-site.example" required>
      <button type="submit">Add website</button>
    </form>
  </div>

  <div id="list"></div>
</div>

<script>
const list = document.getElementById("list");
const input = document.getElementById("url");

function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function api(url, options={}){
  const r=await fetch(url,options);
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}

async function load(){
  const sites=await api("/api/sites");
  if(!sites.length){
    list.innerHTML='<div class="card empty">No websites added yet.</div>';
    return;
  }

  list.innerHTML=sites.map(s=>{
    const pct=s.checks ? Math.round((s.success||0)/s.checks*100) : 0;
    const state=s.ok
      ? '<span class="online">● ONLINE</span>'
      : '<span class="offline">● OFFLINE</span>';

    return '<div class="card site">'+
      '<div>'+
        '<div class="url">'+esc(s.url)+'</div>'+
        '<div>'+state+' · HTTP '+esc(s.lastStatus||"—")+
        ' · '+esc(s.lastResponseMs||"—")+' ms</div>'+
        '<div class="meta">Last check: '+esc(s.lastCheck||"—")+
        '<br>Checks: '+s.checks+' · Success: '+pct+'%'+
        '</div>'+
      '</div>'+
      '<div class="actions">'+
        '<button class="secondary" onclick="checkSite(\\''+s.id+'\\')">Check now</button>'+
        '<button class="danger" onclick="deleteSite(\\''+s.id+'\\')">Delete</button>'+
      '</div>'+
    '</div>';
  }).join("");
}

document.getElementById("addForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/sites",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({url:input.value.trim()})
    });
    input.value="";
    await load();
  }catch(e){alert(e.message)}
});

async function checkSite(id){
  try{await api("/api/sites/"+id+"/check",{method:"POST"});await load()}
  catch(e){alert(e.message)}
}

async function deleteSite(id){
  if(!confirm("Delete this website?")) return;
  try{await api("/api/sites/"+id,{method:"DELETE"});await load()}
  catch(e){alert(e.message)}
}

load();
setInterval(load,30000);
</script>
</body>
</html>`;

async function getSites(env) {
  return JSON.parse((await env.SITES.get("sites")) || "[]");
}

async function saveSites(env, sites) {
  await env.SITES.put("sites", JSON.stringify(sites));
}

function validUrl(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

async function checkSite(site) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(site.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Cloudflare-KeepAlive-Manager/1.0"
      }
    });

    clearTimeout(timeout);

    site.lastStatus = response.status;
    site.ok = response.ok;
  } catch {
    site.lastStatus = 0;
    site.ok = false;
  }

  site.lastResponseMs = Date.now() - started;
  site.lastCheck = new Date().toISOString();
  site.checks = (site.checks || 0) + 1;

  if (site.ok) site.success = (site.success || 0) + 1;
  else site.fail = (site.fail || 0) + 1;

  return site;
}

async function checkAll(env) {
  const sites = await getSites(env);

  // Keep batches small to avoid creating an excessive number of simultaneous requests.
  for (let i = 0; i < sites.length; i += 10) {
    const batch = sites.slice(i, i + 10);
    await Promise.all(batch.map(checkSite));
  }

  await saveSites(env, sites);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }

    if (url.pathname === "/api/sites" && request.method === "GET") {
      return Response.json(await getSites(env), { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/sites" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch { return Response.json({error:"Invalid JSON"}, {status:400,headers:JSON_HEADERS}); }

      const siteUrl = validUrl(String(body.url || "").trim());
      if (!siteUrl) {
        return Response.json({error:"Enter a valid http:// or https:// URL."},{status:400,headers:JSON_HEADERS});
      }

      const sites = await getSites(env);

      if (sites.some(s => s.url === siteUrl)) {
        return Response.json({error:"This website is already added."},{status:409,headers:JSON_HEADERS});
      }

      const site = {
        id: crypto.randomUUID(),
        url: siteUrl,
        addedAt: new Date().toISOString(),
        checks: 0,
        success: 0,
        fail: 0
      };

      await checkSite(site);
      sites.push(site);
      await saveSites(env, sites);

      return Response.json(site, {headers:JSON_HEADERS});
    }

    const match = url.pathname.match(/^\\/api\\/sites\\/([^/]+)$/);
    if (match && request.method === "DELETE") {
      const sites = await getSites(env);
      const filtered = sites.filter(s => s.id !== match[1]);
      await saveSites(env, filtered);
      return Response.json({ok:true},{headers:JSON_HEADERS});
    }

    const checkMatch = url.pathname.match(/^\\/api\\/sites\\/([^/]+)\\/check$/);
    if (checkMatch && request.method === "POST") {
      const sites = await getSites(env);
      const site = sites.find(s => s.id === checkMatch[1]);

      if (!site) {
        return Response.json({error:"Website not found."},{status:404,headers:JSON_HEADERS});
      }

      await checkSite(site);
      await saveSites(env, sites);

      return Response.json(site,{headers:JSON_HEADERS});
    }

    return new Response("Not Found", {status:404});
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(checkAll(env));
  }
};
