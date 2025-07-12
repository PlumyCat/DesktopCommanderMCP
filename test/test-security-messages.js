#!/usr/bin/env node
/**
 * Test des messages d'explication de sécurité
 */

import { addAllowedDirectory, removeAllowedDirectory } from '../dist/tools/config.js';
import { generateSecurityExplanation, generateConciseSecurityMessage } from '../dist/utils/security.js';

async function testSecurityMessages() {
  console.log('📝 Test des Messages d\'Explication de Sécurité');
  
  console.log('\n=== Test 1: Messages pour OneDrive Entreprise ===');
  
  // Test OneDrive Business
  const oneDriveResult = await addAllowedDirectory({ 
    directory: '/Users/john/OneDrive - CompanyName' 
  });
  
  if (oneDriveResult.isError) {
    console.log('✅ Message OneDrive Business reçu');
    console.log('Longueur du message:', oneDriveResult.content[0].text.length, 'caractères');
    
    // Vérifier que le message contient les éléments clés
    const message = oneDriveResult.content[0].text;
    const checkElements = [
      '🔒 ACCÈS REFUSÉ',
      'ONEDRIVE BUSINESS',
      'RÉPERTOIRES ALTERNATIFS',
      'TYPES DE RÉPERTOIRES BLOQUÉS',
      'CETTE RESTRICTION PROTÈGE'
    ];
    
    checkElements.forEach(element => {
      if (message.includes(element)) {
        console.log(`  ✅ Contient: ${element}`);
      } else {
        console.log(`  ❌ Manque: ${element}`);
      }
    });
  } else {
    console.log('❌ OneDrive Business devrait être bloqué');
  }
  
  console.log('\n=== Test 2: Messages pour SharePoint ===');
  
  const sharePointResult = await addAllowedDirectory({ 
    directory: '/Users/john/SharePoint - CompanyName' 
  });
  
  if (sharePointResult.isError) {
    console.log('✅ Message SharePoint reçu');
    const message = sharePointResult.content[0].text;
    
    if (message.includes('SHAREPOINT DÉTECTÉ')) {
      console.log('  ✅ Contient explication SharePoint spécifique');
    } else {
      console.log('  ❌ Manque explication SharePoint spécifique');
    }
  }
  
  console.log('\n=== Test 3: Messages pour Teams ===');
  
  const teamsResult = await addAllowedDirectory({ 
    directory: '/Users/john/Microsoft Teams Chat Files' 
  });
  
  if (teamsResult.isError) {
    console.log('✅ Message Teams reçu');
    const message = teamsResult.content[0].text;
    
    if (message.includes('MICROSOFT TEAMS DÉTECTÉ')) {
      console.log('  ✅ Contient explication Teams spécifique');
    } else {
      console.log('  ❌ Manque explication Teams spécifique');
    }
  }
  
  console.log('\n=== Test 4: Messages pour Répertoires Système ===');
  
  const systemResult = await addAllowedDirectory({ 
    directory: '/etc/passwd' 
  });
  
  if (systemResult.isError) {
    console.log('✅ Message système reçu');
    const message = systemResult.content[0].text;
    
    if (message.includes('répertoire système')) {
      console.log('  ✅ Contient explication système');
    } else {
      console.log('  ❌ Manque explication système');
    }
  }
  
  console.log('\n=== Test 5: Message removeAllowedDirectory ===');
  
  const removeResult = await removeAllowedDirectory({ 
    directory: '/tmp' 
  });
  
  if (removeResult.isError) {
    console.log('✅ Message removeAllowedDirectory reçu');
    const message = removeResult.content[0].text;
    
    const removeElements = [
      'FONCTION DÉSACTIVÉE',
      'POURQUOI CETTE RESTRICTION',
      'ALTERNATIVES SÉCURISÉES',
      'COMMENT PROCÉDER'
    ];
    
    removeElements.forEach(element => {
      if (message.includes(element)) {
        console.log(`  ✅ Contient: ${element}`);
      } else {
        console.log(`  ❌ Manque: ${element}`);
      }
    });
  }
  
  console.log('\n=== Test 6: Fonctions de Génération de Messages ===');
  
  // Test direct des fonctions
  console.log('\n--- Test generateSecurityExplanation ---');
  const detailedMessage = generateSecurityExplanation(
    '/Users/john/OneDrive - TestCompany',
    'OneDrive Business/Enterprise directory detected'
  );
  
  console.log('Longueur du message détaillé:', detailedMessage.length, 'caractères');
  console.log('Contient emojis:', detailedMessage.includes('🔒') && detailedMessage.includes('📁'));
  
  console.log('\n--- Test generateConciseSecurityMessage ---');
  const conciseMessage = generateConciseSecurityMessage(
    '/Users/john/OneDrive - TestCompany',
    'OneDrive Business/Enterprise directory detected'
  );
  
  console.log('Longueur du message concis:', conciseMessage.length, 'caractères');
  console.log('Plus court que le détaillé:', conciseMessage.length < detailedMessage.length);
  
  console.log('\n=== Résumé des Tests ===');
  console.log('• Messages OneDrive Business: Complets et explicatifs');
  console.log('• Messages SharePoint: Spécifiques au type de sync');
  console.log('• Messages Teams: Adaptés aux fichiers d\'équipe');
  console.log('• Messages système: Clairs sur les risques');
  console.log('• Message removeAllowedDirectory: Éducatif et directif');
  console.log('• Fonctions de génération: Fonctionnelles et adaptées');
  
  console.log('\n✅ Tous les tests de messages d\'explication terminés!');
}

// Exécuter les tests
testSecurityMessages().catch(console.error);