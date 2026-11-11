# SMART OUTFIT — Full-Stack Ecommerce

A Node.js + Express + PostgreSQL fashion store, prepared for GitHub and Render deployment. The interface follows the supplied SMART OUTFIT HTML's warm ivory / dark brown / rust visual direction and the MEN, WOMEN, KIDS, WINTER and COMBO categories.

## Included
- Responsive customer storefront, category filtering, search and shopping bag\n- Customer registration and login
- Checkout with Cash on Delivery and stock validation
- Order tracking by order number
- Admin login with bcrypt password hashing and PostgreSQL-backed sessions (session table initialized once by the app)
- Admin dashboard, products, orders/status updates, customer list, coupons
- Branding settings: change website name, tagline, announcement, delivery fee and upload logo
- PostgreSQL schema + initial demo products + first admin account created on startup
- Render Blueprint file (`render.yaml`)

## Run locally
1. Install Node.js 20+ and PostgreSQL.
2. Create a database named `smart_outfit`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL`, `SESSION_SECRET`, and a strong `ADMIN_PASSWORD`.
5. Run:
   ```bash
   npm install
   npm start
   ```
6. Open `http://localhost:3000`; admin page: `http://localhost:3000/admin`.

## Deploy with GitHub + Render
1. Create a new GitHub repository named `SMART-OUTFIT`.
2. Upload all files/folders from this project (the contents, not the ZIP itself).
3. In Render, choose **New + → Blueprint** and connect the repository.
4. Render reads `render.yaml` and creates the Web Service + PostgreSQL database.
5. Set the `ADMIN_PASSWORD` value when Render asks. Use a long unique password. Do not publish it in GitHub.
6. Deploy. Wait for the service to become Live.
7. Open `https://YOUR-SERVICE.onrender.com` and `/admin`.
8. Sign in using `ADMIN_EMAIL` and the `ADMIN_PASSWORD` you configured.

If you create the service manually instead of using Blueprint:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Add PostgreSQL database and set `DATABASE_URL` to its **Internal Database URL**.
- Set `NODE_ENV=production`, `SESSION_SECRET` (long random value), `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

## Important production notes
- Change the default admin password before public launch. The first admin user is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when that email does not already exist.
- If you change `ADMIN_PASSWORD` after the admin account has been created, it does not automatically reset the existing user's password. Change it through a future password-management feature or update the database securely.
- Uploaded logo images are stored as a small data URL in PostgreSQL (1 MB upload limit), so they persist across Render restarts. Product photos use image URLs; use stable HTTPS image hosting for them.
- Demo products and remote Unsplash images are starter content. Replace them with your real product photos and details in Admin.
- Cash on Delivery is implemented. Online payments (bKash/Nagad/SSLCommerz), SMS, email notifications, advanced returns, staff permission management and production-grade coupon checkout validation are not connected in this starter release and require provider credentials / additional implementation.
- Free Render instances and free databases may have sleep, storage, or expiry limits that change over time. For a real store, use a paid persistent database plan and keep backups.
- Keep `.env` private. Never commit passwords or database URLs to GitHub.

## Main routes
- `/` storefront
- `/admin` admin panel
- `/api/health` health check
