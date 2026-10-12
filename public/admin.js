const $ = id => document.getElementById(id);
let settingsCache = {};
let toastTimer;
function toast(message) { const el=$("toast"); el.textContent=message; el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,3500); }
async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({error:"Server response पढ़ नहीं पाया"}));
  if (res.status === 401) { showLogin(); throw new Error(data.error || "Login required"); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function showLogin() { $("loginPanel").hidden=false; $("dashboard").hidden=true; $("logoutBtn").hidden=true; }
function showDashboard() { $("loginPanel").hidden=true; $("dashboard").hidden=false; $("logoutBtn").hidden=false; }
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginError").textContent="";
  const fd=new FormData(e.target);
  try { await api("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd))}); showDashboard(); await loadAll(); }
  catch(err){ $("loginError").textContent=err.message; }
});
$("logoutBtn").addEventListener("click", async()=>{try{await api("/api/admin/logout",{method:"POST"});}catch{} showLogin();});
async function loadStats(){
  const s=await api("/api/admin/stats");
  $("statVisitors").textContent=s.visitors;$("statSubmissions").textContent=s.submissions;$("statYes").textContent=s.consentYes;$("statNo").textContent=s.consentNo;$("statPhotos").textContent=s.photos;
}
async function loadSettings(){
  settingsCache=await api("/api/admin/settings");
  const form=$("settingsForm");
  for(const [key,value] of Object.entries(settingsCache)){if(form.elements[key])form.elements[key].value=value;}
  $("previewBanner").src=settingsCache.bannerImage;
  $("previewManifesto").src=settingsCache.manifestoImage;
  $("previewBackground").src=settingsCache.backgroundImage;
}
$("settingsForm").addEventListener("submit",async e=>{
  e.preventDefault(); const data=Object.fromEntries(new FormData(e.target));
  try{await api("/api/admin/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});$("settingsStatus").textContent="Saved ✓";toast("सभी text और links save हो गए।");setTimeout(()=>$("settingsStatus").textContent="",3000);}
  catch(err){toast(err.message);}
});
document.querySelectorAll(".upload-image").forEach(btn=>btn.addEventListener("click",async()=>{
  const kind=btn.dataset.image;const input=$(kind+"File");if(!input.files[0]){toast("पहले image चुनें।");return;}
  const fd=new FormData();fd.append("image",input.files[0]);btn.disabled=true;btn.textContent="Uploading…";
  try{const result=await api("/api/admin/image/"+kind,{method:"POST",body:fd});const preview=$(kind==="banner"?"previewBanner":kind==="manifesto"?"previewManifesto":"previewBackground");preview.src=result.url;toast("Image successfully update हो गई।");input.value="";}
  catch(err){toast(err.message);}finally{btn.disabled=false;btn.textContent=kind==="banner"?"Banner upload":kind==="manifesto"?"Manifesto upload":"Background upload";}
}));
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function recordHtml(r){
  const photos=(r.photos||[]).map(p=>`<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(p.url)}" alt="Uploaded issue photo" loading="lazy"></a>`).join("");
  return `<article class="record"><div class="record-top"><div><h3>#${r.id} · ${escapeHtml(r.name)}</h3><div class="record-meta">📱 ${escapeHtml(r.mobile)}</div></div><div><time>${escapeHtml(r.created_at)}</time><br><span class="consent-badge ${r.consent?'':'no'}">${r.consent?'Consent: हाँ':'Consent: नहीं'}</span></div></div><p><strong>समस्या:</strong> ${escapeHtml(r.short_issue)}</p><p><strong>विस्तार:</strong> ${escapeHtml(r.details)}</p>${photos?`<div class="record-photos">${photos}</div>`:'<p class="muted">कोई फोटो अपलोड नहीं की गई।</p>'}</article>`;
}
async function loadRecords(){
  const q=$("searchInput").value.trim();
  const rows=await api("/api/admin/submissions"+(q?"?q="+encodeURIComponent(q):""));
  $("recordsCount").textContent=`${rows.length} record दिख रहे हैं (अधिकतम 500)।`;
  $("records").innerHTML=rows.length?rows.map(recordHtml).join(""):'<div class="record">अभी कोई submission नहीं है।</div>';
}
async function loadAll(){try{await Promise.all([loadStats(),loadSettings(),loadRecords()]);}catch(err){toast(err.message);}}
$("searchBtn").addEventListener("click",()=>loadRecords().catch(e=>toast(e.message)));
$("refreshBtn").addEventListener("click",()=>loadAll());
$("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();loadRecords().catch(err=>toast(err.message));}});
(async()=>{try{await loadStats();showDashboard();await loadAll();}catch{showLogin();}})();
