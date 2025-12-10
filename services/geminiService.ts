import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { SONIC_SYSTEM_INSTRUCTION, GEMINI_CHAT_MODEL, GEMINI_IMAGE_MODEL } from "../constants";

// User provided API Key
const API_KEY = "AIzaSyC_KomLrDaVTiJc42H3fzTbirTn2bCMQcg";

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: API_KEY });
  }
  return aiInstance;
};

export const generateTextResponse = async (
  history: { role: 'user' | 'model'; parts: { text?: string; inlineData?: any }[] }[],
  newMessage: string,
  imagePart?: { mimeType: string; data: string },
  userName?: string
): Promise<string> => {
  try {
    const ai = getAI();
    
    let systemInstruction = SONIC_SYSTEM_INSTRUCTION;
    if (userName) {
      systemInstruction += `\n\nUSER INFO:\nThe user's name is: ${userName}. Address them by name and be super friendly/funny with them!`;
    }

    const chat = ai.chats.create({
      model: GEMINI_CHAT_MODEL,
      config: {
        systemInstruction: systemInstruction,
      },
      history: history,
    });

    const parts: any[] = [{ text: newMessage }];
    if (imagePart) {
      parts.push({
        inlineData: {
          mimeType: imagePart.mimeType,
          data: imagePart.data
        }
      });
    }

    const response: GenerateContentResponse = await chat.sendMessage({ 
      message: { 
        role: 'user', 
        parts: parts 
      } 
    });
    
    return response.text || "Arre re! Kuch gadbad ho gayi. Dobara try karo! 😅🛑";
  } catch (error: any) {
    console.error("Text generation error:", error);
    return "Oof! Connection break ho gaya! 😵‍💫 Thodi der baad try karna boss! ⚡ (Check Quota or Internet)";
  }
};

export const generateImageResponse = async (prompt: string): Promise<string> => {
  try {
    const ai = getAI();
    
    const response = await ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        // No responseMimeType/responseSchema for this model
      }
    });

    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            }
        }
    }
    
    return "";
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
};