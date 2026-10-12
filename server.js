require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const multer = require("multer");
const { google } = require("googleapis");
const { Readable } = require("stream");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(PUBLIC, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const DB_PATH = path.join(DATA, "website.sqlite");
let Database;
try { Database = require("better-sqlite3"); } catch (e) {
  // Install dynamically declared dependency fallback message
  console.error("Missing SQLite driver. Add better-sqlite3 to package.json and run npm install.");
  process.exit(1);
}
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  short_issue TEXT NOT NULL,
  details TEXT NOT NULL,
  photos_json TEXT NOT NULL DEFAULT '[]',
  consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visits (
  visitor_id TEXT PRIMARY KEY,
  visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
const defaults = {
  siteTitle: "ग्राम पंचायत सांवतगढ़",
  slogan: "स्वच्छ सांवतगढ़, स्वस्थ सांवतगढ़ | हर घर शुद्ध जल, हर खेत को पानी | पक्की सड़कें, सुरक्षित आवागमन",
  socialLine: "पंचायत के हर अपडेट और विकास कार्यों से जुड़े रहने के लिए हमारे व्हाट्सएप और इंस्टाग्राम से जरूर जुड़ें!",
  formHeading: "सांवतगढ़ के विकास हेतु अपनी शिकायत / सुझाव दर्ज करें",
  detailPlaceholder: "विस्तार से बताएं कि कौनसी जगह क्या समस्या है, और सबसे पहले क्या काम सुनिश्चित होना चाहिए?",
  consentText: "हाँ, मैं श्रीमती जनता देवी (निवेदक जगफूल सिंह मीणा) को ग्राम पंचायत सांवतगढ़ के सरपंच पद एवं गाँव के विकास के लिए चुनता/चुनती हूँ।",
  manifestoHeading: "हमारे संकल्प और प्राथमिकताएँ",
  thankYouText: "शुक्रिया! अपना कीमती वोट देके जनता देवी को सरपंच पद हेतु विजयी बनायें।",
  proposer: "जगफूल सिंह मीणा",
  proposerTitle: "सेवानिवृत्त सीनियर नर्सिंग ऑफिसर, ग्रेड प्रथम",
  helpline: "7976099557",
  whatsappUrl: process.env.WHATSAPP_URL || "https://wa.me/",
  instagramUrl: process.env.INSTAGRAM_URL || "https://instagram.com/",
  bannerImage: "/assets/banner-candidate.jpg",
  manifestoImage: "/assets/manifesto-19-points.jpg",
  backgroundImage: "/assets/reference-mockup.jpg"
};
const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key=?");
const setSettingStmt = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
for (const [key, value] of Object.entries(defaults)) {
  if (!getSettingStmt.get(key)) setSettingStmt.run(key, String(value));
}
function allSettings() {
  return Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(r => [r.key, r.value]));
}
function publicSettings() {
  const s = allSettings();
  // Only known public keys are returned.
  return Object.fromEntries(Object.keys(defaults).map(k => [k, s[k] ?? defaults[k]]));
}
function safeJson(value, fallback=[]) {
  try { return JSON.parse(value); } catch { return fallback; }
}

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(session({
  name: "sawant_admin",
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(PUBLIC, { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) return cb(new Error("केवल JPG, PNG, WebP या HEIC फोटो अपलोड करें।"));
    cb(null, true);
  }
});
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "कृपया पहले admin login करें।" });
}
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });

function imageExtension(mimetype) {
  const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif" };
  return extensions[mimetype] || null;
}
async function optimizePhoto(file, index) {
  // Termux-compatible fallback: preserve the original image bytes and extension.
  // No native image library is required; uploads still work without resizing/re-encoding.
  const ext = imageExtension(file.mimetype);
  if (!ext) throw new Error("Unsupported image type");
  const base = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${index}${ext}`;
  const output = path.join(UPLOADS, base);
  fs.writeFileSync(output, file.buffer, { flag: "wx" });
  return { url: `/uploads/${base}`, name: file.originalname.slice(0, 180), size: fs.statSync(output).size, mimetype: file.mimetype };
}
async function telegramNotify(submission) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const photos = safeJson(submission.photos_json);
  const text = `नई शिकायत / सुझाव #${submission.id}\nनाम: ${submission.name}\nमोबाइल: ${submission.mobile}\nसमस्या: ${submission.short_issue}\nविस्तार: ${submission.details}\nConsent: ${submission.consent ? "हाँ" : "नहीं"}\nसमय: ${submission.created_at}\nफोटो: ${photos.length}`;
  try {
    const messageResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!messageResponse.ok) console.error("Telegram sendMessage failed:", await messageResponse.text());
    for (const photo of photos) {
      const localPath = path.join(PUBLIC, String(photo.url || "").replace(/^\/+/, ""));
      if (!localPath.startsWith(UPLOADS + path.sep) || !fs.existsSync(localPath)) continue;
      const blob = new Blob([fs.readFileSync(localPath)], { type: photo.mimetype || "image/jpeg" });
      const form = new FormData(); form.append("chat_id", chatId);
      form.append("photo", blob, path.basename(localPath));
      form.append("caption", `शिकायत #${submission.id} • ${submission.name} • ${photo.name || path.basename(localPath)}`);
      const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method:"POST", body:form });
      if (!response.ok) console.error("Telegram sendPhoto failed:", await response.text());
    }
  } catch (err) { console.error("Telegram notification failed:", err.message); }
}
async function driveBackup(photos = []) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!json || !folderId) return;
  let temp = null;
  try {
    const credentials = JSON.parse(json);
    const auth = new google.auth.GoogleAuth({
      credentials, scopes: ["https://www.googleapis.com/auth/drive.file"]
    });
    const drive = google.drive({ version: "v3", auth });
    db.pragma("wal_checkpoint(FULL)");
    temp = path.join(DATA, `backup-${Date.now()}.sqlite`);
    fs.copyFileSync(DB_PATH, temp);
    await drive.files.create({
      requestBody: { name: `sawantgarh-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`, parents: [folderId] },
      media: { mimeType: "application/x-sqlite3", body: fs.createReadStream(temp) },
      fields: "id,name"
    });
    // Also back up submitted images, because the database stores their local URLs.
    for (const photo of photos) {
      const localPath = path.join(PUBLIC, String(photo.url || "").replace(/^\/+/, ""));
      if (localPath.startsWith(UPLOADS + path.sep) && fs.existsSync(localPath)) {
        await drive.files.create({
          requestBody: { name: `submission-photo-${Date.now()}-${path.basename(localPath)}`, parents: [folderId] },
          media: { mimeType: photo.mimetype || ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif" }[path.extname(localPath).toLowerCase()] || "application/octet-stream"), body: fs.createReadStream(localPath) },
          fields: "id,name"
        });
      }
    }
  } catch (err) {
    console.error("Google Drive backup failed:", err.message);
  } finally {
    if (temp) try { fs.unlinkSync(temp); } catch {}
  }
}

app.get("/api/settings", (req, res) => res.json(publicSettings()));
app.post("/api/visit", (req, res) => {
  const raw = String(req.body && req.body.visitorId || "");
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(raw)) return res.status(400).json({ error: "Invalid visitor ID" });
  db.prepare("INSERT OR IGNORE INTO visits(visitor_id) VALUES(?)").run(raw);
  res.json({ ok: true });
});

app.post("/api/submit", submitLimiter, upload.array("photos", 5), async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 120);
  const mobile = String(req.body.mobile || "").replace(/[^\d+ -]/g, "").trim().slice(0, 25);
  const shortIssue = String(req.body.shortIssue || "").trim().slice(0, 240);
  const details = String(req.body.details || "").trim().slice(0, 5000);
  const consent = req.body.consent === "on" || req.body.consent === "true" || req.body.consent === "1" ? 1 : 0;
  if (!name || !mobile || !shortIssue || !details) return res.status(400).json({ error: "कृपया नाम, मोबाइल नंबर, समस्या और विस्तार भरें।" });
  if (mobile.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "कृपया सही मोबाइल नंबर दर्ज करें।" });
  const files = req.files || [];
  if (files.length > 5) return res.status(400).json({ error: "अधिकतम 5 फोटो अपलोड कर सकते हैं।" });
  let photos = [];
  try {
    for (let i = 0; i < files.length; i++) photos.push(await optimizePhoto(files[i], i));
    const result = db.prepare(`
      INSERT INTO submissions(name,mobile,short_issue,details,photos_json,consent)
      VALUES(?,?,?,?,?,?)
    `).run(name, mobile, shortIssue, details, JSON.stringify(photos), consent);
    const row = db.prepare("SELECT * FROM submissions WHERE id=?").get(result.lastInsertRowid);
    // Notifications and backups run after the durable SQLite insert.
    setImmediate(() => { Promise.allSettled([telegramNotify(row), driveBackup(photos)]); });
    res.json({ ok: true, id: row.id, message: publicSettings().thankYouText });
  } catch (err) {
    console.error("Submission failed:", err);
    res.status(500).json({ error: "फॉर्म जमा नहीं हो पाया। कृपया दोबारा कोशिश करें।" });
  }
});

app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC, "admin.html")));
app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD || "change-this-password-now";
  const userOk = crypto.timingSafeEqual(Buffer.from(username.padEnd(128).slice(0,128)), Buffer.from(expectedUser.padEnd(128).slice(0,128)));
  const passOk = crypto.timingSafeEqual(Buffer.from(password.padEnd(256).slice(0,256)), Buffer.from(expectedPass.padEnd(256).slice(0,256)));
  if (!userOk || !passOk) return res.status(401).json({ error: "Username या password गलत है।" });
  req.session.admin = true;
  res.json({ ok: true });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  res.json({
    visitors: db.prepare("SELECT COUNT(*) AS n FROM visits").get().n,
    submissions: db.prepare("SELECT COUNT(*) AS n FROM submissions").get().n,
    consentYes: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE consent=1").get().n,
    consentNo: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE consent=0").get().n,
    photos: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE photos_json != '[]'").get().n
  });
});
app.get("/api/admin/submissions", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const rows = q
    ? db.prepare(`SELECT * FROM submissions WHERE name LIKE ? OR mobile LIKE ? OR short_issue LIKE ? OR details LIKE ? ORDER BY id DESC LIMIT 500`)
      .all(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`)
    : db.prepare("SELECT * FROM submissions ORDER BY id DESC LIMIT 500").all();
  res.json(rows.map(r => ({ ...r, photos: safeJson(r.photos_json), photos_json: undefined })));
});
app.get("/api/admin/settings", requireAdmin, (req, res) => res.json(publicSettings()));
app.post("/api/admin/settings", requireAdmin, (req, res) => {
  const allowed = Object.keys(defaults).filter(k => !["bannerImage","manifestoImage","backgroundImage"].includes(k));
  const updates = req.body || {};
  const update = db.transaction(() => {
    for (const key of allowed) {
      if (typeof updates[key] === "string") setSettingStmt.run(key, updates[key].slice(0, 2000));
    }
  });
  update();
  res.json({ ok: true, settings: publicSettings() });
});
app.post("/api/admin/image/:kind", requireAdmin, upload.single("image"), async (req, res) => {
  const keyMap = { banner: "bannerImage", manifesto: "manifestoImage", background: "backgroundImage" };
  const key = keyMap[req.params.kind];
  if (!key) return res.status(400).json({ error: "Unknown image type" });
  if (!req.file) return res.status(400).json({ error: "Image missing" });
  try {
    const ext = imageExtension(req.file.mimetype);
    if (!ext) return res.status(400).json({ error: "Unsupported image type" });
    const filename = `admin-${req.params.kind}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(UPLOADS, filename), req.file.buffer, { flag: "wx" });
    setSettingStmt.run(key, `/uploads/${filename}`);
    res.json({ ok: true, url: `/uploads/${filename}` });
  } catch (err) { res.status(400).json({ error: "Image process नहीं हो पाई।" }); }
});
app.get("/api/admin/export.csv", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id,name,mobile,short_issue,details,consent,photos_json,created_at FROM submissions ORDER BY id DESC").all();
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["id,name,mobile,short_issue,details,consent,photos,created_at", ...rows.map(r => [r.id,r.name,r.mobile,r.short_issue,r.details,r.consent,safeJson(r.photos_json).map(p=>p.url).join(" "),r.created_at].map(esc).join(","))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=sawantgarh-submissions.csv");
  res.send("\uFEFF" + csv);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "हर फोटो 25 MB से छोटी होनी चाहिए; फोटो अपने-आप compress हो जाएगी।" : "अधिकतम 5 फोटो अपलोड करें।" });
  if (err) return res.status(400).json({ error: err.message || "Request error" });
  next();
});
app.listen(PORT, () => console.log(`Sawantgarh site running at http://localhost:${PORT}`));
