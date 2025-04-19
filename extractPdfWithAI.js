const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
// Removed: const pdf = require('pdf-parse');

// Function to load configuration (API Key, Model)
async function loadConfig() {
    const configPath = path.join(__dirname, 'config.json');
    try {
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        if (!config.apiKey || !config.apiEndpoint || !config.model) {
            throw new Error('Config file must contain apiKey, apiEndpoint, and model.');
        }
        console.log('Configuration loaded successfully.');
        return config;
    } catch (error) {
        console.error(`Error loading config file from ${configPath}:`, error.message);
        console.error('Please ensure config.json exists in the root directory and has the correct format (see config.example.json).');
        process.exit(1);
    }
}

// Function to read raw content from a PDF file
async function readPdfRaw(filePath) {
    console.log(`  Reading raw data from ${path.basename(filePath)}...`);
    try {
        const dataBuffer = await fs.readFile(filePath);
        console.log(`    Successfully read raw data (size: ${dataBuffer.length} bytes).`);
        if (dataBuffer.length === 0) {
            console.warn(`    Warning: Raw data from ${path.basename(filePath)} is empty.`);
        }
        return dataBuffer;
    } catch (error) {
        console.error(`    Error reading PDF file ${path.basename(filePath)}:`, error.message);
        throw error; // Re-throw the error to be caught in the main loop
    }
}

// Function to call OpenAI API for transcription from raw PDF data
async function transcribePdfWithAI(pdfBuffer, pdfFileName, config) {
    console.log(`    Encoding and sending data from ${pdfFileName} to AI for transcription...`);
    const base64Pdf = pdfBuffer.toString('base64');
    // Note: Sending raw base64 PDF data might exceed token limits or not be effectively processed by current chat models.
    // This approach is experimental and may require a model specifically trained for PDF interpretation or a different API endpoint if available.
    const prompt = `Please interpret the following base64 encoded PDF data, representing a file named "${pdfFileName}", and transcribe its content into a well-formatted Markdown document. Preserve the structure, headings, lists, and paragraphs as accurately as possible. If the PDF content cannot be interpreted, please indicate that.

--- BASE64 PDF DATA START ---
${base64Pdf}
--- BASE64 PDF DATA END ---`;

    try {
        const response = await axios.post(
            config.apiEndpoint, // Use the endpoint from config
            {
                model: config.model, // Use the model from config
                messages: [
                    { role: 'system', content: 'You are an expert assistant tasked with interpreting raw PDF data (base64 encoded) and transcribing it into clean, well-formatted Markdown.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2, // Lower temperature for more deterministic transcription
                // Consider max_tokens if needed, but large PDFs might still fail
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`, // Use the apiKey from config
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            const markdownContent = response.data.choices[0].message.content.trim();
            console.log(`    Successfully received Markdown transcription from AI.`);
            return markdownContent;
        } else {
            throw new Error('Invalid response structure received from OpenAI API.');
        }
    } catch (error) {
        // Check for specific errors like token limits
        if (error.response && error.response.data && error.response.data.error && error.response.data.error.code === 'context_length_exceeded') {
             console.error(`    Error calling OpenAI API for ${pdfFileName}: The PDF data is too large for the model's context window.`);
        } else {
            console.error(`    Error calling OpenAI API for ${pdfFileName}:`, error.response ? error.response.data : error.message);
        }
        throw error; // Re-throw to be caught in the main loop
    }
}

// --- Main Execution Logic ---
async function main() {
    const inputDir = process.argv[2];
    if (!inputDir) {
        console.error('Please provide the input directory path containing PDF files as a command line argument.');
        console.error('Usage: node extractPdfWithAI.js <input_directory>');
        process.exit(1);
    }

    const absoluteInputDir = path.resolve(inputDir);
    const outputBaseDir = path.join(__dirname, 'extracted_md');

    let config;
    try {
        config = await loadConfig();
    } catch (error) {
        // Error is handled within loadConfig, which exits
        return;
    }

    try {
        await fs.access(absoluteInputDir);
        console.log(`Input directory found: ${absoluteInputDir}`);
    } catch (error) {
        console.error(`Error accessing input directory: ${absoluteInputDir}`, error.message);
        process.exit(1);
    }

    try {
        await fs.mkdir(outputBaseDir, { recursive: true });
        console.log(`Output directory ensured: ${outputBaseDir}`);
    } catch (error) {
        console.error(`Error creating output directory ${outputBaseDir}:`, error.message);
        process.exit(1);
    }

    try {
        const files = await fs.readdir(absoluteInputDir);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log(`No PDF files found in ${absoluteInputDir}. Exiting.`);
            return;
        }

        console.log(`Found ${pdfFiles.length} PDF file(s). Starting AI transcription process...`);

        for (const pdfFile of pdfFiles) {
            const pdfFilePath = path.join(absoluteInputDir, pdfFile);
            const baseName = path.basename(pdfFile, '.pdf');
            const outputMdPath = path.join(outputBaseDir, `${baseName}.md`);

            console.log(`\nProcessing: ${pdfFile}`);

            try {
                // 1. Read raw data from PDF
                const pdfBuffer = await readPdfRaw(pdfFilePath);

                if (!pdfBuffer || pdfBuffer.length === 0) {
                    console.warn(`  Skipping ${pdfFile} because raw data is empty.`);
                    continue; // Skip to next file if no data
                }

                // 2. Transcribe PDF data using AI
                const markdownContent = await transcribePdfWithAI(pdfBuffer, pdfFile, config);

                // 3. Write Markdown to file
                await fs.writeFile(outputMdPath, markdownContent);
                console.log(`    Successfully transcribed and saved to ${outputMdPath}`);

            } catch (error) {
                console.error(`  Skipping ${pdfFile} due to an error during processing:`, error.message);
                // Optionally log the full error: console.error(error);
                continue; // Skip to the next file on error
            }
        }

        console.log('\nAI transcription process finished.');

    } catch (error) {
        console.error('An unexpected error occurred during the main process:', error);
    }
}

main();