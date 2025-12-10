import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SONIC_SYSTEM_INSTRUCTION, GEMINI_LIVE_MODEL } from '../constants';
import { base64ToUint8Array, createPcmBlob, decodeAudioData } from './utils';

export interface LiveClientCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onAudioData?: (source: AudioBufferSourceNode) => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (error: any) => void;
}

export class SonicLiveClient {
  private ai: GoogleGenAI;
  private inputAudioContext: AudioContext;
  private outputAudioContext: AudioContext;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private nextStartTime = 0;
  private sessionPromise: Promise<any> | null = null;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private callbacks: LiveClientCallbacks;
  private isConnected = false;

  constructor(callbacks: LiveClientCallbacks) {
    // Safe access to process.env
    const apiKey = (typeof process !== 'undefined' && process.env) ? process.env.API_KEY : null;
    
    if (!apiKey) {
        console.error("API_KEY is missing");
        throw new Error("API_KEY is missing. Please set API_KEY in environment variables.");
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.callbacks = callbacks;
    
    // Initialize Audio Contexts
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
    this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });
    
    this.inputNode = this.inputAudioContext.createGain();
    this.outputNode = this.outputAudioContext.createGain();
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  public async connect() {
    if (this.isConnected) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.sessionPromise = this.ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        callbacks: {
          onopen: () => {
            console.log('Sonic Live Connection Opened');
            this.isConnected = true;
            this.startAudioInput();
            this.callbacks.onOpen?.();
          },
          onmessage: this.handleMessage.bind(this),
          onclose: () => {
            console.log('Sonic Live Connection Closed');
            this.isConnected = false;
            this.cleanup();
            this.callbacks.onClose?.();
          },
          onerror: (err) => {
            console.error('Sonic Live Error:', err);
            this.callbacks.onError?.(err);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SONIC_SYSTEM_INSTRUCTION + "\n\nIMPORTANT: When speaking, use an energetic, fast, and friendly voice. You are Sonic! Be funny and witty!",
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
        },
      });
    } catch (error) {
      console.error("Failed to connect live client:", error);
      this.callbacks.onError?.(error);
    }
  }

  public async disconnect() {
    if (this.sessionPromise) {
        const session = await this.sessionPromise;
        // @ts-ignore
        if (session && typeof session.close === 'function') {
             // @ts-ignore
            session.close();
        }
    }
    this.cleanup();
    this.isConnected = false;
    this.callbacks.onClose?.();
  }

  private startAudioInput() {
    if (!this.stream) return;
    
    const source = this.inputAudioContext.createMediaStreamSource(this.stream);
    this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (e) => {
      if (!this.isConnected) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const volume = Math.sqrt(sum / inputData.length);
      this.callbacks.onVolumeChange?.(volume);

      const pcmBlob = createPcmBlob(inputData);
      
      if (this.sessionPromise) {
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({ media: pcmBlob });
        });
      }
    };

    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (base64Audio) {
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      
      const audioBuffer = await decodeAudioData(
        base64ToUint8Array(base64Audio),
        this.outputAudioContext
      );
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });
      
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
      
      this.callbacks.onAudioData?.(source);
    }

    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      this.sources.forEach(s => {
        try { s.stop(); } catch(e){}
      });
      this.sources.clear();
      this.nextStartTime = 0;
    }
  }

  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    this.sources.forEach(s => {
        try { s.stop(); } catch(e){}
    });
    this.sources.clear();
  }
}