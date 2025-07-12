#!/usr/bin/env node
/**
 * Affiche un exemple de message complet pour démonstration
 */

import { addAllowedDirectory } from '../dist/tools/config.js';

async function displayExampleMessage() {
  console.log('🔒 EXEMPLE DE MESSAGE D\'EXPLICATION SÉCURITÉ');
  console.log('=' .repeat(80));
  
  // Tester avec OneDrive Business
  const result = await addAllowedDirectory({ 
    directory: '/Users/john/OneDrive - CompanyName' 
  });
  
  if (result.isError) {
    console.log(result.content[0].text);
  }
  
  console.log('=' .repeat(80));
  console.log('FIN DU MESSAGE');
}

displayExampleMessage().catch(console.error);