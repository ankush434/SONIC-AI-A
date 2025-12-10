
import { generateTextResponse } from './geminiService';

export interface LiveClientCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onAudioData?: (source: AudioBufferSourceNode) => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (error: any) => void;
}

export class SonicLiveClient {
  private callbacks: LiveClientCallbacks;
  private isConnected = false;
  private recognition: any = null;
  private synth: SpeechSynthesis = window.speechSynthesis;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphoneStream: MediaStream | null = null;
  private visualizerInterval: any = null;

  constructor(callbacks: LiveClientCallbacks) {
    this.callbacks = callbacks;
    
    // Setup Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false; // We want turn-taking
      this.recognition.interimResults = false;
      this.recognition.lang = 'hi-IN'; // Default to Hindi/India mixed
    }
  }

  public async connect() {
    if (this.isConnected) return;
    
    if (!this.recognition) {
        this.callbacks.onError?.("Speech Recognition not supported in this browser.");
        return;
    }

    try {
        // Setup Visualizer (Microphone Volume)
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);
        
        // Start Visualizer Loop
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.visualizerInterval = setInterval(() => {
            if (this.analyser) {
                this.analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                const avg = sum / dataArray.length;
                this.callbacks.onVolumeChange?.(avg / 128); // Normalize 0-1 (approx)
            }
        }, 100);

        // Setup Recognition Events
        this.recognition.onstart = () => {
            console.log("Listening...");
        };

        this.recognition.onend = () => {
            if (this.isConnected) {
                // Restart listening if we are still connected and not speaking
                if (!this.synth.speaking) {
                    try { this.recognition.start(); } catch(e) {}
                }
            }
        };

        this.recognition.onresult = async (event: any) => {
            const transcript = event.results[0][0].transcript;
            if (transcript.trim()) {
                console.log("User said:", transcript);
                // Stop listening while processing/speaking
                this.recognition.stop(); 
                await this.processUserAudio(transcript);
            }
        };

        this.isConnected = true;
        this.callbacks.onOpen?.();
        this.recognition.start();

    } catch (error) {
        console.error("Live Client Connect Error", error);
        this.callbacks.onError?.(error);
    }
  }

  private async processUserAudio(text: string) {
      try {
          const responseText = await generateTextResponse([], text, undefined, localStorage.getItem('sonic_user_name') || undefined);
          this.speak(responseText);
      } catch (error) {
          console.error("Processing error", error);
          this.speak("Sorry boss, connection error.");
      }
  }

  private speak(text: string) {
      if (this.synth.speaking) this.synth.cancel();

      // Clean text
      const cleanText = text.replace(/[*#]/g, '').replace(/\[\[.*?\]\]/g, '');

      const utterance = new SpeechSynthesisUtterance(cleanText);
      
      // Select Voice
      const voices = this.synth.getVoices();
      const hindiVoice = voices.find(v => v.lang.includes('hi'));
      const englishVoice = voices.find(v => v.lang.includes('en-US'));
      
      if (hindiVoice && /[\u0900-\u097F]/.test(cleanText)) {
          utterance.voice = hindiVoice;
      } else if (englishVoice) {
          utterance.voice = englishVoice;
      }

      utterance.rate = 1.1; // Sonic speed

      utterance.onend = () => {
          if (this.isConnected) {
              try { this.recognition.start(); } catch(e){}
          }
      };

      this.synth.speak(utterance);
  }

  public async disconnect() {
    this.isConnected = false;
    
    if (this.recognition) {
        this.recognition.onend = null;
        this.recognition.stop();
    }
    
    if (this.synth.speaking) {
        this.synth.cancel();
    }

    if (this.visualizerInterval) clearInterval(this.visualizerInterval);
    
    if (this.microphoneStream) {
        this.microphoneStream.getTracks().forEach(t => t.stop());
    }
    
    if (this.audioContext) {
        this.audioContext.close();
    }

    this.callbacks.onClose?.();
  }
}
