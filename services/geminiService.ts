import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { SONIC_SYSTEM_INSTRUCTION, GEMINI_CHAT_MODEL, GEMINI_IMAGE_MODEL } from "../constants";

// Retrieve API Key from Environment Variable (Netlify)
const API_KEY = process.env.API_KEY as string;

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    if (!API_KEY) {
      throw new Error("API Key not found. Please set 'API_KEY' in Netlify Environment Variables.");
    }
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
    
    let errorMessage = "Oof! Connection break ho gaya! 😵‍💫 Thodi der baad try karna boss! ⚡";
    
    if (error.message?.includes("API key")) {
      errorMessage = "**API Key Error:** Key invalid hai ya missing hai. Netlify settings check karo.";
    } else if (error.message?.includes("429")) {
      errorMessage = "**Quota Exceeded:** Aaj ka limit khatam ho gaya lagta hai. 🛑";
    } else if (error.message?.includes("fetch")) {
      errorMessage = "**Network Error:** Internet check karo boss! 📶";
    }

    return errorMessage;
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