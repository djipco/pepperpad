// Import external Node.js modules
const client = require('https');
const csvWriter = require('csv-write-stream');
const date = require("date-and-time");
const fs = require("fs");
const OpenAI = require("openai");
const path = require("path");
const pkg = require('package.json');
const recorder = require('node-record-lpcm16');

// Import Gpio module only on Linux (this is for GPIO inputs on the Pi)
let Gpio = undefined;
if (process.platform === "linux") Gpio = require("onoff").Gpio;

// Import relevant project classes
import {logError, logInfo} from "./Logger.js";
import credentials from "../config/.credentials.js";
import prefs from "../config/preferences.js";

export default class Application {

  constructor() {
    this.button = undefined;            // GPIO hardware button input
    this.callbacks = {};                // callbacks used in the app
    this.generating = false;            // whether the application is currently generating an image
    this.lastRecordingId = undefined;   // id of last recording
    this.lastRecordingStartTime = 0;    // start time of last recording
    this.lastRecordingStopTime = 0;     // stop time of last recording
    this.lastGenerationStartTime = 0;   // start time of last image generation
    this.lastGenerationStopTime = 0;    // stop time of last mage generation
    this.openai = undefined;            // OpenAI API
    this.recording = undefined;         // current audio recording
    this.timeouts = {};                 // timeouts used in the app
    this.window = nw.Window.get();      // NW.js main window
    this.writer = undefined;            // csv writer
  }

  start() {

    // Watch for various quitting signals
    this.callbacks.onExitRequest = this.#onExitRequest.bind(this);
    process.on("SIGINT", this.callbacks.onExitRequest);               // CTRL+C
    process.on("SIGQUIT", this.callbacks.onExitRequest);              // Keyboard quit
    process.on("SIGTERM", this.callbacks.onExitRequest);              // `kill` command
    this.window.on("close", this.callbacks.onExitRequest);            // Window closed

    // Display splash screen
    this.changeVisualState("splashscreen");

    // Log environment info
    logInfo(
      nw.App.manifest.title + " started " +
      "(NW.js " + process.versions["nw-flavor"].toUpperCase() + " v" + process.versions["nw"] +
      ", Chromium v" + process.versions["chromium"] + ", " +
      "Node.js v" + process.versions["node"] + ")"
    );

    // Show browser context dev tools
    if (prefs.debug.showBrowserDevTools) this.window.showDevTools();

    // Show Node context dev tools
    if (prefs.debug.showNodeDevTools) {
      chrome.developerPrivate.openDevTools({
        renderViewId: -1,
        renderProcessId: -1,
        extensionId: chrome.runtime.id
      });
    }

    // Instantiate OpenAI API object
    this.openai = new OpenAI({
      apiKey: credentials.openAiApiKey,
      dangerouslyAllowBrowser: true,
      timeout: prefs.timeouts.api * 1000
    });

    // Prepare CSV writer object
    if (!fs.existsSync(prefs.paths.transcriptionFile)) {
      this.writer = csvWriter({
        headers: ["id", "transcript", "prompt", "duration_audio", "duration_generation"]
      });
    } else {
      this.writer = csvWriter({sendHeaders: false});
    }

    // Watch for clicks on software start recording buttons
    const startRecordingSoftwareButton = document.getElementById('start-recording');
    this.callbacks.onStartRecordingSoftwareButtonClicked =
      this.#onStartRecordingSoftwareButtonClicked.bind(this);
    startRecordingSoftwareButton.addEventListener(
      "click",
      this.callbacks.onStartRecordingSoftwareButtonClicked
    );

    // Watch for clicks on software stop recording buttons
    const stopRecordingSoftwareButton = document.getElementById('stop-recording');
    this.callbacks.onStopRecordingSoftwareButtonClicked =
      this.#onStopRecordingSoftwareButtonClicked.bind(this);
    stopRecordingSoftwareButton.addEventListener(
      "click",
      this.callbacks.onStopRecordingSoftwareButtonClicked
    );

    // If we are on Linux (hopefully raspbian), we watch the hardware button for clicks
    if (Gpio && Gpio.accessible) {
      this.button = new Gpio(prefs.hardware.buttonPin, 'in', "both", {debounceTimeout: 20});
      this.callbacks.onHardwareButtonInteraction = this.#onHardwareButtonInteraction.bind(this);
      this.button.watch(this.callbacks.onHardwareButtonInteraction);
    }

    // Switch visuals
    setTimeout(() => this.changeVisualState("start"), 1200);

  }

  quit() {

    // Quickly hide window so reactivity appears fast
    this.window.hide();

    // Remove quitting listeners
    process.off("SIGINT", this.callbacks.onExitRequest);       // CTRL+C
    process.off("SIGQUIT", this.callbacks.onExitRequest);      // Keyboard quit
    process.off("SIGTERM", this.callbacks.onExitRequest);      // `kill` command
    this.window.removeAllListeners('close');                   // Window closed

    // Release resources used by the button
    if (Gpio && Gpio.accessible) {
      this.button.unwatchAll()
      this.button.unexport();
    }

    logInfo(`${nw.App.manifest.title} stopped`);

    // Close NW.js window and exit
    this.window.close(true);
    process.exit();

  }

  startRecording() {

    // Adjust visuals
    this.changeVisualState("start-recording");

    // Note start time
    this.lastRecordingStartTime = performance.now();

    // Generate unique recording id
    this.lastRecordingId = date.format(new Date(), 'YYYY-MM-DD.HH-mm-ss-SSS') + "." +
      Math.random().toString(32).substring(2, 12);
    const filename = this.lastRecordingId + "." + prefs.audio.format;
    const filepath = path.join(prefs.paths.recordedAudioFolder, filename);

    // Prepare recording to file
    const file = fs.createWriteStream(filepath, {encoding: 'binary'});

    // Start recording
    this.recording = recorder.record({
      sampleRate: 44100,
      channels: 1,
      audioType: prefs.audio.format
    });
    logInfo(`Recording started in: ${filepath}`);

    // Pipe recording stream to file
    this.recording.stream()
      .on('error', err => logError(err))
      .pipe(file);

    // Start a timeout to stop the recording if it's too long
    this.callbacks.onRecordingTimeout = this.#onRecordingTimeout.bind(this);
    this.timeouts.recording = setTimeout(
      this.callbacks.onRecordingTimeout,
      prefs.timeouts.recording * 1000
    );

    // Return filepath
    return filepath;

  }

  stopRecording() {

    // Cancel pending recording timeout
    if (this.timeouts.recording)  {
      clearTimeout(this.timeouts.recording);
      this.callbacks.onRecordingTimeout = undefined;
      this.timeouts.recording = undefined;
    }

    // Stop recording
    this.recording.stop();
    this.recording = undefined;
    logInfo(`Recording stopped`);
    this.lastRecordingStopTime = performance.now();

    // Assemble file name
    const filename = this.lastRecordingId + "." + prefs.audio.format;

    // Calculate recording duration
    const duration = (this.lastRecordingStopTime - this.lastRecordingStartTime) / 1000;
    const filepath = path.join(prefs.paths.recordedAudioFolder, filename);

    // Check if duration is too short
    if (duration < prefs.audio.minimumRecordingLength) {
      fs.unlink(filepath, () => {}); // remove recording file
      this.changeVisualState("stop-recording");
      throw new Error(`Recording duration too short (${duration.toFixed(2)} seconds).`);
    }

    this.changeVisualState("stop-recording");
    return filepath;

  }

  async generate(audioFilePath) {

    this.generating = true;
    this.changeVisualState("start-image-generation");

    // Get translated transcription from audio file
    let transcript;

    try {
      transcript = await this.transcribeAudio(audioFilePath);
    } catch (e) {
      logError(e.message);
      setTimeout(() => {
        this.changeVisualState("end-image-generation");
        this.generating = false;
      }, 1500);
      return;
    }

    const audioDuration = (this.lastRecordingStopTime - this.lastRecordingStartTime) / 1000;

    // A newline character gets automatically added. We remove it.
    transcript = transcript.trim();

    // When nothing is detected in the audio file, a bunch of dummy responses can be returned. Those
    // are the ones I have seen so far. In this case, we simply ignore and return.
    const dummyResponses = [
      "Thank you.",
      "Thank you for watching!",
      "Thanks for watching!",
      "For more information, visit www.fema.gov",
      "Welcome!",
      "you",
      "You",
      ""
    ];

    if (dummyResponses.includes(transcript)) {
      logInfo(`No transcript`);
      this.saveTranscript(this.lastRecordingId, "", "", audioDuration, 0);
      setTimeout(() => {
        this.changeVisualState("end-image-generation")
        this.generating = false;
      }, 1500);
      return;
    } else {
      logInfo(`Resulting transcript: "${transcript}"`);
    }

    // Get generated image from prompt
    let url, generatioDuration;
    try {
      url = await this.generateImageFromPrompt(transcript);
      generatioDuration = (this.lastGenerationStopTime - this.lastGenerationStartTime) / 1000;
      logInfo(`Generated image in ${generatioDuration.toFixed(1)} seconds`);
    } catch (e) {
      logError(e);
      this.changeVisualState("end-image-generation");
      this.saveTranscript(
        this.lastRecordingId,
        transcript,
        prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript),
        audioDuration,
        0
      );
      this.generating = false;
      return;
    }

    const localImagePath = path.join(prefs.paths.generatedVisualsFolder, `${this.lastRecordingId}.png`);

    try {
      await this.downloadImage(url, localImagePath);
      logInfo(`Image saved to local file: ${localImagePath}`);
    } catch (e) {
      logError(e);
      this.changeVisualState("end-image-generation");
      this.saveTranscript(
        this.lastRecordingId,
        transcript,
        prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript),
        audioDuration,
        generatioDuration
      );
      this.generating = false;
      return;
    }

    // Show image
    document.getElementById("generated-image").src = localImagePath;

    this.changeVisualState("end-image-generation");

    this.saveTranscript(
      this.lastRecordingId,
      transcript,
      prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript),
      audioDuration,
      generatioDuration
    );

    this.generating = false;

  }

  async transcribeAudio(audioFilePath) {

    logInfo("Transcribing and translating audio");

    let transcript;

    try {

      transcript = await this.openai.audio.translations.create({
        file: fs.createReadStream(audioFilePath),
        model: "whisper-1",
        response_format: "text"
      });

    } catch (e) {
      throw new Error(`Could not complete transcription and translation: ${e.message}`);
    }

    return transcript;

    // If the audio recording is too short, we get a 400 Invalide File Format error.

    // We currently support the following languages through both the transcriptions and translations
    // endpoint:
    //
    // Afrikaans, Arabic, Armenian, Azerbaijani, Belarusian, Bosnian, Bulgarian, Catalan, Chinese,
    // Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, Galician, German, Greek,
    // Hebrew, Hindi, Hungarian, Icelandic, Indonesian, Italian, Japanese, Kannada, Kazakh, Korean,
    // Latvian, Lithuanian, Macedonian, Malay, Marathi, Maori, Nepali, Norwegian, Persian, Polish,
    // Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish,
    // Tagalog, Tamil, Thai, Turkish, Ukrainian, Urdu, Vietnamese, and Welsh.

    // While the underlying model was trained on 98 languages, we only list the languages that
    // exceeded <50% word error rate (WER) which is an industry standard benchmark for speech to
    // text model accuracy. The model will return results for languages not listed above but the
    // quality will be low.

  }

  async generateImageFromPrompt(transcript) {

    logInfo(`Starting image generation`);

    this.lastGenerationStartTime = performance.now();

    // Inject the transcript in the general prompt and generate the image
    const prompt = prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript);

    const options = {
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",  // standard or hd
      style: "vivid"        // vivid or natural
    };

    let response;
    try {
      response = await this.openai.images.generate(options);
    } catch (e) {
      throw e.error;
    }

    this.lastGenerationStopTime = performance.now();

    return response.data[0].url;

  }

  async downloadImage(url, filepath) {

    return new Promise((resolve, reject) => {

      client.get(url, (res) => {
        if (res.statusCode === 200) {
          res.pipe(fs.createWriteStream(filepath))
            .on('error', reject)
            .once('close', () => resolve(filepath));
        } else {
          res.resume(); // Consume response data to free up memory
          reject(new Error(`Request Failed With a Status Code: ${res.statusCode}`));
        }
      });

    });

  }

  getLastFilePath(directory) {

    try {

      const files = fs.readdirSync(directory); // Synchronously read directory contents

      if (files.length > 0) {
        return path.join(directory, files[files.length - 1]);
      } else {
        logError(`No file found in directory ${directory}`);
        return undefined;
      }

    } catch (error) {
      logError(`Error finding last file in directory ${directory} : ${error}`);
      return undefined;
    }

  }

  saveTranscript(id, transcript, prompt, audioDuration, generationDuration) {

    this.writer.pipe(
      fs.createWriteStream(prefs.paths.transcriptionFile, {flags: 'a'})
    );

    this.writer.write({
      id,
      transcript: transcript.trim(),
      prompt,
      duration_audio: audioDuration.toFixed(2),
      duration_generation: generationDuration.toFixed(2)
    });

    this.writer.end();

  }

  changeVisualState(state) {

    if (state === "splashscreen") {

      document.getElementById("name").textContent = pkg.title;
      document.getElementsByTagName("title")[0].textContent = pkg.title;
      document.getElementById("version").textContent = `v${pkg.version}`;
      document.getElementById("splashscreen").style.opacity = "1";

    } else if (state === "start") {

      document.getElementById("splashscreen").style.opacity = "0";

      // Display last generated image
      const path = this.getLastFilePath(prefs.paths.generatedVisualsFolder);
      if (path) document.getElementById("generated-image").src = path;
      document.getElementById("generated-image").style.opacity = "1";

      setTimeout(() => {

        if (prefs.debug.panel) {
          document.getElementById("debug").style.display = "block";
        } else {
          document.getElementById("debug").style.display = "none";
        }

      }, 2000);


    } else if (state === "start-recording") {

      document.getElementById("start-recording").style.display = "none";
      document.getElementById("stop-recording").style.display = "block";

      document.getElementById("recording").play();
      document.getElementById("recording").style.opacity = "1";

    // } else if (state === "abort-recording") {
    //
    //   document.getElementById("start-recording").style.display = "block";
    //   document.getElementById("stop-recording").style.display = "none";
    //
    //   document.getElementById("recording").style.opacity = "0";

    } else if (state === "stop-recording") {

      document.getElementById("start-recording").style.display = "block";
      document.getElementById("stop-recording").style.display = "none";

      document.getElementById("recording").style.opacity = "0";

      setTimeout(() => {
        document.getElementById("recording").pause();
        document.getElementById("recording").currentTime = 0;
      }, 3000);

    } else if (state === "start-image-generation") {

      document.getElementById("generation").play();
      document.getElementById("generation").style.opacity = "1";
      document.getElementById("generated-image").style.opacity = "0";

    } else if (state === "end-image-generation") {

      document.getElementById("generation").style.opacity = "0";
      document.getElementById("generated-image").style.opacity = "1";

      setTimeout(() => {
        document.getElementById("generation").pause();
        document.getElementById("generation").currentTime = 0;
      }, 3000);

    }

  }

  #onExitRequest() {
    this.quit();
  }

  async #onHardwareButtonInteraction(err, value) {

    if (err) {
      logError(err.message);
      return;
    }

    if (value) {    // Button pressed

      if (this.recording || this.generating) {
        logInfo("Application is currently recording or generating. Ignoring request to start recording.");
        return;
      }

      return this.startRecording();

    } else {      // Button released

      if (!this.recording) {
        logInfo("Application is not currently recording. Ignoring request to stop recording.");
        return;
      }

      let filepath;

      try {
        filepath = this.stopRecording();
      } catch (e) {
        logInfo(e.message);
        return;
      }

      await this.generate(filepath);

    }

  }

  async #onStopRecordingSoftwareButtonClicked() {

    if (!this.recording) {
      logInfo("Application is not currently recording. Ignoring request to stop recording.");
      return;
    }

    let filepath;

    try {
      filepath = this.stopRecording();
    } catch (e) {
      logInfo(e.message);
      return;
    }

    await this.generate(filepath);

  }

  #onStartRecordingSoftwareButtonClicked() {

    if (this.recording || this.generating) {
      logInfo("Application is currently recording or generating. Ignoring request to start recording.");
      return;
    }

    return this.startRecording();

  }

  async #onRecordingTimeout() {

    // Reset timeout
    this.callbacks.onRecordingTimeout = undefined;
    this.timeouts.recording = undefined;
    logInfo(`Recording timeout triggered (${prefs.timeouts.recording}s)`);

    // Stop recording and generate image
    const filepath = this.stopRecording();
    await this.generate(filepath);

  }

}
