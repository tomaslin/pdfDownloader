const fs = require('fs').promises;
const path = require('path');
const axios = require('axios'); // Import axios

const LARGE_FILE_THRESHOLD = 10000; // Characters
const CHUNK_SIZE = 10000; // Target size for chunks
const CONCURRENCY_LIMIT = 10; // Increased concurrency limit

// --- Configuration Loading ---
async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        if (!config.apiKey || !config.apiEndpoint || !config.model) {
            throw new Error('Config file must contain apiKey, apiEndpoint, and model.');
        }
        console.log('Configuration loaded successfully.');
        return config;
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
async function translateText(text, targetLang, instructions, config, fileType = 'markdown') {
    const formatInstruction = fileType === 'html' ? 'HTML' : 'Markdown';
    console.log(`  Requesting translation to ${targetLang} (Format: ${formatInstruction})...`);
    try {
        // Construct the prompt for the OpenAI API
        const prompt = `Translate the following text to ${targetLang}.
Instructions: ${instructions}.
Formatting Requirements:
- Return ONLY the translated text.
- Format the output as clean, well-structured ${formatInstruction}.
- Use appropriate ${formatInstruction} for headings, sections, lists, links, etc. based on the source text structure.
- For HTML, ensure all tags are correctly closed and nested.
- Remove any unnecessary extra whitespace (leading/trailing spaces, multiple blank lines).
- Remove any prefix like "\`\`\`markdown" or "\`\`\`html" or similar code block fences.
- Return the full entirely translated document/chunk, don't summarize.

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
                    { role: "system", content: `You are a helpful translation assistant. You translate text accurately based on the provided instructions and return the result in ${formatInstruction} format.` },
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
        let translatedContent = response.data.choices[0]?.message?.content.trim();


        if (!translatedContent) {
            throw new Error('No translation content received from API.');
        }

        // Clean up potential markdown/html fences added by the AI
        const startFenceMd = '```markdown';
        const startFenceHtml = '```html';
        const endFence = '```';

        if (translatedContent.startsWith(startFenceMd) && translatedContent.endsWith(endFence)) {
            translatedContent = translatedContent.substring(startFenceMd.length, translatedContent.length - endFence.length).trim();
        } else if (translatedContent.startsWith(startFenceHtml) && translatedContent.endsWith(endFence)) {
            translatedContent = translatedContent.substring(startFenceHtml.length, translatedContent.length - endFence.length).trim();
        } else if (translatedContent.startsWith(endFence) && translatedContent.endsWith(endFence)) {
             // Handle case where only ``` is added without language specifier
             translatedContent = translatedContent.substring(endFence.length, translatedContent.length - endFence.length).trim();
        }


        console.log(`    Translation received for ${targetLang}.`);
        return translatedContent;


    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `API Error: ${error.response.status} ${error.response.statusText}. ${JSON.stringify(error.response.data)}`;
        }
        console.error(`    Error during translation API call to ${targetLang}:`, errorMessage);
        throw new Error(`Translation failed for ${targetLang}: ${errorMessage}`);
    }
}


// --- Helper Function to Split Text ---
function splitTextIntoChunks(text, maxSize) {
    const chunks = [];
    let startIndex = 0;
    while (startIndex < text.length) {
        let endIndex = startIndex + maxSize;
        if (endIndex >= text.length) {
            chunks.push(text.substring(startIndex));
            break;
        }

        // Try to find a natural break point (paragraph) near the maxSize
        let splitPos = text.lastIndexOf('\n\n', endIndex);
        if (splitPos <= startIndex) {
            // If no paragraph break found, try a sentence break
            splitPos = text.lastIndexOf('. ', endIndex);
            if (splitPos <= startIndex) {
                 // If no sentence break, try a line break
                 splitPos = text.lastIndexOf('\n', endIndex);
                 if (splitPos <= startIndex) {
                      // If no natural break found, just split at maxSize
                      splitPos = endIndex;
                 } else {
                     splitPos += 1; // Include the newline
                 }
            } else {
                splitPos += 2; // Include the ". "
            }
        } else {
            splitPos += 2; // Include the "\n\n"
        }

        chunks.push(text.substring(startIndex, splitPos));
        startIndex = splitPos;
    }
    return chunks;
}

// --- Helper Function to Adjust HTML Image Paths ---
function adjustHtmlImagePaths(htmlContent) {
    // Adjusts <img src="some/path/image.png"> to <img src="../en/some/path/image.png">
    // Avoids adjusting absolute URLs or already adjusted paths
    return htmlContent.replace(/<img([^>]+)src="([^"]+)"/gi, (match, attributes, src) => {
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('../en/')) {
            return match; // Don't modify absolute URLs, data URIs, or already adjusted paths
        }
        // Ensure we don't double-prefix if the path somehow already starts with /
        const newSrc = src.startsWith('/') ? `../en${src}` : `../en/${src}`;
        return `<img${attributes}src="${newSrc}"`;
    });
}


// --- Main Execution Logic ---
async function main() {
    const sourceDir = path.join(__dirname, 'extracted_md');
    const outputBaseDir = path.join(sourceDir, 'translated');

    try {
        await fs.access(sourceDir);
        console.log(`Source directory found: ${sourceDir}`);
    } catch (error) {
        console.error(`Error accessing source directory: ${sourceDir}`, error.message);
        console.error('Please ensure the extracted_md directory exists and contains Markdown/HTML files.');
        process.exit(1);
    }

    await fs.mkdir(outputBaseDir, { recursive: true });
    console.log(`Output directory ensured: ${outputBaseDir}`);

    const config = await loadConfig();
    const translationFormats = await loadTranslationFormats();


    try {
        const files = await fs.readdir(sourceDir);

        // --- Asynchronously get stats and filter files ---
        const fileStats = await Promise.all(
            files.map(async (file) => {
                const fullPath = path.join(sourceDir, file);
                try {
                    const stat = await fs.stat(fullPath); // Use asynchronous stat
                    return { file, stat, ext: path.extname(file).toLowerCase() };
                } catch (statError) {
                    // Ignore errors for files we can't get stats for (e.g., broken symlinks)
                    console.warn(`  Could not get stats for ${file}, skipping: ${statError.message}`);
                    return null;
                }
            })
        );

        const processableFiles = fileStats
            .filter(item => item && item.stat.isFile() && (item.ext === '.md' || item.ext === '.html'))
            .map(item => item.file); // Get back just the filenames
        // --- End of filtering modification ---


        if (processableFiles.length === 0) {
            console.log(`No Markdown or HTML files found in ${sourceDir}. No files to translate.`);
            return;
        }


        console.log(`Found ${processableFiles.length} Markdown/HTML files. Starting translation process...`);


        for (const file of processableFiles) { // Process files one by one
            const sourceFilePath = path.join(sourceDir, file);
            const baseName = path.basename(file);
            const fileExt = path.extname(file).toLowerCase();
            const fileType = fileExt === '.html' ? 'html' : 'markdown';


            console.log(`\nProcessing file: ${baseName} (Type: ${fileType})`);


            let sourceText;
            try {
                sourceText = await fs.readFile(sourceFilePath, 'utf8');
                console.log(`  Read source file: ${baseName}`);
            } catch (readError) {
                console.error(`  Skipping file ${baseName}: Cannot read file.`, readError.message);
                continue; // Skip to the next file
            }

            const isLargeFile = sourceText.length > LARGE_FILE_THRESHOLD;
            const translationTasks = []; // Array to hold async task functions for this file

            // --- Prepare translation tasks for the current file ---
            for (const [langCode, instructions] of Object.entries(translationFormats)) {
                const targetDir = path.join(outputBaseDir, langCode);
                const outputFilePath = path.join(targetDir, baseName);

                // Define the core translation logic as an async function (task)
                const task = async () => {
                    try {
                        await fs.mkdir(targetDir, { recursive: true });

                        // Check if target file already exists before starting task
                        try {
                            await fs.access(outputFilePath);
                            console.log(`    Skipping ${langCode} for ${baseName}: Target file already exists.`);
                            return; // Skip this task
                        } catch (e) {
                            // File doesn't exist, proceed
                        }

                        if (instructions.toLowerCase() === "don't translate") {
                            console.log(`    Skipping ${langCode} for ${baseName}: Instruction is "Don't translate".`);
                            return; // Skip this task
                        }

                        if (langCode === 'en') {
                            console.log(`    Copying ${baseName} to ${langCode}...`);
                            await fs.copyFile(sourceFilePath, outputFilePath);
                            console.log(`    Copied ${baseName} to ${outputFilePath}`);
                            return; // Task complete
                        }

                        // --- Perform translation (chunked if large) ---
                        let finalTranslation;
                        if (isLargeFile) {
                            console.log(`    Processing large file chunks for ${langCode}...`);
                            const chunks = splitTextIntoChunks(sourceText, CHUNK_SIZE);
                            console.log(`      Split into ${chunks.length} chunks for ${langCode}.`);
                            const translatedChunks = [];
                            // Process chunks sequentially for this language
                            for (let i = 0; i < chunks.length; i++) {
                                console.log(`        Translating chunk ${i + 1} of ${chunks.length} for ${langCode}...`);
                                const translatedChunk = await translateText(chunks[i], langCode, instructions, config, fileType);
                                translatedChunks.push(translatedChunk);
                            }
                            finalTranslation = translatedChunks.join('\n\n'); // Join chunks
                            console.log(`      Finished translating chunks for ${langCode}.`);
                        } else {
                            // Translate small file directly
                            finalTranslation = await translateText(sourceText, langCode, instructions, config, fileType);
                        }

                        // Adjust image paths for HTML after translation
                        if (fileType === 'html' && langCode !== 'en') {
                            console.log(`    Adjusting image paths in HTML for ${langCode} (${baseName})...`);
                            finalTranslation = adjustHtmlImagePaths(finalTranslation);
                        }

                        await fs.writeFile(outputFilePath, finalTranslation);
                        console.log(`    Successfully translated and saved ${baseName} to ${outputFilePath}`);

                    } catch (error) {
                        console.error(`    Failed to process ${baseName} for ${langCode}:`, error.message);
                    }
                }; // End task definition
                translationTasks.push(task); // Add the task function
            } // End language loop for the current file

            // --- Execute tasks for the current file in batches ---
            if (translationTasks.length > 0) {
                console.log(`  Executing ${translationTasks.length} language tasks for ${baseName} with concurrency ${CONCURRENCY_LIMIT}...`);
                for (let i = 0; i < translationTasks.length; i += CONCURRENCY_LIMIT) {
                    const batch = translationTasks.slice(i, i + CONCURRENCY_LIMIT);
                    console.log(`    Running batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} for ${baseName} (${batch.length} tasks)...`);
                    const batchPromises = batch.map(task => task()); // Call the task functions
                    await Promise.allSettled(batchPromises); // Wait for batch to complete
                    console.log(`    Batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} for ${baseName} finished.`);
                }
            } else {
                console.log(`  No translation tasks needed for ${baseName}.`);
            }

        } // End file loop


        console.log('\nTranslation process finished.');


    } catch (error) {
        console.error('An unexpected error occurred during the main process:', error);
    }
}

main();