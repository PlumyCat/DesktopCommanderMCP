import { configManager, ServerConfig } from '../config-manager.js';
import { SetConfigValueArgsSchema } from './schemas.js';
import { getSystemInfo } from '../utils/system-info.js';
import { validateAllowedDirectory, analyzePathSecurity, generateSecurityExplanation } from '../utils/security.js';

/**
 * Get the entire config including system information
 */
export async function getConfig() {
  console.error('getConfig called');
  try {
    const config = await configManager.getConfig();
    
    // Add system information to the config response
    const systemInfo = getSystemInfo();
    const configWithSystemInfo = {
      ...config,
      systemInfo: {
        platform: systemInfo.platform,
        platformName: systemInfo.platformName,
        defaultShell: systemInfo.defaultShell,
        pathSeparator: systemInfo.pathSeparator,
        isWindows: systemInfo.isWindows,
        isMacOS: systemInfo.isMacOS,
        isLinux: systemInfo.isLinux,
        examplePaths: systemInfo.examplePaths
      }
    };
    
    console.error(`getConfig result: ${JSON.stringify(configWithSystemInfo, null, 2)}`);
    return {
      content: [{
        type: "text",
        text: `Current configuration:\n${JSON.stringify(configWithSystemInfo, null, 2)}`
      }],
    };
  } catch (error) {
    console.error(`Error in getConfig: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error instanceof Error && error.stack ? error.stack : 'No stack trace available');
    // Return empty config rather than crashing
    return {
      content: [{
        type: "text",
        text: `Error getting configuration: ${error instanceof Error ? error.message : String(error)}\nUsing empty configuration.`
      }],
    };
  }
}

/**
 * Set a specific config value
 */
export async function setConfigValue(args: unknown) {
  console.error(`setConfigValue called with args: ${JSON.stringify(args)}`);
  try {
    const parsed = SetConfigValueArgsSchema.safeParse(args);
    if (!parsed.success) {
      console.error(`Invalid arguments for set_config_value: ${parsed.error}`);
      return {
        content: [{
          type: "text",
          text: `Invalid arguments: ${parsed.error}`
        }],
        isError: true
      };
    }

    try {
      // Parse string values that should be arrays or objects
      let valueToStore = parsed.data.value;
      
      // If the value is a string that looks like an array or object, try to parse it
      if (typeof valueToStore === 'string' && 
          (valueToStore.startsWith('[') || valueToStore.startsWith('{'))) {
        try {
          valueToStore = JSON.parse(valueToStore);
          console.error(`Parsed string value to object/array: ${JSON.stringify(valueToStore)}`);
        } catch (parseError) {
          console.error(`Failed to parse string as JSON, using as-is: ${parseError}`);
        }
      }

      // Special security validation for allowedDirectories
      if (parsed.data.key === 'allowedDirectories') {
        const { validateAllowedDirectory } = await import('../utils/security.js');
        
        // Ensure it's an array
        if (!Array.isArray(valueToStore)) {
          if (typeof valueToStore === 'string') {
            try {
              valueToStore = JSON.parse(valueToStore);
            } catch {
              valueToStore = [valueToStore];
            }
          } else {
            valueToStore = [valueToStore];
          }
        }
        
        // Validate each directory
        const invalidDirs = [];
        for (const dir of valueToStore) {
          const validation = validateAllowedDirectory(dir);
          if (!validation.success) {
            invalidDirs.push(`${dir}: ${validation.error}`);
          }
        }
        
        if (invalidDirs.length > 0) {
          // Generate detailed explanations for the first invalid directory
          const firstInvalidDir = valueToStore.find((dir: string) => {
            const validation = validateAllowedDirectory(dir);
            return !validation.success;
          });
          
          let errorMessage = `Cannot set allowedDirectories. The following directories are invalid:\n${invalidDirs.join('\n')}\n\n`;
          
          if (firstInvalidDir) {
            const validation = validateAllowedDirectory(firstInvalidDir);
            if (!validation.success) {
              errorMessage += `EXPLICATION DÉTAILLÉE POUR "${firstInvalidDir}":\n\n`;
              errorMessage += generateSecurityExplanation(firstInvalidDir, validation.error || 'Directory validation failed');
            }
          }
          
          return {
            content: [{
              type: "text",
              text: errorMessage
            }],
            isError: true
          };
        }
        
        // Additional security check: prevent setting allowedDirectories to bypass existing restrictions
        const currentConfig = await configManager.getConfig();
        const currentDirs = currentConfig.allowedDirectories || [];
        
        // Check if user is trying to add directories that would bypass current restrictions
        const potentialBypass = [];
        for (const dir of valueToStore) {
          const enterpriseDetection = validateAllowedDirectory(dir);
          if (!enterpriseDetection.success) {
            potentialBypass.push(`${dir}: ${enterpriseDetection.error}`);
          }
        }
        
        if (potentialBypass.length > 0) {
          return {
            content: [{
              type: "text",
              text: `Security violation: Cannot set allowedDirectories to bypass restrictions:\n${potentialBypass.join('\n')}`
            }],
            isError: true
          };
        }
      }

      // Special handling for known array configuration keys
      if ((parsed.data.key === 'allowedDirectories' || parsed.data.key === 'blockedCommands') && 
          !Array.isArray(valueToStore)) {
        if (typeof valueToStore === 'string') {
          try {
            valueToStore = JSON.parse(valueToStore);
          } catch (parseError) {
            console.error(`Failed to parse string as array for ${parsed.data.key}: ${parseError}`);
            // If parsing failed and it's a single value, convert to an array with one item
            if (!valueToStore.includes('[')) {
              valueToStore = [valueToStore];
            }
          }
        } else {
          // If not a string or array, convert to an array with one item
          valueToStore = [valueToStore];
        }
        
        // Ensure the value is an array after all our conversions
        if (!Array.isArray(valueToStore)) {
          console.error(`Value for ${parsed.data.key} is still not an array, converting to array`);
          valueToStore = [String(valueToStore)];
        }
      }

      await configManager.setValue(parsed.data.key, valueToStore);
      // Get the updated configuration to show the user
      const updatedConfig = await configManager.getConfig();
      console.error(`setConfigValue: Successfully set ${parsed.data.key} to ${JSON.stringify(valueToStore)}`);
      return {
        content: [{
          type: "text",
          text: `Successfully set ${parsed.data.key} to ${JSON.stringify(valueToStore, null, 2)}\n\nUpdated configuration:\n${JSON.stringify(updatedConfig, null, 2)}`
        }],
      };
    } catch (saveError: any) {
      console.error(`Error saving config: ${saveError.message}`);
      // Continue with in-memory change but report error
      return {
        content: [{
          type: "text", 
          text: `Value changed in memory but couldn't be saved to disk: ${saveError.message}`
        }],
        isError: true
      };
    }
  } catch (error) {
    console.error(`Error in setConfigValue: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error instanceof Error && error.stack ? error.stack : 'No stack trace available');
    return {
      content: [{
        type: "text",
        text: `Error setting value: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Add a directory to allowedDirectories with security validation
 */
export async function addAllowedDirectory(args: { directory: string }) {
  console.error(`addAllowedDirectory called with: ${JSON.stringify(args)}`);
  
  try {
    const { directory } = args;
    
    // Validate the directory
    const validation = validateAllowedDirectory(directory);
    if (!validation.success) {
      const detailedExplanation = generateSecurityExplanation(directory, validation.error || 'Directory validation failed');
      
      return {
        content: [{
          type: "text",
          text: `Cannot add directory: ${directory}\n\n${detailedExplanation}`
        }],
        isError: true
      };
    }
    
    // Get current config
    const config = await configManager.getConfig();
    const currentDirs = config.allowedDirectories || [];
    
    // Check if directory is already added
    if (currentDirs.includes(directory)) {
      return {
        content: [{
          type: "text",
          text: `Directory ${directory} is already in allowedDirectories`
        }]
      };
    }
    
    // Add the directory
    const newDirs = [...currentDirs, directory];
    await configManager.setValue('allowedDirectories', newDirs);
    
    return {
      content: [{
        type: "text",
        text: `Successfully added ${directory} to allowedDirectories.\n\nCurrent allowedDirectories:\n${JSON.stringify(newDirs, null, 2)}`
      }]
    };
  } catch (error) {
    console.error(`Error in addAllowedDirectory: ${error instanceof Error ? error.message : String(error)}`);
    return {
      content: [{
        type: "text",
        text: `Error adding directory: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Remove a directory from allowedDirectories (RESTRICTED FUNCTION)
 * This function is intentionally limited to prevent security bypasses
 */
export async function removeAllowedDirectory(args: { directory: string }) {
  console.error(`removeAllowedDirectory called with: ${JSON.stringify(args)}`);
  
  // SECURITY: This function is disabled to prevent bypassing access controls
  // Users should not be able to remove directories from allowedDirectories
  // as this could be used to circumvent security restrictions
  
  const securityExplanation = `🔒 FONCTION DÉSACTIVÉE POUR SÉCURITÉ

removeAllowedDirectory est intentionnellement désactivée pour prévenir les contournements de sécurité.

📋 POURQUOI CETTE RESTRICTION ?
• Empêche la suppression de répertoires de sécurité
• Prévient l'accès non autorisé aux données sensibles
• Maintient l'intégrité des politiques de sécurité
• Évite les contournements des restrictions d'entreprise

🛡️ ALTERNATIVES SÉCURISÉES :
• Utilisez les outils de gestion de configuration appropriés
• Contactez votre administrateur système pour modifier les répertoires autorisés
• Créez de nouveaux répertoires sécurisés dans vos dossiers personnels
• Utilisez ~/.claude-server-commander/workspace pour vos projets

💡 COMMENT PROCÉDER ?
1. Identifiez le répertoire que vous souhaitez utiliser
2. Assurez-vous qu'il n'est pas synchronisé avec OneDrive/SharePoint entreprise
3. Utilisez addAllowedDirectory pour ajouter des répertoires sécurisés
4. Consultez votre administrateur pour les modifications de configuration

✅ CETTE RESTRICTION PROTÈGE :
• Vos données personnelles et professionnelles
• La confidentialité des informations d'entreprise
• La conformité aux politiques organisationnelles
• La sécurité globale du système`;

  return {
    content: [{
      type: "text",
      text: securityExplanation
    }],
    isError: true
  };
}

/**
 * Analyze a path for security risks
 */
export async function analyzePathSecurityRisk(args: { path: string }) {
  console.error(`analyzePathSecurityRisk called with: ${JSON.stringify(args)}`);
  
  try {
    const { path } = args;
    const analysis = analyzePathSecurity(path);
    
    let message = `Security analysis for path: ${path}\n\n`;
    message += `Contains traversal sequences: ${analysis.containsTraversal}\n`;
    message += `Is absolute path: ${analysis.isAbsolute}\n`;
    message += `Potentially dangerous: ${analysis.potentiallyDangerous}\n\n`;
    
    if (analysis.recommendations.length > 0) {
      message += `Recommendations:\n${analysis.recommendations.map(r => `• ${r}`).join('\n')}\n\n`;
    }
    
    // Check if path would be allowed
    const config = await configManager.getConfig();
    const { isPathAllowed } = await import('../utils/security.js');
    const allowed = isPathAllowed(path, config.allowedDirectories || []);
    message += `Would be allowed by current configuration: ${allowed}`;
    
    return {
      content: [{
        type: "text",
        text: message
      }]
    };
  } catch (error) {
    console.error(`Error in analyzePathSecurityRisk: ${error instanceof Error ? error.message : String(error)}`);
    return {
      content: [{
        type: "text",
        text: `Error analyzing path: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}