// functions/watermark.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('node:fs/promises');
const serverless = require('serverless-http'); // <-- เพิ่มบรรทัดนี้

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Load the Sarabun font (path relative to the function's execution environment)
// For Netlify Functions, files in the functions directory or included_files are accessible.
// Since sarabun.ttf is at the root of the project, we need to adjust the path
// It's often safer to include the font in the function's bundle or use a specific path
// For simplicity, let's assume it's directly accessible at the function's root once deployed.
// A more robust solution might involve including it in the function's bundle via netlify.toml.
// Or, if your sarabun.ttf is within the `functions` folder itself, the path is `./sarabun.ttf`.
// If sarabun.ttf is at the project root, and the function is in `functions/`, the path might be `../sarabun.ttf`
// or you can configure `included_files` in netlify.toml.
let sarabunFontBytes;
let sarabunFontLoaded = false;
const fontPath = 'sarabun.ttf'; // This path needs to be correct within the function's deployed context.
                                 // Let's assume for now `sarabun.ttf` is placed alongside `watermark.js`
                                 // within the deployed function bundle.

async function loadSarabunFont() {
    try {
        sarabunFontBytes = await fs.readFile(fontPath);
        sarabunFontLoaded = true;
        console.log('Sarabun font loaded successfully.');
    } catch (error) {
        console.error(`Error loading Sarabun font file at ${fontPath}:`, error);
        // In a serverless function, we might not want to exit the process,
        // but rather throw an error or handle it gracefully for each invocation.
        // For critical resources like fonts, throwing might be appropriate.
        throw new Error(`Failed to load Sarabun font: ${error.message}`);
    }
}

// Load font when the function is initialized (first cold start)
// This will make subsequent calls faster.
// Note: Netlify Functions are stateless. Each invocation could be a new "instance".
// So this loading happens per cold start.
if (!sarabunFontLoaded) {
    loadSarabunFont();
}


// API Endpoint to add watermark
app.post('/addWatermark', async (req, res) => {
    // Ensure font is loaded before processing request
    if (!sarabunFontLoaded) {
        try {
            await loadSarabunFont(); // Attempt to load if not already
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    const {
        pdfBase64,
        firstName,
        lastName,
        watermarkLine1,
        watermarkOptions
    } = req.body;

    if (!pdfBase64) {
        return res.status(400).json({ error: 'PDF data (pdfBase64) is required.' });
    }

    try {
        const existingPdfBytes = Buffer.from(pdfBase64, 'base64');
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        pdfDoc.registerFontkit(fontkit);

        const customFont = await pdfDoc.embedFont(sarabunFontBytes);

        const defaultWatermarkOptions = {
            size: 65,
            opacity: 0.2,
            rotate: -45,
            sizesubtitle: 40
        };
        const finalWatermarkOptions = { ...defaultWatermarkOptions, ...watermarkOptions };

        const finalWatermarkLine1 = watermarkLine1 || 'CONFIDENTIAL';
        const finalWatermarkLine2 = `${firstName || ''} ${lastName || ''}`;

        const mainFont = customFont;
        const subtitleFont = customFont;

        pdfDoc.getPages().forEach(page => {
            const { width, height } = page.getSize();

            const rotateDegrees = finalWatermarkOptions.rotate;
            const rotationObject = degrees(rotateDegrees);

            const line1Width = mainFont.widthOfTextAtSize(finalWatermarkLine1, finalWatermarkOptions.size);
            const line1Height = finalWatermarkOptions.size;

            const pageCenterX = width / 2;
            const pageCenterY = height / 2;

            const line1DrawX_unrotated = pageCenterX - (line1Width / 2);
            const line1DrawY_unrotated = pageCenterY - (line1Height / 2);

            page.drawText(finalWatermarkLine1, {
                x: line1DrawX_unrotated,
                y: line1DrawY_unrotated,
                size: finalWatermarkOptions.size,
                opacity: finalWatermarkOptions.opacity,
                rotate: rotationObject,
                font: mainFont,
                color: rgb(0.5, 0.5, 0.5)
            });

            const xOffsetRotated = -20;
            const yOffsetRotated = -30;

            const line2DrawX = line1DrawX_unrotated + xOffsetRotated;
            const line2DrawY = line1DrawY_unrotated + yOffsetRotated;

            page.drawText(finalWatermarkLine2, {
                x: line2DrawX,
                y: line2DrawY,
                size: finalWatermarkOptions.sizesubtitle,
                opacity: finalWatermarkOptions.opacity,
                rotate: rotationObject,
                font: subtitleFont,
                color: rgb(0.5, 0.5, 0.5)
            });
        });

        const modifiedPdfBytes = await pdfDoc.save();
        const watermarkedPdfBase64 = Buffer.from(modifiedPdfBytes).toString('base64');

        return res.json({
            success: true,
            watermarkedPdfBase64: watermarkedPdfBase64
        });

    } catch (error) {
        console.error('Error generating watermarked PDF:', error);
        return res.status(500).json({ error: 'Failed to generate watermarked PDF', details: error.message });
    }
});

// Export the Express app as a serverless function handler
module.exports.handler = serverless(app);