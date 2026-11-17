# AMG 2026 · Event microsite

Private event microsite for **Grindwell Norton – AMG 2026, Goa** (about 150 guests).

## What it does

| Area | Guests | Organisers (`/admin`) |
|---|---|---|
| **Access** | Open the site from a personal link (no password). If they lose it, they enter their email or mobile and the link is sent again. | Add people one by one or import a CSV. Send everyone their link on WhatsApp and email. Copy a link, reset a link, see who has opened the site. |
| **Notifications** | Get a WhatsApp message and an email for every update, with a link straight to it. They can turn either one off. | Each update, quiz launch, results reveal and gallery announcement can notify everyone. A delivery log shows sent, failed, skipped or dry-run for each person. |
| **Updates feed** | Text, photo or video posts, plus YouTube or livestream links that play inside the page. A toast pops up live if the site is open. | Post with an upload or a link. Pin a post, delete a post, and choose WhatsApp, email or both. |
| **Quizzes** | Answer once. See their score right away, then their rank and the winner when the organisers reveal results. | Build multiple-choice questions with a correct answer and points. Scoring is automatic: number and % correct per question, a full ranking (ties go to the fastest), the **winner**, CSV export and an overall leaderboard across all quizzes. |
| **Polls** | Vote, then see the live % for each option, with the top choice starred. Can also answer open-text questions. | Live vote counts and %, the **most-voted option**, a list of open-text answers and CSV export. |
| **Gallery** | Upload several photos or videos at once from their phone. Browse in a lightbox and download. | Approve or reject guest uploads (or switch on auto-approve). Upload the official post-event photos and videos, then send one "gallery is live" message. |
| **Agenda (running calendar)** | Day tabs, a **"Live now"** marker on the current session, a "Now / Up next" card on the home page, and *Add to my calendar* (.ics). | Add, edit and delete sessions. Guests see changes instantly. |
| **Chat** | One-to-one chat with any guest, a group "Lounge", online dots and unread badges. | Open or close the Lounge. |
| **Info** | Countdown, venue and map, help desk phone, WhatsApp and email. | Set in `.env`. |
| **Branding** | Client logo, colours, tagline and header photo across the site and every email. Changes appear live. | **Admin → Branding**: upload the logo and header photo, choose 3 colours (or start from a preset), and preview the guest site and the notification email side by side before saving. |

## Branding

Go to **Admin → Branding**. Ask the client for:
* **Logo:** a PNG with a transparent background, about 600px wide. Email apps don't show SVG, so a PNG is safest. Keep *white badge* on for a full-colour logo; turn it off for an all-white logo.
* **Brand colours** as hex codes from their brand guidelines:
  * **Primary:** a deep shade, used for the header and menus.
  * **Accent:** used for buttons.
  * **Highlight:** used for the event year and badges.

  The page warns you if text on those colours would be hard to read.
* **Optional:** a theme line or tagline for AMG 2026, and a wide header photo of the venue or Goa.
* **Optional:** *title artwork* (the event lockup as a transparent PNG, which replaces the typed event name), up to 4 *partner/group logos* (shown on a white strip at the bottom of the site and emails), a *header tint* (strong for photos, light for designed artwork) and a *heading font*.

The AMG 2026 branding currently loaded came from the client's Illustrator file `AMG 2026-23.10.26.ai`:
* Norton | Saint-Gobain logo
* "AMG Managers' Meet 2026" lockup
* header light-streak artwork
* Lead & Grow 2030 and Saint-Gobain partner logos
* navy `#1c2d7c`, red `#e8202e` and orange `#f07420`
* Montserrat as the free web stand-in for Gotham. Gotham is a licensed font and is not used on the site.

All three colours drive every shade on the site through CSS variables (`public/js/brand.js`). The same colours and logo are used in the emails (`src/notify.js`).

## Run it locally

You need Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there is no database to install.

```bash
npm install
```
```bash
cp .env.example .env
```
```bash
npm run seed
```
```bash
npm start
```

* Guest site: `http://localhost:3000`. `npm run seed` prints demo guest links. Remove the demo people from the admin before going live.
* Admin: `http://localhost:3000/admin`, with the password from `ADMIN_PASSWORD` in `.env`.

Data is stored in `data/amg2026.db` and uploads in `uploads/`. **Back up both folders.**

## Loading the 150 guests

Save the guest sheet from Excel as **CSV** with these columns (the header names are flexible):

```
Name,Email,Phone,Company,Designation
Aarav Mehta,aarav@company.com,9876543210,Grindwell Norton,Regional Head
```

Go to **Admin → Attendees → Import**. A 10-digit number gets `DEFAULT_COUNTRY_CODE` (91) added. Re-importing updates people who match on email or phone and doesn't create duplicates.

## Connecting WhatsApp

WhatsApp only lets businesses start a conversation with a **pre-approved template**. Every notification from the microsite uses one template with 3 variables:

```
Hi {{1}}, {{2}} on the AMG 2026 microsite. Open it here: {{3}}
```
`{{1}}` = first name, `{{2}}` = the headline (e.g. *a new video is up: "Opening keynote"*), `{{3}}` = the guest's personal link.

**Option A: Meta WhatsApp Cloud API** (cheapest, direct)
1. In Meta Business Manager, create a WhatsApp Business account and add the sender phone number.
2. Create a *Utility* template named `amg_update` with the body above, and wait for approval (usually minutes to a day).
3. Create a System User with a permanent token that has `whatsapp_business_messaging` permission.
4. In `.env`: `WHATSAPP_PROVIDER=meta`, `WA_META_TOKEN`, `WA_META_PHONE_NUMBER_ID`, `WA_TEMPLATE_NAME=amg_update`.

**Option B: Twilio.** Set `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` and `TWILIO_CONTENT_SID`, using the same 3-variable template created in Twilio Content.

If you use an Indian BSP (Interakt, Gupshup, AiSensy, etc.), it's one more function in `src/notify.js`.

## Connecting email

Use any SMTP service: Google Workspace, Microsoft 365, Amazon SES, Brevo or SendGrid. Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. For 150 people, any of these is fine. Use a sending domain with SPF/DKIM set up so emails don't land in spam.

Until a channel is configured it runs in **dry-run** mode: every message is logged in Admin → Dashboard → Recent notifications but not sent. You can rehearse the whole flow safely this way.

## Going live

This app needs a host that keeps a Node process running and has a **persistent disk** (for SQLite, uploads and live updates). Good options:

* A small VPS (DigitalOcean, AWS Lightsail, Hostinger) with Nginx and HTTPS. A 2 GB RAM, 50 GB+ disk machine is enough for 150 guests.
* Render, Railway or Fly.io with a mounted persistent volume for `data/` and `uploads/`.

It does *not* suit purely static or serverless hosting, because files and the database would be lost.

Set `BASE_URL=https://amg2026.yourdomain.com`, because it goes into every WhatsApp and email link. If you use Nginx, raise `client_max_body_size` to match `MAX_UPLOAD_MB` and turn off proxy buffering for `/api/stream`.

## Event-day runbook

1. **About 1 week before:** import guests, then **Attendees → Send personal links to everyone**.
2. **On the day:** post updates with *Notify* ticked. Run a quiz with *Go live* and choose whether to notify everyone. When it ends, **Close**, then **Reveal results**, which also announces the winner.
3. Keep the **Gallery → Pending** tab open to approve guest photos as they come in.
4. **After the event:** upload the official photos and videos, then **Announce the gallery**.

## Project layout

```
server.js           Express app and all API routes
src/db.js           SQLite schema (node:sqlite)
src/notify.js       WhatsApp (Meta/Twilio) + SMTP email, delivery log, dry-run
src/live.js         Server-Sent Events for live updates and chat
public/index.html   Guest microsite (public/js/app.js)
public/admin.html   Organiser console (public/js/admin.js)
scripts/seed.js     Demo data
```
