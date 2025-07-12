#!/usr/bin/env node

import { searchTextInFiles } from '../dist/tools/search.js';
import { configManager } from '../dist/config-manager.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

async function testSearchFix() {
    console.log('🔍 Testing search functionality after fixes...');

    try {
        // Initialize config
        await configManager.init();
        const config = await configManager.getConfig();

        console.log('📋 Current configuration:');
        console.log('- Default shell:', config.defaultShell);
        console.log('- Allowed directories:', config.allowedDirectories);

        // Test search in an allowed directory (temp)
        console.log('\n🔍 Testing search in temp directory...');
        const tempDir = os.tmpdir();

        // Create a test file in temp directory
        const testFile = path.join(tempDir, 'test-search-file.txt');
        await fs.promises.writeFile(testFile, 'This is a test file for searchTextInFiles function\nAnother line with searchTextInFiles');

        try {
            const results = await searchTextInFiles({
                rootPath: tempDir,
                pattern: 'searchTextInFiles',
                filePattern: '*.txt',
                maxResults: 5
            });

            console.log(`✅ Search completed, found ${results.length} results`);

            if (results.length > 0) {
                console.log('📄 Sample results:');
                results.slice(0, 3).forEach((result, index) => {
                    console.log(`  ${index + 1}. ${result.file}:${result.line}`);
                    console.log(`     ${result.match.substring(0, 80)}...`);
                });
            }
        } finally {
            // Clean up test file
            try {
                await fs.promises.unlink(testFile);
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        // Test access to C:\projects if it exists
        const projectsPath = 'C:\\projects';
        try {
            const results = await searchTextInFiles({
                rootPath: projectsPath,
                pattern: 'test',
                maxResults: 1
            });
            console.log(`✅ Access to ${projectsPath} works correctly (${results.length} results)`);
        } catch (error) {
            console.log(`ℹ️  ${projectsPath} not accessible (might not exist): ${error.message}`);
        }

        console.log('\n🎉 All tests passed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testSearchFix(); 