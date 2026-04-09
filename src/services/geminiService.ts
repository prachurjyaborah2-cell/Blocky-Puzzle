import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const FALLBACK_TIPS = [
  "Tip: Hamesha bade blocks ke liye jagah bachao! 🧩",
  "Tip: Ek sath 2-3 lines clear karne par zyada points milte hain. 🔥",
  "Tip: Corners ko pehle bharne ki koshish karo. 📐",
  "Tip: Center ko khali rakhna hamesha safe hota hai. 🛡️",
  "Tip: Agle blocks ko dekh kar apni chaal chalo! 👀",
  "Tip: Don't panic! Har block ki ek sahi jagah hoti hai. ✨"
];

export async function getAITip(score: number): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    return "Tip: Connect your Gemini API key for personalized AI tips! ✨";
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an expert Block Puzzle game master. The player's current score is ${score}. 
      Give a short, punchy, and helpful tip in Hindi (Hinglish) with an emoji. 
      Keep it under 15 words. 
      Example: "Tip: Bade blocks ke liye corners khali rakho! 📐"`,
      config: {
        temperature: 0.8,
        topP: 0.95,
      }
    });

    return response.text || FALLBACK_TIPS[Math.floor(Math.random() * FALLBACK_TIPS.length)];
  } catch (error: any) {
    // Check if it's a rate limit error
    if (error?.status === 429 || error?.message?.includes("429") || error?.message?.includes("quota") || error?.status === "RESOURCE_EXHAUSTED") {
       console.warn("Gemini API Rate Limit Exceeded. Using fallback tips.");
    } else {
       console.error("Gemini API Error:", error);
    }
    return FALLBACK_TIPS[Math.floor(Math.random() * FALLBACK_TIPS.length)];
  }
}
