// Import external Node.js modules
const OpenAI = require("openai");
const fs = require("fs");
const recorder = require('node-record-lpcm16');
const path = require('path');
const date = require('date-and-time');
// const Gpio = require("onoff").Gpio;
const client = require('https');
const csvWriter = require('csv-write-stream');

// Import relevant project classes
import credentials from "../config/.credentials.js";
import prefs from "../config/preferences.js";
import {logError, logInfo} from "./Logger.js";

export default class Application {

  constructor() {
    this.recordingId = undefined; // IS THIS THE BEST WAY?????
    this.callbacks = {};
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

    // Instantiate OpenAI API object
    this.openai = new OpenAI({apiKey: credentials.openAiApiKey, dangerouslyAllowBrowser: true});

    // Prepare CSV writer object
    if (!fs.existsSync(prefs.paths.transcriptionFile)) {
      this.writer = csvWriter({ headers: ["id", "transcript", "prompt"]});
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
    document.getElementById("start-recording").style.display = "none";
    document.getElementById("stop-recording").style.display = "block";
    return this.startRecording();
  }

  async #onStopRecordingSoftwareButtonClicked() {

    // Adjust software button visibility
    document.getElementById("start-recording").style.display = "none";
    document.getElementById("stop-recording").style.display = "none";

    const filepath = this.stopRecording();

    // Display video during generation of the image
    document.getElementById("video").play();
    document.getElementById("video").style.opacity = "1";
    document.getElementById("image").style.opacity = "0";

    // Generate final image
    await this.generate(filepath);

    // Adjust software button visibility
    document.getElementById("start-recording").style.display = "block";
    document.getElementById("stop-recording").style.display = "none";

    // Hide video
    document.getElementById("video").style.opacity = "0";
    document.getElementById("image").style.opacity = "1";

    setTimeout(() => {
      document.getElementById("video").pause();
      document.getElementById("video").currentTime = 0;
    }, 3000);

  }

  startRecording() {

    // WE NEED TO ADD A TIMEOUT HERE!!!

    // Generate unique recording id
    this.recordingId = date.format(new Date(), 'YYYY-MM-DD.HH-mm-ss-SSS') + "." +
      Math.random().toString(32).substring(2, 12);
    const filename = this.recordingId + "." + prefs.audio.format;
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

    // Return filepath
    return filepath;

  }

  stopRecording() {

    this.recording.stop();
    logInfo(`Recording stopped`);

    const filename = this.recordingId + "." + prefs.audio.format;
    return path.join(prefs.paths.recordedAudioFolder, filename);

  }

  async generate(audioFilePath) {

    // Get translated transcription from audio file
    let transcript;

    try {
      transcript = await this.transcribeAudio(audioFilePath);
    } catch (e) {
      logError(e)
      return;
    }

    // A newline character gets automatically added. We remove it.
    transcript = transcript.trim();

    // When nothing is detected in the audio file, a bunch of dummy responses can be returned. Those
    // are the ones I have seen so far. In this case, we simply ignore and return.
    const dummyResponses = [
      "Thank you.",
      "Thank you for watching!",
      "Thanks for watching!"
    ];

    if (dummyResponses.includes(transcript)) {
      logInfo(`Resulting transcript: ""`);
      this.saveTranscript(this.recordingId, "", "");
      return;
    } else {
      logInfo(`Resulting transcript: "${transcript}"`);
      this.saveTranscript(
        this.recordingId,
        transcript,
        prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript)
      );
    }

    // Get generated image from prompt
    let url;
    try {
      url = await this.generateImageFromPrompt(transcript);
      logInfo(`Generated image URL: ${url}`);
    } catch (e) {
      logError(e)
      return;
    }

    const localImagePath = path.join(prefs.paths.generatedVisualsFolder, `${this.recordingId}.png`);

    try {
      await this.downloadImage(url, localImagePath);
      logInfo(`Image downloaded to ${localImagePath}`);
    } catch (e) {
      logError(e);
    }

    // Show image
    document.getElementById("image").src = localImagePath;
    //   HERE WE NEED FOR THE IMAGE TO BE LOADED AND DISPLAYED BEFORE FADE IN


  }

  async transcribeAudio(audioFilePath) {

    // we need a timeout here!!!!

    return this.openai.audio.translations.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
      response_format: "text",
      prompt: prefs.ai.translation.prompt
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

    // Inject the transcript in the general prompt and generate the image
    const prompt = prefs.ai.generation.prompts[0].replace("{QUOTE}", transcript);

    console.log(prompt);

    const options = {
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",  // standard or hd
      style: "vivid"        // vivid or natural
    };

    const response = await this.openai.images.generate(options);
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

  saveTranscript(id, transcript, prompt) {

    this.writer.pipe(
      fs.createWriteStream(prefs.paths.transcriptionFile, {flags: 'a'})
    );

    this.writer.write({
      id,
      transcript: transcript.trim(),
      prompt
    });

    this.writer.end();

  }

}
