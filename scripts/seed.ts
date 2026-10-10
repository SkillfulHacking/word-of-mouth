// Creates an admin. Usage: WOM_ADMIN_PASSWORD=... pnpm seed [username]
// Note: the app itself creates the first admin on its first start when WOM_ADMIN_PASSWORD is set and the
// database has no users, so you only need this to add another admin.
import { hashPassword } from "../src/lib/auth";
import { db } from "../src/lib/db";

const username = (process.argv[2] ?? "admin").toLowerCase();
const password = process.env.WOM_ADMIN_PASSWORD;
if (!password || password.length < 8) {
  console.error("Set WOM_ADMIN_PASSWORD (8+ characters).");
  process.exit(1);
}

const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (existing) {
  console.log(`User "${username}" already exists (the app creates the first admin automatically when WOM_ADMIN_PASSWORD is set), nothing to do.`);
  process.exit(0);
}
db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, ?, 'admin')").run(username, hashPassword(password));
console.log(`Created admin "${username}".`);
