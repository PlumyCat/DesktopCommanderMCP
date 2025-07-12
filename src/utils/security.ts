import path from 'path';
import os from 'os';
import { configManager } from '../config-manager.js';

/**
 * Enhanced path validation with security checks
 * @param targetPath - Path to validate
 * @param allowedDirs - Array of allowed directories
 * @returns boolean - true if path is allowed, false otherwise
 */
export function isPathAllowed(targetPath: string, allowedDirs: string[]): boolean {
  // Normalize the target path to handle traversal attempts
  const normalizedPath = path.normalize(path.resolve(targetPath));

  // Check for directory traversal attempts
  if (normalizedPath.includes('..')) {
    return false;
  }

  // Check if path is within any allowed directory
  return allowedDirs.some(dir => {
    const normalizedDir = path.normalize(path.resolve(dir));

    // On Windows, do case-insensitive comparison
    if (os.platform() === 'win32') {
      const pathLower = normalizedPath.toLowerCase();
      const dirLower = normalizedDir.toLowerCase();
      return pathLower === dirLower ||
        pathLower.startsWith(dirLower + path.sep);
    }

    // On other platforms, use case-sensitive comparison
    return normalizedPath === normalizedDir ||
      normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

/**
 * Analyzes a path for security risks
 * @param pathToAnalyze - Path to analyze
 * @returns Object with security analysis results
 */
export function analyzePathSecurity(pathToAnalyze: string): {
  containsTraversal: boolean;
  isAbsolute: boolean;
  potentiallyDangerous: boolean;
  recommendations: string[];
} {
  const normalized = path.normalize(pathToAnalyze);
  const analysis = {
    containsTraversal: normalized.includes('..'),
    isAbsolute: path.isAbsolute(normalized),
    potentiallyDangerous: false,
    recommendations: [] as string[]
  };

  // Detect potentially dangerous patterns
  const dangerousPatterns = [
    // System directories
    /system32/i,
    /windows/i,
    /boot/i,
    /etc\/(passwd|shadow)/i,
    /program files/i,
    /program files \(x86\)/i,
    /\/bin/i,
    /\/sbin/i,
    /\/usr\/bin/i,
    /\/var/i,

    // OneDrive and SharePoint enterprise directories
    /onedrive.*business/i,
    /onedrive.*entreprise/i,
    /sharepoint/i,
    /sites\/[^\/]+/i,  // SharePoint sites
    /teams\/[^\/]+/i,  // Microsoft Teams files
    /microsoft.*teams/i,
    /office365/i,
    /o365/i,

    // Common enterprise cloud sync patterns
    /sync.*\w+\.\w+/i,  // Corporate sync folders
    /shared.*documents/i,
    /company.*files/i,
    /corporate.*data/i,

    // OneDrive specific patterns (Windows)
    /users\/[^\/]+\/onedrive.*-/i,  // OneDrive - CompanyName format
    /onedrive.*-.*\w+/i,  // OneDrive - CompanyName format
  ];

  analysis.potentiallyDangerous = dangerousPatterns.some(pattern =>
    pattern.test(normalized)
  );

  // Add recommendations
  if (analysis.containsTraversal) {
    analysis.recommendations.push('Avoid directory traversal sequences (..)');
  }

  if (!analysis.isAbsolute) {
    analysis.recommendations.push('Prefer absolute paths to avoid ambiguity');
  }

  if (analysis.potentiallyDangerous) {
    analysis.recommendations.push('This path accesses a sensitive system area');
  }

  return analysis;
}

/**
 * Detects if a path is within an enterprise OneDrive or SharePoint directory
 * @param pathToCheck - Path to analyze
 * @returns Object with detection result and details
 */
export function detectEnterpriseSync(pathToCheck: string): {
  isEnterprise: boolean;
  syncType?: 'onedrive' | 'sharepoint' | 'teams' | 'office365' | 'unknown';
  reason?: string;
} {
  const normalized = path.normalize(pathToCheck).toLowerCase();

  // OneDrive Business patterns
  const oneDriveBusinessPatterns = [
    /onedrive.*-.*\w+/i,  // OneDrive - CompanyName
    /onedrive.*business/i,
    /onedrive.*entreprise/i,
    /users\/[^\/]+\/onedrive.*-/i,  // Windows user OneDrive - Company
  ];

  // SharePoint patterns
  const sharePointPatterns = [
    /sharepoint/i,
    /sites\/[^\/]+/i,  // SharePoint sites
    /shared.*documents/i,
    /company.*sharepoint/i,
  ];

  // Teams patterns
  const teamsPatterns = [
    /teams\/[^\/]+/i,
    /microsoft.*teams/i,
    /teams.*files/i,
    /\\teams\\[^\\]+/i,  // Windows Teams paths
    /teams.*chat/i,
    /teams.*project/i,
  ];

  // Office 365 patterns
  const office365Patterns = [
    /office365/i,
    /o365/i,
    /microsoft.*365/i,
  ];

  // Check each pattern type
  if (oneDriveBusinessPatterns.some(pattern => pattern.test(normalized))) {
    return {
      isEnterprise: true,
      syncType: 'onedrive',
      reason: 'OneDrive Business/Enterprise directory detected'
    };
  }

  if (sharePointPatterns.some(pattern => pattern.test(normalized))) {
    return {
      isEnterprise: true,
      syncType: 'sharepoint',
      reason: 'SharePoint directory detected'
    };
  }

  if (teamsPatterns.some(pattern => pattern.test(normalized))) {
    return {
      isEnterprise: true,
      syncType: 'teams',
      reason: 'Microsoft Teams directory detected'
    };
  }

  if (office365Patterns.some(pattern => pattern.test(normalized))) {
    return {
      isEnterprise: true,
      syncType: 'office365',
      reason: 'Office 365 directory detected'
    };
  }

  // Additional heuristics for enterprise sync folders
  const enterpriseHeuristics = [
    /sync.*\w+\.\w+/i,  // Corporate sync folders like "Sync - company.com"
    /\w+\.\w+.*sync/i,  // Company domain sync folders
    /corporate.*data/i,
    /company.*files/i,
  ];

  if (enterpriseHeuristics.some(pattern => pattern.test(normalized))) {
    return {
      isEnterprise: true,
      syncType: 'unknown',
      reason: 'Corporate sync directory pattern detected'
    };
  }

  return { isEnterprise: false };
}

/**
 * Generates detailed security explanation messages for users
 * @param directory - The directory that was blocked
 * @param reason - The reason for blocking
 * @returns Formatted explanation message
 */
export function generateSecurityExplanation(directory: string, reason: string): string {
  const enterpriseDetection = detectEnterpriseSync(directory);

  let explanation = `🔒 ACCÈS REFUSÉ POUR SÉCURITÉ\n\n`;
  explanation += `Répertoire bloqué : ${directory}\n`;
  explanation += `Raison : ${reason}\n\n`;

  if (enterpriseDetection.isEnterprise) {
    explanation += `📋 EXPLICATION DE SÉCURITÉ :\n`;
    explanation += `Ce répertoire a été identifié comme contenant des données d'entreprise sensibles.\n`;
    explanation += `L'accès est restreint pour protéger :\n`;
    explanation += `• Les données confidentielles de l'entreprise\n`;
    explanation += `• Les documents partagés avec des collègues\n`;
    explanation += `• Les informations propriétaires\n`;
    explanation += `• La conformité aux politiques de sécurité\n\n`;

    switch (enterpriseDetection.syncType) {
      case 'onedrive':
        explanation += `📁 ONEDRIVE BUSINESS DÉTECTÉ :\n`;
        explanation += `Ce répertoire synchronise des données OneDrive Business/Entreprise.\n`;
        explanation += `Ces données appartiennent à votre organisation et doivent être protégées.\n`;
        explanation += `Formats typiques : "OneDrive - NomEntreprise", "OneDrive - company.com"\n\n`;
        break;

      case 'sharepoint':
        explanation += `📁 SHAREPOINT DÉTECTÉ :\n`;
        explanation += `Ce répertoire contient des documents SharePoint de l'entreprise.\n`;
        explanation += `Ces documents sont souvent partagés avec des équipes et contiennent des informations sensibles.\n`;
        explanation += `Formats typiques : "SharePoint", "Sites/NomSite", "Shared Documents"\n\n`;
        break;

      case 'teams':
        explanation += `📁 MICROSOFT TEAMS DÉTECTÉ :\n`;
        explanation += `Ce répertoire contient des fichiers Microsoft Teams de l'entreprise.\n`;
        explanation += `Ces fichiers incluent des conversations, documents partagés et données d'équipe.\n`;
        explanation += `Formats typiques : "Microsoft Teams", "Teams/NomProjet", "Teams Chat Files"\n\n`;
        break;

      case 'office365':
        explanation += `📁 OFFICE 365 DÉTECTÉ :\n`;
        explanation += `Ce répertoire est lié à Office 365 entreprise.\n`;
        explanation += `Il peut contenir des données synchronisées de votre environnement professionnel.\n\n`;
        break;

      default:
        explanation += `📁 SYNCHRONISATION ENTREPRISE DÉTECTÉE :\n`;
        explanation += `Ce répertoire semble contenir des données d'entreprise synchronisées.\n`;
        explanation += `Il peut inclure des fichiers partagés ou des données propriétaires.\n\n`;
        break;
    }

    explanation += `🛡️ RÉPERTOIRES ALTERNATIFS SÉCURISÉS :\n`;
    explanation += `Vous pouvez utiliser ces répertoires à la place :\n`;
    explanation += `• ~/.claude-server-commander/workspace (créé automatiquement)\n`;
    explanation += `• ~/Documents/claude-projects (créé automatiquement)\n`;
    explanation += `• Vos dossiers personnels (non-professionnels)\n`;
    explanation += `• Des répertoires temporaires pour vos projets\n\n`;

  } else {
    // For system directories
    explanation += `📋 EXPLICATION DE SÉCURITÉ :\n`;
    explanation += `Ce répertoire système est protégé pour éviter :\n`;
    explanation += `• La corruption du système d'exploitation\n`;
    explanation += `• La modification de fichiers critiques\n`;
    explanation += `• Les risques de sécurité système\n`;
    explanation += `• L'accès à des données sensibles\n\n`;

    explanation += `🛡️ RÉPERTOIRES ALTERNATIFS SÉCURISÉS :\n`;
    explanation += `Utilisez plutôt ces répertoires pour vos projets :\n`;
    explanation += `• ~/Documents/claude-projects\n`;
    explanation += `• ~/.claude-server-commander/workspace\n`;
    explanation += `• ~/Desktop pour les fichiers temporaires\n`;
    explanation += `• Vos dossiers personnels dans votre répertoire utilisateur\n\n`;
  }

  explanation += `❓ COMMENT CONFIGURER UN RÉPERTOIRE SÉCURISÉ :\n`;
  explanation += `1. Créez un nouveau dossier dans votre répertoire personnel\n`;
  explanation += `2. Évitez les dossiers synchronisés avec OneDrive/SharePoint\n`;
  explanation += `3. Utilisez des noms explicites comme "mes-projets-claude"\n`;
  explanation += `4. Ajoutez ce dossier via la configuration allowedDirectories\n\n`;

  explanation += `🔍 TYPES DE RÉPERTOIRES BLOQUÉS :\n`;
  explanation += `• Répertoires système : /etc, /System, C:\\Windows, /bin, /sbin\n`;
  explanation += `• OneDrive Business : "OneDrive - *", "OneDrive Business"\n`;
  explanation += `• SharePoint : "SharePoint", "Sites/*", "Shared Documents"\n`;
  explanation += `• Microsoft Teams : "Microsoft Teams", "Teams/*"\n`;
  explanation += `• Office 365 : "Office365", "O365"\n`;
  explanation += `• Synchronisation entreprise : "Sync - company.com", patterns corporate\n\n`;

  explanation += `✅ CETTE RESTRICTION PROTÈGE :\n`;
  explanation += `• Vos données personnelles et professionnelles\n`;
  explanation += `• La confidentialité des informations d'entreprise\n`;
  explanation += `• La stabilité et sécurité du système\n`;
  explanation += `• Le respect des politiques de sécurité organisationnelles\n\n`;

  explanation += `💡 BESOIN D'AIDE ?\n`;
  explanation += `Si vous avez besoin d'accéder à des données spécifiques, contactez votre administrateur système\n`;
  explanation += `ou utilisez les outils de gestion de configuration appropriés.`;

  return explanation;
}

/**
 * Generates a concise security message for API responses
 * @param directory - The directory that was blocked
 * @param reason - The reason for blocking
 * @returns Concise explanation message
 */
export function generateConciseSecurityMessage(directory: string, reason: string): string {
  const enterpriseDetection = detectEnterpriseSync(directory);

  let message = `🔒 Accès refusé pour sécurité : ${directory}\n\n`;
  message += `${reason}\n\n`;

  if (enterpriseDetection.isEnterprise) {
    message += `Ce répertoire contient des données d'entreprise sensibles (${enterpriseDetection.syncType}).\n`;
    message += `Utilisez plutôt :\n`;
    message += `• ~/.claude-server-commander/workspace\n`;
    message += `• ~/Documents/claude-projects\n`;
    message += `• Vos dossiers personnels non-professionnels\n\n`;
  } else {
    message += `Ce répertoire système est protégé pour votre sécurité.\n`;
    message += `Utilisez plutôt vos dossiers personnels.\n\n`;
  }

  message += `Cette restriction protège vos données et respecte les politiques de sécurité.`;

  return message;
}

/**
 * Validates if a directory can be safely added to allowedDirectories
 * @param directory - Directory to validate
 * @returns Object with validation result and message
 */
export function validateAllowedDirectory(directory: string): {
  success: boolean;
  error?: string;
  message?: string;
} {
  // Check that directory isn't sensitive
  const sensitiveDirectories = [
    // System directories
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
    '/bin', '/sbin', '/usr/bin', '/etc', '/var', '/boot',
    '/System', '/Library', '/Applications', // macOS system directories

    // OneDrive and SharePoint enterprise patterns
    'OneDrive - ', // Common OneDrive enterprise prefix
    'SharePoint', 'Sites', 'Teams', 'Microsoft Teams',
    'Office365', 'O365',

    // Common enterprise sync folder patterns
    'Sync', 'Shared Documents', 'Company Files', 'Corporate Data'
  ];

  const normalizedDir = path.normalize(directory);

  // Security check
  if (sensitiveDirectories.some(dir => normalizedDir.startsWith(dir))) {
    return {
      success: false,
      error: generateConciseSecurityMessage(directory, 'Sensitive system directory detected')
    };
  }

  // Check for traversal attempts
  if (normalizedDir.includes('..')) {
    return {
      success: false,
      error: generateConciseSecurityMessage(directory, 'Directory path contains traversal sequences')
    };
  }

  // Check for enterprise sync directories (OneDrive, SharePoint, Teams)
  const enterpriseDetection = detectEnterpriseSync(directory);
  if (enterpriseDetection.isEnterprise) {
    return {
      success: false,
      error: generateConciseSecurityMessage(directory, enterpriseDetection.reason || 'Enterprise sync directory detected')
    };
  }

  return {
    success: true,
    message: `Directory can be safely added: ${directory}`
  };
}

/**
 * Creates secure file operation wrapper
 * @param operation - Function to wrap with security checks
 * @returns Secured function
 */
export function secureFileOperation<T extends (...args: any[]) => any>(
  operation: T
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async function (...args: Parameters<T>): Promise<ReturnType<T>> {
    // Assume first parameter contains path information
    const params = args[0];
    if (!params || typeof params !== 'object' || !('path' in params)) {
      throw new Error('Invalid parameters for secure file operation');
    }

    const targetPath = params.path;
    const config = await configManager.getConfig();
    const allowedDirs = config.allowedDirectories || [];

    // Check if path is allowed
    if (!isPathAllowed(targetPath, allowedDirs)) {
      // Analyze the path for security insights
      const analysis = analyzePathSecurity(targetPath);

      let errorMessage = `Access denied to path: ${targetPath}. This path is not in the allowed directories.`;

      if (analysis.potentiallyDangerous) {
        errorMessage += ' WARNING: This path accesses a sensitive system area.';
      }

      if (analysis.containsTraversal) {
        errorMessage += ' WARNING: Path contains directory traversal sequences.';
      }

      throw new Error(errorMessage);
    }

    // Proceed with the operation if path is allowed
    return operation(...args);
  };
}

/**
 * Creates directories if they don't exist (for secure defaults)
 * @param directories - Array of directories to create
 */
export async function ensureSecureDirectories(directories: string[]): Promise<void> {
  const fs = await import('fs/promises');

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's okay
      console.warn(`Could not create directory ${dir}:`, error);
    }
  }
}