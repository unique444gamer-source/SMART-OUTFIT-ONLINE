require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");

const app = express();
const isProd = process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false
});
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "local-development-secret-change-before-deploy-please",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 1000*60*60*24*7 }
}));
app.use(express.static(path.join(__dirname, "public")));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 }, fileFilter: (_, f, cb) => cb(null, /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.mimetype)) });
const limiter = rateLimit({ windowMs: 15*60*1000, limit: 100, standardHeaders: true, legacyHeaders: false });
app.use("/api", limiter);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'MEN',
      description TEXT DEFAULT '', price NUMERIC(12,2) NOT NULL DEFAULT 0,
      compare_price NUMERIC(12,2), image_url TEXT DEFAULT '', sizes JSONB DEFAULT '[]',
      colors JSONB DEFAULT '[]', stock INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
      items JSONB NOT NULL, subtotal NUMERIC(12,2) NOT NULL, delivery_fee NUMERIC(12,2) DEFAULT 80,
      total NUMERIC(12,2) NOT NULL, payment_method TEXT DEFAULT 'Cash on Delivery',
      status TEXT NOT NULL DEFAULT 'Pending', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY, value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, discount_percent INTEGER NOT NULL,
      active BOOLEAN DEFAULT TRUE, expires_at TIMESTAMPTZ
    );
  `);
  const email = (process.env.ADMIN_EMAIL || "admin@smartoutfit.com").toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";
  const exists = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  if (!exists.rowCount) {
    const hash = await bcrypt.hash(pass, 12);
    await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",
      [process.env.ADMIN_NAME || "SMART OUTFIT Admin", email, hash]);
    console.log("Initial admin account created:", email);
  }
  const defaults = {
    brand: { name: "SMART OUTFIT", logo: "", tagline: "Style that speaks for you", primary: "#7c2517" },
    delivery: { fee: 80, freeAbove: 3000 },
    announcement: { text: "বাংলাদেশজুড়ে Cash on Delivery • Easy Size Exchange", active: true }
  };
  for (const [key, value] of Object.entries(defaults))
    await pool.query("INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING", [key, JSON.stringify(value)]);
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM products");
  if (!count.rows[0].n) {
    const seed = [
      ["Premium Cotton T-Shirt","MEN","Comfortable everyday cotton tee",650,"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900",["M","L","XL"],["Black","White"],35],
      ["Classic Denim Shirt","MEN","Smart casual denim shirt",1250,"https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=900",["M","L","XL"],["Blue"],18],
      ["Women Everyday Kurti","WOMEN","Elegant everyday wear",990,"https://images.unsplash.com/photo-1583391733956-6c78276477e7?w=900",["S","M","L"],["Maroon"],22],
      ["Kids Casual Set","KIDS","Soft and comfortable kids set",850,"https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=900",["2Y","4Y","6Y"],["Blue"],14],
      ["Winter Hoodie","WINTER","Warm fleece hoodie",1450,"https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=900",["M","L","XL"],["Black","Grey"],20],
      ["Family Combo Pack","COMBO","Value combo collection",1990,"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=900",["M","L","XL"],["Mixed"],10]
    ];
    for (const p of seed) await pool.query(
      "INSERT INTO products(name,category,description,price,image_url,sizes,colors,stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [p[0],p[1],p[2],p[3],p[4],JSON.stringify(p[5]),JSON.stringify(p[6]),p[7]]);
  }
}
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const adminOnly = (req,res,next) => req.session.user?.role === "admin" ? next() : res.status(401).json({error:"Admin login required"});
const signedIn = (req,res,next) => req.session.user ? next() : res.status(401).json({error:"Please login first"});

app.get("/admin", (_,res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/api/health", (_,res) => res.json({ok:true, app:"SMART OUTFIT"}));
app.get("/api/settings", asyncRoute(async (_,res) => {
  const r = await pool.query("SELECT key,value FROM site_settings");
  res.json(Object.fromEntries(r.rows.map(x=>[x.key,x.value])));
}));
app.get("/api/products", asyncRoute(async (req,res) => {
  const { category, q } = req.query;
  const args=[]; let sql="SELECT * FROM products WHERE active=TRUE";
  if (category && category!=="ALL") { args.push(category); sql+=` AND category=$${args.length}`; }
  if (q) { args.push(`%${q}%`); sql+=` AND (name ILIKE $${args.length} OR description ILIKE $${args.length})`; }
  sql+=" ORDER BY created_at DESC";
  const r=await pool.query(sql,args); res.json(r.rows);
}));
app.post("/api/register", asyncRoute(async (req,res) => {
  const {name,email,password}=req.body;
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length<8) return res.status(400).json({error:"Name, valid email and password (8+ characters) required"});
  const hash=await bcrypt.hash(password,12);
  try {
    const r=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role",[name.trim(),email.toLowerCase(),hash]);
    req.session.user=r.rows[0]; res.status(201).json({user:req.session.user});
  } catch(e) { if(e.code==="23505") return res.status(409).json({error:"Email already registered"}); throw e; }
}));
app.post("/api/login", asyncRoute(async (req,res) => {
  const {email,password}=req.body;
  const r=await pool.query("SELECT * FROM users WHERE email=$1",[String(email||"").toLowerCase()]);
  if(!r.rowCount || !(await bcrypt.compare(password||"",r.rows[0].password_hash))) return res.status(401).json({error:"Email or password is incorrect"});
  const u=r.rows[0]; req.session.user={id:u.id,name:u.name,email:u.email,role:u.role}; res.json({user:req.session.user});
}));
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.post("/api/orders", asyncRoute(async (req,res) => {
  const {customer_name,phone,address,items,payment_method="Cash on Delivery"}=req.body;
  if(!customer_name||!phone||!address||!Array.isArray(items)||!items.length) return res.status(400).json({error:"Please complete all checkout details"});
  const ids=items.map(x=>Number(x.id)).filter(Number.isInteger);
  if(ids.length!==items.length) return res.status(400).json({error:"Invalid cart items"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const rows=await client.query("SELECT id,name,price,stock,image_url FROM products WHERE id=ANY($1::int[]) AND active=TRUE FOR UPDATE",[ids]);
    const map=new Map(rows.rows.map(p=>[p.id,p]));
    let clean=[],subtotal=0;
    for(const item of items) {
      const p=map.get(Number(item.id)), qty=Math.max(1,Math.min(20,Number(item.qty)||1));
      if(!p || p.stock<qty) throw new Error(`Stock unavailable for ${p?.name||"a product"}`);
      const price=Number(p.price); subtotal+=price*qty;
      clean.push({id:p.id,name:p.name,price,qty,image_url:p.image_url,size:String(item.size||""),color:String(item.color||"")});
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2",[qty,p.id]);
    }
    const setting=await client.query("SELECT value FROM site_settings WHERE key='delivery'");
    const fee=Number(setting.rows[0]?.value?.fee ?? 80);
    const total=subtotal+fee, number="SO"+Date.now().toString().slice(-9);
    const result=await client.query(`INSERT INTO orders(order_number,user_id,customer_name,phone,address,items,subtotal,delivery_fee,total,payment_method)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING order_number,total,status`,
      [number,req.session.user?.id||null,customer_name,phone,address,JSON.stringify(clean),subtotal,fee,total,payment_method]);
    await client.query("COMMIT"); res.status(201).json(result.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); res.status(400).json({error:e.message}); }
  finally { client.release(); }
}));
app.get("/api/track/:number",asyncRoute(async(req,res)=>{
  const r=await pool.query("SELECT order_number,status,total,created_at FROM orders WHERE order_number=$1",[req.params.number]);
  if(!r.rowCount)return res.status(404).json({error:"Order not found"});res.json(r.rows[0]);
}));
app.get("/api/admin/summary",adminOnly,asyncRoute(async(_,res)=>{
  const [p,o,u,s]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM products"),pool.query("SELECT COUNT(*)::int n,COALESCE(SUM(total) FILTER(WHERE status<>'Cancelled'),0) sales FROM orders"),
    pool.query("SELECT COUNT(*)::int n FROM users WHERE role='customer'"),pool.query("SELECT COUNT(*)::int n FROM orders WHERE status='Pending'")
  ]);
  res.json({products:p.rows[0].n,orders:o.rows[0].n,sales:Number(o.rows[0].sales),customers:u.rows[0].n,pending:s.rows[0].n});
}));
app.get("/api/admin/products",adminOnly,asyncRoute(async(_,res)=>res.json((await pool.query("SELECT * FROM products ORDER BY id DESC")).rows)));
app.post("/api/admin/products",adminOnly,asyncRoute(async(req,res)=>{
  const {name,category,description,price,compare_price,image_url,sizes,colors,stock,active=true}=req.body;
  if(!name||!category||Number(price)<0)return res.status(400).json({error:"Product name, category and valid price required"});
  const r=await pool.query(`INSERT INTO products(name,category,description,price,compare_price,image_url,sizes,colors,stock,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name,category,description||"",price,compare_price||null,image_url||"",JSON.stringify(sizes||[]),JSON.stringify(colors||[]),Math.max(0,Number(stock)||0),!!active]);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/admin/products/:id",adminOnly,asyncRoute(async(req,res)=>{
  const {name,category,description,price,compare_price,image_url,sizes,colors,stock,active=true}=req.body;
  const r=await pool.query(`UPDATE products SET name=$1,category=$2,description=$3,price=$4,compare_price=$5,image_url=$6,sizes=$7,colors=$8,stock=$9,active=$10 WHERE id=$11 RETURNING *`,
    [name,category,description||"",price,compare_price||null,image_url||"",JSON.stringify(sizes||[]),JSON.stringify(colors||[]),Math.max(0,Number(stock)||0),!!active,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Product not found"});res.json(r.rows[0]);
}));
app.delete("/api/admin/products/:id",adminOnly,asyncRoute(async(req,res)=>{await pool.query("DELETE FROM products WHERE id=$1",[req.params.id]);res.json({ok:true});}));
app.get("/api/admin/orders",adminOnly,asyncRoute(async(_,res)=>res.json((await pool.query("SELECT * FROM orders ORDER BY created_at DESC")).rows)));
app.patch("/api/admin/orders/:id",adminOnly,asyncRoute(async(req,res)=>{
  const allowed=["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled"];
  if(!allowed.includes(req.body.status))return res.status(400).json({error:"Invalid order status"});
  const r=await pool.query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",[req.body.status,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Order not found"});res.json(r.rows[0]);
}));
app.get("/api/admin/customers",adminOnly,asyncRoute(async(_,res)=>res.json((await pool.query("SELECT id,name,email,created_at FROM users WHERE role='customer' ORDER BY id DESC")).rows)));
app.put("/api/admin/settings/:key",adminOnly,asyncRoute(async(req,res)=>{
  const allowed=["brand","delivery","announcement"];
  if(!allowed.includes(req.params.key))return res.status(400).json({error:"Setting not allowed"});
  let value=req.body;
  if(req.params.key==="brand") {
    const old=await pool.query("SELECT value FROM site_settings WHERE key='brand'");
    value={...(old.rows[0]?.value||{}),...req.body};
  }
  await pool.query("INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[req.params.key,JSON.stringify(value)]);
  res.json({ok:true});
}));
app.post("/api/admin/logo",adminOnly,upload.single("logo"),asyncRoute(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Select an image file"});
  const data=`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  const current=await pool.query("SELECT value FROM site_settings WHERE key='brand'");
  const brand={...(current.rows[0]?.value||{}),logo:data};
  await pool.query("INSERT INTO site_settings(key,value) VALUES('brand',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(brand)]);
  res.json({logo:data});
}));
app.post("/api/admin/coupons",adminOnly,asyncRoute(async(req,res)=>{
  const {code,discount_percent,expires_at}=req.body;
  if(!code||Number(discount_percent)<1||Number(discount_percent)>90)return res.status(400).json({error:"Coupon and discount 1-90% required"});
  const r=await pool.query("INSERT INTO coupons(code,discount_percent,expires_at) VALUES($1,$2,$3) RETURNING *",[code.toUpperCase(),discount_percent,expires_at||null]);res.status(201).json(r.rows[0]);
}));
app.get("/api/admin/coupons",adminOnly,asyncRoute(async(_,res)=>res.json((await pool.query("SELECT * FROM coupons ORDER BY id DESC")).rows)));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error. Check Render logs."});});
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,()=>console.log(`SMART OUTFIT running on port ${port}`))).catch(e=>{console.error("Database initialization failed:",e);process.exit(1);});
