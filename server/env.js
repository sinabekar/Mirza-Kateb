// Loads server/.env into process.env. Imported FIRST (before any module
// that reads process.env at load time) so ESM evaluation order is correct.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });
