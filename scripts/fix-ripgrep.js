#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fixRipgrepOnWindows() {
    if (os.platform() !== 'win32') {
        console.log('This fix is only needed on Windows');
        return;
    }

    const ripgrepBinPath = path.join(__dirname, '..', 'node_modules', '@vscode', 'ripgrep', 'bin');
    const rgPath = path.join(ripgrepBinPath, 'rg');
    const rgExePath = path.join(ripgrepBinPath, 'rg.exe');

    try {
        // Check if rg exists
        if (!fs.existsSync(rgPath)) {
            console.log('❌ ripgrep binary not found at:', rgPath);
            return;
        }

        // Check if rg.exe already exists
        if (fs.existsSync(rgExePath)) {
            console.log('✅ rg.exe already exists');
            return;
        }

        // Copy rg to rg.exe
        fs.copyFileSync(rgPath, rgExePath);
        console.log('✅ Fixed ripgrep: copied rg to rg.exe');

    } catch (error) {
        console.error('❌ Error fixing ripgrep:', error);
    }
}

// Run the fix
fixRipgrepOnWindows(); 