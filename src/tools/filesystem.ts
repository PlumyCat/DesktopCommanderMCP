import fs from "fs/promises";
import path from "path";
import os from 'os';
import fetch from 'cross-fetch';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { capture } from '../utils/capture.js';
import { withTimeout } from '../utils/withTimeout.js';
import { configManager } from '../config-manager.js';

// CONSTANTS SECTION - Consolidate all timeouts and thresholds
const FILE_OPERATION_TIMEOUTS = {
    PATH_VALIDATION: 10000,    // 10 seconds
    URL_FETCH: 30000,          // 30 seconds  
    FILE_READ: 30000,          // 30 seconds
} as const;

const FILE_SIZE_LIMITS = {
    LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,  // 10MB
    LINE_COUNT_LIMIT: 10 * 1024 * 1024,      // 10MB for line counting
} as const;

const READ_PERFORMANCE_THRESHOLDS = {
    SMALL_READ_THRESHOLD: 100,    // For very small reads
    DEEP_OFFSET_THRESHOLD: 1000,  // For byte estimation
    SAMPLE_SIZE: 10000,           // Sample size for estimation
    CHUNK_SIZE: 8192,             // 8KB chunks for reverse reading
} as const;

// UTILITY FUNCTIONS - Eliminate duplication

/**
 * Count lines in text content efficiently
 * @param content Text content to count lines in
 * @returns Number of lines
 */
function countLines(content: string): number {
    return content.split('\n').length;
}

/**
 * Count lines in a file efficiently (for files under size limit)
 * @param filePath Path to the file
 * @returns Line count or undefined if file too large/can't read
 */
async function getFileLineCount(filePath: string): Promise<number | undefined> {
    try {
        const stats = await fs.stat(filePath);
        // Only count lines for reasonably sized files to avoid performance issues
        if (stats.size < FILE_SIZE_LIMITS.LINE_COUNT_LIMIT) {
            const content = await fs.readFile(filePath, 'utf8');
            return countLines(content);
        }
    } catch (error) {
        // If we can't read the file, just return undefined
    }
    return undefined;
}

/**
 * Get MIME type information for a file
 * @param filePath Path to the file
 * @returns Object with mimeType and isImage properties
 */
async function getMimeTypeInfo(filePath: string): Promise<{ mimeType: string; isImage: boolean }> {
    const { getMimeType, isImageFile } = await import('./mime-types.js');
    const mimeType = getMimeType(filePath);
    const isImage = isImageFile(mimeType);
    return { mimeType, isImage };
}

/**
 * Get file extension for telemetry purposes
 * @param filePath Path to the file
 * @returns Lowercase file extension
 */
function getFileExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
}

/**
 * Get default read length from configuration
 * @returns Default number of lines to read
 */
async function getDefaultReadLength(): Promise<number> {
    const config = await configManager.getConfig();
    return config.fileReadLineLimit ?? 1000; // Default to 1000 lines if not set
}

// Initialize allowed directories from configuration
async function getAllowedDirs(): Promise<string[]> {
    try {
        const config = await configManager.getConfig();
        if (config.allowedDirectories && Array.isArray(config.allowedDirectories)) {
            return config.allowedDirectories;
        } else {
            // Use secure defaults - this should not happen with new config defaults
            const secureDefaults = [
                path.join(os.homedir(), '.claude-server-commander', 'workspace'),
                path.join(os.homedir(), 'Documents', 'claude-projects'),
                os.tmpdir()
            ];
            await configManager.setValue('allowedDirectories', secureDefaults);
            return secureDefaults;
        }
    } catch (error) {
        console.error('Failed to initialize allowed directories:', error);
        // Return secure defaults instead of empty array
        return [
            path.join(os.homedir(), '.claude-server-commander', 'workspace'),
            path.join(os.homedir(), 'Documents', 'claude-projects'),
            os.tmpdir()
        ];
    }
}

// Import Windows path utilities
import { normalizeWindowsPath, expandHome, toAbsolutePath } from '../utils/windowsPathFix.js';

// Normalize all paths consistently without case conversion for Windows compatibility
function normalizePath(p: string): string {
    return normalizeWindowsPath(expandHome(p));
}

/**
 * Recursively validates parent directories until it finds a valid one
 * This function handles the case where we need to create nested directories
 * and we need to check if any of the parent directories exist
 *
 * @param directoryPath The path to validate
 * @returns Promise<boolean> True if a valid parent directory was found
 */
async function validateParentDirectories(directoryPath: string): Promise<boolean> {
    const parentDir = path.dirname(directoryPath);

    // Base case: we've reached the root or the same directory (shouldn't happen normally)
    if (parentDir === directoryPath || parentDir === path.dirname(parentDir)) {
        return false;
    }

    try {
        // Check if the parent directory exists
        await fs.realpath(parentDir);
        return true;
    } catch {
        // Parent doesn't exist, recursively check its parent
        return validateParentDirectories(parentDir);
    }
}

/**
 * Checks if a path is within any of the allowed directories
 *
 * @param pathToCheck Path to check
 * @returns boolean True if path is allowed
 */
async function isPathAllowed(pathToCheck: string): Promise<boolean> {
    const allowedDirectories = await getAllowedDirs();

    // No longer allow empty allowedDirectories as a bypass
    if (allowedDirectories.length === 0) {
        return false;
    }

    // Import security utilities
    const { isPathAllowed: secureIsPathAllowed, analyzePathSecurity } = await import('../utils/security.js');

    // Use enhanced security validation
    const isAllowed = secureIsPathAllowed(pathToCheck, allowedDirectories);

    if (!isAllowed) {
        // Log security analysis for debugging
        const analysis = analyzePathSecurity(pathToCheck);
        console.warn(`Path access denied: ${pathToCheck}`, analysis);
    }

    return isAllowed;
}

/**
 * Validates a path to ensure it can be accessed or created.
 * For existing paths, returns the real path (resolving symlinks).
 * For non-existent paths, validates parent directories to ensure they exist.
 *
 * @param requestedPath The path to validate
 * @returns Promise<string> The validated path
 * @throws Error if the path or its parent directories don't exist or if the path is not allowed
 */
export async function validatePath(requestedPath: string): Promise<string> {
    const validationOperation = async (): Promise<string> => {
        // Use the improved path handling for Windows
        const absolute = toAbsolutePath(requestedPath);

        // Check if path is allowed
        if (!(await isPathAllowed(absolute))) {
            capture('server_path_validation_error', {
                error: 'Path not allowed',
                allowedDirsCount: (await getAllowedDirs()).length
            });

            throw new Error(`Path not allowed: ${requestedPath}. Must be within one of these directories: ${(await getAllowedDirs()).join(', ')}`);
        }

        // Check if path exists
        try {
            const stats = await fs.stat(absolute);
            // If path exists, resolve any symlinks
            return await fs.realpath(absolute);
        } catch (error) {
            // Path doesn't exist - validate parent directories
            if (await validateParentDirectories(absolute)) {
                // Return the path if a valid parent exists
                // This will be used for folder creation and many other file operations
                return absolute;
            }
            // If no valid parent found, return the absolute path anyway
            return absolute;
        }
    };

    // Execute with timeout
    const result = await withTimeout(
        validationOperation(),
        FILE_OPERATION_TIMEOUTS.PATH_VALIDATION,
        `Path validation operation`, // Generic name for telemetry
        null
    );

    if (result === null) {
        // Keep original path in error for AI but a generic message for telemetry
        capture('server_path_validation_timeout', {
            timeoutMs: FILE_OPERATION_TIMEOUTS.PATH_VALIDATION
        });

        throw new Error(`Path validation failed for path: ${requestedPath}`);
    }

    return result;
}

// File operation tools
export interface FileResult {
    content: string;
    mimeType: string;
    isImage: boolean;
}


/**
 * Read file content from a URL
 * @param url URL to fetch content from
 * @returns File content or file result with metadata
 */
export async function readFileFromUrl(url: string): Promise<FileResult> {
    // Import the MIME type utilities
    const { isImageFile } = await import('./mime-types.js');

    // Set up fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FILE_OPERATION_TIMEOUTS.URL_FETCH);

    try {
        const response = await fetch(url, {
            signal: controller.signal
        });

        // Clear the timeout since fetch completed
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // Get MIME type from Content-Type header
        const contentType = response.headers.get('content-type') || 'text/plain';
        const isImage = isImageFile(contentType);

        if (isImage) {
            // For images, convert to base64
            const buffer = await response.arrayBuffer();
            const content = Buffer.from(buffer).toString('base64');

            return { content, mimeType: contentType, isImage };
        } else {
            // For text content
            const content = await response.text();

            return { content, mimeType: contentType, isImage };
        }
    } catch (error) {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);

        // Return error information instead of throwing
        const errorMessage = error instanceof DOMException && error.name === 'AbortError'
            ? `URL fetch timed out after ${FILE_OPERATION_TIMEOUTS.URL_FETCH}ms: ${url}`
            : `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`;

        throw new Error(errorMessage);
    }
}



/**
 * Generate enhanced status message with total and remaining line information
 * @param readLines Number of lines actually read
 * @param offset Starting offset (line number)
 * @param totalLines Total lines in the file (if available)
 * @param isNegativeOffset Whether this is a tail operation
 * @returns Enhanced status message string
 */
function generateEnhancedStatusMessage(
    readLines: number,
    offset: number,
    totalLines?: number,
    isNegativeOffset: boolean = false
): string {
    if (isNegativeOffset) {
        // For tail operations (negative offset)
        if (totalLines !== undefined) {
            return `[Reading last ${readLines} lines (total: ${totalLines} lines)]`;
        } else {
            return `[Reading last ${readLines} lines]`;
        }
    } else {
        // For normal reads (positive offset)
        if (totalLines !== undefined) {
            const endLine = offset + readLines;
            const remainingLines = Math.max(0, totalLines - endLine);

            if (offset === 0) {
                return `[Reading ${readLines} lines from start (total: ${totalLines} lines, ${remainingLines} remaining)]`;
            } else {
                return `[Reading ${readLines} lines from line ${offset} (total: ${totalLines} lines, ${remainingLines} remaining)]`;
            }
        } else {
            // Fallback when total lines unknown
            if (offset === 0) {
                return `[Reading ${readLines} lines from start]`;
            } else {
                return `[Reading ${readLines} lines from line ${offset}]`;
            }
        }
    }
}

/**
 * Read file content using smart positioning for optimal performance
 * @param filePath Path to the file (already validated)
 * @param offset Starting line number (negative for tail behavior)
 * @param length Maximum number of lines to read
 * @param mimeType MIME type of the file
 * @param includeStatusMessage Whether to include status headers (default: true)
 * @returns File result with content
 */
async function readFileWithSmartPositioning(filePath: string, offset: number, length: number, mimeType: string, includeStatusMessage: boolean = true): Promise<FileResult> {
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;

    // Get total line count for enhanced status messages (only for smaller files)
    const totalLines = await getFileLineCount(filePath);

    // For negative offsets (tail behavior), use reverse reading
    if (offset < 0) {
        const requestedLines = Math.abs(offset);

        if (fileSize > FILE_SIZE_LIMITS.LARGE_FILE_THRESHOLD && requestedLines <= READ_PERFORMANCE_THRESHOLDS.SMALL_READ_THRESHOLD) {
            // Use efficient reverse reading for large files with small tail requests
            return await readLastNLinesReverse(filePath, requestedLines, mimeType, includeStatusMessage, totalLines);
        } else {
            // Use readline circular buffer for other cases
            return await readFromEndWithReadline(filePath, requestedLines, mimeType, includeStatusMessage, totalLines);
        }
    }

    // For positive offsets
    else {
        // For small files or reading from start, use simple readline
        if (fileSize < FILE_SIZE_LIMITS.LARGE_FILE_THRESHOLD || offset === 0) {
            return await readFromStartWithReadline(filePath, offset, length, mimeType, includeStatusMessage, totalLines);
        }

        // For large files with middle/end reads, try to estimate position
        else {
            // If seeking deep into file, try byte estimation
            if (offset > READ_PERFORMANCE_THRESHOLDS.DEEP_OFFSET_THRESHOLD) {
                return await readFromEstimatedPosition(filePath, offset, length, mimeType, includeStatusMessage, totalLines);
            } else {
                return await readFromStartWithReadline(filePath, offset, length, mimeType, includeStatusMessage, totalLines);
            }
        }
    }
}

/**
 * Read last N lines efficiently by reading file backwards in chunks
 */
async function readLastNLinesReverse(filePath: string, n: number, mimeType: string, includeStatusMessage: boolean = true, fileTotalLines?: number): Promise<FileResult> {
    const fd = await fs.open(filePath, 'r');
    try {
        const stats = await fd.stat();
        const fileSize = stats.size;

        let position = fileSize;
        let lines: string[] = [];
        let partialLine = '';

        while (position > 0 && lines.length < n) {
            const readSize = Math.min(READ_PERFORMANCE_THRESHOLDS.CHUNK_SIZE, position);
            position -= readSize;

            const buffer = Buffer.alloc(readSize);
            await fd.read(buffer, 0, readSize, position);

            const chunk = buffer.toString('utf-8');
            const text = chunk + partialLine;
            const chunkLines = text.split('\n');

            partialLine = chunkLines.shift() || '';
            lines = chunkLines.concat(lines);
        }

        // Add the remaining partial line if we reached the beginning
        if (position === 0 && partialLine) {
            lines.unshift(partialLine);
        }

        const result = lines.slice(-n); // Get exactly n lines
        const content = includeStatusMessage
            ? `${generateEnhancedStatusMessage(result.length, -n, fileTotalLines, true)}\n\n${result.join('\n')}`
            : result.join('\n');

        return { content, mimeType, isImage: false };
    } finally {
        await fd.close();
    }
}

/**
 * Read from end using readline with circular buffer
 */
async function readFromEndWithReadline(filePath: string, requestedLines: number, mimeType: string, includeStatusMessage: boolean = true, fileTotalLines?: number): Promise<FileResult> {
    const rl = createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity
    });

    const buffer: string[] = new Array(requestedLines);
    let bufferIndex = 0;
    let totalLines = 0;

    for await (const line of rl) {
        buffer[bufferIndex] = line;
        bufferIndex = (bufferIndex + 1) % requestedLines;
        totalLines++;
    }

    rl.close();

    // Extract lines in correct order
    let result: string[];
    if (totalLines >= requestedLines) {
        result = [
            ...buffer.slice(bufferIndex),
            ...buffer.slice(0, bufferIndex)
        ].filter(line => line !== undefined);
    } else {
        result = buffer.slice(0, totalLines);
    }

    const content = includeStatusMessage
        ? `${generateEnhancedStatusMessage(result.length, -requestedLines, fileTotalLines, true)}\n\n${result.join('\n')}`
        : result.join('\n');
    return { content, mimeType, isImage: false };
}

/**
 * Read from start/middle using readline
 */
async function readFromStartWithReadline(filePath: string, offset: number, length: number, mimeType: string, includeStatusMessage: boolean = true, fileTotalLines?: number): Promise<FileResult> {
    const rl = createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity
    });

    const result: string[] = [];
    let lineNumber = 0;

    for await (const line of rl) {
        if (lineNumber >= offset && result.length < length) {
            result.push(line);
        }
        if (result.length >= length) break; // Early exit optimization
        lineNumber++;
    }

    rl.close();

    if (includeStatusMessage) {
        const statusMessage = generateEnhancedStatusMessage(result.length, offset, fileTotalLines, false);
        const content = `${statusMessage}\n\n${result.join('\n')}`;
        return { content, mimeType, isImage: false };
    } else {
        const content = result.join('\n');
        return { content, mimeType, isImage: false };
    }
}

/**
 * Read from estimated byte position for very large files
 */
async function readFromEstimatedPosition(filePath: string, offset: number, length: number, mimeType: string, includeStatusMessage: boolean = true, fileTotalLines?: number): Promise<FileResult> {
    // First, do a quick scan to estimate lines per byte
    const rl = createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity
    });

    let sampleLines = 0;
    let bytesRead = 0;



    for await (const line of rl) {
        bytesRead += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
        sampleLines++;
        if (bytesRead >= READ_PERFORMANCE_THRESHOLDS.SAMPLE_SIZE) break;
    }

    rl.close();

    if (sampleLines === 0) {
        // Fallback to simple read
        return await readFromStartWithReadline(filePath, offset, length, mimeType, includeStatusMessage, fileTotalLines);
    }

    // Estimate average line length and seek position
    const avgLineLength = bytesRead / sampleLines;
    const estimatedBytePosition = Math.floor(offset * avgLineLength);

    // Create a new stream starting from estimated position
    const fd = await fs.open(filePath, 'r');
    try {
        const stats = await fd.stat();
        const startPosition = Math.min(estimatedBytePosition, stats.size);

        const stream = createReadStream(filePath, { start: startPosition });
        const rl2 = createInterface({
            input: stream,
            crlfDelay: Infinity
        });

        const result: string[] = [];
        let lineCount = 0;
        let firstLineSkipped = false;

        for await (const line of rl2) {
            // Skip first potentially partial line if we didn't start at beginning
            if (!firstLineSkipped && startPosition > 0) {
                firstLineSkipped = true;
                continue;
            }

            if (result.length < length) {
                result.push(line);
            } else {
                break;
            }
            lineCount++;
        }

        rl2.close();

        const content = includeStatusMessage
            ? `${generateEnhancedStatusMessage(result.length, offset, fileTotalLines, false)}\n\n${result.join('\n')}`
            : result.join('\n');
        return { content, mimeType, isImage: false };
    } finally {
        await fd.close();
    }
}

/**
 * Read file content from the local filesystem
 * @param filePath Path to the file
 * @param offset Starting line number to read from (default: 0)
 * @param length Maximum number of lines to read (default: from config or 1000)
 * @returns File content or file result with metadata
 */
export async function readFileFromDisk(filePath: string, offset: number = 0, length?: number): Promise<FileResult> {
    // Add validation for required parameters
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path provided');
    }

    // Get default length from config if not provided
    if (length === undefined) {
        length = await getDefaultReadLength();
    }

    const validPath = await validatePath(filePath);

    // Get file extension for telemetry using path module consistently
    const fileExtension = getFileExtension(validPath);

    // Check file size before attempting to read
    try {
        const stats = await fs.stat(validPath);

        // Capture file extension in telemetry without capturing the file path
        capture('server_read_file', {
            fileExtension: fileExtension,
            offset: offset,
            length: length,
            fileSize: stats.size
        });
    } catch (error) {
        console.error('error catch ' + error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        capture('server_read_file_error', { error: errorMessage, fileExtension: fileExtension });
        // If we can't stat the file, continue anyway and let the read operation handle errors
    }

    // Detect the MIME type based on file extension
    const { mimeType, isImage } = await getMimeTypeInfo(validPath);

    // Use withTimeout to handle potential hangs
    const readOperation = async () => {
        if (isImage) {
            // For image files, read as Buffer and convert to base64
            // Images are always read in full, ignoring offset and length
            const buffer = await fs.readFile(validPath);
            const content = buffer.toString('base64');

            return { content, mimeType, isImage };
        } else {
            // For all other files, use smart positioning approach
            try {
                return await readFileWithSmartPositioning(validPath, offset, length, mimeType, true);
            } catch (error) {
                // If UTF-8 reading fails, treat as binary and return base64 but still as text
                const buffer = await fs.readFile(validPath);
                const content = `Binary file content (base64 encoded):\n${buffer.toString('base64')}`;

                return { content, mimeType: 'text/plain', isImage: false };
            }
        }
    };
    // Execute with timeout
    const result = await withTimeout(
        readOperation(),
        FILE_OPERATION_TIMEOUTS.FILE_READ,
        `Read file operation for ${filePath}`,
        null
    );
    if (result == null) {
        // Handles the impossible case where withTimeout resolves to null instead of throwing
        throw new Error('Failed to read the file');
    }

    return result;
}

/**
 * Read a file from either the local filesystem or a URL
 * @param filePath Path to the file or URL
 * @param isUrl Whether the path is a URL
 * @param offset Starting line number to read from (default: 0)
 * @param length Maximum number of lines to read (default: from config or 1000)
 * @returns File content or file result with metadata
 */
export async function readFile(filePath: string, isUrl?: boolean, offset?: number, length?: number): Promise<FileResult> {
    return isUrl
        ? readFileFromUrl(filePath)
        : readFileFromDisk(filePath, offset, length);
}

/**
 * Read file content without status messages for internal operations
 * This function preserves exact file content including original line endings,
 * which is essential for edit operations that need to maintain file formatting.
 * @param filePath Path to the file
 * @param offset Starting line number to read from (default: 0)
 * @param length Maximum number of lines to read (default: from config or 1000)
 * @returns File content without status headers, with preserved line endings
 */
export async function readFileInternal(filePath: string, offset: number = 0, length?: number): Promise<string> {
    // Get default length from config if not provided
    if (length === undefined) {
        length = await getDefaultReadLength();
    }

    const validPath = await validatePath(filePath);

    // Get file extension and MIME type
    const fileExtension = getFileExtension(validPath);
    const { mimeType, isImage } = await getMimeTypeInfo(validPath);

    if (isImage) {
        throw new Error('Cannot read image files as text for internal operations');
    }

    // IMPORTANT: For internal operations (especially edit operations), we must
    // preserve exact file content including original line endings.
    // We cannot use readline-based reading as it strips line endings.

    // Read entire file content preserving line endings
    const content = await fs.readFile(validPath, 'utf8');

    // If we need to apply offset/length, do it while preserving line endings
    if (offset === 0 && length >= Number.MAX_SAFE_INTEGER) {
        // Most common case for edit operations: read entire file
        return content;
    }

    // Handle offset/length by splitting on line boundaries while preserving line endings
    const lines = splitLinesPreservingEndings(content);

    // Apply offset and length
    const selectedLines = lines.slice(offset, offset + length);

    // Join back together (this preserves the original line endings)
    return selectedLines.join('');
}

/**
 * Split text into lines while preserving original line endings with each line
 * @param content The text content to split
 * @returns Array of lines, each including its original line ending
 */
function splitLinesPreservingEndings(content: string): string[] {
    if (!content) return [''];

    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        currentLine += char;

        // Check for line ending patterns
        if (char === '\n') {
            // LF or end of CRLF
            lines.push(currentLine);
            currentLine = '';
        } else if (char === '\r') {
            // Could be CR or start of CRLF
            if (i + 1 < content.length && content[i + 1] === '\n') {
                // It's CRLF, include the \n as well
                currentLine += content[i + 1];
                i++; // Skip the \n in next iteration
            }
            // Either way, we have a complete line
            lines.push(currentLine);
            currentLine = '';
        }
    }

    // Handle any remaining content (file not ending with line ending)
    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
}

export async function writeFile(filePath: string, content: string, mode: 'rewrite' | 'append' = 'rewrite'): Promise<void> {
    const validPath = await validatePath(filePath);

    // Get file extension for telemetry
    const fileExtension = getFileExtension(validPath);

    // Calculate content metrics
    const contentBytes = Buffer.from(content).length;
    const lineCount = countLines(content);

    // Capture file extension and operation details in telemetry without capturing the file path
    capture('server_write_file', {
        fileExtension: fileExtension,
        mode: mode,
        contentBytes: contentBytes,
        lineCount: lineCount
    });

    // Use different fs methods based on mode
    if (mode === 'append') {
        await fs.appendFile(validPath, content);
    } else {
        await fs.writeFile(validPath, content);
    }
}

export interface MultiFileResult {
    path: string;
    content?: string;
    mimeType?: string;
    isImage?: boolean;
    error?: string;
}

export async function readMultipleFiles(paths: string[]): Promise<MultiFileResult[]> {
    return Promise.all(
        paths.map(async (filePath: string) => {
            try {
                const validPath = await validatePath(filePath);
                const fileResult = await readFile(validPath);

                return {
                    path: filePath,
                    content: typeof fileResult === 'string' ? fileResult : fileResult.content,
                    mimeType: typeof fileResult === 'string' ? "text/plain" : fileResult.mimeType,
                    isImage: typeof fileResult === 'string' ? false : fileResult.isImage
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    path: filePath,
                    error: errorMessage
                };
            }
        }),
    );
}

export async function createDirectory(dirPath: string): Promise<void> {
    const validPath = await validatePath(dirPath);
    await fs.mkdir(validPath, { recursive: true });
}

export async function listDirectory(dirPath: string): Promise<string[]> {
    const validPath = await validatePath(dirPath);
    const entries = await fs.readdir(validPath, { withFileTypes: true });
    return entries.map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`);
}

export async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const validSourcePath = await validatePath(sourcePath);
    const validDestPath = await validatePath(destinationPath);
    await fs.rename(validSourcePath, validDestPath);
}

export async function searchFiles(
    rootPath: string,
    pattern: string,
    options: {
        maxResults?: number;
        maxDepth?: number;
        timeoutMs?: number;
        excludeDirs?: string[];
    } = {}
): Promise<string[]> {
    const {
        maxResults = 1000,
        maxDepth = 10,
        timeoutMs = 10000, // Reduced from 30s to 10s
        excludeDirs = ['node_modules', '.git', 'dist', '.cache', 'tmp']
    } = options;

    const results: string[] = [];
    let searchCancelled = false;
    const startTime = Date.now();

    // Create timeout mechanism
    const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
            searchCancelled = true;
            reject(new Error(`Search operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    async function search(currentPath: string, depth: number = 0): Promise<void> {
        // Check cancellation and limits
        if (searchCancelled || results.length >= maxResults || depth > maxDepth) {
            return;
        }

        // Check timeout periodically
        if (Date.now() - startTime > timeoutMs) {
            searchCancelled = true;
            return;
        }

        let entries;
        try {
            entries = await fs.readdir(currentPath, { withFileTypes: true });
        } catch (error) {
            return; // Skip this directory on error
        }

        // Process files first, then directories (for better user experience)
        const files = entries.filter(entry => entry.isFile());
        const directories = entries.filter(entry => entry.isDirectory());

        // Process files
        for (const entry of files) {
            if (searchCancelled || results.length >= maxResults) {
                break;
            }

            const fullPath = path.join(currentPath, entry.name);

            try {
                await validatePath(fullPath);

                // Use case-insensitive search on Windows, case-sensitive on other platforms
                const searchName = os.platform() === 'win32' ? entry.name.toLowerCase() : entry.name;
                const searchPattern = os.platform() === 'win32' ? pattern.toLowerCase() : pattern;

                if (searchName.includes(searchPattern)) {
                    results.push(fullPath);
                }
            } catch (error) {
                continue;
            }
        }

        // Process directories recursively
        for (const entry of directories) {
            if (searchCancelled || results.length >= maxResults || depth >= maxDepth) {
                break;
            }

            // Skip excluded directories
            if (excludeDirs.includes(entry.name)) {
                continue;
            }

            const fullPath = path.join(currentPath, entry.name);

            try {
                await validatePath(fullPath);

                // Also check if directory name matches pattern
                const searchName = os.platform() === 'win32' ? entry.name.toLowerCase() : entry.name;
                const searchPattern = os.platform() === 'win32' ? pattern.toLowerCase() : pattern;

                if (searchName.includes(searchPattern)) {
                    results.push(fullPath);
                }

                // Recurse into directory
                await search(fullPath, depth + 1);
            } catch (error) {
                continue;
            }
        }
    }

    try {
        // Validate root path before starting search
        const validPath = await validatePath(rootPath);

        // Race between search operation and timeout
        await Promise.race([
            search(validPath),
            timeoutPromise
        ]);

        // Log search performance metrics
        const executionTime = Date.now() - startTime;
        capture('server_search_files_complete', {
            resultsCount: results.length,
            patternLength: pattern.length,
            executionTimeMs: executionTime,
            maxResults: maxResults,
            maxDepth: maxDepth,
            timeoutMs: timeoutMs,
            wasTimeout: searchCancelled
        });

        return results;
    } catch (error) {
        // Check if it was a timeout
        const isTimeout = error instanceof Error && error.message.includes('timed out');

        // For telemetry only - sanitize error info
        capture('server_search_files_error', {
            errorType: error instanceof Error ? error.name : 'Unknown',
            error: isTimeout ? 'Search timeout' : 'Error with root path',
            isRootPathError: !isTimeout,
            isTimeout: isTimeout,
            executionTimeMs: Date.now() - startTime,
            partialResultsCount: results.length
        });

        // If it was a timeout but we have partial results, return them with a warning
        if (isTimeout && results.length > 0) {
            console.warn(`Search timed out but returning ${results.length} partial results`);
            return results;
        }

        // Re-throw the original error for the caller
        throw error;
    }
}

export async function getFileInfo(filePath: string): Promise<Record<string, any>> {
    const validPath = await validatePath(filePath);
    const stats = await fs.stat(validPath);

    // Basic file info
    const info: Record<string, any> = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };

    // For text files that aren't too large, also count lines
    if (stats.isFile() && stats.size < FILE_SIZE_LIMITS.LINE_COUNT_LIMIT) {
        try {
            // Get MIME type information
            const { mimeType, isImage } = await getMimeTypeInfo(validPath);

            // Only count lines for non-image, likely text files
            if (!isImage) {
                const content = await fs.readFile(validPath, 'utf8');
                const lineCount = countLines(content);
                info.lineCount = lineCount;
                info.lastLine = lineCount - 1; // Zero-indexed last line
                info.appendPosition = lineCount; // Position to append at end
            }
        } catch (error) {
            // If reading fails, just skip the line count
            // This could happen for binary files or very large files
        }
    }

    return info;
}