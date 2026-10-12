# Sawantgarh website + admin panel

Mobile-first community suggestion/complaint website based on the three supplied reference images.

## Included
- Responsive public page, Hindi slogan ticker, WhatsApp/Instagram buttons
- Name, mobile, short issue, detailed issue, optional consent, up to 5 photos
- Image optimization/compression with Sharp; photos larger than 5 MB are resized/encoded to JPEG/WebP-size-friendly output
- SQLite database stores submissions, consent state, visit IDs and editable settings
- Admin dashboard: visitor count, submissions, consent count, search/view records, update site texts/social URLs/helpline and upload replacement banner/manifesto/background images
- Telegram notification integration (optional)
- Google Drive SQLite backup integration (optional)
- Changes are read from the database on each page load/API request; no server restart is needed for content updates.

## Run locally
1. Install Node.js 20+.
2. Extract this ZIP and open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`, then set a strong `ADMIN_PASSWORD` and `SESSION_SECRET`.
5. Run `npm start`.
6. Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the admin panel.

## Telegram setup (optional)
1. In Telegram, message `@BotFather`, create a bot and copy its token.
2. Send a message to your bot from your own Telegram account. For a group, add the bot to the group and allow it to post.
3. Obtain the chat ID using a trusted Telegram bot/API method; set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.
4. Restart once after changing environment variables. The app sends a text notification for every successful submission. Keep the bot token secret.

## Google Drive backup (optional)
1. Create a Google Cloud project and enable the Google Drive API.
2. Create a service account and download its JSON key.
3. Create a Drive folder and share that folder with the service-account email as Editor.
4. Put the full service-account JSON on one line in `GOOGLE_SERVICE_ACCOUNT_JSON` and set `GOOGLE_DRIVE_FOLDER_ID`.
5. After every new submission, the app attempts to upload a SQLite database backup and the submitted optimized photos to that folder. Verify this in your own Drive before relying on it.

## Deployment notes
- Deploy on a Node.js host with a **persistent disk/volume** for the `data/` directory and `public/uploads/`. Do not use a serverless host with ephemeral storage unless you move the database/uploads to managed storage.
- Use HTTPS in production. Set `NODE_ENV=production`, a strong session secret and strong admin password.
- Backups are extra protection, not a replacement for testing restores. Download a backup periodically and verify it opens.
- No credentials are included in this project. Integrations remain inactive until you configure them.
- The website is a starter project, not a security audit. Before public launch, have a developer review privacy notice, data retention, abuse protection, hosting and backups. Avoid collecting unnecessary personal information.


## Termux compatibility note

This build does not use the native `sharp` module. Image uploads preserve the original JPG/PNG/WebP/HEIC/HEIF file instead of resizing/re-encoding it, which avoids Sharp native compilation errors on Android/Termux. All other application routes and integrations remain in place.


## Photo selection and Telegram
- Separate camera and gallery controls; up to five images per complaint.
- Telegram sends a structured text message plus each uploaded photo with a caption when credentials are configured.
- Public header has no Admin link; admin remains at `/admin` and must use strong credentials.

## Hosting note
This project uses Express, SQLite and local uploads. It cannot be deployed as a plain static Netlify site with all features intact. Netlify Functions have request payload limits and are not a persistent Express/SQLite server; use a Node.js host for the backend or migrate the database/uploads/APIs to managed services. Never upload `.env` or private keys to a public repository.
