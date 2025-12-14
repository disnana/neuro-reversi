import { GoogleGenAI, Type } from "@google/genai";
import { Board, Disk, Coordinate } from '../types';

let genAI: GoogleGenAI | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const initGemini = () => {
  if (!process.env.API_KEY) {
      console.warn("API Key not found in environment.");
      return;
  }
  genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generateGeminiMove = async (
  board: Board,
  myColor: Disk,
  validMoves: Coordinate[]
): Promise<Coordinate> => {
  if (!genAI) initGemini();
  
  if (!genAI || validMoves.length === 0) {
     throw new Error("No moves possible or AI not init");
  }
  
  if (validMoves.length === 1) return validMoves[0];

  const model = "gemini-flash-lite-latest";

  const boardStr = board.map(row => 
    row.map(cell => cell === null ? '.' : cell === 'Black' ? 'B' : 'W').join('')
  ).join('\n');

  const prompt = `
    You are playing Reversi (Othello). You are ${myColor === 'Black' ? 'Black (B)' : 'White (W)'}.
    
    Current Board:
    ${boardStr}
    
    Valid Moves (row, col):
    ${JSON.stringify(validMoves)}
    
    Strategy:
    1. Prioritize corners (0,0), (0,7), (7,0), (7,7).
    2. Avoid placing disks adjacent to corners (X-squares and C-squares) unless you can capture the corner.
    3. Minimize your number of disks in the early game (mobility).
    
    Select the BEST move from the valid moves list.
    Return ONLY a JSON object with "row" and "col".
  `;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const response = await genAI.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              row: { type: Type.NUMBER },
              col: { type: Type.NUMBER },
            },
            required: ["row", "col"],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from Gemini");
      
      const json = JSON.parse(text);
      
      const isValid = validMoves.some(m => m.row === json.row && m.col === json.col);
      if (isValid) {
        return json as Coordinate;
      } else {
        console.warn("Gemini returned invalid move, falling back to random.");
        return validMoves[Math.floor(Math.random() * validMoves.length)];
      }

    } catch (error: any) {
      // Check for Rate Limit (429) or Service Unavailable (503)
      if (error.status === 429 || error.code === 429 || error.status === 503) {
        attempts++;
        const waitTime = Math.pow(2, attempts) * 1000 + (Math.random() * 1000); // Exponential backoff + jitter
        console.warn(`Gemini API Rate Limit hit. Retrying in ${Math.round(waitTime)}ms... (Attempt ${attempts}/${maxAttempts})`);
        await sleep(waitTime);
      } else {
        console.error("Gemini API Error (Non-retriable):", error);
        // Break loop and fall back to random
        break;
      }
    }
  }

  // Fallback to random if all retries fail
  console.warn("Gemini API failed after retries. Using random move.");
  return validMoves[Math.floor(Math.random() * validMoves.length)];
};