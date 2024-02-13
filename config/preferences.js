export default {

  debug: {
    panel: true,
    showDevTools: true
  },

  engines: {
    darwin: "nwjs.app/Contents/MacOS/nwjs",     // macOS
    win32: "nwjs-sdk-v0.83.0-win-x64/nw.exe",   // Windows
    linux: "nwjs-sdk-v0.51.2-linux-x64/nw"      // Linux
  },

  paths: {
    recordedAudioFolder: "./generated/recordings",
    generatedVisualsFolder: "./generated/images",
    transcriptionFile: "generated/transcripts.csv",
    enginesFolder: "engines"
  },

  audio: {
    format: "mp3",                // mp3 or wav
    minimumRecordingLength: 1.5   // in seconds
  },

  timeouts: {
    api: 120,                     // in seconds
    recording: 30                 // in seconds
  },

  hardware: {
    buttonPin: 4
  },

  ai: {
    generation: {
      prompts: [

        `I need you to create an image. It will be used in an artistic interactive installation. The
        image must depict a single isolated object that embodies the essence of the following text 
        that was submitted by a visitor. Here is the submitted text: "{QUOTE}"
        
        The image must respect the following conditions:
        
        - It must have a pure black background. This is very important because it will be viewed 
        using the pepper's ghost technique. 
        
        - The object in the image should be rendered in a photorealistic style, yet carry an aura of 
        otherworldliness.
        
        - The main object should be positionned in the center, devoid of any surrounding context or 
        environment. It must not cast shadows and there must be no ground. 
        
        - The object must be floating on the black background and it must not touch the edges of the 
        image.
        
        - The visual elements should appear as though they are gently emerging from a delicate mist 
        of swirling smoke and faint dust, enhancing their mysterious allure.
        
        - The image must be crafted from a detailed blend of natural and artificial elements — 
        think of a fusion of entangled branches, lush vegetation, and complex mechanical and
        electrical components, all woven together in a steampunk-inspired design.
          
        - The image should be bathed in a palette of under-saturated colors with a subtle blueish 
        tint.
        
        - The image must not contain any text and it shouldn't look like a diagram.
        
        Important: if this prompt does not respect the content or safety policies, alter it so that 
        all policies are fully respected.`,


        `Here is a text excerpt: "{QUOTE}". Identify a single, isolated, object that
        poetically represents this excerpt. Then, draw the entirety of this object on a pure black
        background. There must not be any environment or context around the object. It should only
        represent the chosen object on a pure black background without any shadows, reflections or 
        shades. The object should be drawn in a photorealistic yet mysterious manner. The object 
        should look as if it is made of intertwined tree branches, leaves and fruits. The object 
        must not touch the edges of the image and should be centered. It should have under-saturated
        colours and an overall blueish hue. If the object cannot be drawn due to content policy
        restrictions, pick the next best object that respects the policy.`,


        // `Select an object that embodies the essence of this quote : "{QUOTE}". Draw this object
        // while carefully respecting the following conditions:
        //
        // - The object should be the sole focus against a stark black background, devoid of any
        //   surrounding context or environmental elements.
        // - The object should be rendered in a photorealistic style, yet carry an aura of
        //   otherworldliness.
        // - The object should appear as though it is gently emerging from a delicate mist of
        //   swirling smoke and faint dust, enhancing its mysterious allure.
        // - The object must be crafted from an intricate blend of natural and artificial elements
        //   — think of a fusion of entangled branches, lush vegetation, and complex mechanical and
        //   electrical components, all woven together in a steampunk-inspired design.
        // - The object should float centrally within the image, not touching any of the 4 edges, and
        //   be bathed in a palette of under-saturated colors with a subtle blueish tint.
        //
        // Should the initial object choice be restricted by content or safety policies, please adapt
        // to an alternative that aligns with the guidelines.`,

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


      ]
    }
  }

};
