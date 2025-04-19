const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse'); // Import pdf-parse

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

// Function to analyze text for potential complexity (heuristics)
function analyzeTextForComplexity(text, fileName) {
    const lines = text.split('\n');
    let complexIndicators = 0;
    const complexityThreshold = 5; // Number of indicators to flag as complex
    const excessiveSpacesRegex = /\s{5,}/; // Detect 5 or more consecutive spaces
    const tableColumnRegex = /(\S+\s{3,}\S+){2,}/; // Detect multiple words separated by 3+ spaces (potential columns)

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) continue; // Skip empty lines

        // Heuristic 1: Excessive consecutive spaces (often indicates columns or wide spacing)
        if (excessiveSpacesRegex.test(line)) {
            complexIndicators++;
            continue; // Count once per line for this heuristic
        }

        // Heuristic 2: Lines with few words but significant length (potential sparse table rows)
        const words = trimmedLine.split(/\s+/).filter(Boolean);
        if (words.length > 0 && words.length <= 3 && trimmedLine.length > 30) { // Adjusted length threshold
             complexIndicators++;
             continue;
        }

        // Heuristic 3: Consistent large spacing between multiple words (stronger table indicator)
        if (tableColumnRegex.test(trimmedLine)) {
            complexIndicators++;
            continue;
        }

        // Add more heuristics here if needed
    }

    // console.log(`    Debug: Complexity indicators for ${fileName}: ${complexIndicators}`); // Optional debug log
    return complexIndicators >= complexityThreshold;
}

// --- Translation API Call (Removed) ---
// Removed translateText function

// --- Main Execution Logic ---
async function main() {
    const inputDir = process.argv[2];
    if (!inputDir) {
        console.error('Please provide the input directory path as a command line argument.');
        console.error('Usage: node extractPdf.js <input_directory>'); // Updated usage message
        process.exit(1);
    }

    const absoluteInputDir = path.resolve(inputDir);
    const outputBaseDir = path.join(__dirname, 'extracted_md'); // Changed output directory

    try {
        await fs.access(absoluteInputDir);
        console.log(`Input directory found: ${absoluteInputDir}`);
    } catch (error) {
        console.error(`Error accessing input directory: ${absoluteInputDir}`, error.message);
        process.exit(1);
    }

    await fs.mkdir(outputBaseDir, { recursive: true });
    console.log(`Output directory ensured: ${outputBaseDir}`);

    // Removed config and translationFormats loading

    try {
        const files = await fs.readdir(absoluteInputDir);
        console.log(`  Files found in ${absoluteInputDir}:`, files); // Added for debugging
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log(`No PDF files found in ${absoluteInputDir}.`);
            return;
        }

        console.log(`Found ${pdfFiles.length} PDF file(s). Starting text extraction process...`); // Updated log message

        const complexFiles = []; // Initialize array to store complex file names

        for (const pdfFile of pdfFiles) {
            const pdfFilePath = path.join(absoluteInputDir, pdfFile);
            const baseName = path.basename(pdfFile, '.pdf');
            // Removed subdirectory creation

            console.log(`\nProcessing: ${pdfFile}`);
            let pdfText;
            try {
                pdfText = await readPdfText(pdfFilePath);

                // Analyze text for complexity
                if (analyzeTextForComplexity(pdfText, pdfFile)) {
                    // console.log(`    INFO: Potentially complex formatting detected in ${pdfFile}.`); // Removed immediate log
                    complexFiles.push(pdfFile); // Add complex file name to the list
                }

                const outputMdPath = path.join(outputBaseDir, `${baseName}.md`); // Save directly to extracted_md with .md extension
                await fs.writeFile(outputMdPath, pdfText); // Write extracted text
                console.log(`    Successfully extracted text and saved to ${outputMdPath}`);
            } catch (readOrWriteError) {
                console.error(`  Skipping ${pdfFile} due to error:`, readOrWriteError.message);
                continue; // Skip to the next file if reading or writing fails
            }

            // Removed translation loop
        }

        console.log('\nText extraction process finished.'); // Updated log message

        // Print the list of complex files at the end
        if (complexFiles.length > 0) {
            console.log('\nPotentially complex PDF files detected:');
            complexFiles.forEach(file => console.log(`  - ${file}`));
        }

    } catch (error) {
        console.error('An error occurred during the text extraction process:', error);
    }
}

main();