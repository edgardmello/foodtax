import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import sharp from 'sharp';

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OCRResult {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
}

async function runTesseract(imagePath: string): Promise<OCRResult[]> {
  return new Promise((resolve, reject) => {
    const outputPrefix = path.join(process.cwd(), 'temp', 'ocr_' + Date.now());
    if (!fs.existsSync(path.dirname(outputPrefix))) {
      fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
    }

    const tesseract = spawn('tesseract', [imagePath, outputPrefix, 'tsv']);
    
    let stderr = '';
    tesseract.stderr.on('data', (data) => { stderr += data.toString(); });

    tesseract.on('close', (code) => {
      const tsvPath = outputPrefix + '.tsv';
      if (code === 0 && fs.existsSync(tsvPath)) {
        const tsv = fs.readFileSync(tsvPath, 'utf8');
        const lines = tsv.split('\n');
        const results: OCRResult[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          if (cols.length >= 12) {
            const text = cols[11].trim();
            if (text) {
              results.push({
                text,
                left: parseInt(cols[6]),
                top: parseInt(cols[7]),
                width: parseInt(cols[8]),
                height: parseInt(cols[9]),
                conf: parseFloat(cols[10])
              });
            }
          }
        }
        try { fs.unlinkSync(tsvPath); } catch (e) {}
        resolve(results);
      } else {
        reject(new Error(`Tesseract failed with code ${code}. Stderr: ${stderr}`));
      }
    });
  });
}

export async function detectReceiptRegions(base64Data: string) {
  const tmpDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  
  const tmpImg = path.join(tmpDir, `receipt_${Date.now()}.jpg`);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(tmpImg, buffer);

  try {
    const words = await runTesseract(tmpImg);
    const metadata = await sharp(buffer).metadata();
    const imgWidth = metadata.width || 1000;
    const imgHeight = metadata.height || 2000;

    const totalKeywords = ['TOTAL', 'PAGAR', 'LIQUIDO', 'VALOR'];
    const taxKeywords = ['TRIBUTOS', '12.741', 'ESTADUAL', 'FEDERAL', 'IBPT', 'APROX', 'FONTE'];

    const findBestRegion = (keywords: string[], searchFromBottom = true) => {
      let matches = words.filter(w => 
        keywords.some(k => w.text.toUpperCase().includes(k))
      );

      if (matches.length === 0) return null;

      // Sort by vertical position (bottom-up often better for totals)
      if (searchFromBottom) {
        matches.sort((a, b) => b.top - a.top);
      } else {
        matches.sort((a, b) => a.top - b.top);
      }

      const primary = matches[0];
      
      // Expand to cover the likely value area (the whole line and a bit more)
      return {
        left: 0,
        top: Math.max(0, primary.top - 30),
        width: imgWidth,
        height: primary.height + 60
      };
    };

    let boxTotal = findBestRegion(totalKeywords, true);
    let boxTax = findBestRegion(taxKeywords, true);

    // Fallback: if nothing found, crop the bottom 25% of the image (where totals usually are)
    if (!boxTotal) {
      boxTotal = {
        left: 0,
        top: Math.floor(imgHeight * 0.75),
        width: imgWidth,
        height: Math.floor(imgHeight * 0.15)
      };
    }
    
    if (!boxTax) {
      boxTax = {
        left: 0,
        top: Math.floor(imgHeight * 0.85),
        width: imgWidth,
        height: Math.floor(imgHeight * 0.12)
      };
    }

    try { fs.unlinkSync(tmpImg); } catch (e) {}
    return { boxTotal, boxTax };
  } catch (error) {
    console.error('OCR Error:', error);
    try { if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg); } catch (e) {}
    return { boxTotal: null, boxTax: null };
  }
}

export async function cropRegions(base64Data: string, boxTotal: BoundingBox | null, boxTax: BoundingBox | null) {
  const buffer = Buffer.from(base64Data, 'base64');
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  const processCrop = async (box: BoundingBox | null) => {
    if (!box || !width || !height) return null;
    
    // Ensure box is within image bounds
    const left = Math.max(0, box.left);
    const top = Math.max(0, Math.min(box.top, height - 10));
    const w = Math.min(width - left, box.width);
    const h = Math.min(height - top, box.height);
    
    if (w > 10 && h > 10) {
      try {
        const cropBuffer = await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer();
        return cropBuffer.toString('base64');
      } catch (e) {
        console.error('Crop failed:', e);
        return null;
      }
    }
    return null;
  };

  const imgTotal = await processCrop(boxTotal);
  const imgTax = await processCrop(boxTax);

  return { imgTotal, imgTax };
}
