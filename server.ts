import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { GoogleGenAI, Type } from "@google/genai";
import sharp from "sharp";
import dotenv from "dotenv";
import { detectReceiptRegions, cropRegions } from "./src/ocr_utils.ts";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3919", 10);

// Increase payload limit for base64 images
app.use(express.json({ limit: "50mb" }));

const db = new Database("receipts.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    tax_federal REAL NOT NULL,
    tax_state REAL NOT NULL,
    img_total TEXT,
    img_tax TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper function to add timeout to any promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

async function processWithGemini(base64Data: string, mimeType: string) {
  console.log("[Gemini] Processing receipt...");
  const data = await withTimeout(
    (async () => {
      const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType || "image/jpeg",
        },
      },
      {
        text: `Analise esta nota fiscal brasileira. Extraia:
1. Valor total líquido (VALOR A PAGAR).
2. Valor imposto federal (Lei 12.741).
3. Valor imposto estadual (Lei 12.741).

Adicionalmente, identifique a região (bounding box) de:
- Onde aparece o "VALOR A PAGAR".
- Onde aparece a seção de impostos/tributos (Lei 12.741).

Se não encontrar um valor, use 0.`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          total: { type: Type.NUMBER },
          taxFederal: { type: Type.NUMBER },
          taxState: { type: Type.NUMBER },
          boxTotal: {
            type: Type.OBJECT,
            properties: {
              ymin: { type: Type.NUMBER },
              xmin: { type: Type.NUMBER },
              ymax: { type: Type.NUMBER },
              xmax: { type: Type.NUMBER },
            },
          },
          boxTax: {
            type: Type.OBJECT,
            properties: {
              ymin: { type: Type.NUMBER },
              xmin: { type: Type.NUMBER },
              ymax: { type: Type.NUMBER },
              xmax: { type: Type.NUMBER },
            },
          },
        },
        required: ["total", "taxFederal", "taxState"],
      },
    },
      });
      return JSON.parse(response.text || "{}");
    })(),
    50000,
    "Tempo limite de análise excedido (50s). O Gemini demorou muito para responder."
  );
  
  let imgTotalBase64 = null;
  let imgTaxBase64 = null;

  try {
    const buffer = Buffer.from(base64Data, "base64");
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    const processCrop = async (box: any) => {
      if (box && width && height) {
        const { ymin, xmin, ymax, xmax } = box;
        // Gemini returns normalized 0-1000
        const left = Math.max(0, Math.floor((xmin / 1000) * width));
        const top = Math.max(0, Math.floor((ymin / 1000) * height));
        const w = Math.min(width - left, Math.ceil(((xmax - xmin) / 1000) * width));
        const h = Math.min(height - top, Math.ceil(((ymax - ymin) / 1000) * height));
        
        if (w > 0 && h > 0) {
          const cropBuffer = await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer();
          return cropBuffer.toString("base64");
        }
      }
      return null;
    };

    imgTotalBase64 = await processCrop(data.boxTotal);
    imgTaxBase64 = await processCrop(data.boxTax);

    // If Gemini boxes are missing/invalid, try Tesseract as backup
    if (!imgTotalBase64 || !imgTaxBase64) {
      console.log("[OCR] Using Tesseract as backup for visual verification...");
      const { boxTotal, boxTax } = await detectReceiptRegions(base64Data);
      const crops = await cropRegions(base64Data, boxTotal, boxTax);
      if (!imgTotalBase64) imgTotalBase64 = crops.imgTotal;
      if (!imgTaxBase64) imgTaxBase64 = crops.imgTax;
    }
  } catch (err) {
    console.error("Error cropping image:", err);
    // Try Tesseract as absolute fallback
    try {
      const { boxTotal, boxTax } = await detectReceiptRegions(base64Data);
      const crops = await cropRegions(base64Data, boxTotal, boxTax);
      imgTotalBase64 = crops.imgTotal;
      imgTaxBase64 = crops.imgTax;
    } catch (e) {}
  }

  return { ...data, imgTotal: imgTotalBase64, imgTax: imgTaxBase64 };
}

async function processWithOpenAI(base64Data: string, url: string, model: string) {
  console.log(`[OpenAI-Comp] Using URL: ${url} and model: ${model}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);

  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Analise esta nota fiscal brasileira e extraia os valores numéricos.

IMPORTANTE: Para o valor total, use EXCLUSIVAMENTE "Valor Pago". NÃO use "Valor total", "Subtotal" ou "Total R$".

Para os impostos, busque por uma dessas variações:
- "TRIB APROX: FEDERAL" ou "Trib Federais:" ou "Tributos Federais"
- "TRIB APROX: ESTADUAL" ou "Trib Estaduais:" ou "Tributos Estaduais"

NUNCA retorne o valor logo após "Tributos Totais Incidentes(Lei Fed. 12.741/2012):" pois esse é a soma dos impostos.

Responda APENAS o JSON: {"total": 0.0, "taxFederal": 0.0, "taxState": 0.0}. Use 0.0 se não encontrar.` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
            ]
          }
        ],
        // No response_format for better compatibility with local models
        temperature: 0.1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[OpenAI-Comp] API error: ${res.status}. Response:`, errorText);
      throw new Error(`API error: ${res.status}`);
    }
    const result = await res.json();
    let content = result.choices[0].message.content;
    
    let data: any;
    try {
      // Extract JSON block if the model is talkative
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      data = JSON.parse(jsonString);
    } catch (e) {
      console.error("[OpenAI-Comp] JSON Parse Error. Raw content:", content);
      throw new Error("Failed to parse JSON from model response.");
    }

    console.log("[OCR] Detecting regions for visual verification...");
    const { boxTotal, boxTax } = await detectReceiptRegions(base64Data);
    const { imgTotal, imgTax } = await cropRegions(base64Data, boxTotal, boxTax);

    return {
      total: data.total || 0,
      taxFederal: data.taxFederal || 0,
      taxState: data.taxState || 0,
      imgTotal: imgTotal || null,
      imgTax: imgTax || null
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error("Tempo limite de análise excedido (50s). O modelo demorou muito para responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processWithOllama(base64Data: string, model: string) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  console.log(`[Ollama] Using model: ${model} at ${ollamaUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000); // 50 seconds timeout

  try {
    const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        prompt: `Analise esta nota fiscal brasileira e extraia os valores numéricos.

IMPORTANTE: Para o valor total, use EXCLUSIVAMENTE \"Valor Pago\". NÃO use \"Valor total\", \"Subtotal\", \"VALOR A PAGAR\", \"TOTAL LÍQUIDO\" ou \"Total R$\".

Para os impostos, busque por uma dessas variações:
- Federal: \"TRIB APROX: FEDERAL\", \"Trib Federais:\", ou \"Tributos Federais\"
- Estadual: \"TRIB APROX: ESTADUAL\", \"Trib Estaduais:\", ou \"Tributos Estaduais\"

NUNCA retorne o valor logo após \"Tributos Totais Incidentes(Lei Fed. 12.741/2012):\" pois esse é a soma dos impostos.

Siga estas instruções:
1. Localize EXATAMENTE \"Valor Pago\".
2. Localize o valor do imposto federal (procure por \"Trib Federais\" ou similar).
3. Localize o valor do imposto estadual (procure por \"Trib Estaduais\" ou similar).

Responda APENAS o JSON:
{\"total\": 0.0, \"taxFederal\": 0.0, \"taxState\": 0.0}

Use 0.0 se não encontrar.`,
        images: [base64Data],
        stream: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!ollamaRes.ok) {
      const errorText = await ollamaRes.text();
      throw new Error(`Ollama API error: ${ollamaRes.status} - ${errorText}`);
    }

    const reader = ollamaRes.body?.getReader();
    let responseText = "";
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              if (json.response) responseText += json.response;
              if (json.done) break;
            } catch (e) {
              console.error("Error parsing streaming chunk:", e);
            }
          }
        }
      }
    }

    if (!responseText.trim()) {
      throw new Error("Ollama returned an empty response.");
    }

    let jsonString = responseText;
    const jsonBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonBlockMatch) {
      jsonString = jsonBlockMatch[1];
    } else {
      const start = responseText.indexOf('{');
      const end = responseText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        jsonString = responseText.substring(start, end + 1);
      }
    }

    let data: any = {};
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      console.warn("[Ollama] JSON Parse failed, attempting regex extraction...");
      const totalMatch = responseText.match(/(?:Valor Pago).*?(\d+[,.]\d{2})/i);
      const fedMatch = responseText.match(/(?:Trib Federais|TRIB APROX.*?FEDERAL|Tributos Federais).*?R?\$?\s*(\d+[,.]\d{2})/i);
      const stateMatch = responseText.match(/(?:Trib Estaduais|TRIB APROX.*?ESTADUAL|Tributos Estaduais).*?R?\$?\s*(\d+[,.]\d{2})/i);
      
      data = {
        total: totalMatch ? parseFloat(totalMatch[1].replace(',', '.')) : 0,
        taxFederal: fedMatch ? parseFloat(fedMatch[1].replace(',', '.')) : 0,
        taxState: stateMatch ? parseFloat(stateMatch[1].replace(',', '.')) : 0
      };
      
      if (data.total === 0) {
         console.error("[Ollama] Regex extraction failed too. Original text:", responseText);
         throw new Error("Failed to parse response from Ollama.");
      }
    }

    // Enrich with OCR-based crops for visual verification
    console.log("[OCR] Detecting regions for visual verification...");
    const { boxTotal, boxTax } = await detectReceiptRegions(base64Data);
    const { imgTotal, imgTax } = await cropRegions(base64Data, boxTotal, boxTax);

    return {
      total: data.total || data.Total || 0,
      taxFederal: data.taxFederal || data.tax_federal || data.taxFederalValue || 0,
      taxState: data.taxState || data.tax_state || data.taxStateValue || 0,
      imgTotal: imgTotal || null,
      imgTax: imgTax || null
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error("Tempo limite de análise excedido (50s). O modelo demorou muito para responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

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

app.get("/api/custom/models", async (req, res) => {
  try {
    let { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: "URL is required" });
    
    // Clean URL: remove trailing slash
    url = url.replace(/\/$/, "");
    
    console.log(`[Proxy] Fetching models from: ${url}/v1/models`);
    const response = await fetch(`${url}/v1/models`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Proxy] Server responded with ${response.status}: ${text}`);
      return res.status(response.status).json({ error: `Server error: ${response.status}` });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error(`[Proxy] Connection failed: ${error.message}`);
    res.status(500).json({ error: `Connection failed: ${error.message}. Check if server is running and URL is correct.` });
  }
});

app.post("/api/receipts", async (req, res) => {
  try {
    const { imageBase64, mimeType, engine, ollamaModel, customUrl, customModel } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image provided" });
    }

    const base64Data = imageBase64.includes(",") 
      ? imageBase64.split(",")[1] 
      : imageBase64;

    let data: any = null;
    let usedFallback = false;

    if (engine === "ollama") {
      try {
        const modelToUse = ollamaModel || "qwen3.5:0.8b";
        data = await processWithOllama(base64Data, modelToUse);
        
        if (data.total === 0 && data.taxFederal === 0 && data.taxState === 0) {
          console.warn("[Ollama] Model returned all zeros, triggering fallback to Gemini.");
          throw new Error("Ollama returned zeros");
        }
      } catch (error: any) {
        if (error.message?.includes("Tempo limite") || error.name === 'AbortError') {
          console.error("[Ollama] Timeout error:", error);
          return res.status(408).json({ error: error.message || "Tempo limite de análise excedido (50s)." });
        }
        console.error("[Ollama] Failed, falling back to Gemini:", error);
        usedFallback = true;
        data = await processWithGemini(base64Data, mimeType);
      }
    } else if (engine === "custom") {
      try {
        data = await processWithOpenAI(base64Data, customUrl, customModel);
      } catch (error: any) {
        if (error.message?.includes("Tempo limite") || error.name === 'AbortError') {
          console.error("[Custom] Timeout error:", error);
          return res.status(408).json({ error: error.message || "Tempo limite de análise excedido (50s)." });
        }
        console.error("[Custom] Failed, falling back to Gemini:", error);
        usedFallback = true;
        data = await processWithGemini(base64Data, mimeType);
      }
    } else {
      data = await processWithGemini(base64Data, mimeType);
    }

    const stmt = db.prepare(
      "INSERT INTO receipts (total, tax_federal, tax_state, img_total, img_tax) VALUES (?, ?, ?, ?, ?)"
    );
    const info = stmt.run(
      data.total || 0, 
      data.taxFederal || 0, 
      data.taxState || 0, 
      data.imgTotal || null, 
      data.imgTax || null
    );

    res.json({ id: info.lastInsertRowid, ...data, fallback: usedFallback });
  } catch (error: any) {
    console.error("Error processing receipt:", error);
    if (error.message?.includes("Tempo limite")) {
      res.status(408).json({ error: error.message || "Tempo limite de análise excedido (50s)." });
    } else {
      res.status(500).json({ error: "Failed to process receipt" });
    }
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
