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
          prompt: `Analise a imagem desta nota fiscal de mercado brasileira.
Extraia os seguintes valores numéricos:
1. Valor total da compra (geralmente no final da nota)
2. Valor do imposto federal (tributos federais)
3. Valor do imposto estadual (tributos estaduais)

Responda APENAS com um objeto JSON válido, sem nenhum texto adicional, usando exatamente este formato:
{
  "total": 150.50,
  "taxFederal": 10.20,
  "taxState": 5.30
}
Se não encontrar algum valor, use 0. Use ponto para casas decimais.`,
          images: [base64Data],
          stream: false,
          format: "json",
          options: {
            temperature: 0.1
          }
        })
      });

      if (!ollamaRes.ok) {
        const errorText = await ollamaRes.text();
        console.error(`[Ollama] API error: ${ollamaRes.status} - ${errorText}`);
        throw new Error(`Ollama API error: ${ollamaRes.statusText}`);
      }

      const ollamaJson = await ollamaRes.json();
      console.log(`[Ollama] Raw response:`, ollamaJson.response);
      
      let responseText = ollamaJson.response || "{}";
      
      // Tenta limpar a resposta caso o modelo retorne markdown (ex: ```json ... ```)
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        responseText = jsonMatch[1];
      } else {
        const start = responseText.indexOf('{');
        const end = responseText.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          responseText = responseText.substring(start, end + 1);
        }
      }
      
      console.log(`[Ollama] Parsed JSON string:`, responseText);
      data = JSON.parse(responseText);
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
