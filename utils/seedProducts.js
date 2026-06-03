/**
 * utils/seedProducts.js
 * ─────────────────────────────────────────────────────────────
 * Seed sample products for the ordering system
 * Run this to populate initial product catalog
 * ─────────────────────────────────────────────────────────────
 */

const { Product } = require("../db");

const SAMPLE_PRODUCTS = [
  {
    name: "Laptop Computer 15.6 inch",
    description: "High-performance laptop with 8GB RAM, 256GB SSD, Intel Core i5 processor. Perfect for students and professionals.",
    price: 45000,
    category: "products",
    image: "",
    imageUrl: "",
    keywords: ["laptop", "computer", "notebook", "pc", "device"],
    inStock: true,
    isActive: true
  },
  {
    name: "Wireless Mouse",
    description: "Ergonomic wireless mouse with USB receiver. Long battery life, smooth tracking.",
    price: 650,
    category: "products",
    image: "",
    imageUrl: "",
    keywords: ["mouse", "wireless", "pointer", "cursor", "click"],
    inStock: true,
    isActive: true
  },
  {
    name: "Mechanical Keyboard RGB",
    description: "Gaming mechanical keyboard with RGB backlight, Blue switches, anti-ghosting. Premium build quality.",
    price: 2500,
    category: "products",
    image: "",
    imageUrl: "",
    keywords: ["keyboard", "mechanical", "rgb", "gaming", "typing", "keys"],
    inStock: true,
    isActive: true
  },
  {
    name: "USB Headphone with Mic",
    description: "Comfortable over-ear headphone with built-in microphone. Perfect for online classes and meetings.",
    price: 1200,
    category: "products",
    image: "",
    imageUrl: "",
    keywords: ["headphone", "headset", "mic", "microphone", "audio", "earphone", "music"],
    inStock: true,
    isActive: true
  },
  {
    name: "Webcam HD 1080p",
    description: "Full HD webcam with built-in microphone. Auto-focus, noise reduction. For video calls and streaming.",
    price: 1800,
    category: "products",
    image: "",
    imageUrl: "",
    keywords: ["webcam", "camera", "video", "streaming", "call", "hd"],
    inStock: true,
    isActive: true
  },

  // Courses Category
  {
    name: "Office Programme 360",
    description: "Complete MS Office training including Word, Excel, PowerPoint, Access. Job-ready skills in 3 months.",
    price: 8000,
    category: "courses",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "Graphic Design with AI",
    description: "Master graphic design using Photoshop, Illustrator, and AI tools. Create stunning designs for clients.",
    price: 12000,
    category: "courses",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "Web Development Bootcamp",
    description: "Full-stack web development: HTML, CSS, JS, React, Node.js. Build real projects and get job support.",
    price: 15000,
    category: "courses",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "Digital Marketing Course",
    description: "Learn SEO, Social Media Marketing, Google Ads, Facebook Ads. Grow any business digitally.",
    price: 10000,
    category: "courses",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "Video Editing with AI",
    description: "Professional video editing using Premiere Pro, After Effects, and AI tools. Create YouTube content.",
    price: 11000,
    category: "courses",
    image: "",
    inStock: true,
    isActive: true
  },

  // Services Category
  {
    name: "Website Development (Basic)",
    description: "Professional static website with 5 pages. Responsive design, contact form, basic SEO.",
    price: 8000,
    category: "services",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "Logo Design",
    description: "Professional logo design with 3 concepts, unlimited revisions. Vector files included.",
    price: 3000,
    category: "services",
    image: "",
    inStock: true,
    isActive: true
  },
  {
    name: "SEO Optimization",
    description: "Complete on-page SEO for your website. Meta tags, keywords, content optimization, speed improvement.",
    price: 5000,
    category: "services",
    image: "",
    inStock: true,
    isActive: true
  }
];

/**
 * Seed products to database
 * Only adds products if none exist in that category
 */
async function seedProducts() {
  try {
    console.log("🌱 Checking for existing products...");

    const existingCount = await Product.countDocuments();
    if (existingCount > 0) {
      console.log(`📦 Products already exist (${existingCount} found). Skipping seed.`);
      return;
    }

    console.log("🌱 Seeding sample products...");

    const insertedProducts = await Product.insertMany(SAMPLE_PRODUCTS);
    console.log(`✅ Successfully seeded ${insertedProducts.length} products!`);

    // Log by category
    const productsByCategory = {
      products: 0,
      courses: 0,
      services: 0
    };

    insertedProducts.forEach(p => {
      productsByCategory[p.category]++;
    });

    console.log("   📱 Products:", productsByCategory.products);
    console.log("   📚 Courses:", productsByCategory.courses);
    console.log("   🔧 Services:", productsByCategory.services);

  } catch (err) {
    console.error("❌ Seed Products Error:", err.message);
  }
}

/**
 * Get all products formatted for AI system prompt
 */
function getProductsForAI() {
  const byCategory = {
    products: SAMPLE_PRODUCTS.filter(p => p.category === "products"),
    courses: SAMPLE_PRODUCTS.filter(p => p.category === "courses"),
    services: SAMPLE_PRODUCTS.filter(p => p.category === "services")
  };

  let text = "\n📦 AVAILABLE PRODUCTS FOR SALE:\n";
  text += "═".repeat(50) + "\n\n";

  text += "🖥️ PRODUCTS:\n";
  byCategory.products.forEach((p, i) => {
    text += `  ${i + 1}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
  });

  text += "\n📚 COURSES:\n";
  byCategory.courses.forEach((p, i) => {
    text += `  ${i + 1}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
  });

  text += "\n🔧 SERVICES:\n";
  byCategory.services.forEach((p, i) => {
    text += `  ${i + 1}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
  });

  return text;
}

module.exports = {
  seedProducts,
  getProductsForAI,
  SAMPLE_PRODUCTS
};