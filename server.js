const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const { customAlphabet } = require("nanoid");

const app = express();
const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

const dbFile = path.join(__dirname, "data", "portfolio-db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { portfolios: [] });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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
    aboutCards: parsePipeRows(req.body.aboutCards, 2).map(([title, description]) => ({
      title,
      description
    })),
    projects: parsePipeRows(req.body.projects, 3).map(([title, platform, description]) => ({
      title,
      platform,
      description
    })),
    experiences: parsePipeRows(req.body.experiences, 3).map(([period, title, description]) => ({
      period,
      title,
      description
    })),
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
  if (record.shippingPoints.length === 0) {
    record.shippingPoints = [
      "SwiftUI + UIKit integration",
      "Performance-first interaction design",
      "Accessibility at enterprise scale"
    ];
  }

  if (record.aboutCards.length === 0) {
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

  if (record.projects.length === 0) {
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

  if (record.experiences.length === 0) {
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

    if (alreadyOwnedByAnotherUser) {
      return;
    }

    const isLegacyMatch =
      !item.ownerUserId &&
      (normalizedOwnerEmail === normalizedUserEmail ||
        normalizedCreatorEmail === normalizedUserEmail ||
        normalizedContactEmail === normalizedUserEmail ||
        normalizedItemName === normalizedUserName);

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
    createdAt: new Date().toISOString()
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

app.get("/dashboard", requireAuth, async (req, res) => {
  await claimLegacyPortfoliosForUser(req.session.user);
  await loadDb();
  const myPortfolios = db.data.portfolios.filter(
    (item) => item.ownerUserId === req.session.user.id
  );
  res.render("dashboard", { portfolios: myPortfolios });
});

app.get("/form.html", requireAuth, async (req, res) => {
  await loadDb();
  res.render("form");
});

app.post("/create", requireAuth, async (req, res) => {
  await loadDb();

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

  res.redirect(`/${slug}`);
});

app.get("/portfolio/:portfolioId/edit", requireAuth, async (req, res) => {
  await loadDb();
  const portfolio = db.data.portfolios.find(
    (item) => item.portfolioId === req.params.portfolioId
  );

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  if (portfolio.ownerUserId !== req.session.user.id) {
    return res.status(403).send("You are not allowed to edit this portfolio.");
  }

  const formData = {
    ...portfolio,
    aboutCardsText: toPipeRows(portfolio.aboutCards, ["title", "description"]),
    projectsText: toPipeRows(portfolio.projects, ["title", "platform", "description"]),
    experiencesText: toPipeRows(portfolio.experiences, ["period", "title", "description"]),
    shippingPointsText: (portfolio.shippingPoints || []).join("\n"),
    theme: normalizeTheme(portfolio.theme),
    layoutVariant: normalizeLayout(portfolio.layoutVariant)
  };

  return res.render("edit-portfolio", { portfolio: formData });
});

app.post("/portfolio/:portfolioId/edit", requireAuth, async (req, res) => {
  await loadDb();
  const portfolio = db.data.portfolios.find(
    (item) => item.portfolioId === req.params.portfolioId
  );

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  if (portfolio.ownerUserId !== req.session.user.id) {
    return res.status(403).send("You are not allowed to edit this portfolio.");
  }

  const payload = buildPortfolioPayload(req);
  const previousFullName = portfolio.fullName;
  Object.assign(portfolio, payload, {
    updatedAt: new Date().toISOString()
  });

  if (payload.fullName !== previousFullName) {
    portfolio.slug = uniqueSlugFromName(
      payload.fullName,
      db.data.portfolios.filter((item) => item.portfolioId !== portfolio.portfolioId)
    );
  }

  applyPortfolioDefaults(portfolio);

  await db.write();
  return res.redirect("/dashboard");
});

app.get("/api/portfolios", async (req, res) => {
  await loadDb();
  res.json(db.data.portfolios);
});

app.get("/:slug", async (req, res) => {
  await loadDb();
  const portfolio = db.data.portfolios.find((item) => item.slug === req.params.slug);

  if (!portfolio) {
    return res.status(404).send("Portfolio not found.");
  }

  res.render("portfolio", { portfolio });
});

app.listen(PORT, () => {
  console.log(`Dynamic portfolio app running on http://localhost:${PORT}`);
});
