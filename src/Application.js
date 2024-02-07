// Import Node.js modules
import {logError, logInfo} from "./Logger.js";

const OpenAI = require("openai");
const fs = require("fs");
const recorder = require('node-record-lpcm16');
const path = require('path');
const date = require('date-and-time');

// Import hidden credentials
import credentials from "../config/.credentials.js";
import preferences from "../config/preferences.js";

export default class Application {

  constructor() {

    this.recordingId = undefined;
    this.callbacks = {};
    this.window = nw.Window.get();

    // Watch for various quitting signals
    this.callbacks.onExitRequest = this.onExitRequest.bind(this);
    process.on("SIGINT", this.callbacks.onExitRequest);       // CTRL+C
    process.on("SIGQUIT", this.callbacks.onExitRequest);      // Keyboard quit
    process.on("SIGTERM", this.callbacks.onExitRequest);      // `kill` command
    this.window.on("close", this.callbacks.onExitRequest);    // Window closed

    // Show dev tools
    if (preferences.showDevTools) this.window.showDevTools();

    // Instantiate OpenAI API object
    this.openai = new OpenAI({apiKey: credentials.openAiApiKey, dangerouslyAllowBrowser: true});

    // Watch for clicks on buttons
    this.startRecordingButton = document.getElementById('start-recording');
    this.callbacks.onStartRecordingButtonClicked = this.startRecording.bind(this);
    this.startRecordingButton.addEventListener("click", this.callbacks.onStartRecordingButtonClicked);

    this.stopRecordingButton = document.getElementById('stop-recording');
    this.callbacks.onStopRecordingButtonClicked = this.stopRecording.bind(this);
    this.stopRecordingButton.addEventListener("click", this.callbacks.onStopRecordingButtonClicked);

  }

  onExitRequest() {
    // if (error) logError(error);
    this.shutdown();
  }

  shutdown() {
    logInfo(`${nw.App.manifest.title} stopped`);
    this.window.hide();
    this.window.close(true);
    process.exit();
  }

  startRecording() {

    document.getElementById("start-recording").style.display = "none";
    document.getElementById("stop-recording").style.display = "block";

    // Generate unique recording id
    this.recordingId = date.format(new Date(), 'YYYY-MM-DD.HH-mm-ss-SSS') + "." +
      Math.random().toString(32).substring(2, 12);
    const filename = this.recordingId + "." + preferences.audioRecordingFormat;
    const filepath = path.join("recordings", filename);

    // Prepare recording to file
    const file = fs.createWriteStream(filepath, {encoding: 'binary'});

    // Start recording
    this.recording = recorder.record({
      sampleRate: 44100,
      channels: 1,
      audioType: preferences.audioRecordingFormat
    });

    logInfo(`Recording started in ${filepath}`);

    this.recording.stream()
      .on('error', err => logError(err))
      .pipe(file);

    // Return filepath
    return filepath;

  }

  stopRecording() {

    console.log("stop rec");

    document.getElementById("start-recording").style.display = "none";
    document.getElementById("stop-recording").style.display = "block";

    this.recording.stop();
    logInfo(`Recording stopped`);

    const filename = this.recordingId + "." + preferences.audioRecordingFormat;
    const filepath = path.join("recordings", filename);

    console.log("stop rec", filepath);

    this.generate(filepath);

  }

  async generate(audioFilePath) {

    document.getElementById("start-recording").style.display = "none";
    document.getElementById("stop-recording").style.display = "none";
    document.getElementById("video").style.opacity = "1";
    document.getElementById("image").style.opacity = "0";

    console.log("generate", audioFilePath);

    // Get translated transcription from audio file
    let transcript;
    try {
      transcript = await this.transcribeAudio(audioFilePath);
      logInfo(`Transcript: ${transcript}`);
      console.log(transcript);
    } catch (e) {
      console.error(e);
      return;
    }

    // Get generated image from prompt
    let url;
    try {
      url = await this.generateImageFromPrompt(transcript);
      logInfo(`Image URL: ${url}`);
      document.getElementById("image").src = url;
    //   HERE WE NEED FIR THE IMAGE TO BE LOADED AND DISPLAYED BEFORE FAIND IN
    } catch (e) {
      console.error(e);
    }

    document.getElementById("start-recording").style.display = "block";
    document.getElementById("stop-recording").style.display = "none";
    document.getElementById("video").style.opacity = "0";
    document.getElementById("image").style.opacity = "1";

  }

  async transcribeAudio(audioFilePath) {

    return this.openai.audio.translations.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
      response_format: "text"
    });

  }

  async generateImageFromPrompt(transcript) {

    // Add the transcription to the general prompt
    // let prompt = `Here is a text excerpt: "${transcript}". Identify a single, isolated, object that
    // poetically represents this excerpt. Then, draw the entirety of this object on a pure black
    // background. There must not be any environment or context around the object. It should only
    // represent the chosen object on a pure black background without any shadows, reflections or shades.
    // The object should be drawn in a photorealistic yet mysterious manner. The object should look as if
    // it is made of intertwined tree branches, leaves and fruits. The object must not touch the edges of the image
    // and should be centered. It should have under-saturated colours and an overall blueish hue. If the
    // object cannot be drawn due to content policy restrictions, pick the next best object that respects
    // the policy.`;
    // let prompt = `Here is a text excerpt: "${transcript}". Identify a single, isolated, object that
    // poetically represents this excerpt. Then, draw the entirety of this object on a pure black
    // background. There must not be any environment or context around the object. The final image should
    // only represent the chosen object on a pure black background without any shadows, reflections or
    // shades. The object should be drawn in a photorealistic yet eerie manner. It should look as if it is
    // emerging from a subtle cloud of twirling smoke and light dust. The object should look as if it is made of
    // various intertwined mechanical and electrical parts inspired by the steampunk look. The object must
    // not touch the edges of the image and should be centered. It should have under-saturated colours and
    // an overall blueish hue. If the object cannot be drawn due to content policy restrictions, pick the
    // next best object that respects the policy.`;
    // let prompt = `Here is a text excerpt: "${transcript}". Identify a single, isolated, object that
    // poetically represents this excerpt. Then, draw the entirety of this object on a pure black
    // background. There must not be any environment or context around the object. The final image should
    // only represent the chosen object on a pure black background without any shadows, reflections or
    // shades. The object should be drawn in a photorealistic yet eerie manner. It should look as if it is
    // emerging from a subtle cloud of twirling smoke and light dust. The object should look as if it is
    // made of various intertwined branches, vegetation, mechanical and electrical parts somehow inspired by the steampunk
    // aesthetic. The object must not touch the edges of the image and should be centered. It should have
    // under-saturated colours and an overall blueish hue. If the object cannot be drawn due to content
    // policy restrictions, pick the next best object that respects the policy.`;
    let prompt = `Envision an object that embodies the essence of this quote : '${transcript}'. This 
    object should be the sole
focus against a stark black background, devoid of any surrounding context or environmental
elements. The chosen object should be rendered in a photorealistic style, yet carry an aura of
otherworldliness. It should appear as though it is gently emerging from a delicate mist of swirling
smoke and faint dust, enhancing its mysterious allure. Craft this object from an intricate blend of
natural and artificial elements—think of a fusion of entangled branches, lush vegetation, and
complex mechanical and electrical components, all woven together in a steampunk-inspired design.
This creation should float centrally within the frame, not touching any edges, and be bathed in a
palette of under-saturated colors with a subtle blueish tint. Should the initial object choice be
restricted by content policies, please adapt to an alternative that aligns with the given guidelines.`;

    const options = {
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
    };

    const response = await this.openai.images.generate(options);
    return response.data[0].url;

  }

}
