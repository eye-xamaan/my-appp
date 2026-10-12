const $ = (id) => document.getElementById(id);
const form = $("issueForm");
let currentSettings = {};
const visitorKey = "sawantgarh_visitor_id";
function visitorId() {
  let id = sessionStorage.getItem(visitorKey);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : "v_" + Math.random().toString(36).slice(2) + Date.now()).replace(/[^a-zA-Z0-9_-]/g,"");
    sessionStorage.setItem(visitorKey, id);
  }
  return id;
}
fetch("/api/visit", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({visitorId:visitorId()})}).catch(()=>{});
function setText(id, value) { if ($(id) && value != null) $(id).textContent = value; }
function setLink(id, value) { if ($(id) && value) $(id).href = value; }
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    currentSettings = await res.json();
    setText("siteTitle", currentSettings.siteTitle);
    $("bannerImage").src = currentSettings.bannerImage;
    $("manifestoImage").src = currentSettings.manifestoImage;
    document.querySelector(".ambient-bg").style.backgroundImage = `linear-gradient(135deg,#f7f0dcdd,#f8fbf5e8 45%,#e7efffe8),url("${currentSettings.backgroundImage}")`;
    const slogan = currentSettings.slogan || "";
    setText("sloganOne", slogan + "  ✦  ");
    setText("sloganTwo", slogan + "  ✦  ");
    setText("socialLine", currentSettings.socialLine);
    setText("formHeading", currentSettings.formHeading);
    $("details").placeholder = currentSettings.detailPlaceholder || "";
    setText("consentText", currentSettings.consentText);
    setText("manifestoHeading", currentSettings.manifestoHeading);
    setText("proposer", currentSettings.proposer);
    setText("proposerTitle", currentSettings.proposerTitle);
    setText("helpline", currentSettings.helpline);
    $("helpline").href = "tel:" + (currentSettings.helpline || "").replace(/[^\d+]/g,"");
    setLink("whatsappTop", currentSettings.whatsappUrl);
    setLink("instagramTop", currentSettings.instagramUrl);
    setLink("whatsappFooter", currentSettings.whatsappUrl);
    setLink("instagramFooter", currentSettings.instagramUrl);
    $("thankMessage").textContent = currentSettings.thankYouText;
    document.title = currentSettings.siteTitle + " | सुझाव और शिकायत";
  } catch (e) { console.error("Settings could not load", e); }
}
loadSettings();
// Keep already-open pages reasonably fresh after admin edits, without a server restart.
setInterval(loadSettings, 30000);

let selectedPhotos = [];
function renderPhotos() {
  $("fileList").textContent = selectedPhotos.length ? selectedPhotos.map(f => `${f.name} (${(f.size/1024/1024).toFixed(1)} MB)`).join(" • ") : "कोई फोटो नहीं चुनी गई (अधिकतम 5)";
}
function addPhotos(files) {
  const incoming = [...files], merged = [...selectedPhotos];
  for (const file of incoming) {
    if (!file.type.startsWith("image/")) continue;
    if (merged.length >= 5) break;
    if (!merged.some(x => x.name === file.name && x.size === file.size && x.lastModified === file.lastModified)) merged.push(file);
  }
  if (incoming.length + selectedPhotos.length > 5) $("formStatus").textContent = "अधिकतम 5 फोटो चुन सकते हैं।";
  selectedPhotos = merged.slice(0,5); renderPhotos();
}
$("openCamera").addEventListener("click", () => $("cameraInput").click());
$("openGallery").addEventListener("click", () => $("photos").click());
$("cameraInput").addEventListener("change", () => { addPhotos($("cameraInput").files); $("cameraInput").value = ""; });
$("photos").addEventListener("change", () => { addPhotos($("photos").files); $("photos").value = ""; });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("formStatus");
  const button = $("submitButton");
  const selected = selectedPhotos;
  if (selected.length > 5) { status.textContent = "अधिकतम 5 फोटो चुनें।"; return; }
  if (selected.some(f => f.size > 25 * 1024 * 1024)) { status.textContent = "हर फोटो 25 MB से छोटी होनी चाहिए।"; return; }
  const data = new FormData(form); data.delete("photos"); selected.forEach(file => data.append("photos", file, file.name));
  data.set("consent", $("consent").checked ? "on" : "off");
  button.disabled = true; button.querySelector("span").textContent = "जमा हो रहा है…"; status.textContent = "";
  try {
    const response = await fetch("/api/submit", {method:"POST", body:data});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "फॉर्म जमा नहीं हो पाया।");
    form.reset(); selectedPhotos = []; renderPhotos();
    $("thankMessage").textContent = result.message || currentSettings.thankYouText;
    $("thankModal").hidden = false;
  } catch (err) { status.textContent = err.message || "नेटवर्क की समस्या है। दोबारा कोशिश करें।"; }
  finally { button.disabled = false; button.querySelector("span").textContent = "जमा करें"; }
});
$("closeModal").addEventListener("click", () => $("thankModal").hidden = true);
$("thankModal").addEventListener("click", e => { if (e.target === $("thankModal")) $("thankModal").hidden = true; });
$("manifestoImage").addEventListener("click", () => { $("zoomImage").src = $("manifestoImage").src; $("imageModal").hidden = false; });
$("closeImage").addEventListener("click", () => $("imageModal").hidden = true);
$("imageModal").addEventListener("click", e => { if (e.target === $("imageModal")) $("imageModal").hidden = true; });
