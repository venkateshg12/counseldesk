import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../constants/env.js";

// One client per process, like the database pool.
export const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
