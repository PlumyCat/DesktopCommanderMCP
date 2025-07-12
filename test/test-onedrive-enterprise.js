#!/usr/bin/env node
/**
 * Test OneDrive Enterprise security
 */

import { configManager } from '../dist/config-manager.js';
import { addAllowedDirectory } from '../dist/tools/config.js';

async function testOneDriveEnterpriseSecurity() {
  console.log('🔒 Testing OneDrive Enterprise Security');
  
  // Test various OneDrive enterprise paths
  const enterprisePaths = [
    '/Users/john/OneDrive - CompanyName',
    'C:\\Users\\john\\OneDrive - Company Ltd',
    '/home/user/OneDrive - Enterprise Corp',
    'C:\\Users\\jane\\OneDrive - company.com',
    '/Users/john/SharePoint - CompanyName',
    'C:\\Users\\john\\Sites\\CompanySharePoint',
    '/home/user/Shared Documents/Company',
    'C:\\Users\\jane\\SharePoint\\Projects',
    '/Users/john/Microsoft Teams Chat Files',
    'C:\\Users\\john\\Teams\\ProjectTeam',
    '/home/user/Microsoft Teams'
  ];
  
  console.log('\n=== Testing addAllowedDirectory with Enterprise Paths ===');
  
  for (const path of enterprisePaths) {
    try {
      const result = await addAllowedDirectory({ directory: path });
      if (result.isError) {
        console.log(`✅ BLOCKED: ${path}`);
        console.log(`   Reason: ${result.content[0].text}`);
      } else {
        console.log(`❌ NOT BLOCKED: ${path}`);
      }
    } catch (error) {
      console.log(`✅ BLOCKED: ${path}`);
      console.log(`   Exception: ${error.message}`);
    }
  }
  
  console.log('\n=== Testing configManager.setValue with Enterprise Paths ===');
  
  // Test a few key enterprise paths via direct config setting
  const testPaths = [
    ['/Users/john/OneDrive - CompanyName'],
    ['C:\\Users\\john\\OneDrive - Company Ltd', '/tmp'],
    ['/home/user/SharePoint - CompanyName'],
  ];
  
  for (const pathArray of testPaths) {
    try {
      await configManager.setValue('allowedDirectories', pathArray);
      console.log(`❌ NOT BLOCKED: ${JSON.stringify(pathArray)}`);
    } catch (error) {
      console.log(`✅ BLOCKED: ${JSON.stringify(pathArray)}`);
      console.log(`   Reason: ${error.message}`);
    }
  }
  
  console.log('\n✅ OneDrive Enterprise security tests completed!');
}

// Run test
testOneDriveEnterpriseSecurity().catch(console.error);