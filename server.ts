import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for base64 images
app.use(express.json({ limit: "50mb" }));

const db = new Database("receipts.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    tax_federal REAL NOT NULL,
    tax_state REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get("/api/ollama/check", async (req, res) => {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) throw new Error("Ollama not responding");
    const data = await response.json();
    res.json({ status: "ok", models: data.models });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Ollama is not accessible" });
  }
});

app.post("/api/receipts", async (req, res) => {
  try {
    const { imageBase64, mimeType, engine, ollamaModel } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image provided" });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.includes(",") 
      ? imageBase64.split(",")[1] 
      : imageBase64;

    let data: any = {};

    if (engine === "ollama") {
      const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      const modelToUse = ollamaModel || "qwen3.5:0.8b";
      console.log(`[Ollama] Using model: ${modelToUse} at ${ollamaUrl}`);
      
      const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelToUse,
          prompt: `Analise a nota fiscal na imagem. Extraia: total, taxFederal, taxState.
Responda APENAS com JSON: {"total": 0.0, "taxFederal": 0.0, "taxState": 0.0}.
Se não achar, use 0.`,
          images: [base64Data],
          stream: true
        })
      });

      if (!ollamaRes.ok) {
        const errorText = await ollamaRes.text();
        console.error(`[Ollama] API error: ${ollamaRes.status} - ${errorText}`);
        throw new Error(`Ollama API error: ${ollamaRes.statusText}`);
      }

      // Read streaming response
      const reader = ollamaRes.body?.getReader();
      let responseText = "";
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Ollama streaming returns multiple JSON objects, one per line
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              try {
                const json = JSON.parse(line);
                if (json.response) responseText += json.response;
              } catch (e) {
                console.error("Error parsing streaming chunk:", e);
              }
            }
          }
        }
      }
      
      console.log(`[Ollama] Accumulated response:`, responseText);
      
      if (!responseText.trim()) {
        throw new Error("Ollama returned an empty response. The model may not be vision-capable or failed to process the image.");
      }

      // Tenta limpar a resposta caso o modelo retorne markdown (ex: ```json ... ```)
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      let jsonString = responseText;
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        const start = responseText.indexOf('{');
        const end = responseText.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          jsonString = responseText.substring(start, end + 1);
        }
      }
      
      console.log(`[Ollama] Parsed JSON string:`, jsonString);
      try {
        data = JSON.parse(jsonString);
      } catch (e) {
        console.error("[Ollama] JSON Parse Error:", e);
        throw new Error("Failed to parse JSON response from Ollama.");
      }
      console.log(`[Ollama] Final parsed data:`, data);
    } else {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType || "image/jpeg",
            },
          },
          {
            text: "Analise esta nota fiscal de mercado brasileira. Extraia o valor total da compra, o valor do imposto federal e o valor do imposto estadual. Se algum valor não for encontrado, retorne 0.",
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              total: { type: Type.NUMBER, description: "Valor total da nota fiscal" },
              taxFederal: { type: Type.NUMBER, description: "Valor do imposto federal pago" },
              taxState: { type: Type.NUMBER, description: "Valor do imposto estadual pago" },
            },
            required: ["total", "taxFederal", "taxState"],
          },
        },
      });

      data = JSON.parse(response.text || "{}");
    }

    const stmt = db.prepare(
      "INSERT INTO receipts (total, tax_federal, tax_state) VALUES (?, ?, ?)"
    );
    const info = stmt.run(data.total || 0, data.taxFederal || 0, data.taxState || 0);

    res.json({ id: info.lastInsertRowid, ...data });
  } catch (error) {
    console.error("Error processing receipt:", error);
    res.status(500).json({ error: "Failed to process receipt" });
  }
});

app.get("/api/receipts", (req, res) => {
  try {
    const receipts = db.prepare("SELECT * FROM receipts ORDER BY created_at DESC").all();
    res.json(receipts);
  } catch (error) {
    console.error("Error fetching receipts:", error);
    res.status(500).json({ error: "Failed to fetch receipts" });
  }
});

app.delete("/api/receipts/:id", (req, res) => {
  try {
    db.prepare("DELETE FROM receipts WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting receipt:", error);
    res.status(500).json({ error: "Failed to delete receipt" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
