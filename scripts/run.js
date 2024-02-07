// Modules
import {spawn} from "child_process";
import path from "path";
import { fileURLToPath } from 'url';

// Get file and directory names
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment
let root = path.join(__dirname, "..");
let engines= path.join(root, "engines");

// Executables accodring to platform
let apps = {
  macos: path.join("nwjs.app", "Contents", "MacOS", "nwjs"),
  windows: path.join("nwjs-sdk-v0.83.0-win-x64", "nw.exe"),
  linux: path.join("nwjs-sdk-v0.51.2-linux-x64", "nw"),
};

// Check current platform
let command;
if (process.platform === "darwin") {
  command = path.join(engines, apps.macos);
} else if (process.platform === "win32") {
  command = path.join(engines, apps.windows);
} else {
  throw new Error(`Unsupported platform! (${process.platform})`);
}

const child = spawn(command, [root], { detached: true, stdio: "ignore" });
child.unref();
