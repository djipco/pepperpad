// Import external Node.js modules
const OpenAI = require("openai");
const fs = require("fs");
const recorder = require('node-record-lpcm16');
const path = require("path");
const date = require("date-and-time");
// const Gpio = require("onoff").Gpio;
const client = require('https');
const csvWriter = require('csv-write-stream');

// Import relevant project classes
import credentials from "../config/.credentials.js";
import prefs from "../config/preferences.js";
import {logError, logInfo} from "./Logger.js";

export default class Application {

  constructor() {

    this.lastRecordingId = undefined; // IS THIS THE BEST WAY?????
    this.lastRecordingStartTime = 0;
    this.lastRecordingStopTime = 0;
    this.lastGenerationStartTime = 0;
    this.lastGenerationStopTime = 0;

    this.callbacks = {};
    this.timeouts = {};
    this.window = nw.Window.get();
    this.writer = undefined;
  }

  start() {

    // Watch for various quitting signals
    this.callbacks.onExitRequest = this.#onExitRequest.bind(this);
    process.on("SIGINT", this.callbacks.onExitRequest);       // CTRL+C
    process.on("SIGQUIT", this.callbacks.onExitRequest);      // Keyboard quit
    process.on("SIGTERM", this.callbacks.onExitRequest);      // `kill` command
    this.window.on("close", this.callbacks.onExitRequest);    // Window closed

    logInfo(
      nw.App.manifest.title + " started " +
      "(NW.js " + process.versions["nw-flavor"].toUpperCase() + " v" + process.versions["nw"] +
      ", Chromium v" + process.versions["chromium"] + ", " +
      "Node.js v" + process.versions["node"] + ")"
    );

    // Show dev tools
    if (prefs.debug.showDevTools) this.window.showDevTools();
    if (prefs.debug.panel) {
      document.getElementById("debug").style.display = "block";
    } else {
      document.getElementById("debug").style.display = "none";
    }

    // Instantiate OpenAI API object
    this.openai = new OpenAI({apiKey: credentials.openAiApiKey, dangerouslyAllowBrowser: true});

    // Prepare CSV writer object
    if (!fs.existsSync(prefs.paths.transcriptionFile)) {
      this.writer = csvWriter({
        headers: ["id", "transcript", "prompt", "duration_audio", "duration_generation"]
      });
    } else {
      this.writer = csvWriter({sendHeaders: false});
    }

    // Watch for clicks on software buttons
    this.startRecordingSoftwareButton = document.getElementById('start-recording');
    this.callbacks.onStartRecordingSoftwareButtonClicked =
      this.#onStartRecordingSoftwareButtonClicked.bind(this);
    this.startRecordingSoftwareButton.addEventListener(
      "click",
      this.callbacks.onStartRecordingSoftwareButtonClicked
    );

    this.stopRecordingSoftwareButton = document.getElementById('stop-recording');
    this.callbacks.onStopRecordingSoftwareButtonClicked =
      this.#onStopRecordingSoftwareButtonClicked.bind(this);
    this.stopRecordingSoftwareButton.addEventListener(
      "click",
      this.callbacks.onStopRecordingSoftwareButtonClicked
    );

    // Display last generated image
    const path = this.getLastFilePath(prefs.paths.generatedVisualsFolder);
    if (path) document.getElementById("image").src = path;
    document.getElementById("image").style.opacity = "1";

    // Instantiate hardware record button
    // this.button = new Gpio(4, 'in', "both", {debounceTimeout: 20});

    // Watch for presses on hardware button
    // this.button.watch((err, value) => {
    //   if (err) throw err;
    //
    // });

  }

  quit() {

    process.off("SIGINT", this.callbacks.onExitRequest);       // CTRL+C
    process.off("SIGQUIT", this.callbacks.onExitRequest);      // Keyboard quit
    process.off("SIGTERM", this.callbacks.onExitRequest);      // `kill` command
    this.window.removeAllListeners('close');                   // Window closed

    this.window.closeDevTools();

    // this.button.unexport();

    logInfo(`${nw.App.manifest.title} stopped`);

    this.window.hide();
    this.window.close(true);
    process.exit();

  }

  #onExitRequest() {
    this.quit();
  }

  #onStartRecordingSoftwareButtonClicked() {
    return this.startRecording();
  }

  async #onStopRecordingSoftwareButtonClicked() {

    let filepath;

    try {
      filepath = this.stopRecording();
    } catch (e) {
      this.changeVisualState("abort-image-generation")
      logInfo(e.message);
      return;
    }

    await this.generate(filepath);

  }

  startRecording() {

    this.lastRecordingStartTime = performance.now();

    this.changeVisualState("start-recording");

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

    this.recording.stream()
      .on('error', err => logError(err))
      .pipe(file);

    // Start a timeout to stop the recording if it's too long
    this.callbacks.onRecordingTimeout = this.#onRecordingTimeout.bind(this);
    this.timeouts.recording = setTimeout(
      this.callbacks.onRecordingTimeout,
      prefs.audio.recordingTimeout * 1000
    );

    // Return filepath
    return filepath;

  }

  async #onRecordingTimeout() {

    // Reset timeout
    this.callbacks.onRecordingTimeout = undefined;
    this.timeouts.recording = undefined;
    logInfo(`Recording timeout triggered (${prefs.audio.recordingTimeout}s)`);

    // Stop recording and generate image
    const filepath = this.stopRecording();
    await this.generate(filepath);

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
    logInfo(`Recording stopped`);
    this.lastRecordingStopTime = performance.now();

    const filename = this.lastRecordingId + "." + prefs.audio.format;

    // Calculate recording duration
    const duration = (this.lastRecordingStopTime - this.lastRecordingStartTime) / 1000;
    const filepath = path.join(prefs.paths.recordedAudioFolder, filename);

    // Check if duration is too short
    if (duration < prefs.audio.minimumRecordingLength) {
      fs.unlink(filepath, () => {}); // remove recording file
      throw new Error(`Recording duration too short (${duration.toFixed(2)} seconds).`);
    }

    this.changeVisualState("stop-recording")
    return filepath;

  }

  async generate(audioFilePath) {

    // Get translated transcription from audio file
    let transcript;

    this.changeVisualState("start-image-generation");

    try {
      transcript = await this.transcribeAudio(audioFilePath);
    } catch (e) {
      logError(e.message)
      this.changeVisualState("end-image-generation");
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
      "Welcome!"
    ];


    if (dummyResponses.includes(transcript)) {
      logInfo(`No transcript`);
      this.saveTranscript(this.lastRecordingId, "", "", audioDuration, 0);
      this.changeVisualState("end-image-generation");
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
      return;
    }

    // Show image
    document.getElementById("image").src = localImagePath;

    this.changeVisualState("end-image-generation");

    this.saveTranscript(
      this.lastRecordingId,
      transcript,
      prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript),
      audioDuration,
      generatioDuration
    );

  }

  async transcribeAudio(audioFilePath) {

    // we need a timeout here!!!!

    logInfo("Transcribing audio");

    return this.openai.audio.translations.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
      response_format: "text"
    });

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

    // WE NEED A TIMEOUT HERE!!!

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

    if (state === "start-recording") {

      document.getElementById("start-recording").style.display = "none";
      document.getElementById("stop-recording").style.display = "block";

    } else if (state === "stop-recording") {

      document.getElementById("start-recording").style.display = "none";
      document.getElementById("stop-recording").style.display = "none";

    } else if (state === "start-image-generation") {

      document.getElementById("video").play();
      document.getElementById("video").style.opacity = "1";
      document.getElementById("image").style.opacity = "0";

    } else if (state === "end-image-generation") {

      document.getElementById("start-recording").style.display = "block";
      document.getElementById("stop-recording").style.display = "none";

      document.getElementById("video").style.opacity = "0";
      document.getElementById("image").style.opacity = "1";

      setTimeout(() => {
        document.getElementById("video").pause();
        document.getElementById("video").currentTime = 0;
      }, 3000);

    } else if (state === "abort-image-generation") {
      document.getElementById("start-recording").style.display = "block";
      document.getElementById("stop-recording").style.display = "none";
    }

  }

}
