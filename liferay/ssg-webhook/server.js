require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
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

    // Execute the build command using spawn to stream output and avoid buffer limits
    console.log(`[${new Date().toISOString()}] Initiating 'npm run build' in ${projectPathAbsolute}...`);
    
    const outPath = path.join(projectPathAbsolute, 'out');
    const outBakPath = path.join(projectPathAbsolute, 'out_backup_internal');

    // Backup existing 'out' directory before build
    if (fs.existsSync(outPath)) {
      try {
        if (fs.existsSync(outBakPath)) {
          fs.rmSync(outBakPath, { recursive: true, force: true });
        }
        fs.renameSync(outPath, outBakPath);
        console.log(`[${new Date().toISOString()}] Successfully backed up existing 'out' directory.`);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error backing up 'out' directory:`, err);
      }
    }

    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: projectPathAbsolute,
      shell: true
    });

    buildProcess.stdout.on('data', (data) => {
      process.stdout.write(`[Build STDOUT]: ${data}`);
    });

    buildProcess.stderr.on('data', (data) => {
      process.stderr.write(`[Build STDERR]: ${data}`);
    });

    buildProcess.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Spawn error during build: ${error.message}`);
    });

    buildProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[${new Date().toISOString()}] Build failed with code ${code}`);
        // Restore from backup on failure
        if (fs.existsSync(outBakPath)) {
          if (fs.existsSync(outPath)) {
            fs.rmSync(outPath, { recursive: true, force: true });
          }
          fs.renameSync(outBakPath, outPath);
          console.log(`[${new Date().toISOString()}] Restored 'out' directory from backup after build failure.`);
        }
      } else {
        console.log(`[${new Date().toISOString()}] Build finished successfully.`);
        // Merge backup into the new 'out' directory
        if (fs.existsSync(outBakPath)) {
          console.log(`[${new Date().toISOString()}] Merging previously exported content...`);
          // Use 'cp -rn' to copy without overwriting new files
          const mergeProcess = spawn('cp', ['-rn', `${outBakPath}/.`, outPath], { shell: true });
          mergeProcess.on('close', (mergeCode) => {
            if (mergeCode === 0) {
              console.log(`[${new Date().toISOString()}] Content merge complete.`);
              fs.rmSync(outBakPath, { recursive: true, force: true });
            } else {
              console.error(`[${new Date().toISOString()}] Merge failed with code ${mergeCode}.`);
            }
          });
        }
      }

      // Clean up the temporary file
      fs.unlink(tempFilePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[${new Date().toISOString()}] Error deleting temporary file ${tempFilePath}:`, unlinkErr);
        } else {
          console.log(`[${new Date().toISOString()}] Successfully deleted temporary file ${tempFilePath}`);
        }
      });
    });

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
