require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const { customAlphabet } = require("nanoid");

const app = express();
const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

const dbFile = path.join(__dirname, "data", "portfolio-db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { portfolios: [], users: [] });

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";

const razorpay =
  razorpayKeyId && razorpayKeySecret
    ? new Razorpay({
        key_id: razorpayKeyId,
        key_secret: razorpayKeySecret
      })
    : null;

const PRO_PRICE_INR = 450;
const PRO_DURATION_DAYS = 30;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function splitLines(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parsePipeRows(text, expectedParts) {
  return splitLines(text)
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts.length >= expectedParts)
    .map((parts) => parts.slice(0, expectedParts));
}

function slugifyName(value) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlugFromName(fullName, portfolios) {
  const base = slugifyName(fullName) || `portfolio-${nanoid()}`;
  let slug = base;
  let counter = 2;

  while (portfolios.some((item) => item.slug === slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}

function toPipeRows(items, fields) {
  return (items || [])
    .map((item) => fields.map((field) => item[field] || "").join(" | "))
    .join("\n");
}

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function normalizeLayout(value) {
  const allowed = new Set(["default", "hero-reverse", "projects-first"]);
  return allowed.has(value) ? value : "default";
}

function sanitizeNext(value) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/")) return "/dashboard";
  return value;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function buildPortfolioPayload(req) {
  return {
    fullName: (req.body.fullName || "Your Name").trim(),
    role: req.body.role || "Developer at Apple",
    headline: req.body.headline || "Crafting elegant software that feels magical.",
    heroText:
      req.body.heroText ||
      "I design and engineer high-performance product experiences with a strong focus on motion, clarity, and user delight.",
    shippingTitle: req.body.shippingTitle || "Now Shipping",
    shippingHeading: req.body.shippingHeading || "Apple Ecosystem Features",
    shippingDescription:
      req.body.shippingDescription ||
      "Leading cross-platform experiences for iOS, macOS, and visionOS with clean architecture and consistent performance.",
    shippingPoints: splitLines(req.body.shippingPoints),
    aboutCards: parsePipeRows(req.body.aboutCards, 2).map(
      ([title, description]) => ({
        title,
        description
      })
    ),
    projects: parsePipeRows(req.body.projects, 3).map(
      ([title, platform, description]) => ({
        title,
        platform,
        description
      })
    ),
    experiences: parsePipeRows(req.body.experiences, 3).map(
      ([period, title, description]) => ({
        period,
        title,
        description
      })
    ),
    email: (req.body.email || "").trim(),
    linkedin: (req.body.linkedin || "").trim(),
    youtube: (req.body.youtube || "").trim(),
    instagram: (req.body.instagram || "").trim(),
    twitter: (req.body.twitter || "").trim(),
    github: (req.body.github || "").trim(),
    theme: normalizeTheme(req.body.theme),
    layoutVariant: normalizeLayout(req.body.layoutVariant)
  };
}

function applyPortfolioDefaults(record) {
  if (!record.shippingPoints || record.shippingPoints.length === 0) {
    record.shippingPoints = [
      "SwiftUI + UIKit integration",
      "Performance-first interaction design",
      "Accessibility at enterprise scale"
    ];
  }

  if (!record.aboutCards || record.aboutCards.length === 0) {
    record.aboutCards = [
      {
        title: "Design + Code",
        description:
          "I bridge product, design, and engineering to deliver interfaces that are intuitive, beautiful, and technically robust."
      },
      {
        title: "Performance Obsessed",
        description:
          "From launch-time optimization to fluid animations, I focus on measurable quality and polished user interactions."
      },
      {
        title: "Mentorship",
        description:
          "I mentor teams on architecture, UI craftsmanship, and modern app standards across Apple platforms."
      }
    ];
  }

  if (!record.projects || record.projects.length === 0) {
    record.projects = [
      {
        title: "Health Insight Dashboard",
        platform: "iOS",
        description:
          "Developed a real-time health analytics interface with dynamic charts, meaningful animations, and robust offline behavior."
      },
      {
        title: "Creative Workspace Suite",
        platform: "macOS",
        description:
          "Built a modular productivity suite with seamless continuity and advanced keyboard-first workflow optimization."
      },
      {
        title: "Spatial Interaction Lab",
        platform: "visionOS",
        description:
          "Prototyped immersive UI patterns for spatial computing, focusing on depth, gesture feedback, and intuitive navigation."
      }
    ];
  }

  if (!record.experiences || record.experiences.length === 0) {
    record.experiences = [
      {
        period: "2022 - Present",
        title: "Senior Developer, Apple",
        description:
          "Leading feature engineering initiatives across flagship consumer apps and driving performance standards across teams."
      },
      {
        period: "2019 - 2022",
        title: "Software Engineer, Product Innovation",
        description:
          "Delivered next-generation interaction patterns and collaborated on design systems for multi-device consistency."
      },
      {
        period: "2016 - 2019",
        title: "Frontend Engineer, Creative Tech Studio",
        description:
          "Built premium digital experiences for global brands, emphasizing craftsmanship, motion, and performance."
      }
    ];
  }
}

async function loadDb() {
  await db.read();
  db.data ||= { portfolios: [], users: [] };
  db.data.portfolios ||= [];
  db.data.users ||= [];

  let needsWrite = false;

  db.data.portfolios.forEach((portfolio) => {
    if (!portfolio.portfolioId) {
      portfolio.portfolioId = nanoid();
      needsWrite = true;
    }

    if (!portfolio.ownerEmail && portfolio.creatorEmail) {
      portfolio.ownerEmail = portfolio.creatorEmail;
      needsWrite = true;
    }
  });

  db.data.users.forEach((user) => {
    if (!user.plan) {
      user.plan = "basic";
      needsWrite = true;
    }

    if (!user.planStatus) {
      user.planStatus = user.plan === "pro" ? "active" : "inactive";
      needsWrite = true;
    }

    if (user.plan === "pro" && user.planExpiresAt) {
      const expired = new Date(user.planExpiresAt).getTime() <= Date.now();
      if (expired) {
        user.plan = "basic";
        user.planStatus = "expired";
        needsWrite = true;
      }
    }
  });

  if (needsWrite) {
    await db.write();
  }
}

function getUserBySession(req) {
  if (!req.session.user) return null;
  return db.data.users.find((u) => u.id === req.session.user.id) || null;
}

function hasActivePro(user) {
  if (!user) return false;
  if (user.plan !== "pro") return false;
  if (user.planStatus !== "active") return false;
  if (!user.planExpiresAt) return false;

  return new Date(user.planExpiresAt).getTime() > Date.now();
}

function activateProPlan(user) {
  const now = new Date();
  const expiresAt = addDays(now, PRO_DURATION_DAYS);

  user.plan = "pro";
  user.planStatus = "active";
  user.proActivatedAt = now.toISOString();
  user.planExpiresAt = expiresAt.toISOString();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

async function claimLegacyPortfoliosForUser(user) {
  await loadDb();

  let hasChanges = false;
  const normalizedUserName = (user.fullName || "").trim().toLowerCase();
  const normalizedUserEmail = (user.email || "").trim().toLowerCase();

  db.data.portfolios.forEach((item) => {
    const normalizedItemName = (item.fullName || "").trim().toLowerCase();
    const normalizedOwnerEmail = (item.ownerEmail || "").trim().toLowerCase();
    const normalizedCreatorEmail = (item.creatorEmail || "").trim().toLowerCase();
    const normalizedContactEmail = (item.email || "").trim().toLowerCase();

    const alreadyOwnedByAnotherUser =
      item.ownerUserId && item.ownerUserId !== user.id;

    if (alreadyOwnedByAnotherUser) return;

    const isLegacyMatch =
      !item.ownerUserId &&
      (
        normalizedOwnerEmail === normalizedUserEmail ||
        normalizedCreatorEmail === normalizedUserEmail ||
        normalizedContactEmail === normalizedUserEmail ||
        normalizedItemName === normalizedUserName
      );

    if (isLegacyMatch) {
      item.ownerUserId = user.id;
      item.ownerEmail = user.email;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    await db.write();
  }
}

app.get("/", (req, res) => {
  res.render("landing");
});

app.get("/signup", (req, res) => {
  res.render("auth", { mode: "signup", error: "" });
});

app.post("/signup", async (req, res) => {
  await loadDb();

  const fullName = (req.body.fullName || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!fullName || !email || !password) {
    return res.status(400).render("auth", {
      mode: "signup",
      error: "Please fill full name, email, and password."
    });
  }

  if (password.length < 6) {
    return res.status(400).render("auth", {
      mode: "signup",
      error: "Password must be at least 6 characters."
    });
  }

  const existingUser = db.data.users.find((user) => user.email === email);
  if (existingUser) {
    return res.status(400).render("auth", {
      mode: "signup",
      error: "An account with this email already exists."
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: nanoid(),
    fullName,
    email,
    passwordHash,
    createdAt: new Date().toISOString(),
    plan: "basic",
    planStatus: "inactive",
    planExpiresAt: null
  };

  db.data.users.unshift(user);
  await db.write();

  req.session.user = {
    id: user.id,
    fullName: user.fullName,
    email: user.email
  };

  await claimLegacyPortfoliosForUser(req.session.user);
  return res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  res.render("auth", { mode: "login", error: "" });
});

app.post("/login", async (req, res) => {
  await loadDb();

  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  const user = db.data.users.find((item) => item.email === email);

  if (!user) {
    return res.status(401).render("auth", {
      mode: "login",
      error: "No account found with this email."
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return res.status(401).render("auth", {
      mode: "login",
      error: "Incorrect password."
    });
  }

  req.session.user = {
    id: user.id,
    fullName: user.fullName,
    email: user.email
  };

  await claimLegacyPortfoliosForUser(req.session.user);
  return res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.post("/delete-account", requireAuth, async (req, res) => {
  await loadDb();
  await claimLegacyPortfoliosForUser(req.session.user);

  const userId = req.session.user.id;

  db.data.users = (db.data.users || []).filter((u) => u.id !== userId);
  db.data.portfolios = (db.data.portfolios || []).filter(
    (p) => p.ownerUserId !== userId
  );

  await db.write();

  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", requireAuth, async (req, res) => {
  await loadDb();
  await claimLegacyPortfoliosForUser(req.session.user);

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  const myPortfolios = db.data.portfolios.filter(
    (item) => item.ownerUserId === req.session.user.id
  );

  res.render("dashboard", {
    portfolios: myPortfolios,
    isPro,
    planLabel: isPro ? "Pro" : "Basic Plan"
  });
});

app.get("/form.html", requireAuth, async (req, res) => {
  await loadDb();
  await claimLegacyPortfoliosForUser(req.session.user);

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  const myPortfolioCount = db.data.portfolios.filter(
    (p) => p.ownerUserId === req.session.user.id
  ).length;

  if (!isPro && myPortfolioCount >= 1) {
    return res.redirect(
      `/pricing?reason=create&next=${encodeURIComponent("/form.html")}`
    );
  }

  return res.render("form");
});

app.post("/create", requireAuth, async (req, res) => {
  await loadDb();
  await claimLegacyPortfoliosForUser(req.session.user);

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  const myPortfolioCount = db.data.portfolios.filter(
    (p) => p.ownerUserId === req.session.user.id
  ).length;

  if (!isPro && myPortfolioCount >= 1) {
    return res.redirect(
      `/pricing?reason=create&next=${encodeURIComponent("/form.html")}`
    );
  }

  const now = new Date().toISOString();
  const payload = buildPortfolioPayload(req);
  const slug = uniqueSlugFromName(payload.fullName, db.data.portfolios);

  const record = {
    id: slug,
    portfolioId: nanoid(),
    slug,
    ownerUserId: req.session.user.id,
    ownerEmail: req.session.user.email,
    creatorEmail: req.session.user.email,
    createdAt: now,
    ...payload
  };

  applyPortfolioDefaults(record);

  db.data.portfolios.unshift(record);
  await db.write();

  return res.redirect(`/${slug}`);
});

app.get("/pricing", requireAuth, async (req, res) => {
  await loadDb();

  const reason = req.query.reason || "upgrade";
  const next = sanitizeNext(req.query.next || "/dashboard");

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  res.render("pricing", {
    reason,
    next,
    plan: isPro ? "pro" : "basic",
    razorpayKeyId,
    proPriceINR: PRO_PRICE_INR
  });
});

app.post("/api/razorpay/order", requireAuth, async (req, res) => {
  if (!razorpay) {
    return res.status(500).json({
      success: false,
      error: "Razorpay is not configured on the server."
    });
  }

  try {
    await loadDb();

    const user = getUserBySession(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User session not found."
      });
    }

    const amountPaise = PRO_PRICE_INR * 100;
    const currency = "INR";
    const receipt = `pro-${user.id}-${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt
    });

    return res.json({
      success: true,
      order_id: order.id,
      amount: amountPaise,
      currency,
      key_id: razorpayKeyId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error && typeof error.message === "string"
          ? error.message
          : "Failed to create Razorpay order."
    });
  }
});

app.get("/pay/pro", requireAuth, async (req, res) => {
  await loadDb();

  const next = sanitizeNext(req.query.next || "/dashboard");
  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  if (isPro) {
    return res.redirect(next);
  }

  if (!razorpay) {
    return res.status(500).render("pricing", {
      reason: "upgrade",
      next,
      plan: "basic",
      razorpayKeyId,
      proPriceINR: PRO_PRICE_INR
    });
  }

  try {
    const amountPaise = PRO_PRICE_INR * 100;
    const currency = "INR";
    const receipt = `pro-${req.session.user.id}-${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt
    });

    return res.render("razorpay-checkout", {
      next,
      razorpayKeyId,
      proPriceINR: PRO_PRICE_INR,
      orderId: order.id,
      amount: amountPaise,
      currency
    });
  } catch (error) {
    return res.status(500).send(
      error && typeof error.message === "string"
        ? error.message
        : "Failed to start checkout."
    );
  }
});

app.post("/payment/verify", requireAuth, async (req, res) => {
  if (!razorpay || !razorpayKeySecret) {
    return res.status(500).json({
      success: false,
      error: "Razorpay is not configured on the server."
    });
  }

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    next
  } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      success: false,
      error: "Missing Razorpay verification fields."
    });
  }

  const expectedSignature = crypto
    .createHmac("sha256", razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    return res.status(400).json({
      success: false,
      error: "Payment verification failed."
    });
  }

  await loadDb();

  const user = getUserBySession(req);
  if (!user) {
    return res.status(404).json({
      success: false,
      error: "User not found."
    });
  }

  activateProPlan(user);
  await db.write();

  return res.json({
    success: true,
    next: sanitizeNext(next || "/dashboard")
  });
});

app.get("/portfolio/:portfolioId/edit", requireAuth, async (req, res) => {
  await loadDb();

  const identifier = req.params.portfolioId;

  let portfolio = db.data.portfolios.find(
    (item) => item.portfolioId === identifier
  );

  if (!portfolio) {
    portfolio = db.data.portfolios.find(
      (item) => item.slug === identifier || item.id === identifier
    );
  }

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  if (portfolio.ownerUserId !== req.session.user.id) {
    return res.status(403).send("You are not allowed to edit this portfolio.");
  }

  const editIdentifier = portfolio.portfolioId || portfolio.slug || portfolio.id;

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  if (!isPro) {
    const nextUrl = `/portfolio/${encodeURIComponent(editIdentifier)}/edit`;
    return res.redirect(
      `/pricing?reason=edit&next=${encodeURIComponent(nextUrl)}`
    );
  }

  const formData = {
    ...portfolio,
    portfolioId: editIdentifier,
    aboutCardsText: toPipeRows(portfolio.aboutCards, ["title", "description"]),
    projectsText: toPipeRows(portfolio.projects, [
      "title",
      "platform",
      "description"
    ]),
    experiencesText: toPipeRows(portfolio.experiences, [
      "period",
      "title",
      "description"
    ]),
    shippingPointsText: (portfolio.shippingPoints || []).join("\n"),
    theme: normalizeTheme(portfolio.theme),
    layoutVariant: normalizeLayout(portfolio.layoutVariant)
  };

  return res.render("edit-portfolio", { portfolio: formData });
});

app.post("/portfolio/:portfolioId/edit", requireAuth, async (req, res) => {
  await loadDb();

  const identifier = req.params.portfolioId;

  const portfolio =
    db.data.portfolios.find((item) => item.portfolioId === identifier) ||
    db.data.portfolios.find(
      (item) => item.slug === identifier || item.id === identifier
    );

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  if (portfolio.ownerUserId !== req.session.user.id) {
    return res.status(403).send("You are not allowed to edit this portfolio.");
  }

  const user = getUserBySession(req);
  const isPro = hasActivePro(user);

  if (!isPro) {
    const nextUrl = `/portfolio/${encodeURIComponent(identifier)}/edit`;
    return res.redirect(
      `/pricing?reason=edit&next=${encodeURIComponent(nextUrl)}`
    );
  }

  const payload = buildPortfolioPayload(req);
  const previousFullName = portfolio.fullName;

  Object.assign(portfolio, payload, {
    updatedAt: new Date().toISOString()
  });

  if (payload.fullName !== previousFullName) {
    portfolio.slug = uniqueSlugFromName(
      payload.fullName,
      db.data.portfolios.filter((item) => item !== portfolio)
    );
  }

  applyPortfolioDefaults(portfolio);
  await db.write();

  return res.redirect("/dashboard");
});

app.get("/api/portfolios", async (req, res) => {
  await loadDb();
  return res.json(db.data.portfolios);
});

app.get("/:slug", async (req, res) => {
  await loadDb();

  const portfolio = db.data.portfolios.find(
    (item) => item.slug === req.params.slug
  );

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  return res.render("portfolio", { portfolio });
});

app.listen(PORT, () => {
  console.log(`Dynamic portfolio app running on http://localhost:${PORT}`);
});