
import { SONIC_SYSTEM_INSTRUCTION, OPENROUTER_API_KEY, OPENROUTER_BASE_URL, GEMINI_CHAT_MODEL } from "../constants";

// Helper to get effective API Key
const getApiKey = () => {
  // Use the hardcoded key from constants if available, otherwise check env or local storage
  return OPENROUTER_API_KEY || localStorage.getItem('sonic_api_key') || process.env.API_KEY || "";
};

export const generateTextResponse = async (
  history: { role: 'user' | 'model'; parts: { text?: string; inlineData?: any }[] }[],
  newMessage: string,
  imagePart?: { mimeType: string; data: string },
  userName?: string
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API Key Missing! Please add 'API_KEY' in Netlify or Settings.");
  }

  try {
    let systemInstruction = SONIC_SYSTEM_INSTRUCTION;
    if (userName) {
      systemInstruction += `\n\nUSER INFO:\nThe user's name is: ${userName}. Address them by name and be super friendly/funny with them!`;
    }

    // Convert history to OpenRouter/OpenAI format
    const messages: any[] = [
      { role: "system", content: systemInstruction }
    ];

    history.forEach(msg => {
      const contentParts: any[] = [];
      msg.parts.forEach(part => {
        if (part.text) contentParts.push({ type: "text", text: part.text });
        if (part.inlineData) {
           contentParts.push({ 
             type: "image_url", 
             image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } 
           });
        }
      });
      if (contentParts.length > 0) {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: contentParts
        });
      }
    });

    // Add new message
    const newContentParts: any[] = [{ type: "text", text: newMessage }];
    if (imagePart) {
      newContentParts.push({
        type: "image_url",
        image_url: { url: `data:${imagePart.mimeType};base64,${imagePart.data}` }
      });
    }

    messages.push({
      role: "user",
      content: newContentParts
    });

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sonic-ai.netlify.app", // Required by OpenRouter
        "X-Title": "Sonic AI"
      },
      body: JSON.stringify({
        model: GEMINI_CHAT_MODEL,
        messages: messages,
        temperature: 0.8,
      })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Arre re! Kuch gadbad ho gayi. Dobara try karo! 😅🛑";

  } catch (error: any) {
    console.error("Text generation error:", error);
    
    let errorMessage = "Oof! Connection break ho gaya! 😵‍💫 Thodi der baad try karna boss! ⚡";
    
    if (error.message?.includes("401")) {
      errorMessage = "**API Key Error:** Key invalid hai. Check constants.ts or settings.";
    } else if (error.message?.includes("429")) {
      errorMessage = "**Quota Exceeded:** Limit over ho gayi hai OpenRouter par. 🛑";
    }

    return errorMessage;
  }
};

export const generateImageResponse = async (prompt: string): Promise<string> => {
    // OpenRouter is primarily Text LLM. 
    // Image generation is not natively supported via the standard chat endpoint in the same way.
    // We return empty string to let the UI handle it (or show a text description).
    console.warn("Image generation via OpenRouter not implemented in this version.");
    return "";
};
