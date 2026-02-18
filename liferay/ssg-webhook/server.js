require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all origins
app.use(cors());

// Middleware to parse the request body as JSON
app.use(express.json());

// --- Environment Variable Check ---
const projectPathRelative = process.env.PROJECT_PATH;

if (!projectPathRelative) {
  console.error('Error: PROJECT_PATH environment variable must be defined in .env');
  process.exit(1);
}

const projectPathAbsolute = path.resolve(__dirname, projectPathRelative);

// --- Webhook Endpoint ---
app.post('/api/v1/trigger-extraction', (req, res) => {
  console.log(`[${new Date().toISOString()}] Extraction request received.`);
  
  const { pages } = req.body;

  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    console.error(`[${new Date().toISOString()}] Bad Request: 'pages' array is missing or empty.`);
    return res.status(400).send({ message: "Bad Request: 'pages' array is missing or empty in the request body." });
  }

  console.log(`[${new Date().toISOString()}] Received ${pages.length} pages to statify:`);
  console.log(pages);

  const tempFilePath = path.join(projectPathAbsolute, 'pages-to-build.json');

  try {
    // Use synchronous write to prevent race conditions
    fs.writeFileSync(tempFilePath, JSON.stringify(pages, null, 2), 'utf8');
    console.log(`[${new Date().toISOString()}] Successfully wrote pages to ${tempFilePath}`);

    res.status(202).send({ message: 'Build process initiated in the background.' });

    // Execute the build command with a larger buffer
    console.log(`[${new Date().toISOString()}] Initiating 'npm run build' in ${projectPathAbsolute}...`);
    exec(
      'npm run build', 
      { 
        cwd: projectPathAbsolute,
        maxBuffer: 1024 * 1024 * 10 // 10 MB
      }, 
      (error, stdout, stderr) => {
        if (error) {
          console.error(`[${new Date().toISOString()}] Error during build: ${error.message}`);
          // Clean up the temporary file even if build fails
          fs.unlink(tempFilePath, () => {});
          return;
        }
        if (stderr) {
          console.warn(`[${new Date().toISOString()}] Stderr during build:\n${stderr}`);
        }
        console.log(`[${new Date().toISOString()}] Build finished successfully:\n${stdout}`);

        // Clean up the temporary file after the build
        fs.unlink(tempFilePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(`[${new Date().toISOString()}] Error deleting temporary file ${tempFilePath}:`, unlinkErr);
          } else {
            console.log(`[${new Date().toISOString()}] Successfully deleted temporary file ${tempFilePath}`);
          }
        });
      }
    );

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error writing temporary pages file:`, err);
    return res.status(500).send({ message: "Failed to write pages data for the build process." });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Webhook service listening on port ${PORT}`);
  console.log(`Next.js Project Path (Resolved): ${projectPathAbsolute}`);
});
