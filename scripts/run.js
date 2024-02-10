// Node.js module import
import {spawn} from "child_process";
import path from "path";
import { fileURLToPath } from 'url';
import prefs from "../config/preferences.js";

// Get current file and directory name and define necessary paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");
const engines = path.join(root, prefs.paths.enginesFolder);

try {
  const command = path.join(engines, prefs.engines[process.platform]);
  const child = spawn(command, [root], { detached: true, stdio: "ignore" });
  child.unref();
} catch (e) {
  console.error(`Error: Unable to start "${prefs.engines[process.platform]}" engine.`);
  process.exit(1);
}
