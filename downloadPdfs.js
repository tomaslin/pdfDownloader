const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const process = require('process');

// Get URL from command line arguments
const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error('Please provide a URL as a command line argument.');
    console.error('Usage: node downloadPdfs.js <URL>');
    process.exit(1);
}

// Function to sanitize URL for directory name
const sanitizeUrlForDir = (url) => {
    try {
        const parsed = new URL(url);
        // Use hostname and pathname, replace non-alphanumeric chars with underscore
        let dirName = (parsed.hostname + parsed.pathname).replace(/[^a-zA-Z0-9\/_-]/g, '_');
        // Replace multiple underscores/slashes with single ones, remove leading/trailing underscores/slashes
        dirName = dirName.replace(/[/_]+/g, '_').replace(/^_+|_+$/g, '');
        return dirName;
    } catch (e) {
        // Fallback for invalid URLs: replace non-alphanumeric chars
        return url.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    }
};

// Get current date in YYYY-MM-DD format
const today = new Date();
const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD

// Create directory name from sanitized URL and date
const sanitizedUrlPart = sanitizeUrlForDir(targetUrl);
const urlSpecificDirName = `${sanitizedUrlPart}_${dateString}`;

// Define the main downloads directory path
const mainDownloadsDir = path.join(__dirname, 'downloads');

// Ensure the main downloads directory exists
if (!fs.existsSync(mainDownloadsDir)) {
    fs.mkdirSync(mainDownloadsDir);
    console.log(`Created main downloads directory: ${mainDownloadsDir}`);
}

// Define the final download directory path inside the main downloads directory
const downloadDir = path.join(mainDownloadsDir, urlSpecificDirName);

// Ensure the specific download directory exists
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
    console.log(`Created directory: ${downloadDir}`);
} else {
    console.log(`Directory already exists: ${downloadDir}`);
}

// Function to download a file
const downloadFile = (fileUrl, destPath, filename) => {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(fileUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        // Use the provided filename
        const dest = path.join(destPath, filename);
        const file = fs.createWriteStream(dest);

        console.log(`Attempting to download: ${fileUrl} as ${filename}`);

        const request = protocol.get(fileUrl, (response) => {
            if (response.statusCode !== 200) {
                fs.unlink(dest, () => {}); // Delete the file if download failed
                console.error(`Failed to download ${filename}. Status Code: ${response.statusCode}`);
                return reject(new Error(`Status Code: ${response.statusCode}`));
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    console.log(`Successfully downloaded: ${filename} to ${destPath}`);
                    resolve();
                });
            });
        });

        request.on('error', (err) => {
            fs.unlink(dest, () => {}); // Delete the file if download failed
            console.error(`Error downloading ${filename}: ${err.message}`);
            reject(err);
        });

        file.on('error', (err) => {
            fs.unlink(dest, () => {}); // Delete the file if download failed
            console.error(`Error writing file ${filename}: ${err.message}`);
            reject(err);
        });
    });
};

(async () => {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        });
        const page = await browser.newPage();

        console.log(`Navigating to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        console.log('Searching for PDF links and their text...');
        const pdfInfoList = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href$="\.pdf"], a[href$="\.PDF"]'));
            return links.map(link => ({
                url: new URL(link.href, document.baseURI).href,
                text: (link.innerText || link.textContent || '').trim()
            }));
        });

        if (pdfInfoList.length === 0) {
            console.log('No PDF links found on the page.');
        } else {
            console.log(`Found ${pdfInfoList.length} PDF link(s). Starting downloads...`);
            for (const pdfInfo of pdfInfoList) {
                try {
                    // Sanitize the link text to create a valid filename
                    let filename = pdfInfo.text.replace(/[^a-zA-Z0-9 .-]/g, '_').replace(/\s+/g, '_');
                    // Ensure filename is not empty and ends with .pdf
                    if (!filename) {
                        filename = path.basename(new URL(pdfInfo.url).pathname);
                    } else if (!filename.toLowerCase().endsWith('.pdf')) {
                        filename += '.pdf';
                    }
                    // Prevent excessively long filenames (e.g., > 255 chars)
                    if (filename.length > 250) {
                        filename = filename.substring(0, 246) + '.pdf'; // Truncate and ensure .pdf
                    }

                    await downloadFile(pdfInfo.url, downloadDir, filename);
                } catch (error) {
                    console.error(`Could not download ${pdfInfo.url}: ${error.message}`);
                }
            }
            console.log('All download attempts finished.');
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
})();