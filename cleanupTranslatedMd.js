const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'extracted_md', 'translated');

function processDirectory(dirPath) {
    console.log(`Processing directory: ${dirPath}`);
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const currentPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                processDirectory(currentPath);
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
                processFile(currentPath);
            }
        }
    } catch (err) {
        console.error(`Error reading directory ${dirPath}:`, err);
    }
}

function processFile(filePath) {
    console.log(`Processing file: ${filePath}`);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const filteredLines = lines.filter(line => line.trim() !== '```markdown' && line.trim() !== '```');
        const newContent = filteredLines.join('\n');

        // Only write back if content has changed
        if (newContent !== content) {
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`  - Updated: ${filePath}`);
        } else {
            console.log(`  - No changes needed: ${filePath}`);
        }
    } catch (err) {
        console.error(`Error processing file ${filePath}:`, err);
    }
}

if (fs.existsSync(targetDir)) {
    processDirectory(targetDir);
    console.log('\nCleanup complete.');
} else {
    console.error(`Error: Target directory not found: ${targetDir}`);
    console.log('Please ensure the script is run from the project root directory and the path is correct.');
}