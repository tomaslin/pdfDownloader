const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse'); // Import pdf-parse
// Placeholder for HTTP client (e.g., axios)
const axios = require('axios'); // Import axios

// --- Configuration Loading ---
async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('Error loading config.json:', error.message);
        console.error('Please ensure config.json exists and is correctly formatted based on config.example.json.');
        process.exit(1);
    }
}

async function loadTranslationFormats() {
    try {
        const formatsPath = path.join(__dirname, 'translationformats.json');
        const formatsData = await fs.readFile(formatsPath, 'utf8');
        return JSON.parse(formatsData);
    } catch (error) {
        console.error('Error loading translationformats.json:', error.message);
        console.error('Please ensure translationformats.json exists and is correctly formatted based on translationformats.example.json.');
        process.exit(1);
    }
}

// --- PDF Processing ---
async function readPdfText(filePath) {
    console.log(`  Reading text from ${path.basename(filePath)}...`);
    try {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdf(dataBuffer);
        console.log(`    Successfully extracted text.`);
        return data.text;
    } catch (error) {
        console.error(`    Error reading PDF file ${path.basename(filePath)}:`, error.message);
        throw error; // Re-throw the error to be caught in the main loop
    }
}

// --- Translation API Call ---
async function translateText(text, targetLang, instructions, config) {
    console.log(`  Requesting translation to ${targetLang}...`);
    try {
        // Construct the prompt for the OpenAI API
        const prompt = `Translate the following text to ${targetLang}. 
Instructions: ${instructions}. 
Formatting: Return the translation ONLY as Markdown.

Text to translate:
---
${text}
---
`;

        const response = await axios.post(
            config.apiEndpoint, // Use the endpoint from config.json
            {
                model: config.model || "gpt-4o", // Use model from config or default
                messages: [
                    { role: "system", content: "You are a helpful translation assistant. You translate text accurately based on the provided instructions and return the result in Markdown format." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 4000, // Adjust as needed, consider token limits
                temperature: 0.7, // Adjust creativity vs. precision
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`, // Use the API key from config.json
                    'Content-Type': 'application/json'
                }
            }
        );

        // Extract the translated text from the response
        // This might need adjustment based on the actual API response structure
        const translatedMarkdown = response.data.choices[0]?.message?.content.trim();

        if (!translatedMarkdown) {
            throw new Error('No translation content received from API.');
        }

        console.log(`    Translation received.`);
        return translatedMarkdown;

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            // Include more details if it's an API error
            errorMessage = `API Error: ${error.response.status} ${error.response.statusText}. ${JSON.stringify(error.response.data)}`;
        }
        console.error(`    Error during translation API call to ${targetLang}:`, errorMessage);
        throw new Error(`Translation failed for ${targetLang}: ${errorMessage}`); // Re-throw to be caught in the main loop
    }
}

// --- Main Execution Logic ---
async function main() {
    const inputDir = process.argv[2];
    if (!inputDir) {
        console.error('Please provide the input directory path as a command line argument.');
        console.error('Usage: node translatePdf.js <input_directory>');
        process.exit(1);
    }

    const absoluteInputDir = path.resolve(inputDir);
    const outputBaseDir = path.join(__dirname, 'translations');

    try {
        await fs.access(absoluteInputDir);
        console.log(`Input directory found: ${absoluteInputDir}`);
    } catch (error) {
        console.error(`Error accessing input directory: ${absoluteInputDir}`, error.message);
        process.exit(1);
    }

    await fs.mkdir(outputBaseDir, { recursive: true });
    console.log(`Output directory ensured: ${outputBaseDir}`);

    const config = await loadConfig();
    const translationFormats = await loadTranslationFormats();

    try {
        const files = await fs.readdir(absoluteInputDir);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log(`No PDF files found in ${absoluteInputDir}.`);
            return;
        }

        console.log(`Found ${pdfFiles.length} PDF file(s). Starting translation process...`);

        for (const pdfFile of pdfFiles) {
            const pdfFilePath = path.join(absoluteInputDir, pdfFile);
            const baseName = path.basename(pdfFile, '.pdf');
            const pdfOutputDir = path.join(outputBaseDir, baseName);
            await fs.mkdir(pdfOutputDir, { recursive: true });

            console.log(`\nProcessing: ${pdfFile}`);
            let pdfText;
            try {
                pdfText = await readPdfText(pdfFilePath);
            } catch (readError) {
                console.error(`  Skipping ${pdfFile} due to read error.`);
                continue; // Skip to the next file if reading fails
            }

            for (const [langCode, instructions] of Object.entries(translationFormats)) {
                if (instructions.toLowerCase() === "don't translate") {
                    console.log(`Skipping translation for ${langCode} as per instructions.`);
                    continue;
                }

                console.log(`  Translating to ${langCode}...`);
                try {
                    const translatedText = await translateText(pdfText, langCode, instructions, config);
                    const outputMdPath = path.join(pdfOutputDir, `${langCode}.md`);
                    await fs.writeFile(outputMdPath, translatedText);
                    console.log(`    Successfully translated and saved to ${outputMdPath}`);
                } catch (translateError) {
                    console.error(`    Failed to translate ${pdfFile} to ${langCode}:`, translateError.message);
                }
            }
        }

        console.log('\nTranslation process finished.');

    } catch (error) {
        console.error('An error occurred during the translation process:', error);
    }
}

main();