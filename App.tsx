
import React, { useState, useRef, useEffect } from 'react';
import ChatMessage from './components/ChatMessage';
import PulseVisualizer from './components/PulseVisualizer';
import { generateTextResponse, generateImageResponse } from './services/geminiService';
import { SonicLiveClient } from './services/liveClient';
import { Message, Sender, AppMode, ChatSession } from './types';
import { GREETING_MESSAGE } from './constants';

// Extend window for SpeechRecognition
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  
  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // History State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Live/Voice State
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const [isListeningToDictation, setIsListeningToDictation] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  
  // Attachments & User Info
  const [selectedImage, setSelectedImage] = useState<{ mimeType: string, data: string } | null>(null);
  const [userName, setUserName] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const liveClientRef = useRef<SonicLiveClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // Load User Name & History on Mount
  useEffect(() => {
    const savedName = localStorage.getItem('sonic_user_name');
    if (savedName) setUserName(savedName);

    const savedHistory = localStorage.getItem('sonic_chat_history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setSessions(parsedHistory);
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save History whenever sessions change
  useEffect(() => {
    localStorage.setItem('sonic_chat_history', JSON.stringify(sessions));
  }, [sessions]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (liveClientRef.current) liveClientRef.current.disconnect();
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  // --- Session Management ---

  const createNewSessionId = () => Date.now().toString();

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setInputText('');
    setSelectedImage(null);
    setIsSidebarOpen(false);
  };

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setIsSidebarOpen(false);
    setMode(AppMode.CHAT);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) {
      handleNewChat();
    }
  };

  const updateCurrentSession = (newMessages: Message[]) => {
    if (newMessages.length === 0) return;

    // Determine Session ID
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = createNewSessionId();
      setCurrentSessionId(sessionId);
    }

    // Determine Title (First user message or default)
    const firstUserMsg = newMessages.find(m => m.sender === Sender.USER);
    const title = firstUserMsg ? (firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '')) : 'New Conversation';

    setSessions(prev => {
      const existingIndex = prev.findIndex(s => s.id === sessionId);
      const updatedSession: ChatSession = {
        id: sessionId!,
        title: existingIndex >= 0 ? prev[existingIndex].title : title,
        messages: newMessages,
        timestamp: Date.now()
      };

      if (existingIndex >= 0) {
        const newArr = [...prev];
        newArr[existingIndex] = updatedSession;
        // Move to top
        newArr.sort((a, b) => b.timestamp - a.timestamp);
        return newArr;
      } else {
        return [updatedSession, ...prev];
      }
    });
  };

  // --- Chat Logic ---

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isProcessing) return;

    const currentInput = inputText;
    const currentImage = selectedImage;

    // Reset Input
    setInputText('');
    setSelectedImage(null);
    setIsProcessing(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: Sender.USER,
      text: currentInput,
      timestamp: Date.now(),
      attachment: currentImage || undefined
    };

    const updatedMessagesWithUser = [...messages, userMsg];
    setMessages(updatedMessagesWithUser);
    updateCurrentSession(updatedMessagesWithUser); // Save to history

    // Add placeholder Sonic message
    const thinkingMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: thinkingMsgId,
      sender: Sender.SONIC,
      text: '',
      timestamp: Date.now(),
      isThinking: true
    }]);

    try {
      // Create history for API
      const apiHistory = updatedMessagesWithUser.map(m => {
        const parts: any[] = [];
        if (m.text) parts.push({ text: m.text });
        if (m.attachment) {
           parts.push({
               inlineData: {
                   mimeType: m.attachment.mimeType,
                   data: m.attachment.data
               }
           });
        }
        return {
          role: m.sender === Sender.USER ? 'user' as const : 'model' as const,
          parts: parts
        };
      });

      const rawResponse = await generateTextResponse(apiHistory, userMsg.text, currentImage || undefined, userName);
      
      // Name Memory Logic
      let displayText = rawResponse;
      const nameMatch = rawResponse.match(/\[\[NAME_SAVED:(.+?)\]\]/);
      if (nameMatch) {
          const capturedName = nameMatch[1].trim();
          localStorage.setItem('sonic_user_name', capturedName);
          setUserName(capturedName);
          displayText = rawResponse.replace(/\[\[NAME_SAVED:(.+?)\]\]/, '').trim();
      }

      // Image Generation Logic (Simulated Text Response for now as OpenRouter handles text better)
      const imagePromptMatch = displayText.match(/\*\*Image Prompt:\*\*\s*(.*)/i);
      
      let finalMessage: Message = {
        id: thinkingMsgId,
        sender: Sender.SONIC,
        text: displayText.replace(/\*\*Image Prompt:\*\*.*$/is, '').trim(), 
        timestamp: Date.now(),
        isThinking: false
      };

      if (imagePromptMatch) {
         // OpenRouter limitation: Direct image generation disabled in this mode to prevent crashes.
         // We will just show the text prompt or a note.
         finalMessage.text += "\n\n(Note: Image generation is currently paused in this API mode. But that's a cool idea! ⚡)";
      }

      // Final update
      const finalMessages = [...updatedMessagesWithUser, finalMessage];
      setMessages(finalMessages);
      updateCurrentSession(finalMessages); // Save to history

    } catch (error) {
      console.error(error);
      const errorMsg: Message = {
        id: thinkingMsgId,
        sender: Sender.SONIC,
        text: "Gotta run fast! But I hit a snag. Try again? " + (error instanceof Error ? error.message : ""),
        timestamp: Date.now(),
        isThinking: false
      };
      const errorMessages = [...updatedMessagesWithUser, errorMsg];
      setMessages(errorMessages);
      updateCurrentSession(errorMessages);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleVoiceMode = async () => {
    setVoiceError(null);
    
    if (mode === AppMode.CHAT) {
      try {
        if (!liveClientRef.current) {
          liveClientRef.current = new SonicLiveClient({
            onOpen: () => setIsLiveConnected(true),
            onClose: () => setIsLiveConnected(false),
            onError: (err) => {
                console.log("Voice Error", err);
                setIsLiveConnected(false);
                setVoiceError("Microphone Error or Browser Not Supported.");
            },
            onVolumeChange: (vol) => setMicVolume(vol)
          });
        }
        setMode(AppMode.VOICE);
        await liveClientRef.current.connect();
      } catch (err: any) {
        console.error("Voice Mode Init Error", err);
        setMode(AppMode.CHAT);
        setVoiceError("Voice mode failed to start.");
        setTimeout(() => setVoiceError(null), 5000);
      }
    } else {
      if (liveClientRef.current) {
        await liveClientRef.current.disconnect();
      }
      setMode(AppMode.CHAT);
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setSelectedImage({
          mimeType: file.type,
          data: base64String
        });
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startDictation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListeningToDictation) {
      recognitionRef.current?.stop();
      setIsListeningToDictation(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'hi-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListeningToDictation(true);
    recognition.onend = () => setIsListeningToDictation(false);
    recognition.onerror = () => setIsListeningToDictation(false);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(prev => prev + (prev ? ' ' : '') + transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <div className="flex flex-col w-full bg-gray-900 overflow-hidden relative" style={{ height: '100dvh' }}>
      
      {/* Toast Alert for Errors */}
      {voiceError && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-slide-up border-2 border-red-400">
           <i className="fas fa-exclamation-triangle"></i>
           <span className="font-bold">{voiceError}</span>
        </div>
      )}

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="absolute inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsSidebarOpen(false)}></div>
          <div className="relative w-72 bg-gray-900 h-full shadow-2xl border-r border-gray-800 flex flex-col animate-slide-right">
             <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                <h2 className="font-bold text-white text-lg tracking-wide"><i className="fas fa-history mr-2 text-blue-500"></i>History</h2>
                <button onClick={() => setIsSidebarOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                  <i className="fas fa-times text-xl"></i>
                </button>
             </div>
             
             <div className="p-4">
                <button 
                  onClick={handleNewChat}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                >
                  <i className="fas fa-plus"></i> New Chat
                </button>
             </div>

             <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                {sessions.length === 0 && (
                  <div className="text-center text-gray-500 mt-10 text-sm">No history yet.</div>
                )}
                {sessions.map(session => (
                  <div 
                    key={session.id} 
                    onClick={() => loadSession(session)}
                    className={`group w-full text-left p-3 rounded-xl flex items-center justify-between transition-all cursor-pointer border ${
                      currentSessionId === session.id 
                        ? 'bg-gray-800 border-blue-500/50 text-blue-400' 
                        : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                       <i className="fas fa-message text-xs opacity-70"></i>
                       <span className="truncate text-sm font-medium">{session.title}</span>
                    </div>
                    <button 
                      onClick={(e) => deleteSession(e, session.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity p-1"
                    >
                      <i className="fas fa-trash-alt text-xs"></i>
                    </button>
                  </div>
                ))}
             </div>
             
             <div className="p-4 border-t border-gray-800 text-xs text-gray-600 text-center">
                Sonic AI v1.2
             </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 z-40 shadow-lg shrink-0 pt-safe">
        <div className="flex items-center gap-3">
          {/* Menu Button */}
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="w-10 h-10 rounded-full bg-gray-800 hover:bg-gray-700 text-white flex items-center justify-center transition-colors border border-gray-700"
          >
            <i className="fas fa-bars"></i>
          </button>

          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 border-2 border-yellow-400 flex items-center justify-center shadow-[0_0_15px_#3b82f6]">
              <i className="fas fa-bolt text-white text-xl"></i>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl md:text-2xl font-black italic tracking-wider sonic-text-gradient">SONIC AI</h1>
              <div className="flex items-center gap-2">
                  <p className="text-[10px] text-blue-400 font-semibold tracking-widest">CREATED BY ANKUSH</p>
                  {userName && <span className="text-[10px] text-yellow-500 font-bold max-w-[100px] truncate">• {userName.toUpperCase()}</span>}
              </div>
            </div>
          </div>
        </div>
        
        {/* Voice Mode Toggle */}
        <button 
          onClick={toggleVoiceMode}
          className={`flex items-center gap-2 px-3 py-2 rounded-full font-bold transition-all duration-300 ${
            mode === AppMode.VOICE 
              ? 'bg-red-600 hover:bg-red-700 text-white shadow-[0_0_20px_#ef4444]' 
              : 'bg-gray-800 hover:bg-gray-700 text-blue-400 border border-blue-900'
          }`}
        >
          <i className={`fas ${mode === AppMode.VOICE ? 'fa-phone-slash' : 'fa-headset'}`}></i>
          <span className="hidden sm:inline text-sm">{mode === AppMode.VOICE ? 'End Call' : 'Voice Mode'}</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden flex flex-col h-full">
        
        {/* Background Decorative Elements */}
        <div className="absolute inset-0 pointer-events-none opacity-10">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600 rounded-full blur-[128px]"></div>
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-yellow-500 rounded-full blur-[96px]"></div>
        </div>

        {mode === AppMode.CHAT ? (
          <>
            {/* Chat History List */}
            <div className="flex-1 overflow-y-auto p-4 pb-36 space-y-4 z-10 scroll-smooth">
              {messages.length === 0 && (
                <div className="flex h-full items-center justify-center flex-col text-gray-500 opacity-50 px-4 text-center">
                    <i className="fas fa-bolt text-6xl mb-4 text-gray-700"></i>
                    <p>Ready to go fast! Ask me anything.</p>
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="absolute bottom-0 left-0 w-full p-3 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 z-20 pb-safe">
              
              {/* Image Preview */}
              {selectedImage && (
                  <div className="absolute -top-24 left-6 bg-gray-800 p-2 rounded-lg border border-gray-700 shadow-xl flex items-start gap-2 animate-slide-up">
                      <img 
                          src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} 
                          alt="Preview" 
                          className="h-16 w-auto rounded object-cover"
                      />
                      <button 
                          onClick={() => setSelectedImage(null)}
                          className="text-gray-400 hover:text-red-400"
                      >
                          <i className="fas fa-times-circle"></i>
                      </button>
                  </div>
              )}

              <div className="max-w-4xl mx-auto relative flex items-center gap-2">
                {/* Image Upload Button */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gray-800 text-gray-400 hover:text-blue-400 hover:bg-gray-700 border border-gray-700 flex items-center justify-center transition-all shrink-0"
                    title="Upload Image"
                >
                    <i className="fas fa-image"></i>
                </button>
                <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleImageSelect}
                />

                {/* Text Input */}
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={selectedImage ? "Add a caption..." : "Ask Sonic..."}
                  className="flex-1 bg-gray-800 text-white placeholder-gray-500 border border-gray-700 rounded-full py-3 px-4 md:py-4 md:px-6 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 transition-all shadow-inner text-sm md:text-base selectable-text"
                  disabled={isProcessing}
                />
                
                {/* Mic Button */}
                <button
                   onClick={startDictation}
                   className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all shrink-0 border border-gray-700 ${
                       isListeningToDictation 
                       ? 'bg-red-600 text-white animate-pulse shadow-[0_0_10px_#ef4444]' 
                       : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                   }`}
                   title="Speak"
                >
                    <i className={`fas ${isListeningToDictation ? 'fa-microphone' : 'fa-microphone-alt'}`}></i>
                </button>

                {/* Send Button */}
                <button
                  onClick={handleSendMessage}
                  disabled={isProcessing || (!inputText.trim() && !selectedImage)}
                  className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg shrink-0 ${
                    isProcessing || (!inputText.trim() && !selectedImage)
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/50'
                  }`}
                >
                  {isProcessing ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-paper-plane text-base md:text-lg"></i>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Voice Mode UI */
          <div className="flex-1 flex flex-col items-center justify-center z-10 p-8">
            <div className="text-center mb-12">
               <h2 className="text-3xl md:text-5xl font-black italic text-white mb-4 drop-shadow-lg">
                 {isLiveConnected ? "LISTENING..." : "INITIALIZING..."}
               </h2>
               <p className="text-blue-300 text-lg">Speak naturally. Sonic is listening.</p>
            </div>
            
            <PulseVisualizer active={isLiveConnected} volume={micVolume} />
            
            <div className="mt-16 text-center">
                <p className="text-gray-500 text-sm">Created by Ankush Vishwakarma</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
