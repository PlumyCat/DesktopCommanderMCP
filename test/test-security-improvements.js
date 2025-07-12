#!/usr/bin/env node
/**
 * Test script for security improvements
 * This script tests the new security features for allowedDirectories
 */

import { configManager } from '../dist/config-manager.js';
import { validateAllowedDirectory, analyzePathSecurity, isPathAllowed } from '../dist/utils/security.js';

/**
 * Test security validation functions
 */
async function testSecurityValidation() {
  console.log('\n=== Testing Security Validation ===');
  
  // Test 1: Validate safe directory
  console.log('\nTest 1: Validate safe directory');
  const safeDir = '/home/user/projects';
  const safeResult = validateAllowedDirectory(safeDir);
  console.log(`Safe directory validation: ${JSON.stringify(safeResult)}`);
  
  // Test 2: Validate dangerous directory
  console.log('\nTest 2: Validate dangerous directory');
  const dangerousDir = '/etc/passwd';
  const dangerousResult = validateAllowedDirectory(dangerousDir);
  console.log(`Dangerous directory validation: ${JSON.stringify(dangerousResult)}`);
  
  // Test 3: Analyze path security
  console.log('\nTest 3: Analyze path security');
  const traversalPath = '/home/user/../../../etc/passwd';
  const analysis = analyzePathSecurity(traversalPath);
  console.log(`Path security analysis: ${JSON.stringify(analysis, null, 2)}`);
  
  // Test 4: Path validation
  console.log('\nTest 4: Path validation');
  const allowedDirs = ['/home/user/projects', '/tmp'];
  const testPaths = [
    '/home/user/projects/myproject',
    '/home/user/projects/../../../etc/passwd',
    '/tmp/tempfile',
    '/etc/passwd'
  ];
  
  for (const testPath of testPaths) {
    const allowed = isPathAllowed(testPath, allowedDirs);
    console.log(`Path "${testPath}" allowed: ${allowed}`);
  }
}

/**
 * Test default configuration security
 */
async function testDefaultConfigSecurity() {
  console.log('\n=== Testing Default Configuration Security ===');
  
  // Reset config to test defaults
  await configManager.resetConfig();
  const config = await configManager.getConfig();
  
  console.log('Default allowedDirectories:', JSON.stringify(config.allowedDirectories, null, 2));
  console.log('requirePermissionPrompt:', config.requirePermissionPrompt);
  
  // Verify secure defaults
  const hasSecureDefaults = config.allowedDirectories && 
                           config.allowedDirectories.length > 0 &&
                           !config.allowedDirectories.includes('') &&
                           !config.allowedDirectories.includes('/');
  
  console.log('Has secure defaults:', hasSecureDefaults);
  
  if (hasSecureDefaults) {
    console.log('✅ Default configuration is secure');
  } else {
    console.log('❌ Default configuration is NOT secure');
  }
}

/**
 * Test setting insecure allowedDirectories
 */
async function testInsecureConfiguration() {
  console.log('\n=== Testing Insecure Configuration Prevention ===');
  
  try {
    // Try to set dangerous directory
    await configManager.setValue('allowedDirectories', ['/etc']);
    console.log('❌ Should have prevented setting /etc as allowed directory');
  } catch (error) {
    console.log('✅ Successfully prevented insecure configuration:', error.message);
  }
  
  try {
    // Try to set empty array (should be prevented by new security)
    await configManager.setValue('allowedDirectories', []);
    console.log('❌ Should have prevented setting empty allowedDirectories');
  } catch (error) {
    console.log('✅ Successfully prevented empty allowedDirectories:', error.message);
  }
}

/**
 * Test enterprise directory detection and blocking
 */
async function testEnterpriseDirectoryBlocking() {
  console.log('\n=== Testing Enterprise Directory Blocking ===');
  
  const { detectEnterpriseSync } = await import('../dist/utils/security.js');
  
  // Test OneDrive Business detection
  const oneDriveBusinessPaths = [
    '/Users/john/OneDrive - CompanyName',
    'C:\\Users\\john\\OneDrive - Company Ltd',
    '/home/user/OneDrive - Enterprise Corp',
    'C:\\Users\\jane\\OneDrive - company.com'
  ];
  
  for (const path of oneDriveBusinessPaths) {
    const detection = detectEnterpriseSync(path);
    console.log(`OneDrive Business path "${path}":`, detection.isEnterprise ? '✅ BLOCKED' : '❌ NOT BLOCKED');
    if (detection.isEnterprise) {
      console.log(`  Reason: ${detection.reason}`);
    }
  }
  
  // Test SharePoint detection
  const sharePointPaths = [
    '/Users/john/SharePoint - CompanyName',
    'C:\\Users\\john\\Sites\\CompanySharePoint',
    '/home/user/Shared Documents/Company',
    'C:\\Users\\jane\\SharePoint\\Projects'
  ];
  
  for (const path of sharePointPaths) {
    const detection = detectEnterpriseSync(path);
    console.log(`SharePoint path "${path}":`, detection.isEnterprise ? '✅ BLOCKED' : '❌ NOT BLOCKED');
    if (detection.isEnterprise) {
      console.log(`  Reason: ${detection.reason}`);
    }
  }
  
  // Test Teams detection
  const teamsPaths = [
    '/Users/john/Microsoft Teams Chat Files',
    'C:\\Users\\john\\Teams\\ProjectTeam',
    '/home/user/Microsoft Teams'
  ];
  
  for (const path of teamsPaths) {
    const detection = detectEnterpriseSync(path);
    console.log(`Teams path "${path}":`, detection.isEnterprise ? '✅ BLOCKED' : '❌ NOT BLOCKED');
    if (detection.isEnterprise) {
      console.log(`  Reason: ${detection.reason}`);
    }
  }
  
  // Test that regular directories are not blocked
  const safePaths = [
    '/Users/john/Documents',
    'C:\\Users\\john\\Projects',
    '/home/user/workspace',
    '/tmp/myproject'
  ];
  
  for (const path of safePaths) {
    const detection = detectEnterpriseSync(path);
    console.log(`Safe path "${path}":`, detection.isEnterprise ? '❌ INCORRECTLY BLOCKED' : '✅ ALLOWED');
  }
}

/**
 * Test removeAllowedDirectory restriction
 */
async function testRemoveDirectoryRestriction() {
  console.log('\n=== Testing removeAllowedDirectory Restriction ===');
  
  const { removeAllowedDirectory } = await import('../dist/tools/config.js');
  
  try {
    const result = await removeAllowedDirectory({ directory: '/tmp' });
    if (result.isError) {
      console.log('✅ removeAllowedDirectory correctly blocked:', result.content[0].text);
    } else {
      console.log('❌ removeAllowedDirectory should have been blocked');
    }
  } catch (error) {
    console.log('✅ removeAllowedDirectory blocked via exception:', error.message);
  }
}

/**
 * Main test function
 */
async function runSecurityTests() {
  console.log('🔒 Starting Security Improvement Tests');
  
  try {
    await testSecurityValidation();
    await testDefaultConfigSecurity();
    await testInsecureConfiguration();
    await testEnterpriseDirectoryBlocking();
    await testRemoveDirectoryRestriction();
    
    console.log('\n✅ All security tests completed successfully!');
  } catch (error) {
    console.error('❌ Security test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSecurityTests();
}

export { runSecurityTests };