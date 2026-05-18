/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Loader2, 
  Sparkles, 
  Download, 
  RefreshCw, 
  Zap, 
  Image as ImageIcon, 
  ArrowRight, 
  Settings, 
  Volume2, 
  Video, 
  Play, 
  Pause,
  Square,
  Clock,
  ChevronDown,
  ChevronLeft
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// Inject fonts
if (typeof document !== 'undefined') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap';
  document.head.appendChild(link);
}

let _aiInstances: any[] = [];
let currentApiIndex = 0;

const getAIClient = () => {
  let keysString = process.env.GEMINI_API_KEY;
  if (!keysString || keysString === 'undefined' || keysString === 'null') {
    if (typeof window !== 'undefined') {
      keysString = localStorage.getItem('GEMINI_API_KEY') || '';
    }
  }
  
  if (!keysString) {
    if (typeof window !== 'undefined') {
      const userKey = window.prompt("Please enter your Gemini API Key(s) (comma separated). It will be saved locally.");
      if (userKey) {
        localStorage.setItem('GEMINI_API_KEY', userKey);
        keysString = userKey;
      } else {
        throw new Error("Gemini API Key is required.");
      }
    } else {
      throw new Error("Gemini API Key is required.");
    }
  }

  const keys = keysString.split(',').map((k: string) => k.trim()).filter((k: string) => k);
  if (keys.length === 0) {
    throw new Error("No valid Gemini API keys found.");
  }
  
  // Create an instance for each key if we haven't already
  if (_aiInstances.length !== keys.length) {
    _aiInstances = keys.map((key: string) => new GoogleGenAI({ apiKey: key }));
  }

  // Rotate through keys
  const client = _aiInstances[currentApiIndex];
  currentApiIndex = (currentApiIndex + 1) % _aiInstances.length;
  return client;
};

interface Scene {
  timestamp: number;
  prompt: string;
  text: string;
  imageUrl?: string;
}

interface CinematicParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  opacity: number;
  type: 'shadow' | 'ember' | 'smoke';
  color?: string;
  rotation?: number;
  vr?: number;
}

const VOICES = [
  { id: 'Charon', name: 'Deep & Resonant (Charon)' },
  { id: 'Puck', name: 'Youthful & Light (Puck)' },
  { id: 'Kore', name: 'Soft & Warm (Kore)' },
  { id: 'Fenrir', name: 'Gravelly & Strong (Fenrir)' },
];

export default function App() {
  const [script, setScript] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Charon');
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showInputBar, setShowInputBar] = useState(true);

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number>(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const activeSceneIndex = useMemo(() => {
    let activeIdx = scenes.length - 1;
    for (let i = 0; i < scenes.length; i++) {
      if (currentTime >= scenes[i].timestamp && (i === scenes.length - 1 || currentTime < scenes[i + 1].timestamp)) {
        activeIdx = i;
        break;
      }
    }
    return Math.max(0, activeIdx);
  }, [currentTime, scenes]);

  useEffect(() => {
    if (stripRef.current && scenes.length > 0 && activeSceneIndex >= 0) {
      const activeChild = stripRef.current.children[activeSceneIndex] as HTMLElement;
      if (activeChild) {
        const strip = stripRef.current;
        const scrollLeft = activeChild.offsetLeft - (strip.clientWidth / 2) + (activeChild.clientWidth / 2);
        strip.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }
  }, [activeSceneIndex, scenes.length]);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = isFocused ? Math.max(120, scrollHeight) : scrollHeight;
      textareaRef.current.style.height = `${Math.min(targetHeight, 300)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [script, isFocused]);

  // Constants for 9:16 video
  const CANVAS_WIDTH = 720;
  const CANVAS_HEIGHT = 1280;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };
      audioRef.current.ontimeupdate = () => {
        const time = audioRef.current?.currentTime || 0;
        setCurrentTime(time);
        
        // Sync timeline scroll
        if (timelineRef.current && duration > 0) {
          const scrollWidth = timelineRef.current.scrollWidth - timelineRef.current.clientWidth;
          timelineRef.current.scrollLeft = (time / duration) * scrollWidth;
        }
      };
    }
  }, [audioUrl, duration]);

  const generateVoiceover = async (targetScript: string) => {
    setStatus('Synthesizing voice...');
    const ttsResponse = await getAIClient().models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: targetScript }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }, 
          },
        },
      },
    });

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!base64Audio) throw new Error("Voiceover failed.");

    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = pcmToWav(bytes, 24000);
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);

    const tempAudio = new Audio(url);
    await new Promise((resolve, reject) => {
      tempAudio.onloadedmetadata = () => {
        setDuration(tempAudio.duration);
        resolve(null);
      };
      tempAudio.onerror = () => reject(new Error("Audio load failed"));
    });
    return tempAudio.duration;
  };

  const createAtmosphere = (audioCtx: AudioContext, destination: AudioNode) => {
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.05; 

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; 
    masterGain.connect(filter);
    filter.connect(destination);

    // Deep dissonant drone oscillators
    const frequencies = [42, 43.5, 61, 63, 31]; 
    const oscillators: OscillatorNode[] = [];

    frequencies.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      
      osc.type = i % 2 === 0 ? 'sine' : 'sawtooth';
      osc.frequency.value = freq;
      
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.value = 0.1 + Math.random() * 0.1;
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      
      osc.connect(g);
      g.connect(masterGain);
      
      osc.start();
      lfo.start();
      oscillators.push(osc);
    });

    const pingInterval = setInterval(() => {
      if (audioCtx.state === 'running') {
        const ping = audioCtx.createOscillator();
        const pGain = audioCtx.createGain();
        ping.type = 'sine';
        ping.frequency.value = 1000 + Math.random() * 1500;
        
        pGain.gain.setValueAtTime(0, audioCtx.currentTime);
        pGain.gain.linearRampToValueAtTime(0.015, audioCtx.currentTime + 0.5);
        pGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 6);
        
        ping.connect(pGain);
        pGain.connect(filter);
        ping.start();
        ping.stop(audioCtx.currentTime + 6);
      }
    }, 6000);

    return {
      stop: () => {
        clearInterval(pingInterval);
        oscillators.forEach(o => {
          try { o.stop(); } catch(e) {}
        });
        masterGain.disconnect();
      }
    };
  };

  const handlePlay = async () => {
    if (!audioRef.current) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      if (!sourceNodeRef.current && audioRef.current) {
        try {
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
          sourceNodeRef.current.connect(audioContextRef.current.destination);
        } catch (e) {
          console.warn("Source already connected");
        }
      }

      await audioRef.current.play();
      setIsPlaying(true);
      
      if (audioContextRef.current) {
        const atmosphere = createAtmosphere(audioContextRef.current, audioContextRef.current.destination);
        (window as any)._previewAtmosphere = atmosphere;
      }
    } catch (err) {
      console.error("Playback failed:", err);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    
    if ((window as any)._previewAtmosphere) {
      (window as any)._previewAtmosphere.stop();
      (window as any)._previewAtmosphere = null;
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    
    if ((window as any)._previewAtmosphere) {
      (window as any)._previewAtmosphere.stop();
      (window as any)._previewAtmosphere = null;
    }
  };

  const togglePlay = () => {
    if (isPlaying) handlePause();
    else handlePlay();
  };
  const sanitizePrompt = (p: string) => {
    // Filter to remove words that heavily trigger NSFW filters (sexual, gore, etc.)
    // We allow artistic words like 'darkness', 'shadow', 'ominous' now as requested for the tone.
    const restricted = [
      'blood', 'gore', 'naked', 'sexual', 'porn', 'violence', 'death', 'kill', 'murder', 'suicide', 
      'genitals', 'breast', 'penis', 'vagina', 'abuse', 'hit', 'smash', 'crush', 'weapon', 
      'gun', 'knife', 'sharp', 'toxic', 'poison', 'harm', 'bleed', 'slay', 'dead', 'knife', 
      'cut', 'wound', 'suffering', 'agony'
    ];
    let sanitized = p.toLowerCase();
    restricted.forEach(word => {
      sanitized = sanitized.split(word).join('intense');
    });
    // Remove characters that might break prompts
    sanitized = sanitized.replace(/[^\w\s,]/gi, ' ');
    return sanitized.substring(0, 500); 
  };

  const generateImageFromProviders = async (prompt: string): Promise<Blob> => {
    let workerUrlsString = process.env.IMAGE_WORKER_URLS;
    if (!workerUrlsString || workerUrlsString === 'undefined' || workerUrlsString === 'null') {
      if (typeof window !== 'undefined') {
        workerUrlsString = localStorage.getItem('IMAGE_WORKER_URLS') || '';
      }
    }
    
    // Default fallback URLs if none provided
    const defaultUrls = [
      "https://flux1.shreevathsa2k27.workers.dev/",
      "https://flux.shreevathsa2k21-4fa.workers.dev/",
      "https://flux.vaishakhaphotos2.workers.dev/",
      "https://flux.vmajibail.workers.dev/"
    ];

    let workerUrls = defaultUrls;
    if (workerUrlsString) {
      const parsedUrls = workerUrlsString.split(',').map(u => u.trim()).filter(u => u);
      if (parsedUrls.length > 0) {
        workerUrls = parsedUrls;
      }
    }

    // Shuffle the URLs to distribute the load randomly per request
    const shuffledUrls = [...workerUrls].sort(() => Math.random() - 0.5);

    let lastError = null;

    for (const workerUrl of shuffledUrls) {
      try {
        console.log(`[Flux Proxy Frontend] Trying URL: ${workerUrl}`);
        const response = await fetch(workerUrl.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Flux Frontend Error] ${workerUrl}:`, response.status, errorText);
          lastError = { status: response.status, text: errorText };
          continue; 
        }

        const arrayBuffer = await response.arrayBuffer();
        let uintArray = new Uint8Array(arrayBuffer);

        if (uintArray[0] === 123) { // '{' character, possible JSON
          const textData = new TextDecoder("utf-8").decode(uintArray);
          try {
            const json = JSON.parse(textData);
            const b64 = json.image || json.result?.image || json.img;
            if (b64) {
              const base64Data = b64.replace(/^data:image\/\w+;base64,/, "");
              const binStr = atob(base64Data);
              const binArr = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) {
                binArr[i] = binStr.charCodeAt(i);
              }
              return new Blob([binArr], { type: "image/jpeg" });
            }
          } catch (e) {
            console.error("JSON parse failed", e);
          }
        }
        
        return new Blob([arrayBuffer], { type: "image/jpeg" });

      } catch (error: any) {
        console.error(`[Flux Proxy Exception] ${workerUrl}:`, error.message);
        lastError = { status: 500, text: error.message };
        continue;
      }
    }

    try {
      console.log(`[Flux Frontend] Using Pollinations fallback`);
      const response = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=720&height=1280&nologo=true`, {
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return new Blob([arrayBuffer], { type: "image/jpeg" });
      }
    } catch (e) {
      console.error("[Flux Proxy] Pollinations fallback failed:", e);
    }

    throw new Error(lastError?.text || "All workers failed");
  };

  const regenerateImage = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;

    setRegeneratingIdx(index);
    setStatus(`Updating frame ${index + 1}...`);
    
    let attempts = 0;
    let success = false;
    let lastErr = '';

    while (attempts < 3 && !success) {
      try {
        const sanitizedScenePrompt = sanitizePrompt(scene.prompt);
        const fullPrompt = `Deeply dark psychological anime/manga style, heart-touching human vulnerability, cinematic composition, ${sanitizedScenePrompt}, masterpiece, high quality, expressive shadows, soulful atmosphere, no text.`;
        const blob = await generateImageFromProviders(fullPrompt);
        const url = URL.createObjectURL(blob);
        
        setScenes(prev => {
          const next = [...prev];
          if (next[index].imageUrl) URL.revokeObjectURL(next[index].imageUrl!);
          next[index] = { ...next[index], imageUrl: url };
          return next;
        });
        setStatus('Frame updated');
        success = true;
      } catch (err: any) {
        attempts++;
        lastErr = err.message;
        console.warn(`Attempt ${attempts} failed for scene ${index}:`, err);
        setStatus(`Retrying frame ${index + 1} (${attempts}/3)...`);
      }
    }

    if (!success) {
      setError(`Failed to regenerate after 3 attempts: ${lastErr}`);
    }
    setRegeneratingIdx(null);
  };

  const generateFullVideo = async (providedScript?: string) => {
    const textToUse = providedScript || script;
    if (!textToUse.trim()) {
      setError('Enter a script first.');
      return;
    }

    setScript(''); // Clear input box so it becomes small again
    setShowInputBar(false);
    setIsGenerating(true);
    setError(null);
    setProgress(0);

    try {
      const audioDuration = await generateVoiceover(textToUse);
      setStatus('Planning story based on audio duration...');
      
      const planResponse = await getAIClient().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: textToUse }] }],
        config: {
          systemInstruction: `You are a cinematic video producer. Divide the provided script into MANY small chronological segments of roughly 6 seconds each to ensure visual variety, matching the total duration of ${audioDuration.toFixed(1)} seconds.
          
          For each segment, you must provide:
          1. "timestamp": The calculated start time in seconds.
          2. "prompt": A deeply emotional, dark psychological anime style prompt focusing on "heart-touching" human vulnerability. It must reflect the specific atmosphere of that part of the script.
             CRITICAL: Each image must be visually unique, deeply relatable, and evoke intense human connection. Use words like 'haunting', 'vulnerable', 'shattered', 'poetic loneliness', 'deep psychological trauma', 'soulful', 'manga aesthetic' while ensuring safety. Avoid generic background repetitions.
          3. "text": The EXACT portion of the script corresponding to this timeframe. Enrich the text with meaningful punctuation, ellipses (...), and pauses (--) to enhance the emotional weight. 
             CRITICAL: Do NOT use ANY emojis. Do NOT omit any words from the original script.
          
          Output as a clean JSON array of objects. No extra text or explanations.`,
          responseMimeType: "application/json",
        }
      });

      let text = planResponse.text;
      if (!text) throw new Error("Planning failed.");

      // Robust JSON extraction
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

      const parsedPlan = JSON.parse(text);
      if (!Array.isArray(parsedPlan)) throw new Error("Invalid plan format");

      // ROBUST SYNC: Distribute duration using word counts + sentence pauses for natural flow
      const PAUSE_DUR = 0.5; // Estimated pause between sentences
      const WORD_DUR = 0.3; // Estimated base word duration
      
      const baseDurations = parsedPlan.map(s => {
        const wordCount = (s.text || "").split(/\s+/).length;
        return (wordCount * WORD_DUR) + PAUSE_DUR;
      });
      
      const totalBaseDuration = baseDurations.reduce((a, b) => a + b, 0);
      const scale = audioDuration / (totalBaseDuration || 1);
      
      let runningTime = 0;
      const scenePlan: Scene[] = parsedPlan.map((s, i) => {
        const startTime = runningTime;
        runningTime += baseDurations[i] * scale;
        return {
          ...s,
          timestamp: startTime,
          prompt: s.prompt || "Cinematic atmosphere",
          text: s.text || ""
        };
      });

      setScenes(scenePlan);

      setStatus('Painting scenes...');
      
      let completed = 0;
        // PARALLEL GENERATION with RETRIES
        const imagePromises = scenePlan.map(async (scene, i) => {
          let attempts = 0;
          let success = false;
          
          while (attempts < 3 && !success) {
            try {
              const sanitizedScenePrompt = sanitizePrompt(scene.prompt);
              const fullPrompt = `Deeply dark psychological anime/manga style, heart-touching human vulnerability, cinematic composition, ${sanitizedScenePrompt}, masterpiece, high quality, expressive shadows, soulful atmosphere, no text.`;
              const blob = await generateImageFromProviders(fullPrompt);
              const url = URL.createObjectURL(blob);
            
            // Update individual scene as it finishes
            setScenes(prev => {
              const next = [...prev];
              next[i] = { ...next[i], imageUrl: url };
              return next;
            });
            
            success = true;
          } catch (err) {
            attempts++;
            console.warn(`Scene ${i} attempt ${attempts} failed:`, err);
            if (attempts >= 3) break;
          }
        }
        
        completed++;
        setProgress((completed / scenePlan.length) * 100);
        return success;
      });

      await Promise.all(imagePromises);

      setStatus('Ready');
      setIsGenerating(false);
      setProgress(100);
    } catch (err: any) {
      setError(err.message || 'Workflow error');
      setIsGenerating(false);
    }
  };

  const downloadVideo = () => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinematic_reels_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const startAutoRender = async () => {
    if (!audioRef.current || !canvasRef.current || scenes.length === 0 || isExporting) return;
    
    setIsExporting(true);
    setExportProgress(0);
    setStatus('Auto-Rendering...');
    
    const canvas = canvasRef.current;
    const stream = canvas.captureStream(30); 
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioContext = audioContextRef.current;
      
      if (!sourceNodeRef.current) {
        try {
          sourceNodeRef.current = audioContext.createMediaElementSource(audioRef.current);
        } catch (err) {
          console.warn("MediaElementSource failed (might already exist):", err);
          // If creation fails, it's likely already connected; bypass and continue
        }
      }
      const source = sourceNodeRef.current;
      if (!source) {
         // Fallback: if we still don't have a source, something is wrong
         throw new Error("Audio source initialization failed");
      }
      
      const destination = audioContext.createMediaStreamDestination();
      source.disconnect(); // Clear any existing connections
      source.connect(destination);
      source.connect(audioContext.destination); 
      
      const atmDest = createAtmosphere(audioContext, destination);
      const atmLocal = createAtmosphere(audioContext, audioContext.destination);
      
      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 8000000 
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setVideoBlob(blob);
        setIsExporting(false);
        setStatus('Ready to Download');
        
        // Expose to global window for headless Puppeteer rendering
        (window as any)._finalVideoBlob = blob;
      };

      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      
      recorder.start();
      await audioRef.current.play();
      setIsPlaying(true);

      const checkEnd = setInterval(() => {
        if (audioRef.current) {
          setExportProgress((audioRef.current.currentTime / (duration || 1)) * 100);
          
          if (audioRef.current.ended || audioRef.current.currentTime >= duration - 0.1) {
            recorder.stop();
            clearInterval(checkEnd);
            setIsPlaying(false);
            atmDest.stop();
            atmLocal.stop();
            handleStop();
          }
        }
      }, 100);
    } catch (e) {
      console.error("Auto-render init failed:", e);
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const allImagesReady = scenes.length > 0 && scenes.every(s => s.imageUrl);
    if (allImagesReady && audioUrl && !videoBlob && !isGenerating && !isExporting && !regeneratingIdx) {
       startAutoRender();
    }
  }, [scenes, audioUrl, isGenerating, regeneratingIdx, videoBlob]);

  useEffect(() => {
    if (videoBlob) setVideoBlob(null);
  }, [script, selectedVoice, scenes]);

  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<CinematicParticle[]>([]);

  // Initialize particles once
  const initParticles = () => {
    const particles: CinematicParticle[] = [];
    
    // Shadow Particles
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: Math.random() * 720,
        y: Math.random() * 1280,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 1 + Math.random() * 3,
        life: Math.random() * 100,
        maxLife: 200 + Math.random() * 200,
        opacity: 0,
        type: 'shadow'
      });
    }

    // Fire Embers (Increased count and brightness)
    for (let i = 0; i < 45; i++) {
      particles.push({
        x: Math.random() * 720,
        y: 1280 + Math.random() * 200,
        vx: (Math.random() - 0.5) * 3.0, 
        vy: -3.0 - Math.random() * 5.0, 
        size: 0.4 + Math.random() * 1.2, 
        life: 0,
        maxLife: 250 + Math.random() * 400,
        opacity: 0,
        type: 'ember',
        color: Math.random() > 0.4 ? '#ffcc00' : (Math.random() > 0.5 ? '#ff6600' : '#ffffff')
      });
    }

    // Smoke Wisps (Reduced count for less clutter)
    for (let i = 0; i < 22; i++) {
      particles.push({
        x: Math.random() * 720,
        y: 1280 + Math.random() * 500,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -1.0 - Math.random() * 1.8, 
        size: 50 + Math.random() * 120, 
        life: 0,
        maxLife: 600 + Math.random() * 1000,
        opacity: 0,
        type: 'smoke',
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.008 
      });
    }

    particlesRef.current = particles;
  };

  const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000) => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const totalSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, totalSize - 8, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, dataSize, true);
    new Uint8Array(arrayBuffer, 44).set(pcmData);
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imageElementRef.current) imageElementRef.current = new Image();
    const img = imageElementRef.current;
    
    // Ensure particles are initialized
    if (particlesRef.current.length === 0) initParticles();

    const render = (time: number) => {
      if (!ctx) return;
      
      const audioTime = audioRef.current?.currentTime || 0;
      const SCENE_DURATION = 5;
      const localTime = audioTime % SCENE_DURATION;
      
      // Find the correct scene for the current time
      let sceneIndex = 0;
      for (let i = scenes.length - 1; i >= 0; i--) {
        if (scenes[i].timestamp <= audioTime) {
          sceneIndex = i;
          break;
        }
      }
      const currentScene = scenes[sceneIndex];
      const sceneStart = currentScene.timestamp;
      const nextScene = scenes[sceneIndex + 1];
      const sceneEnd = nextScene ? nextScene.timestamp : duration;
      const sceneDuration = Math.max(0.1, sceneEnd - sceneStart);
      const progressInScene = Math.max(0, Math.min(1, (audioTime - sceneStart) / sceneDuration));

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      if (currentScene?.imageUrl) {
        if (img.src !== currentScene.imageUrl) img.src = currentScene.imageUrl;
        if (img.complete && img.naturalWidth !== 0) {
          const shakeX = Math.sin(time / 150) * 1.5;
          const shakeY = Math.cos(time / 180) * 1.5;
          
          // Alternating 10% Zoom Effect (Ken Burns)
          const isZoomIn = sceneIndex % 2 === 0;
          const zoomAmount = 0.10;
          const zoomScale = isZoomIn 
            ? (1.0 + progressInScene * zoomAmount) 
            : (1.0 + zoomAmount - progressInScene * zoomAmount);

          ctx.save();
          ctx.globalAlpha = 1.0; 
          
          ctx.translate(CANVAS_WIDTH / 2 + shakeX, CANVAS_HEIGHT / 2 + shakeY);
          ctx.scale(zoomScale, zoomScale);
          const imgAspect = img.naturalWidth / img.naturalHeight;
          const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
          let drawW, drawH;
          if (imgAspect > canvasAspect) {
            drawH = CANVAS_HEIGHT;
            drawW = CANVAS_HEIGHT * imgAspect;
          } else {
            drawW = CANVAS_WIDTH;
            drawH = CANVAS_WIDTH / imgAspect;
          }
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
          const gradient = ctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 0, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_HEIGHT/1.1);
          gradient.addColorStop(0, 'transparent');
          gradient.addColorStop(0.7, 'rgba(0,0,0,0.2)');
          gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          
          // Persistent Cinematic Noise Grain
          ctx.save();
          ctx.globalAlpha = 0.12; 
          for(let i=0; i<3500; i++) {
            const gx = Math.random() * CANVAS_WIDTH;
            const gy = Math.random() * CANVAS_HEIGHT;
            const intensity = Math.random() * 255;
            ctx.fillStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
            ctx.fillRect(gx, gy, 1.2, 1.2);
          }
          ctx.restore();
        }
      } 

      // Cinematic Particles Overlay (Shadows, Embers, Smoke)
      ctx.save();
      particlesRef.current.forEach(p => {
        // Advanced Physics: Add slight turbulence/air current
        if (p.type === 'smoke' || p.type === 'ember') {
          // Add random jitter to velocity - scaled down for smoothness
          p.vx += (Math.random() - 0.5) * 0.15; 
          p.vy += (Math.random() - 0.5) * 0.05; 
          
          // Air resistance / capping
          p.vx *= 0.98;
          
          if (p.rotation !== undefined && p.vr !== undefined) {
             p.rotation += p.vr;
          }
        }

        // Use more varied frequency for sway to avoid "circular" look
        const swayFreq = p.type === 'smoke' ? (2000 + (p.x % 1000)) : 1000;
        const swayAmp = p.type === 'smoke' ? 0.8 : 0.4;
        p.x += p.vx + Math.sin(time / swayFreq + (p.life * 0.02)) * swayAmp;
        p.y += p.vy;
        p.life++;

        // Smoke expands as it rises
        if (p.type === 'smoke') {
          p.size += 0.25; // Continuous expansion
        }

        // Opacity mapping for smooth fade in/out
        if (p.life < p.maxLife * 0.15) {
          p.opacity = p.life / (p.maxLife * 0.15);
        } else if (p.life > p.maxLife * 0.7) {
          p.opacity = 1 - (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3);
        } else {
          p.opacity = 1;
        }

        // Realistic vertical fade: disappears as it moves to the top
        const verticalFade = Math.max(0, Math.min(1, (p.y + p.size) / (CANVAS_HEIGHT * 0.9)));

        // Render based on type
        if (p.opacity > 0) {
          if (p.type === 'shadow') {
            ctx.fillStyle = `rgba(0, 0, 0, ${p.opacity * 0.4})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.type === 'ember') {
            const flicker = 0.7 + Math.random() * 0.3;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter'; // Makes embers pop
            ctx.shadowBlur = 12; 
            ctx.shadowColor = p.color || '#ff9d00';
            ctx.fillStyle = p.color || '#ff9d00';
            ctx.globalAlpha = p.opacity * flicker * 0.9 * verticalFade; 
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else if (p.type === 'smoke') {
            ctx.save();
            ctx.translate(p.x, p.y);
            if (p.rotation) ctx.rotate(p.rotation);
            
            // Very low base opacity for smoke to allow stacking (50% reduction from previous)
            const smokeOpacity = p.opacity * 0.035 * verticalFade;
            
            // Single, ultra-soft radial gradient for a "mist" look
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
            grad.addColorStop(0, `rgba(220, 220, 220, ${smokeOpacity})`);
            grad.addColorStop(0.3, `rgba(200, 200, 200, ${smokeOpacity * 0.6})`);
            grad.addColorStop(0.6, `rgba(180, 180, 180, ${smokeOpacity * 0.2})`);
            grad.addColorStop(1, 'rgba(150, 150, 150, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            // Stretched ellipse for more organic shape
            ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        // Recycle particles with randomized restart
        if (p.life >= p.maxLife || p.y < -500 || p.x < -300 || p.x > CANVAS_WIDTH + 300) {
          p.x = Math.random() * CANVAS_WIDTH;
          p.y = CANVAS_HEIGHT + 100 + Math.random() * 400;
          p.life = 0;
          p.opacity = 0;
          p.vx = (Math.random() - 0.5) * (p.type === 'ember' ? 2.5 : 1.0);
          if (p.type === 'smoke') p.size = 80 + Math.random() * 200;
        }
      });
      ctx.restore();

      // Subtle Glitch Effect
      const glitchSeed = Math.random();
      if (glitchSeed < 0.05 && audioTime > 0 && isPlaying) {
        ctx.save();
        const sliceY = Math.random() * CANVAS_HEIGHT;
        const sliceH = 5 + Math.random() * 40;
        const sliceX = (Math.random() - 0.5) * 10;
        
        // Horizontal slice shift
        ctx.drawImage(canvas, 0, sliceY, CANVAS_WIDTH, sliceH, sliceX, sliceY, CANVAS_WIDTH, sliceH);
        
        // Occasional color aberration
        if (glitchSeed < 0.02) {
          ctx.globalAlpha = 0.2;
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, sliceY, CANVAS_WIDTH, 2);
          ctx.fillStyle = '#00ffff';
          ctx.fillRect(0, sliceY + 4, CANVAS_WIDTH, 2);
        }
        ctx.restore();
      }

      // Subtitles - Centered Single Line with Character Chunking
      if (currentScene?.text) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const fullText = currentScene.text.trim();
        const words = fullText.split(/\s+/);
        const WORDS_PER_CHUNK = 4; // 3-4 words per chunk
        
        // Chunking by words
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
          chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
        }
        
        // Calculate which chunk to show based on word count progress for better word-to-voice matching
        const currentWordIdx = Math.floor(progressInScene * words.length);
        const chunkIndex = Math.min(Math.floor(currentWordIdx / WORDS_PER_CHUNK), chunks.length - 1);
        let chunkText = (chunks[chunkIndex] || "").trim();

        // Preserve original capitalization and punctuation from the AI-generated text, 
        // just ensure it doesn't look like a mid-sentence fragment if possible.
        if (chunkText.length > 0 && /^[a-z]/.test(chunkText)) {
          chunkText = chunkText.charAt(0).toUpperCase() + chunkText.slice(1);
        }

        ctx.font = '700 54px "Dancing Script", cursive';
        
        const x = CANVAS_WIDTH / 2;
        const y = CANVAS_HEIGHT * 0.68; // Moved up slightly more (1cm approx)
        const lineHeight = 70; 

        // Split words to handle line-breaking for chunks of 4 words
        const chunkWords = chunkText.split(' ');
        const displayLines: string[] = [];
        
        if (chunkWords.length >= 4) {
          // Exactly 4 words or more: split into two lines for readability
          displayLines.push(chunkWords.slice(0, 2).join(' '));
          displayLines.push(chunkWords.slice(2).join(' '));
        } else {
          displayLines.push(chunkText);
        }
        
        displayLines.forEach((line, index) => {
          // Calculate individual line Y to keep the block centered around 'y'
          const lineY = y + (index - (displayLines.length - 1) / 2) * lineHeight;

          // Intense Dark Glow Outline
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
          ctx.shadowBlur = 22;
          ctx.lineWidth = 10;
          ctx.strokeStyle = '#000000';
          ctx.strokeText(line, x, lineY);
          ctx.restore();

          // Subtitle Text
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(line, x, lineY);
        });

        ctx.restore();
      }

      if (isGenerating) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0,0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#f97316';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GENERATING VISION...', CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
      }

      requestRef.current = requestAnimationFrame(render);
    };
    requestRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(requestRef.current);
  }, [scenes, currentTime, isGenerating]);

  return (
    <div className="h-[100dvh] flex flex-col bg-[#050505] text-zinc-200 font-sans overflow-hidden">
      <audio ref={audioRef} src={audioUrl || undefined} />

      {/* Header Bar */}
      <header className="shrink-0 h-14 border-b border-zinc-800/50 px-4 sm:px-6 flex items-center justify-between bg-zinc-950 z-50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-orange-500 rounded flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Video size={14} className="text-black" />
          </div>
          <h1 className="text-[10px] font-bold uppercase tracking-[0.2em] hidden sm:block">Flux <span className="text-orange-500 text-opacity-80">Editor</span></h1>
        </div>

        <div className="flex items-center gap-3">
          {videoBlob && (
            <button 
              onClick={downloadVideo}
              className="flex items-center justify-center gap-2 bg-white text-black px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider shadow-[0_0_10px_rgba(255,255,255,0.15)] hover:scale-[1.02] active:scale-95 transition-all"
            >
              <Download size={12} />
              Save
            </button>
          )}

          {isGenerating && (
             <div className="hidden sm:flex items-center gap-3 w-24">
              <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                <motion.div className="h-full bg-orange-500" animate={{ width: `${progress}%` }} />
              </div>
             </div>
          )}
          
          <div className="text-[10px] font-mono text-zinc-500 bg-zinc-900/50 px-2 py-1 rounded-full border border-zinc-800/50 max-w-[120px] truncate">
            {status || 'Idle'}
          </div>

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition-colors relative ${showSettings ? 'bg-orange-500 text-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'}`}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 flex flex-col items-center justify-center min-h-0 relative p-2 sm:px-4 sm:py-2 gap-2 w-full max-w-2xl mx-auto">
        
        <div className="relative flex-1 w-full min-h-0 bg-black border border-white/10 rounded-xl overflow-hidden shadow-2xl flex items-center justify-center group/player">
            <canvas 
              ref={canvasRef} 
              width={CANVAS_WIDTH} 
              height={CANVAS_HEIGHT} 
              className="h-full w-full object-contain cursor-pointer" 
              onClick={() => {
                if (audioUrl && !isExporting) {
                  isPlaying ? handlePause() : handlePlay();
                }
              }}
            />
            
            {!isPlaying && audioUrl && !isExporting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
                <div className="w-14 h-14 bg-white text-black rounded-full shadow-2xl flex items-center justify-center transition-all bg-opacity-80">
                  <Play size={20} fill="currentColor" className="ml-1" />
                </div>
              </div>
            )}

            {/* In-video Regenerate Button */}
            {!isPlaying && scenes.length > 0 && activeSceneIndex >= 0 && (
              <div className="absolute top-4 left-4 z-50">
                <button 
                  disabled={regeneratingIdx === activeSceneIndex}
                  onClick={(e) => { e.stopPropagation(); regenerateImage(activeSceneIndex); }}
                  className="bg-black/60 hover:bg-orange-500 text-white p-2 rounded-full backdrop-blur-md transition-all shadow-xl border border-white/10 group flex items-center gap-2"
                  title="Regenerate this specific frame"
                >
                   <RefreshCw size={16} className={regeneratingIdx === activeSceneIndex ? "animate-spin text-orange-500" : "text-zinc-300 group-hover:text-white"} />
                   <span className="text-xs font-bold shrink-0 hidden group-hover:block pr-1">Regenerate Frame</span>
                </button>
              </div>
            )}

            {/* Over-video controls */}
            {(audioUrl || isExporting) && (
              <div className="absolute left-0 right-0 bottom-0 p-3 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col gap-2 opacity-0 group-hover/player:opacity-100 transition-opacity duration-300">
                {isExporting && (
                   <div className="w-full space-y-1 mb-1 px-1">
                      <div className="flex justify-between text-[8px] font-bold text-zinc-300 uppercase tracking-widest drop-shadow-md">
                        <span>Exporting...</span>
                        <span>{exportProgress.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                         <div className="h-full bg-orange-500 transition-all duration-300 shadow-[0_0_8px_rgba(249,115,22,0.5)]" style={{ width: `${exportProgress}%` }} />
                      </div>
                   </div>
                )}

                {!isExporting && audioUrl && (
                  <div className="w-full flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1">
                      <button onClick={togglePlay} className="text-white hover:text-orange-500 transition-colors drop-shadow-md">
                        {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                      </button>
                      <span className="text-[10px] font-mono text-zinc-200 drop-shadow-md">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
                    </div>
                    
                    <div className="relative w-full h-4 flex items-center group">
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 bg-orange-500 rounded-full pointer-events-none shadow-[0_0_10px_rgba(249,115,22,0.8)] z-10" 
                        style={{ width: `${(currentTime / (duration || 1)) * 100}%` }} 
                      />
                      <input 
                        type="range" 
                        min={0} 
                        step="any"
                        max={duration || 100} 
                        value={currentTime} 
                        onChange={(e) => {
                          const newTime = parseFloat(e.target.value);
                          if (audioRef.current) {
                            audioRef.current.currentTime = newTime;
                            setCurrentTime(newTime);
                          }
                        }}
                        className="absolute w-full h-1.5 bg-white/20 backdrop-blur-sm rounded-full appearance-none flex cursor-pointer focus:outline-none m-0 hover:[&::-webkit-slider-thumb]:scale-125
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-20 [&::-webkit-slider-thumb]:transition-transform"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
        
        {/* Settings Overlay Sidebar */}
        <AnimatePresence>
          {showSettings && (
            <>
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
                onClick={() => setShowSettings(false)}
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-72 bg-zinc-950 border-l border-zinc-800 shadow-2xl z-[70] flex flex-col"
              >
                <div className="h-14 border-b border-zinc-800/50 px-5 flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Settings</span>
                  <button onClick={() => setShowSettings(false)} className="p-2 -mr-2 text-zinc-500 hover:text-white rounded-lg hover:bg-zinc-900 transition-colors">
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Voice Model</label>
                    <div className="relative group">
                      <select
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-[12px] outline-none text-zinc-300 appearance-none cursor-pointer focus:border-orange-500/50 transition-all"
                      >
                        {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-focus-within:text-orange-500 transition-colors">
                        <Volume2 size={14} />
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] text-zinc-500">
                      <span className="uppercase font-bold tracking-widest">Engine Configuration</span>
                    </div>
                    <div className="bg-zinc-900/50 rounded-xl p-3 text-[11px] font-mono text-zinc-400 space-y-2 border border-zinc-800/50">
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>TTS Core:</span> <span className="text-orange-500 opacity-80">Flash TTS</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Aspect:</span> <span>9:16 (Vertical)</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Render:</span> <span>720x1280 px</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Format:</span> <span>WebM/VP9+Opus</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom controls container */}
      <div className="shrink-0 flex flex-col w-full relative z-30 bg-zinc-950 border-t border-zinc-800/50">
        
        {/* Larger strip of images preview */}
        {scenes.length > 0 && (
          <div 
            ref={stripRef}
            className="h-40 sm:h-52 w-full overflow-x-auto flex items-center gap-4 px-[50vw] sm:px-[50vw] py-3 scrollbar-hide relative z-20"
          >
            {scenes.map((scene, i) => {
              const isActive = i === activeSceneIndex;
              return (
                <div 
                  key={i} 
                  onClick={() => {
                    if (audioRef.current && duration) {
                      const newTime = Math.min(scene.timestamp, duration - 0.1);
                      audioRef.current.currentTime = newTime;
                      setCurrentTime(newTime);
                    }
                  }}
                  className={`relative group shrink-0 h-full aspect-[9/16] rounded-md overflow-hidden border cursor-pointer transition-all ${
                    isActive 
                    ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)] ring-2 ring-orange-500 z-10 scale-105' 
                    : 'border-zinc-800 opacity-50 hover:opacity-100 hover:border-zinc-600 scale-95'
                  }`}
                >
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                      {regeneratingIdx === i ? <Loader2 size={12} className="animate-spin text-orange-500" /> : <Loader2 size={12} className="animate-spin text-zinc-600" />}
                    </div>
                  )}
                  <div className="absolute top-0 right-0 bg-black/80 px-1 py-0.5 rounded-bl text-[8px] font-mono text-white">
                    {scene.timestamp.toFixed(0)}s
                  </div>
                  {/* Regenerate Button in top left corner */}
                  <div className={`absolute inset-0 bg-transparent pointer-events-none transition-opacity ${isActive ? 'opacity-100 group-hover:opacity-100' : 'opacity-0 hover:opacity-100 hover:backdrop-blur-[1px]'}`}>
                     <button 
                       disabled={regeneratingIdx === i}
                       onClick={(e) => { e.stopPropagation(); regenerateImage(i); }}
                       className={`absolute top-1 left-1 p-1.5 rounded-md transition-all pointer-events-auto backdrop-blur-md z-20 ${isActive ? 'bg-black/60 hover:bg-orange-500' : 'bg-black/40 hover:bg-white/30'}`}
                       title="Regenerate Frame"
                     >
                       <RefreshCw size={12} className={regeneratingIdx === i ? "animate-spin text-orange-500" : ""} />
                     </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom chat input */}
        <div className="relative w-full">
          {/* Toggle arrow & generating indicator */}
          <div className="absolute left-1/2 bottom-full -translate-x-1/2 z-40 flex flex-col items-center">
             {isGenerating && !showInputBar && (
               <div className="mb-2 bg-zinc-900/90 backdrop-blur-md border border-orange-500/30 text-orange-400 px-4 py-1.5 rounded-full text-[10px] font-mono shadow-[0_0_15px_rgba(249,115,22,0.2)] flex items-center gap-2">
                 <Loader2 size={12} className="animate-spin" />
                 <span className="max-w-[150px] sm:max-w-[200px] truncate">{status || 'Generating...'}</span>
                 <span className="font-bold">{progress.toFixed(0)}%</span>
               </div>
             )}
             <button 
               onClick={() => setShowInputBar(!showInputBar)} 
               className="bg-zinc-900 border border-zinc-800/80 text-zinc-400 hover:text-white px-4 py-1 rounded-t-xl hover:bg-zinc-800 transition-colors shadow-[0_-4px_10px_rgba(0,0,0,0.3)] flex items-center justify-center opacity-80 hover:opacity-100"
               title={showInputBar ? "Hide Chat" : "Show Chat"}
             >
               {showInputBar ? <ChevronDown size={14} /> : <ChevronLeft size={14} className="rotate-90" />}
             </button>
          </div>

          <AnimatePresence initial={false}>
            {showInputBar && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-zinc-950 border-t border-zinc-800/50 w-full"
              >
                <div className="p-2 sm:p-3 relative z-30">
                  <div className="max-w-3xl mx-auto flex items-end gap-2 bg-zinc-900 rounded-xl p-1 focus-within:ring-1 focus-within:ring-orange-500/50 transition-all shadow-inner border border-zinc-800">
                  <textarea
                    ref={textareaRef}
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        generateFullVideo();
                        (e.target as HTMLTextAreaElement).blur();
                      }
                    }}
                    placeholder="Paste script... (Press Enter to execute)"
                    className="flex-1 bg-transparent border-none text-[13px] text-zinc-200 placeholder:text-zinc-600 outline-none resize-none px-3 py-1.5 min-h-[36px] overflow-y-auto custom-scrollbar leading-relaxed transition-[height] duration-300"
                    rows={1}
                  />
                  <button
                    onClick={() => generateFullVideo()}
                    disabled={isGenerating || !script.trim()}
                    className="shrink-0 h-[36px] w-[36px] bg-orange-500 hover:bg-orange-600 text-black rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/20 transition-all disabled:opacity-30 disabled:scale-100 active:scale-95"
                    title="Generate Production"
                  >
                    {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} fill="currentColor" />}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm">
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-[11px] backdrop-blur-xl shadow-2xl flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-4 hover:text-white">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
