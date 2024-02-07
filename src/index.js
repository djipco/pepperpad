import Application from "./Application.js"
import {logInfo} from "./Logger.js";

// Bootstrap!
logInfo(
  nw.App.manifest.title + " started " +
  "(NW.js " + process.versions["nw-flavor"].toUpperCase() + " v" + process.versions["nw"] +
  ", Chromium v" + process.versions["chromium"] + ", " +
  "Node.js v" + process.versions["node"] + ")"
);

// Instantiate application
new Application();
