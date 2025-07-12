import path from 'path';
import os from 'os';

/**
 * Normalize Windows path properly to handle double backslashes from JSON
 * @param inputPath The input path that may contain Windows-style backslashes
 * @returns Properly normalized path
 */
export function normalizeWindowsPath(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
        return inputPath;
    }

    // On Windows, handle the common issue where JSON double backslashes
    // need to be properly converted to single backslashes
    if (os.platform() === 'win32') {
        // Replace multiple backslashes with single backslashes
        // This handles cases like C:\\\\Temp becoming C:\Temp
        let normalizedPath = inputPath.replace(/\\+/g, '\\');
        
        // Use path.normalize to handle . and .. properly
        normalizedPath = path.normalize(normalizedPath);
        
        // Ensure drive letter is uppercase for consistency
        if (normalizedPath.match(/^[a-z]:/)) {
            normalizedPath = normalizedPath.charAt(0).toUpperCase() + normalizedPath.slice(1);
        }
        
        return normalizedPath;
    }

    // On non-Windows platforms, just use standard path normalization
    return path.normalize(inputPath);
}

/**
 * Expand home directory (~) in path
 * @param filepath Path that may contain ~ for home directory
 * @returns Expanded path
 */
export function expandHome(filepath: string): string {
    if (!filepath || typeof filepath !== 'string') {
        return filepath;
    }

    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}

/**
 * Convert path to absolute path with proper Windows path handling
 * @param inputPath The input path
 * @returns Absolute path
 */
export function toAbsolutePath(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
        return inputPath;
    }

    // First normalize the path
    const normalizedPath = normalizeWindowsPath(inputPath);
    
    // Expand home directory
    const expandedPath = expandHome(normalizedPath);
    
    // Convert to absolute path
    if (path.isAbsolute(expandedPath)) {
        return path.resolve(expandedPath);
    } else {
        return path.resolve(process.cwd(), expandedPath);
    }
}

/**
 * Debug function to show path transformation steps
 * @param inputPath The input path
 * @returns Debug information about path transformation
 */
export function debugPathTransformation(inputPath: string): {
    original: string;
    normalized: string;
    expanded: string;
    absolute: string;
    platform: string;
} {
    const normalized = normalizeWindowsPath(inputPath);
    const expanded = expandHome(normalized);
    const absolute = toAbsolutePath(inputPath);
    
    return {
        original: inputPath,
        normalized,
        expanded,
        absolute,
        platform: os.platform()
    };
} 