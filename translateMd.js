const fs = require('fs').promises;
const path = require('path');
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

// --- Translation API Call ---
async function translateText(text, targetLang, instructions, config) {
    console.log(`  Requesting translation to ${targetLang}...`);
    try {
        // Construct the prompt for the OpenAI API
        const prompt = `Translate the following text to ${targetLang}. 
Instructions: ${instructions}. 
Formatting Requirements: 
- Return ONLY the translated text.
- Format the output as clean, well-structured Markdown.
- Use appropriate Markdown for headings and sections based on the source text structure.
- Remove any unnecessary extra whitespace (leading/trailing spaces, multiple blank lines).
- Remove any prefix that says markdown or otherwise, simply remove markdown content 
- Return the full entirely translated document, don't summarize, don't have sections tha say existing code. 

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
        const translatedMarkdown = response.data.choices[0]?.message?.content.trim();

        if (!translatedMarkdown) {
            throw new Error('No translation content received from API.');
        }

        console.log(`    Translation received.`);
        return translatedMarkdown;

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `API Error: ${error.response.status} ${error.response.statusText}. ${JSON.stringify(error.response.data)}`;
        }
        console.error(`    Error during translation API call to ${targetLang}:`, errorMessage);
        throw new Error(`Translation failed for ${targetLang}: ${errorMessage}`);
    }
}

// --- Main Execution Logic ---
async function main() {
    const sourceDir = path.join(__dirname, 'extracted_md');
    const outputBaseDir = path.join(sourceDir, 'translated'); // Changed to be inside sourceDir

    try {
        await fs.access(sourceDir);
        console.log(`Source directory found: ${sourceDir}`);
    } catch (error) {
        console.error(`Error accessing source directory: ${sourceDir}`, error.message);
        console.error('Please ensure the extracted_md directory exists and contains Markdown files.');
        process.exit(1);
    }

    await fs.mkdir(outputBaseDir, { recursive: true });
    console.log(`Output directory ensured: ${outputBaseDir}`);

    const config = await loadConfig();
    const translationFormats = await loadTranslationFormats();

    try {
        const files = await fs.readdir(sourceDir);
        const mdFiles = files.filter(file => path.extname(file).toLowerCase() === '.md');

        if (mdFiles.length === 0) {
            console.log(`No Markdown files found in ${sourceDir}. No files to translate.`);
            return;
        }

        console.log(`Found ${mdFiles.length} Markdown files. Starting translation process...`);

        for (const mdFile of mdFiles) {
            const sourceMdPath = path.join(sourceDir, mdFile);
            const baseName = path.basename(mdFile);

            console.log(`\nProcessing file: ${baseName}`);

            let sourceText;
            try {
                sourceText = await fs.readFile(sourceMdPath, 'utf8');
                console.log(`  Read source file: ${baseName}`);
            } catch (readError) {
                console.error(`  Skipping file ${baseName}: Cannot read file.`, readError.message);
                continue; // Skip to the next file
            }

            for (const [langCode, instructions] of Object.entries(translationFormats)) {
                const langOutputDir = path.join(outputBaseDir, langCode);
                await fs.mkdir(langOutputDir, { recursive: true }); // Ensure language directory exists
                const outputMdPath = path.join(langOutputDir, baseName); // Keep original filename

                if (langCode.toLowerCase() === 'en') {
                    try {
                        await fs.copyFile(sourceMdPath, outputMdPath);
                        console.log(`  Copied source file to ${outputMdPath}`);
                    } catch (copyError) {
                        console.error(`  Failed to copy ${baseName} to ${langCode} directory:`, copyError.message);
                    }
                    continue; // Move to next language
                }

                if (instructions.toLowerCase() === "don't translate") {
                    console.log(`  Skipping translation for ${langCode} as per instructions.`);
                    continue;
                }

                // Check if translated file already exists
                try {
                    await fs.access(outputMdPath);
                    console.log(`  Skipping translation for ${langCode}: File already exists at ${outputMdPath}`);
                    continue; // Skip to the next language if file exists
                } catch (err) {
                    // File doesn't exist, proceed with translation
                }

                console.log(`  Translating ${baseName} to ${langCode}...`);
                try {
                    const translatedText = await translateText(sourceText, langCode, instructions, config);
                    await fs.writeFile(outputMdPath, translatedText);
                    console.log(`    Successfully translated and saved to ${outputMdPath}`);
                } catch (translateError) {
                    console.error(`    Failed to translate ${baseName} to ${langCode}:`, translateError.message);
                }
            }
        }

        console.log('\nTranslation process finished.');

    } catch (error) {
        console.error('An error occurred during the translation process:', error);
    }
}

main();