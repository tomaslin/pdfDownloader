const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

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

// --- AI Formatting Call ---
async function callAIForFormatting(markdownText, fileName, config) {
    console.log(`  Requesting formatting for ${fileName}...`);
    try {
        const prompt = `Please reformat the following Markdown text into a clean, well-structured Markdown document.
Preserve the original meaning, structure (headings, lists, paragraphs, code blocks, etc.), and content accurately.
Ensure consistent formatting and remove any unnecessary whitespace or artifacts.
Return ONLY the reformatted Markdown content. Do not include any introductory text or explanations.

Markdown text to reformat:
---
${markdownText}
---
`;

        const response = await axios.post(
            config.apiEndpoint,
            {
                model: config.model,
                messages: [
                    { role: "system", content: "You are an expert assistant that reformats Markdown text into a clean and well-structured format, preserving the original content and structure." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 4000, // Adjust if needed, but should be sufficient for formatting
                temperature: 0.2, // Lower temperature for deterministic formatting
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const formattedContent = response.data.choices[0]?.message?.content.trim();

        if (!formattedContent) {
            throw new Error('No formatted content received from API.');
        }

        // Basic check to remove potential markdown code block fences added by the AI
        let finalContent = formattedContent;
        if (finalContent.startsWith('```markdown') && finalContent.endsWith('```')) {
            finalContent = finalContent.substring('```markdown'.length, finalContent.length - '```'.length).trim();
        } else if (finalContent.startsWith('```') && finalContent.endsWith('```')) {
             finalContent = finalContent.substring('```'.length, finalContent.length - '```'.length).trim();
        }


        console.log(`    Formatting received for ${fileName}.`);
        return finalContent;

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `API Error: ${error.response.status} ${error.response.statusText}. ${JSON.stringify(error.response.data)}`;
        }
        console.error(`    Error during formatting API call for ${fileName}:`, errorMessage);
        throw new Error(`Formatting failed for ${fileName}: ${errorMessage}`);
    }
}

// --- Main Execution Logic ---
async function main() {
    const inputDir = process.argv[2];
    if (!inputDir) {
        console.error('Please provide the input directory path containing Markdown files as a command line argument.');
        console.error('Usage: node formatMd.js <input_directory>');
        process.exit(1);
    }

    const absoluteInputDir = path.resolve(inputDir);
    const outputBaseDir = path.join(__dirname, 'formatted_md'); // Output directory
    const CONCURRENCY_LIMIT = 5; // Limit concurrent API calls

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
        const allFiles = await fs.readdir(absoluteInputDir);
        // Filter for .md files, excluding directories
        const fileStats = await Promise.all(
            allFiles.map(async (file) => {
                const fullPath = path.join(absoluteInputDir, file);
                try {
                    const stat = await fs.stat(fullPath);
                    return { file, stat, ext: path.extname(file).toLowerCase() };
                } catch (statError) {
                    console.warn(`  Could not get stats for ${file}, skipping: ${statError.message}`);
                    return null;
                }
            })
        );

        const markdownFiles = fileStats
            .filter(item => item && !item.stat.isDirectory() && item.ext === '.md')
            .map(item => item.file);

        if (markdownFiles.length === 0) {
            console.log(`No Markdown files found in ${absoluteInputDir}. Exiting.`);
            return;
        }

        console.log(`Found ${markdownFiles.length} Markdown file(s). Starting formatting process...`);

        const formattingTasks = []; // Array to hold async task functions

        for (const mdFileName of markdownFiles) {
            const sourceFilePath = path.join(absoluteInputDir, mdFileName);
            const outputFilePath = path.join(outputBaseDir, mdFileName);
            const baseName = path.basename(mdFileName);

            // Create the async task for formatting
            const task = async () => {
                console.log(`\nProcessing file: ${baseName}`);
                try {
                    const sourceText = await fs.readFile(sourceFilePath, 'utf8');
                    console.log(`  Read source file: ${baseName}`);

                    const formattedText = await callAIForFormatting(sourceText, baseName, config);

                    await fs.writeFile(outputFilePath, formattedText);
                    console.log(`    Successfully formatted and saved ${baseName} to ${outputFilePath}`);
                } catch (processError) {
                    console.error(`    Failed to process ${baseName}:`, processError.message);
                    // Optionally write the original file or skip writing on error
                }
            };
            formattingTasks.push(task); // Add the task function
        } // End file loop

        // --- Execute formatting tasks in batches ---
        if (formattingTasks.length > 0) {
             console.log(`\nPrepared ${formattingTasks.length} formatting tasks. Starting execution with concurrency limit ${CONCURRENCY_LIMIT}...`);
        } else {
             console.log(`\nNo formatting tasks needed.`);
             return; // Exit if no tasks
        }

        for (let i = 0; i < formattingTasks.length; i += CONCURRENCY_LIMIT) {
            const batch = formattingTasks.slice(i, i + CONCURRENCY_LIMIT);
            console.log(`  Running batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} (${batch.length} tasks)...`);

            // Create promises by calling the task functions in the current batch
            const batchPromises = batch.map(task => task());

            // Wait for all promises in the current batch to settle
            await Promise.allSettled(batchPromises); // Use allSettled to continue even if some fail

            console.log(`  Batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} finished.`);
        }

        console.log('\nFormatting process finished.');

    } catch (error) {
        console.error('An unexpected error occurred during the main process:', error);
    }
}

main();